'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { runLabel, createEvidenceOutput, assertBuildMatches } = require('../scripts/validation-support.cjs');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bilismooth-validation-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('new evidence labels isolate runs and existing labeled or legacy evidence is preserved', t => {
  const root = workspace(t), options = { root, suite: 'control-ui', version: '2.8.0', env: {}, announce: false };
  const first = createEvidenceOutput({ ...options, args: ['--label=first'] });
  fs.writeFileSync(path.join(first, 'report.json'), 'original');
  const second = createEvidenceOutput({ ...options, args: [], env: { BILISMOOTH_RUN_LABEL: 'second' } });
  assert.notEqual(first, second);
  assert.throws(() => createEvidenceOutput({ ...options, args: ['--label=first'] }), /already exists/);
  assert.equal(fs.readFileSync(path.join(first, 'report.json'), 'utf8'), 'original');
  const legacy = path.join(root, 'outputs');
  fs.writeFileSync(path.join(legacy, 'old-report.json'), 'historic');
  assert.throws(() => createEvidenceOutput({ ...options, suite: 'real-surface', legacyDirectory: legacy, reportFile: 'old-report.json', args: [] }), /already exists/);
  assert.equal(fs.readFileSync(path.join(legacy, 'old-report.json'), 'utf8'), 'historic');
});

test('unlabeled paths retain their convention while invalid labels cannot escape the evidence root', t => {
  const root = workspace(t), options = { root, suite: 'floating-control', version: '2.8.0', args: [], env: {}, announce: false };
  assert.equal(createEvidenceOutput(options), path.join(root, 'outputs', 'floating-control-2.8.0'));
  assert.throws(() => createEvidenceOutput(options), /already exists/);
  for (const label of ['', '../elsewhere', 'a/b', 'a\\b', '.']) assert.throws(() => runLabel(['--label=' + label], {}), /report label/);
  assert.equal(runLabel(['--label=cli'], { BILISMOOTH_RUN_LABEL: 'env' }), 'cli');
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
