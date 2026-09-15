import { mkdir, readFile, writeFile, readdir, rename, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildMotion } from './build-motion.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const inside = relative => {
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Build target outside workspace');
  return target;
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pkg = JSON.parse(await readFile(inside('package.json'), 'utf8'));
const motionInputs = await buildMotion();
const files = ['src/core/settings.js', 'src/core/routing-policy.js', 'src/core/media-observer.js',
  'src/core/playback-feedback.js', 'src/page/frame-monitor.js', 'src/page/network-probe.js',
  'src/page/request-interceptor.js', 'src/page/playback-kernel.js',
  'src/page/passive-session.js', 'src/page/control-bridge.js',
  'src/ui/surface.js', 'src/ui/entry-display.js', 'src/ui/motion-runtime.js', 'src/ui/choice.js', 'src/page/floating-control.js'];
const sourceBytes = await Promise.all(files.map(file => readFile(inside(file))));
const source = sourceBytes.map(bytes => bytes.toString()).join('\n');
if (!source.includes(`const VERSION = "${pkg.version}"`)) throw new Error('Runtime version mismatch');
const sourceSha256 = Object.fromEntries(files.map((file, index) => [file, hash(sourceBytes[index])]));
for (const input of ['package.json', 'src/extension/manifest.json']) sourceSha256[input] = hash(await readFile(inside(input)));
for (const input of motionInputs) sourceSha256[input] = hash(await readFile(inside(input)));
const manifest = JSON.parse(await readFile(inside('src/extension/manifest.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Source manifest version mismatch');
if (manifest.content_scripts.filter(entry => entry.world === 'MAIN').flatMap(entry => entry.js).join(',') !== 'playback.js')
  throw new Error('Manifest must load one playback bundle in MAIN world');
const outputs = new Map([['playback.js', Buffer.from(source)]]);
async function include(sourceFile, outputFile) {
  const bytes = await readFile(inside(sourceFile)); outputs.set(outputFile, bytes); sourceSha256[sourceFile] = hash(bytes);
}
for (const file of ['content.js', 'background.js']) await include('src/extension/' + file, file);
const logoBytes = await readFile(inside('src/ui/icon.svg'));
const inlineLogo = source.match(/const logo = '([^']+)'/)?.[1];
const logoShape = value => String(value).replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<svg[^>]*>|<\/svg>/g, '').trim();
if (!inlineLogo || logoShape(inlineLogo) !== logoShape(logoBytes.toString())) throw new Error('Floating and dashboard brand marks differ');
const logoPath = `icon.${hash(logoBytes).slice(0, 12)}.svg`;
await include('src/ui/icon.svg', logoPath);
await include('src/ui/surface.js', 'surface.js');
await include('src/ui/entry-display.js', 'entry-display.js');
await include('src/ui/choice.js', 'choice.js');
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
for (const file of ['settings.js', 'settings-migration.js']) await include('src/core/' + file, file);
async function includeControl(relative = '') {
  for (const entry of await readdir(inside('src/ui/control/' + relative), { withFileTypes: true })) {
    const name = relative + entry.name;
    if (entry.isSymbolicLink()) throw new Error('UI input cannot be a symlink: ' + name);
    if (entry.isDirectory()) await includeControl(name + '/');
    else if (/\.(?:js|css|html|svg|png|txt)$/.test(name)) await include('src/ui/control/' + name, 'control/' + name);
    else throw new Error('Unexpected UI input: ' + name);
  }
}
await includeControl();
if (!outputs.has('control/index.html')) throw new Error('The primary control page is missing');
const html = outputs.get('control/index.html').toString()
  .replace(/<meta\s+name=["']bilismooth-version["'][^>]*>/gi, '')
  .replace(/<head>/i, `<head>\n<meta name="bilismooth-version" content="${pkg.version}">`)
  .replaceAll('../icon.svg', '../' + logoPath)
  .replaceAll('../icons/32.png', '../' + iconPaths[32]);
outputs.set('control/index.html', Buffer.from(html));
for (const file of ['LICENSE', 'NOTICE.md', 'README.md', 'README.en.md', 'PRIVACY.md', 'CHANGELOG.md',
  'docs/licenses/bilibili-accelerator-MIT.txt', 'docs/images/floating-preview.png']) await include(file, file);
try { await include(`docs/releases/${pkg.version}.md`, 'RELEASE.md'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
outputs.set('BUILD.json', Buffer.from(JSON.stringify({ version: pkg.version, validation: 'candidate',
  bundle: 'playback.js', files, sourceSha256,
  outputSha256: Object.fromEntries([...outputs].map(([file, bytes]) => [file, hash(bytes)])) }, null, 2) + '\n'));

// Read all inputs before output mutation; retain the previous installable build.
const out = inside('dist/extension'), stage = inside(`dist/.extension-candidate-${process.pid}`);
try { await lstat(stage); throw new Error('Build staging path already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const [file, bytes] of outputs) { await mkdir(path.dirname(path.join(stage, file)), { recursive: true }); await writeFile(path.join(stage, file), bytes); }
let backup = null;
try {
  const stat = await lstat(out); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Output must be a regular workspace directory');
  backup = inside(`work/build-backups/extension-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`);
  await mkdir(path.dirname(backup), { recursive: true }); await rename(out, backup);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await rename(stage, out);
console.log(JSON.stringify({ version: pkg.version, output: out, files: outputs.size, previousBuild: backup }));
