const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '..');
const validator = import('../scripts/check-commit-message.mjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bilismooth-commit-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, 'scripts'));
  for (const file of ['commit.mjs', 'check-commit-message.mjs']) fs.copyFileSync(path.join(source, 'scripts', file), path.join(root, 'scripts', file));
  const git = (...args) => { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  git('init', '--quiet'); git('config', 'user.name', 'Fixture User'); git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgSign', 'false'); git('config', 'core.autocrlf', 'false');
  git('config', 'core.hooksPath', path.join(root, 'hooks')); fs.mkdirSync(path.join(root, 'hooks'));
  for (const file of ['[scope].txt', 'other.txt']) fs.writeFileSync(path.join(root, file), 'before\n');
  git('add', '--', '[scope].txt', 'other.txt'); git('commit', '--quiet', '-m', 'chore: initialize fixture repository');
  const run = (script, ...args) => spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: root, encoding: 'utf8' });
  const message = path.join(root, 'message.txt'); fs.writeFileSync(message, 'fix(core): preserve scoped file changes\n');
  return { root, git, run, message };
}

test('message policy accepts concrete conventional titles and rejects human or tool attribution equally', async () => {
  const { validateMessage } = await validator;
  for (const message of ['fix(player): preserve native response bodies\n', 'feat!: add selectable buffer indicators\n\nKeep current playback settings.\n', 'revert: restore previous routing defaults'])
    assert.deepEqual(validateMessage(message), []);
  for (const title of ['Update files', 'fix: cleanup', 'fix: 修复播放问题', 'fix: ' + 'x'.repeat(80), 'Merge branch release', 'Revert "fix: preserve response bodies"'])
    assert.ok(validateMessage(title).length, title);
  for (const attribution of ['Co-Authored-By: Any Person <person@example.invalid>', 'Signed-off-by: Fixture User', 'Reviewed-by: Human Reviewer', 'Assisted-by: Tool', 'Generated-by: Script', 'Tested-by: Tester', 'Author: Someone', '🤖 Generated with an assistant', '**Created by a contributor**', '- Thanks to a reviewer'])
    assert.ok(validateMessage('fix: preserve request metadata\n\n' + attribution).some(error => /attribution/.test(error)), attribution);
});

test('commit helper refuses unrelated staged changes and commits only literal authorized paths', t => {
  const h = fixture(t);
  fs.writeFileSync(path.join(h.root, '[scope].txt'), 'selected\n'); fs.writeFileSync(path.join(h.root, 'other.txt'), 'unrelated\n');
  h.git('add', '--', 'other.txt'); const before = h.git('diff', '--cached');
  const refused = h.run('commit.mjs', '--message-file', h.message, '--', '[scope].txt');
  assert.equal(refused.status, 1); assert.match(refused.stderr, /Unrelated staged paths/); assert.equal(h.git('diff', '--cached'), before);
  h.git('restore', '--staged', '--', 'other.txt');
  const committed = h.run('commit.mjs', '--message-file', h.message, '--', '[scope].txt');
  assert.equal(committed.status, 0, committed.stderr); assert.equal(h.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), '[scope].txt');
  assert.equal(h.git('diff', '--name-only'), 'other.txt'); assert.equal(h.git('diff', '--cached'), '');
  assert.equal(h.git('log', '-1', '--format=%B'), 'fix(core): preserve scoped file changes');
});

test('post-hook inspection and CI range validation reject attribution in the actual recorded message', t => {
  const h = fixture(t); assert.equal(h.run('check-commit-message.mjs', '--range=HEAD').status, 0);
  fs.writeFileSync(path.join(h.root, 'hooks', 'prepare-commit-msg'), '#!/bin/sh\nprintf "\\nReviewed-by: Fixture Reviewer\\n" >> "$1"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(h.root, '[scope].txt'), 'changed by hook fixture\n'); const before = h.git('rev-parse', 'HEAD');
  const result = h.run('commit.mjs', '--message-file', h.message, '--', '[scope].txt');
  assert.equal(result.status, 1); assert.match(result.stderr, /after hooks/); assert.notEqual(h.git('rev-parse', 'HEAD'), before);
  assert.match(h.git('log', '-1', '--format=%B'), /Reviewed-by:/);
  const check = h.run('check-commit-message.mjs', '--range=HEAD~1..HEAD'); assert.equal(check.status, 1); assert.match(check.stderr, /attribution/);
});
