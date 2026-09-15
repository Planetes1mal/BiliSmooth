'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

function runLabel(args = process.argv.slice(2), env = process.env) {
  const argument = args.find(value => value.startsWith('--label='));
  const label = argument === undefined ? env.BILISMOOTH_RUN_LABEL : argument.slice(8);
  if (label === undefined) return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(label)) throw Error('Use a report label of 1–80 letters, digits, hyphens or underscores');
  return label;
}

// Preserve the documented unlabeled paths, but never silently replace evidence.
// A label places all artifacts in outputs/<suite>-<version>/<label>/ instead.
function createEvidenceOutput({ root, suite, version, legacyDirectory, reportFile, args, env, announce = true }) {
  const label = runLabel(args, env);
  const base = path.join(root, 'outputs', suite + '-' + version);
  const directory = label ? path.join(base, label) : legacyDirectory || base;
  const shared = !label && legacyDirectory === path.join(root, 'outputs');
  const conflict = reportFile && fs.existsSync(path.join(directory, reportFile));
  if (conflict || (!shared && fs.existsSync(directory))) {
    throw Error('Evidence already exists at ' + directory + '; choose a new --label or BILISMOOTH_RUN_LABEL');
  }
  fs.mkdirSync(shared ? directory : path.dirname(directory), { recursive: true });
  if (!shared) fs.mkdirSync(directory);
  const marker = path.join(directory, '.' + suite + '-' + version + '.run.json');
  try {
    fs.writeFileSync(marker, JSON.stringify({ suite, version, label, startedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw Error('Evidence run already reserved at ' + directory + '; choose a new --label or BILISMOOTH_RUN_LABEL');
    throw error;
  }
  if (announce) console.log('[evidence] ' + directory);
  return directory;
}

async function assertBuildMatches(root, buildDirectory = path.join(root, 'dist/extension')) {
  const build = JSON.parse(await fs.promises.readFile(path.join(buildDirectory, 'BUILD.json'), 'utf8'));
  const counts = {};
  for (const [kind, base] of [['sourceSha256', root], ['outputSha256', buildDirectory]]) {
    const entries = Object.entries(build[kind] || {});
    assert.ok(entries.length > 0, kind + ' must enumerate build inputs or outputs');
    counts[kind] = entries.length;
    for (const [file, expected] of entries) {
      const absolute = path.resolve(base, file);
      assert.ok(absolute.startsWith(path.resolve(base) + path.sep), 'Build path stays within its root: ' + file);
      const actual = createHash('sha256').update(await fs.promises.readFile(absolute)).digest('hex');
      assert.equal(actual, expected, (kind === 'sourceSha256' ? 'Rebuild after source edits: ' : 'Built asset hash mismatch: ') + file);
    }
  }
  return { version: build.version, ...counts };
}

module.exports = { runLabel, createEvidenceOutput, assertBuildMatches };
