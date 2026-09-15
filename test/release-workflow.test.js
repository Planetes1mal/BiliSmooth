const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

test('release gate reads synchronized versions and exact nonempty dated sections', async () => {
  const { checkRelease } = await import('../scripts/release.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bilismooth-release-gate-'));
  const write = async (name, value) => { const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  try {
    await write('package.json', { version: '2.8.2' });
    await write('package-lock.json', { version: '2.8.2', packages: { '': { version: '2.8.2' } } });
    await write('src/extension/manifest.json', { version: '2.8.2' });
    await write('src/page/passive-session.js', 'const VERSION = "2.8.2";');
    await write('CHANGELOG.md', '# Changes\n\n## 2.8.2 — 2026-09-15\n\nRelease changes.\n');
    await write('docs/releases/2.8.2.md', '# BiliSmooth 2.8.2 · First public release\n\nInstall the attached ZIP.');
    assert.equal((await checkRelease({ root, tag: 'v2.8.2' })).date, '2026-09-15');
    await assert.rejects(checkRelease({ root, tag: 'v2.8.20' }), /does not match/);
    for (const bad of ['## 2.8.20 — 2026-09-15\nChanges.', '## 2.8.2 — 2026-09-15\n\n## Older\nChanges.', '## 2.8.2 — 2026-02-30\nChanges.']) {
      await write('CHANGELOG.md', bad); await assert.rejects(checkRelease({ root }), /heading|empty|date/);
    }
    await write('CHANGELOG.md', '## 2.8.2 — 2026-09-15\nChanges.');
    await write('docs/releases/2.8.2.md', '# BiliSmooth 2.8.20\n\nWrong version.');
    await assert.rejects(checkRelease({ root }), /Release notes/);
    await write('src/extension/manifest.json', { version: '2.8.1' });
    await assert.rejects(checkRelease({ root }), /versions must match/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('release verification binds downloaded ZIP and checksum to the committed-source artifact', async () => {
  const { verifyAssetBytes } = await import('../scripts/release.mjs');
  const archive = Buffer.from('exact packaged ZIP bytes'), archiveName = 'BiliSmooth-2.8.2.zip';
  const hash = createHash('sha256').update(archive).digest('hex');
  const input = { archive, localArchive: archive, archiveName, checksum: Buffer.from(`${hash}  ${archiveName}\n`) };
  assert.equal(verifyAssetBytes(input), hash);
  assert.throws(() => verifyAssetBytes({ ...input, archive: Buffer.from('different uploaded bytes') }), /differ/);
  assert.throws(() => verifyAssetBytes({ ...input, checksum: Buffer.from(`${hash}  BiliSmooth-2.8.20.zip\n`) }), /differ/);
  assert.throws(() => verifyAssetBytes({ ...input, localArchive: Buffer.from('rebuilt uncommitted source') }), /differ/);
});
