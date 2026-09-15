// One release gate locally and in CI. Git owns pushes; GitHub Actions owns publication.
import { readFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPOSITORY = 'Planetes1mal/BiliSmooth', ORIGIN = `https://github.com/${REPOSITORY}.git`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fail = message => { throw Error(message); };
async function run(command, args, cwd = ROOT, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '', errors = '';
    child.stdout?.on('data', bytes => { output += bytes; }); child.stderr?.on('data', bytes => { errors += bytes; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(Error(`${command} ${args.join(' ')} failed (${code}). ${errors.trim()}`)));
  });
}
const git = (args, cwd = ROOT) => run('git', args, cwd, true);
const json = async file => JSON.parse(await readFile(file, 'utf8'));

export async function checkRelease({ root = ROOT, tag } = {}) {
  const [pkg, lock, manifest, runtime, changelog] = await Promise.all([
    json(path.join(root, 'package.json')), json(path.join(root, 'package-lock.json')),
    json(path.join(root, 'src/extension/manifest.json')),
    readFile(path.join(root, 'src/page/passive-session.js'), 'utf8'), readFile(path.join(root, 'CHANGELOG.md'), 'utf8')]);
  const version = pkg.version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version === '0.0.0' || version.split('.').some(part => Number(part) > 65535))
    fail('package.json needs a nonzero Chrome x.y.z version with components at most 65535.');
  tag ||= `v${version}`;
  if (tag !== `v${version}`) fail(`Tag ${tag} does not match v${version}.`);
  if ([lock.version, lock.packages?.['']?.version, manifest.version, runtime.match(/const VERSION = ["']([^"']+)["']/)?.[1]].some(value => value !== version))
    fail('package.json, package-lock.json, manifest and playback runtime versions must match.');
  const headings = [...changelog.matchAll(/^## (.+)\r?$/gm)];
  const matching = headings.filter(row => new RegExp(`^${escape(version)} — (\\d{4}-\\d{2}-\\d{2})$`).test(row[1].trim()));
  if (matching.length !== 1) fail(`Expected exactly one dated CHANGELOG heading: ## ${version} — YYYY-MM-DD`);
  const section = matching[0], date = section[1].trim().slice(-10), end = headings[headings.indexOf(section) + 1]?.index ?? changelog.length;
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) fail('CHANGELOG release date is invalid.');
  if (!changelog.slice(section.index + section[0].length, end).trim()) fail('CHANGELOG release section must not be empty.');
  const notesPath = `docs/releases/${version}.md`, notes = await readFile(path.join(root, notesPath), 'utf8');
  const firstLine = notes.split(/\r?\n/)[0];
  if (!new RegExp(`^# BiliSmooth ${escape(version)}(?: · .+)?$`).test(firstLine) || !notes.slice(firstLine.length).trim())
    fail(`Release notes must start with # BiliSmooth ${version} and contain a nonempty body.`);
  let previousTag = null, commits = null, hasGit = false;
  try {
    await git(['rev-parse', '--verify', 'HEAD'], root);
    hasGit = true;
    previousTag = (await git(['tag', '--merged', 'HEAD', '--sort=-version:refname'], root)).split('\n').find(value => /^v\d+\.\d+\.\d+$/.test(value) && value !== tag) || null;
    if (previousTag) commits = (await git(['log', '--format=%h %s', `${previousTag}..HEAD`], root)).split('\n').filter(Boolean);
  } catch { /* A source archive has no local Git range; file checks still apply. */ }
  if (commits && !commits.length) fail(`No commits after ${previousTag}; release check needs a changed revision.`);
  if (hasGit) await run(process.execPath, ['scripts/check-commit-message.mjs', `--range=${previousTag ? `${previousTag}..HEAD` : 'HEAD'}`], root);
  return { version, tag, date, notesPath, previousTag, commits };
}

