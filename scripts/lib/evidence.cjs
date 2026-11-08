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

const timestampLabel = (now = new Date()) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');

// Every run gets its own folder under local/runs/<suite>/<label>/; an unlabeled
// run is named by its start time. Existing evidence is never replaced.
function createEvidenceOutput({ root, suite, args, env, announce = true, now } = {}) {
  if (!root || !suite) throw Error('createEvidenceOutput needs root and suite');
  const label = runLabel(args, env) || timestampLabel(now);
  const directory = path.join(root, 'local', 'runs', suite, label);
  if (fs.existsSync(directory)) throw Error('Evidence already exists at ' + directory + '; choose a new --label or BILISMOOTH_RUN_LABEL');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, '.run.json'), JSON.stringify({ suite, label, startedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });
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

function playbackStalls(samples) {
  const stalls = [];
  let activeSince = null, started = null, previousVideoId;
  for (const sample of samples) {
    if (sample.videoId !== previousVideoId) {
      if (started !== null) stalls.push({ startAt: started, endAt: sample.at, durationMs: sample.at - started, endReason: 'player-replaced' });
      activeSince = null; started = null; previousVideoId = sample.videoId;
    }
    const media = sample.media;
    const active = sample.frames > 0 && sample.visibility === 'visible' && media &&
      !media.paused && !media.seeking && !media.ended;
    if (active) activeSince ??= sample.at;
    else activeSince = null;
    // A resume starts a new observation window. The last frame can belong to
    // the time before a pause, seek or hidden tab and must not backdate a stall.
    const since = active ? Math.max(activeSince, sample.lastFrameAt) : null;
    const frozen = active && sample.at - since >= 1500;
    if (frozen && started === null) started = since;
    if (!frozen && started !== null) {
      stalls.push({ startAt: started, endAt: sample.at, durationMs: sample.at - started,
        endReason: media?.paused ? 'pause' : media?.seeking ? 'seek' : sample.visibility !== 'visible' ? 'hidden'
          : media?.ended ? 'ended' : 'frames' });
      started = null;
    }
  }
  if (started !== null) {
    const endAt = samples.at(-1).at;
    stalls.push({ startAt: started, endAt, durationMs: endAt - started, endReason: 'observation-ended' });
  }
  return stalls;
}

function redactReportUrls(value) {
  if (typeof value === 'string') return value.replace(/https?:\/\/[^\s"'<>]+/g, raw => {
    try { const url = new URL(raw); url.search = ''; url.hash = ''; url.username = ''; url.password = ''; return url.href; }
    catch { return '[redacted-url]'; }
  });
  if (Array.isArray(value)) return value.map(redactReportUrls);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactReportUrls(item)]));
  return value;
}

module.exports = { runLabel, timestampLabel, createEvidenceOutput, assertBuildMatches, playbackStalls, redactReportUrls };
