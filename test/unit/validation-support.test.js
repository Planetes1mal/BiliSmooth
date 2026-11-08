import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import evidence from '../../scripts/lib/evidence.cjs';
const { createEvidenceOutput, assertBuildMatches, playbackStalls, redactReportUrls } = evidence;
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bilismooth-validation-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('playback reports remove signed URL parameters even inside nested browser error messages', () => {
  const original = { error: 'Failed https://cdn.example/video.m4s?token=private#fragment', nested: ['https://name:secret@example.test/path?session=private', 206] };
  assert.deepEqual(redactReportUrls(original), { error: 'Failed https://cdn.example/video.m4s', nested: ['https://example.test/path', 206] });
  assert.ok(original.error.includes('token=private'));
});

test('playback stall measurements exclude inactive time but still detect a freeze after resume', () => {
  const sample = (at, patch = {}) => ({ at, frames: 1, lastFrameAt: 0, visibility: 'visible',
    media: { paused: false, seeking: false, ended: false }, ...patch });
  for (const inactive of [{ media: { paused: true } }, { media: { seeking: true } }, { visibility: 'hidden' }]) {
    const prefix = [sample(0), sample(250, inactive), sample(10000, inactive), sample(10250)];
    assert.deepEqual(playbackStalls([...prefix, sample(10500, { frames: 2, lastFrameAt: 10500 })]), []);
    assert.deepEqual(playbackStalls([...prefix, sample(11750), sample(12000, { frames: 2, lastFrameAt: 12000 })]),
      [{ startAt: 10250, endAt: 12000, durationMs: 1750, endReason: 'frames' }]);
  }
});

test('evidence runs land under local/runs/<suite>/<label> and existing evidence is never replaced', t => {
  const root = workspace(t), options = { root, suite: 'control-ui', env: {}, announce: false };
  const first = createEvidenceOutput({ ...options, args: ['--label=first'] });
  assert.equal(first, path.join(root, 'local', 'runs', 'control-ui', 'first'));
  fs.writeFileSync(path.join(first, 'report.json'), 'original');
  const second = createEvidenceOutput({ ...options, args: [], env: { BILISMOOTH_RUN_LABEL: 'second' } });
  assert.notEqual(first, second);
  assert.throws(() => createEvidenceOutput({ ...options, args: ['--label=first'] }), /already exists/);
  assert.equal(fs.readFileSync(path.join(first, 'report.json'), 'utf8'), 'original');
  const now = new Date('2026-11-08T07:02:13.200Z');
  const unlabeled = createEvidenceOutput({ ...options, args: [], now });
  assert.equal(path.basename(unlabeled), '20261108-070213');
  assert.throws(() => createEvidenceOutput({ ...options, args: [], now }), /already exists/);
  assert.throws(() => createEvidenceOutput({ ...options, args: ['--label=bad label'] }), /label/);
});

test('complete build verification detects stale non-UI inputs and any modified built asset', async t => {
  const root = workspace(t), output = path.join(root, 'dist/extension');
  fs.mkdirSync(output, { recursive: true });
  const hash = value => createHash('sha256').update(value).digest('hex');
  fs.writeFileSync(path.join(root, 'core.js'), 'core');
  fs.writeFileSync(path.join(output, 'background.js'), 'background');
  fs.writeFileSync(path.join(output, 'BUILD.json'), JSON.stringify({ version: '2.8.0', sourceSha256: { 'core.js': hash('core') }, outputSha256: { 'background.js': hash('background') } }));
  assert.deepEqual(await assertBuildMatches(root), { version: '2.8.0', sourceSha256: 1, outputSha256: 1 });
  fs.writeFileSync(path.join(root, 'core.js'), 'changed');
  await assert.rejects(assertBuildMatches(root), /Rebuild after source edits: core\.js/);
  fs.writeFileSync(path.join(root, 'core.js'), 'core');
  fs.writeFileSync(path.join(output, 'background.js'), 'changed');
  await assert.rejects(assertBuildMatches(root), /Built asset hash mismatch: background\.js/);
});