function apiHeaders(accept = 'application/vnd.github+json') {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  return { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'BiliSmooth-release', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
async function api(endpoint, { missing = false } = {}) {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${endpoint}`, { headers: apiHeaders(), signal: AbortSignal.timeout(20000) });
  if (missing && response.status === 404) return null;
  if (!response.ok) fail(`GitHub API ${response.status} at ${endpoint}. Check repository access or set GH_TOKEN for authenticated API limits.`);
  return response.json();
}
async function releaseInfo(tag, draft = false) {
  if (draft) return (await api('/releases?per_page=100')).find(release => release.tag_name === tag) || null;
  return api(`/releases/tags/${encodeURIComponent(tag)}`, { missing: true });
}
async function download(asset) {
  const response = await fetch(asset.url, { headers: apiHeaders('application/octet-stream'), signal: AbortSignal.timeout(120000) });
  if (!response.ok) fail(`Cannot download release asset ${asset.name}: HTTP ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}
export function verifyAssetBytes({ archive, checksum, localArchive, archiveName }) {
  const expected = sha256(localArchive), line = checksum.toString('utf8').trim();
  if (line !== `${expected}  ${archiveName}` || sha256(archive) !== expected)
    fail('Published ZIP, published SHA256SUMS.txt and the local committed-source artifact differ. Do not replace a published asset; investigate the build or publish a corrected version.');
  return expected;
}
async function verifyAssets(release, spec) {
  const archiveName = `BiliSmooth-${spec.version}.zip`;
  const archive = release.assets.find(asset => asset.name === archiveName), checksum = release.assets.find(asset => asset.name === 'SHA256SUMS.txt');
  if (!archive || !checksum) fail(`Release ${spec.tag} lacks ${archiveName} or SHA256SUMS.txt: ${release.html_url}`);
  const [remoteArchive, remoteChecksum, localArchive] = await Promise.all([download(archive), download(checksum), readFile(path.join(ROOT, 'outputs', archiveName))]);
  const hash = verifyAssetBytes({ archive: remoteArchive, checksum: remoteChecksum, localArchive, archiveName });
  const result = { verified: true, tag: spec.tag, release: release.html_url, draft: release.draft, archive: archiveName, sha256: hash };
  console.log(JSON.stringify(result)); return result;
}
async function verify(spec, { draft = false, timeout = 900 } = {}) {
  if (draft) {
    const release = await releaseInfo(spec.tag, true);
    if (!release?.draft) fail(`Expected an existing draft for ${spec.tag}; published releases must not be overwritten.`);
    return verifyAssets(release, spec);
  }
  const head = await git(['rev-parse', 'HEAD']), deadline = Date.now() + timeout * 1000;
  let last = '';
  do {
    const response = await api(`/actions/workflows/release.yml/runs?head_sha=${head}&event=push&per_page=20`, { missing: true });
    const job = response?.workflow_runs.find(run => run.head_branch === spec.tag) || response?.workflow_runs[0];
    const state = job ? `${job.status}/${job.conclusion || 'pending'}` : 'awaiting-tag-workflow';
    if (state !== last) { console.log(JSON.stringify({ tag: spec.tag, action: state, url: job?.html_url || `https://github.com/${REPOSITORY}/actions` })); last = state; }
    if (job?.status === 'completed' && job.conclusion !== 'success') fail(`Release workflow ${job.conclusion}: ${job.html_url}. Correct its failing step and rerun the existing tag workflow; do not move ${spec.tag}.`);
    if (job?.status === 'completed') {
      const release = await releaseInfo(spec.tag);
      if (release && !release.draft) return verifyAssets(release, spec);
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(30000, deadline - Date.now())));
  } while (Date.now() <= deadline);
  fail(`Timed out waiting for published ${spec.tag}. Inspect https://github.com/${REPOSITORY}/actions/workflows/release.yml then rerun: node scripts/release.mjs verify --tag ${spec.tag}`);
}
async function tagTargets(tag) {
  let local = null;
  try { local = await git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]); } catch {}
  const refs = (await git(['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`])).split('\n').filter(Boolean).map(line => line.split(/\s+/));
  return { local, remote: refs.find(([, name]) => name.endsWith('^{}'))?.[0] || refs[0]?.[0] || null };
}
async function cleanMain() {
  if (await git(['branch', '--show-current']) !== 'main') fail('Publish requires the committed main checkout.');
  if (await git(['status', '--porcelain=v1', '--untracked-files=normal'])) fail('Commit the intended release changes and leave a clean checkout before publish.');
  for (const args of [['remote', 'get-url', 'origin'], ['remote', 'get-url', '--push', 'origin']]) {
    if (await git(args) !== ORIGIN) fail(`Publish origin must be exactly ${ORIGIN}.`);
  }
  return git(['rev-parse', 'HEAD']);
}
async function publish(spec, options) {
  const head = await cleanMain(), targets = await tagTargets(spec.tag);
  if ([targets.local, targets.remote].some(value => value && value !== head)) fail(`${spec.tag} already points to another commit. Never move a release tag; prepare a new version.`);
  const existing = await releaseInfo(spec.tag);
  if (existing && !existing.draft) fail(`${spec.tag} is already published. Use verify; do not replace its assets or tag.`);
  // A normalized checkout makes local and Linux CI ZIP bytes comparable even
  // when Git considers a Windows worktree with mixed newlines clean.
  await mkdir(path.join(ROOT, 'work'), { recursive: true });
  const worktree = await mkdtemp(path.join(ROOT, 'work', 'release-'));
  await git(['worktree', 'add', '--detach', worktree, head]);
  console.log(JSON.stringify({ stage: 'build-committed-source', head, worktree }));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // Windows .cmd launch needs cmd.exe; arguments here are fixed project commands.
  const npmRun = args => process.platform === 'win32'
    ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], worktree) : run(npm, args, worktree);
  try {
    await checkRelease({ root: worktree, tag: spec.tag });
    await npmRun(['ci', '--ignore-scripts']); await npmRun(['test']); await npmRun(['run', 'test:workflow']);
    await npmRun(['run', 'build']); await run(process.execPath, ['scripts/package.mjs'], worktree);
    await run(process.env.PYTHON || 'python', ['scripts/verify-package.py'], worktree);
    await mkdir(path.join(ROOT, 'outputs'), { recursive: true });
    for (const file of [`BiliSmooth-${spec.version}.zip`, 'SHA256SUMS.txt', `release-${spec.version}-files.json`])
      await copyFile(path.join(worktree, 'outputs', file), path.join(ROOT, 'outputs', file));
  } catch (error) { fail(`${error.message}\nCommitted-source build retained at ${worktree}`); }
  // This exact directory was created by this invocation beneath work/.
  if (!worktree.startsWith(path.join(ROOT, 'work') + path.sep)) fail('Unexpected release worktree path.');
  await git(['worktree', 'remove', '--force', worktree]);
  if (await cleanMain() !== head) fail('HEAD changed during release validation; rerun publish for the intended commit.');
  const latest = await tagTargets(spec.tag);
  if ([latest.local, latest.remote].some(value => value && value !== head)) fail(`${spec.tag} changed during validation; refusing to push.`);
  await run('git', ['push', 'origin', 'HEAD:refs/heads/main']);
  if (!latest.local) await git(['tag', '-a', spec.tag, '-m', `BiliSmooth ${spec.version}`, head]);
  await run('git', ['push', 'origin', `refs/tags/${spec.tag}:refs/tags/${spec.tag}`]);
  return verify(spec, options);
}

async function main() {
  const args = process.argv.slice(2), command = args.shift() || 'check', options = {};
  while (args.length) {
    const value = args.shift();
    if (value === '--draft') options.draft = true;
    else if (value === '--tag') options.tag = args.shift();
    else if (value === '--timeout') options.timeout = Number(args.shift());
    else fail(`Unknown argument ${value}. Use check|publish|verify [--tag vX.Y.Z] [--timeout seconds]; --draft is for CI verification.`);
  }
  if (options.timeout !== undefined && (!Number.isInteger(options.timeout) || options.timeout < 30 || options.timeout > 1800)) fail('--timeout must be 30–1800 seconds.');
  const spec = await checkRelease(options);
  if (command === 'check') console.log(JSON.stringify(spec));
  else if (command === 'publish') { if (options.draft) fail('publish does not accept --draft.'); await publish(spec, options); }
  else if (command === 'verify') await verify(spec, options);
  else fail('Use check, publish or verify.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
