// Builds dist/extension: the MAIN-world bundle (core + page modules by esbuild, then the UI
// scripts appended as classic scripts), the classic settings scripts for content.js and
// background.js, the dashboard files and the packaged documents.
import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { buildMotion } from './lib/motion.mjs';
import { extractReleaseNotes } from './lib/changelog.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const inside = relative => {
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Build target outside workspace');
  return target;
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pkg = JSON.parse(await readFile(inside('package.json'), 'utf8'));
const motionInputs = await buildMotion();
const sourceSha256 = {};
async function bundle(entry, globalName) {
  const result = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser',
    target: ['chrome120'], write: false, metafile: true, legalComments: 'none', charset: 'utf8', loader: { '.css': 'text', '.svg': 'text' },
    ...(globalName ? { globalName } : {}), define: { __BILISMOOTH_VERSION__: JSON.stringify(pkg.version) } });
  for (const input of Object.keys(result.metafile.inputs)) sourceSha256[input] = hash(await readFile(inside(input)));
  return result.outputFiles[0].text;
}
// The floating control runs after the core in the same MAIN-world file: Motion first (a classic script that
// publishes BiliSmoothMotion), then the floating bundle, which reads BiliSmoothRuntime and BiliSmoothSettings.
const motionBytes = await readFile(inside('src/ui/motion-runtime.js'));
sourceSha256['src/ui/motion-runtime.js'] = hash(motionBytes);
const playback = await bundle('src/page/main.js') + '\n' + motionBytes.toString() + '\n' + await bundle('src/ui/floating/index.js');
const outputs = new Map([['playback.js', Buffer.from(playback)]]);
outputs.set('settings.js', Buffer.from(await bundle('src/core/settings.js', 'BiliSmoothSettings')));
outputs.set('settings-migration.js', Buffer.from(await bundle('src/core/settings-migration.js', 'BiliSmoothSettingsMigration')));
for (const input of ['package.json', 'src/extension/manifest.json']) sourceSha256[input] = hash(await readFile(inside(input)));
for (const input of motionInputs) sourceSha256[input] = hash(await readFile(inside(input)));
const manifest = JSON.parse(await readFile(inside('src/extension/manifest.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Source manifest version mismatch');
if (manifest.content_scripts.filter(entry => entry.world === 'MAIN').flatMap(entry => entry.js).join(',') !== 'playback.js')
  throw new Error('Manifest must load one playback bundle in MAIN world');
async function include(sourceFile, outputFile) {
  const bytes = await readFile(inside(sourceFile)); outputs.set(outputFile, bytes); sourceSha256[sourceFile] = hash(bytes);
}
for (const file of ['content.js', 'background.js']) await include('src/extension/' + file, file);
for (const locale of ['en', 'zh_CN'])
  await include(`src/extension/_locales/${locale}/messages.json`, `_locales/${locale}/messages.json`);
const logoBytes = await readFile(inside('src/ui/icon.svg'));
const logoPath = `icon.${hash(logoBytes).slice(0, 12)}.svg`;
await include('src/ui/icon.svg', logoPath);
await include('src/ui/motion-runtime.js', 'motion-runtime.js');
const iconPaths = {};
for (const size of [16, 32, 48, 128]) {
  const input = `src/extension/icons/${size}.png`, bytes = await readFile(inside(input));
  iconPaths[size] = `icons/${size}.${hash(bytes).slice(0, 12)}.png`;
  await include(input, iconPaths[size]);
}
manifest.icons = iconPaths;
manifest.action.default_icon = { ...iconPaths };
outputs.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
// The dashboard: one bundle, one stylesheet (shared tokens first), the page and the third-party licenses.
outputs.set('control/app.js', Buffer.from(await bundle('src/ui/dashboard/main.js')));
const cssInputs = ['src/ui/shared/tokens.css', 'src/ui/dashboard/dashboard.css'];
const cssBytes = await Promise.all(cssInputs.map(file => readFile(inside(file))));
cssInputs.forEach((file, index) => { sourceSha256[file] = hash(cssBytes[index]); });
outputs.set('control/app.css', Buffer.from(cssBytes.map(bytes => bytes.toString()).join('\n')));
await include('src/ui/dashboard/index.html', 'control/index.html');
await include('src/ui/dashboard/motion-LICENSE.txt', 'control/motion-LICENSE.txt');
await include('src/ui/dashboard/tabler-LICENSE.txt', 'control/tabler-LICENSE.txt');
const html = outputs.get('control/index.html').toString()
  .replace(/<meta\s+name=["']bilismooth-version["'][^>]*>/gi, '')
  .replace(/<head>/i, `<head>\n<meta name="bilismooth-version" content="${pkg.version}">`)
  .replaceAll('../icon.svg', '../' + logoPath)
  .replaceAll('../icons/32.png', '../' + iconPaths[32]);
outputs.set('control/index.html', Buffer.from(html));
for (const file of ['LICENSE', 'NOTICE.md', 'README.md', 'README.en.md', 'PRIVACY.md', 'PRIVACY.en.md', 'CHANGELOG.md',
  'docs/licenses/bilibili-accelerator-MIT.txt']) await include(file, file);
const releaseNotes = extractReleaseNotes(outputs.get('CHANGELOG.md').toString(), pkg.version);
outputs.set('RELEASE.md', Buffer.from(releaseNotes.body));
outputs.set('BUILD.json', Buffer.from(JSON.stringify({ version: pkg.version, validation: 'candidate',
  bundle: 'playback.js', sourceSha256: Object.fromEntries(Object.entries(sourceSha256).sort()),
  outputSha256: Object.fromEntries([...outputs].map(([file, bytes]) => [file, hash(bytes)])) }, null, 2) + '\n'));

// Read all inputs before output mutation; retain the previous installable build.
const out = inside('dist/extension'), stage = inside(`dist/.extension-candidate-${process.pid}`);
try { await lstat(stage); throw new Error('Build staging path already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const [file, bytes] of outputs) { await mkdir(path.dirname(path.join(stage, file)), { recursive: true }); await writeFile(path.join(stage, file), bytes); }
let backup = null;
try {
  const stat = await lstat(out); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Output must be a regular workspace directory');
  backup = inside(`local/tmp/build-backups/extension-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`);
  await mkdir(path.dirname(backup), { recursive: true }); await rename(out, backup);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await rename(stage, out);
await mkdir(inside('local/build'), { recursive: true });
await writeFile(inside(releaseNotes.notesPath), releaseNotes.body);
console.log(JSON.stringify({ version: pkg.version, output: out, files: outputs.size, previousBuild: backup }));
