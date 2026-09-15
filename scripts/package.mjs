import path from 'node:path';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url)), directory = path.join(root, 'dist/extension');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
const build = JSON.parse(await readFile(path.join(directory, 'BUILD.json'), 'utf8'));
if (build.version !== manifest.version) throw new Error('Build and manifest versions differ');
async function listFiles(folder, prefix = '') {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Package cannot include symlinks');
    if (entry.isDirectory()) result.push(...await listFiles(path.join(folder, entry.name), prefix + entry.name + '/'));
    else result.push(prefix + entry.name);
  }
  return result.sort();
}
const files = await listFiles(directory), expected = [...Object.keys(build.outputSha256), 'BUILD.json'].sort();
if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error('Package contains missing or stale output files; rebuild first');
const input = await Promise.all(files.map(async name => ({ name, bytes: await readFile(path.join(directory, name)) })));
for (const { name, bytes } of input) {
  if (name !== 'BUILD.json' && hash(bytes) !== build.outputSha256[name]) throw new Error('Output changed after build: ' + name);
  if (!/^(?:manifest\.json|BUILD\.json|playback\.js|content\.js|background\.js|icon\.[a-f0-9]{12}\.svg|surface\.js|entry-display\.js|motion-runtime\.js|choice\.js|settings(?:-migration)?\.js|LICENSE|NOTICE\.md|README(?:\.en)?\.md|PRIVACY\.md|CHANGELOG\.md|RELEASE\.md|docs\/licenses\/bilibili-accelerator-MIT\.txt|docs\/images\/floating-preview\.png|icons\/(?:16|32|48|128)\.[a-f0-9]{12}\.png|control\/[a-zA-Z0-9_./-]+\.(?:html|css|js|svg|png|txt))$/.test(name))
    throw new Error('Unexpected package path: ' + name);
}
// Standard ZIP deflate + CRC32, with paths relative to the extension root.
const table = Array.from({ length: 256 }, (_, n) => { for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; };
const local = [], central = []; let offset = 0;
for (const { name, bytes } of input) {
  const encoded = Buffer.from(name), compressed = deflateRawSync(bytes), crc = crc32(bytes);
  const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(encoded.length, 26);
  local.push(header, encoded, compressed);
  const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(33, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(encoded.length, 28); entry.writeUInt32LE(offset, 42);
  central.push(entry, encoded); offset += header.length + encoded.length + compressed.length;
}
const directoryBytes = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...local, directoryBytes, end]), archive = `outputs/BiliSmooth-${manifest.version}.zip`;
await mkdir(path.join(root, 'outputs'), { recursive: true }); await writeFile(path.join(root, archive), zip);
const checksums = 'outputs/SHA256SUMS.txt';
await writeFile(path.join(root, checksums), `${hash(zip)}  ${path.basename(archive)}\n`);
await writeFile(path.join(root, `outputs/release-${manifest.version}-files.json`), JSON.stringify({ version: manifest.version, archive, sha256: hash(zip), files,
  fileSha256: Object.fromEntries(input.map(({ name, bytes }) => [name, hash(bytes)])) }, null, 2) + '\n');
console.log(JSON.stringify({ version: manifest.version, archive, checksums, files: files.length, bytes: zip.length, sha256: hash(zip) }));
