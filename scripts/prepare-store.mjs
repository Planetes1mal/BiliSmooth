import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const workspace = relative => {
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Store output must stay inside the workspace.');
  return target;
};
const source = path.join(root, 'docs/chrome-web-store');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const python = process.env.PYTHON || 'python';
const documents = ['README.md', 'listing.en.md', 'listing.zh-CN.md', 'privacy-fields.en.md', 'reviewer-guide.en.md'];
const dimensions = {
  'icon-128.png': [128, 128],
  'promo-small-440x280.png': [440, 280],
  'screenshot-dashboard-en.png': [1280, 800],
  'screenshot-floating-en.png': [1280, 800]
};

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, shell: false, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}).`)));
  });
}

const manifest = JSON.parse(await readFile(path.join(root, 'src/extension/manifest.json'), 'utf8'));
for (const locale of ['en', 'zh_CN']) {
  const messages = JSON.parse(await readFile(path.join(root, `src/extension/_locales/${locale}/messages.json`), 'utf8'));
  for (const [field, limit] of [['name', 75], ['description', 132]]) {
    const key = manifest[field].match(/^__MSG_(\w+)__$/)?.[1];
    const value = key ? messages[key]?.message : manifest[field];
    if (!value?.trim() || value.length > limit) throw new Error(`${locale} manifest ${field} must contain 1–${limit} characters.`);
  }
}
for (const [file, [width, height]] of Object.entries(dimensions)) {
  const bytes = await readFile(path.join(source, 'assets', file));
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height)
    throw new Error(`${file} must be a ${width} × ${height} PNG.`);
}

await run(process.execPath, ['scripts/build.mjs']);
await run(process.execPath, ['scripts/package.mjs']);
await run(python, ['scripts/verify-package.py']);

const output = workspace(`outputs/chrome-web-store-${version}`);
const stage = await mkdtemp(workspace(`outputs/.chrome-web-store-${version}-`));
for (const file of documents) {
  const text = await readFile(path.join(source, file), 'utf8');
  // The submission folder is flat, so its privacy links need one local level.
  await writeFile(path.join(stage, file), text.replaceAll('(../../PRIVACY', '(./PRIVACY'));
}
for (const file of ['PRIVACY.md', 'PRIVACY.en.md']) await copyFile(path.join(root, file), path.join(stage, file));
for (const file of [`BiliSmooth-${version}.zip`, 'SHA256SUMS.txt'])
  await copyFile(path.join(root, 'outputs', file), path.join(stage, file));
await cp(path.join(source, 'assets'), path.join(stage, 'assets'), { recursive: true });

let archive = `${output}-materials.zip`;
const stagedArchive = `${stage}.zip`;
await run(python, ['-c', `
from pathlib import Path
import sys, zipfile
folder, archive = Path(sys.argv[1]), Path(sys.argv[2])
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as output:
    for file in sorted(folder.rglob('*')):
        if file.is_file():
            entry = zipfile.ZipInfo(file.relative_to(folder).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(entry, file.read_bytes())
with zipfile.ZipFile(archive) as output:
    assert output.testzip() is None, 'Submission archive CRC failure'
`, stage, stagedArchive]);

let previous = null;
try {
  await lstat(output);
  const backups = workspace('work/store-backups');
  await mkdir(backups, { recursive: true });
  previous = workspace(`work/store-backups/chrome-web-store-${version}-${Date.now()}`);
  await rename(output, previous);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await rename(stage, output);
let previousArchive = null;
try {
  await lstat(archive);
  const backups = workspace('work/store-backups');
  await mkdir(backups, { recursive: true });
  const backup = workspace(`work/store-backups/chrome-web-store-${version}-materials-${Date.now()}.zip`);
  await rename(archive, backup);
  previousArchive = backup;
} catch (error) {
  if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code))
    archive = workspace(`outputs/chrome-web-store-${version}-materials-${Date.now()}.zip`);
  else if (error.code !== 'ENOENT') throw error;
}
await rename(stagedArchive, archive);
console.log(JSON.stringify({ version, upload: path.join(output, `BiliSmooth-${version}.zip`), materials: output, archive, previous, previousArchive }));
