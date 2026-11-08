// Reproducible, bounded playback observations. Reports contain no signed URLs or cookies.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { requireLoginCookies, checkLogin } = require('../lib/login.cjs');
const local = require('../lib/local.cjs');
const { assertBuildMatches, redactReportUrls } = require('../lib/evidence.cjs');
const { observe, snapshot, summarize } = require('../lib/playback-observer.cjs');
const root = path.resolve(__dirname, '../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const armNames = ['native', 'p0', 'bilismooth', 'upstream'];
const defaultArms = ['native', 'p0', 'bilismooth'];
const hostPolicy = require('../../src/core/routing-policy.js').createPolicy({});
// Bilibili's own saved quality preference; a fresh signed-in profile otherwise starts at 1080P.
const qualityPreference = { '4k': '120', '1080p60': '116' };
// A literal zero resumes server history; 1 ms selects the opening frame through the site's own URL handling.
const startPosition = { method: 'Bilibili URL parameter', parameter: 't', seconds: 0.001 };

async function benchmarkWindow() {
  const browser = await chromium.launch({ channel: 'chromium', headless: false,
    args: ['--window-position=0,0', '--window-size=800,600', '--mute-audio'] });
  try {
    const page = await browser.newPage({ viewport: null });
    const display = await page.evaluate(() => ({ width: screen.availWidth, height: screen.availHeight,
      left: screen.availLeft, top: screen.availTop }));
    return { display, width: Math.min(1280, display.width - 80), height: Math.min(800, display.height - 80),
      left: display.left + 40, top: display.top + 40 };
  } finally { await browser.close(); }
}

function options(argv) {
  const value = (name, fallback) => argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  if (argv.includes('--help')) return { help: true };
  const mode = value('mode', 'measure'), arms = value('arms', mode === 'screen' ? 'native' : defaultArms.join(',')).split(',');
  if (!['screen', 'measure'].includes(mode)) throw Error('--mode must be screen or measure');
  if (!arms.length || new Set(arms).size !== arms.length || arms.some(arm => !armNames.includes(arm))) throw Error('Unknown or repeated arm');
  if (mode === 'screen' && (arms.length !== 1 || arms[0] !== 'native')) throw Error('Screening uses native only');
  if (!argv.includes('--auth')) throw Error('Benchmark requires --auth; log in once in the npm run dev browser');
  const videos = value('videos'), output = value('output');
  if (!videos || !output) throw Error('--videos and --output are required');
  const seconds = Number(value('seconds', mode === 'screen' ? 45 : 60)), pause = Number(value('pause', 15));
  if (!Number.isInteger(seconds) || seconds < (mode === 'measure' ? 60 : 15) || seconds > 180) throw Error('--seconds must be 60–180 for measure or 15–180 for screen');
  if (!Number.isInteger(pause) || pause < 10 || pause > 20) throw Error('--pause must be 10–20');
  const rate = Number(value('rate', 1));
  if (![1, 2].includes(rate)) throw Error('--rate must be 1 or 2');
  const label = value('label', mode);
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(label)) throw Error('Invalid --label');
  const outputPath = path.resolve(root, output);
  if (!outputPath.startsWith(local.runs + path.sep)) throw Error('--output must be inside local/runs/');
  return { mode, arms, videos: path.resolve(root, videos), output: outputPath, seconds, pause, rate, label,
    p0: path.resolve(root, value('p0', 'local/tools/p0/dist/extension')),
    upstream: value('upstream') ? path.resolve(root, value('upstream')) : null,
    startedAt: value('started-at'), deadline: value('deadline'), maxBytes: Number(value('max-bytes', 4 * 1024 ** 3)),
    resume: argv.includes('--resume'), reportedOnly: argv.includes('--reported-only'), firstOpenOnly: argv.includes('--first-open-only') };
}

function normalizeVideos(input, mode, at = Date.now(), reportedOnly = false) {
  const rows = Array.isArray(input) ? input : input.videos;
  if (!Array.isArray(rows) || !rows.length) throw Error('Video file must contain a nonempty array or {videos: [...]}');
  const seen = new Set();
  return rows.map(row => {
    const url = new URL(row.url || `https://www.bilibili.com/video/${row.id}/`);
    if (url.origin !== 'https://www.bilibili.com' || url.username || url.password || !/^\/video\/(BV[A-Za-z0-9]+|av\d+)\/?$/.test(url.pathname))
      throw Error('Video URLs must be normal Bilibili video pages');
    const id = url.pathname.split('/')[2];
    if (seen.has(id)) throw Error(`Repeated video: ${id}`);
    seen.add(id);
    const reference = reportedOnly && row.set === 'reference';
    if (mode === 'measure' && !['popular', 'cold'].includes(row.set) && !reference) throw Error(`Set must be popular or cold: ${id}`);
    if (mode === 'measure' && !reference && !cohort(row, at).includes(row.set)) throw Error(`Input metadata does not establish ${row.set} cohort: ${id}`);
    if (!['site-default', '1080p60', '4k'].includes(row.quality || 'site-default')) throw Error(`Unsupported requested coverage: ${id}`);
    return { id, url: url.origin + '/video/' + id + '/', set: mode === 'screen' ? 'candidate' : row.set,
      viewCount: row.viewCount ?? null, publishedAt: row.publishedAt ?? null, verifiedAt: row.verifiedAt ?? null,
      encoding: row.encoding ?? null, bitrateBps: row.bitrateBps ?? null, quality: row.quality || 'site-default' };
  });
}

function makeSchedule(videos, arms, mode, firstOpenOnly = false) {
  return videos.flatMap((video, index) => {
    const offset = index % arms.length, order = [...arms.slice(offset), ...arms.slice(0, offset)];
    return order.map(arm => ({ id: `${video.id}-${arm}`, video, arm, phases: mode === 'screen' || firstOpenOnly ? ['startup'] : ['startup', 'reload'] }));
  });
}

function rangeLength(value) {
  const match = /^bytes=(\d+)-(\d+)$/i.exec(value || '');
  return match ? Math.max(0, Number(match[2]) - Number(match[1]) + 1) : null;
}

function initiatorFrames(initiator) {
  const result = [];
  for (let stack = initiator?.stack; stack; stack = stack.parent) result.push(...(stack.callFrames || []));
  return result;
}

function isProbe(arm, initiator) {
  // The build concatenates network-probe.js without renaming measure().
  // No player methods are patched to identify probes.
  return initiatorFrames(initiator).some(frame =>
    ['p0', 'bilismooth'].includes(arm) && frame.functionName === 'measure' && /(?:^|\/)playback\.js(?:$|[?#])/.test(frame.url) ||
    arm === 'upstream' && ['fetchRange', 'runRace'].includes(frame.functionName) && /(?:^|\/)bili-accelerator\.page\.js(?:$|[?#])/.test(frame.url));
}

function mediaPath(raw) {
  const url = new URL(raw);
  // BiliSmooth's MCDN relay carries the original media URL in this one parameter.
  // Retain only its pathname; the actual delivery host remains the proxy host.
  const inner = url.hostname.startsWith('proxy-') && url.searchParams.get('url');
  return inner ? new URL(inner).pathname : url.pathname;
}

function recordDash(run, payload) {
  const data = payload?.data || payload?.result || payload;
  if (!data?.dash && !data?.video_info?.dash) return;
  const dash = data.dash || data.video_info.dash;
  run.playinfoQuality = data.quality;
  for (const kind of ['video', 'audio']) for (const representation of dash[kind] || []) {
    const urls = [representation.baseUrl, representation.base_url, ...(representation.backupUrl || representation.backup_url || [])].filter(Boolean);
    const paths = [...new Set(urls.map(mediaPath))];
    const row = { kind, quality: representation.id, width: representation.width, height: representation.height,
      bandwidthBps: representation.bandwidth, codec: representation.codecs, frameRate: representation.frameRate || representation.frame_rate, paths };
    if (!run.dashRepresentations.some(existing => JSON.stringify(existing) === JSON.stringify(row))) run.dashRepresentations.push(row);
  }
}

function createNetworkTracker(cdp, run, stop, addBytes, onBodyBytes) {
  const all = new Map();
  const safeAddress = raw => { try { const url = new URL(raw); return { host: url.host, path: url.pathname }; } catch { return { host: '', path: '' }; } };
  const finish = (row, at, status) => {
    row.totalMs = Math.max(0, (at - row.startedTimestamp) * 1000);
    row.transferMs = row.ttfbMs === null ? null : Math.max(0, row.totalMs - row.ttfbMs);
    row.completed = status === 'finished';
    row.outcome = status;
  };
  cdp.on('Network.requestWillBeSent', event => {
    const previous = all.get(event.requestId);
    if (previous && event.redirectResponse) { previous.status = event.redirectResponse.status; finish(previous, event.timestamp, 'redirect'); }
    const address = safeAddress(event.request.url), headers = event.request.headers;
    const range = Object.entries(headers).find(([key]) => key.toLowerCase() === 'range')?.[1] || null;
    const facts = hostPolicy.describe(event.request.url);
    const row = { id: `${event.requestId}-${run.requests.length}`, phase: run.currentPhase || null, ...address, resourcePath: mediaPath(event.request.url),
      hostClass: facts.relaySource ? 'mcdn' : facts.shared ? 'pcdn' : facts.international ? 'international' : facts.distribution ? 'cdn' : 'other',
      method: event.request.method,
      resourceType: event.type, range, rangeLength: rangeLength(range), startedTimestamp: event.timestamp,
      startedAt: new Date(event.wallTime * 1000).toISOString(), ttfbMs: null, totalMs: null, transferMs: null,
      bytes: null, encodedBytes: 0, status: null, completed: false, outcome: 'pending',
      role: isProbe(run.arm, event.initiator) ? 'probe' : 'playback', kind: 'unknown' };
    row.isMedia = facts.media || hostPolicy.describe('https://media.invalid' + row.resourcePath).media || event.type === 'Media';
    all.set(event.requestId, row);
    if (row.isMedia) run.requests.push(row);
  });
  cdp.on('Network.responseReceived', event => {
    const response = event.response, row = all.get(event.requestId);
    if (response.status === 412 || response.status === 429) stop(`risk-http-${response.status}`);
    if (!row) return;
    row.status = response.status;
    row.ttfbMs = Math.max(0, (event.timestamp - row.startedTimestamp) * 1000);
    row.serverWaitMs = response.timing && response.timing.receiveHeadersStart >= 0 && response.timing.sendEnd >= 0
      ? Math.max(0, response.timing.receiveHeadersStart - response.timing.sendEnd) : null;
    row.fromCache = !!(response.fromDiskCache || response.fromServiceWorker || response.fromPrefetchCache);
    row.protocol = response.protocol;
    row.contentRange = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'content-range')?.[1] || null;
    row.mimeType = response.mimeType;
    if (!row.isMedia && /^(?:video|audio)\//.test(response.mimeType)) { row.isMedia = true; run.requests.push(row); }
    if (response.mimeType.startsWith('audio/')) row.kind = 'audio';
  });
  cdp.on('Network.dataReceived', event => {
    const row = all.get(event.requestId);
    if (!row) return;
    row.bytes = (row.bytes || 0) + event.dataLength;
    row.encodedBytes += event.encodedDataLength;
    // CDP supplies body progress before completion, including aborted probes.
    // Use the larger of body or encoded progress to avoid undercounting a budget.
    const accounted = Math.max(row.bytes, row.encodedBytes);
    addBytes(accounted - (row.accountedBytes || 0), row.phase); row.accountedBytes = accounted;
    onBodyBytes?.({ at: Date.parse(row.startedAt) + (event.timestamp - row.startedTimestamp) * 1000,
      bytes: event.dataLength, role: row.isMedia ? row.role : 'other' });
  });
  cdp.on('Network.loadingFinished', event => {
    const row = all.get(event.requestId);
    if (!row) return;
    row.encodedBytes = Math.max(row.encodedBytes, event.encodedDataLength);
    const accounted = Math.max(row.bytes, row.encodedBytes);
    addBytes(accounted - (row.accountedBytes || 0), row.phase); row.accountedBytes = accounted;
    finish(row, event.timestamp, 'finished');
  });
  cdp.on('Network.loadingFailed', event => {
    const row = all.get(event.requestId);
    if (!row) return;
    row.failure = event.errorText; finish(row, event.timestamp, event.canceled ? 'cancelled' : 'failed');
  });
  return () => {
    for (const row of run.requests) {
      const representation = run.dashRepresentations.find(item => item.paths.includes(row.resourcePath));
      if (representation) { row.kind = representation.kind; row.qualityId = representation.quality; row.bandwidthBps = representation.bandwidthBps; row.codec = representation.codec; }
      row.throughputBps = row.bytes !== null && row.totalMs > 0 ? row.bytes * 8000 / row.totalMs : null;
      row.bodyThroughputBps = row.bytes !== null && row.transferMs > 0 ? row.bytes * 8000 / row.transferMs : null;
    }
  };
}

function matchesDefaultRuntime(config, defaults) {
  if (!config || config.selection !== 'auto' || !defaults.candidatePool.includes(config.pcdnHost)) return false;
  // The default automatic policy changes this target after ranking or recovery.
  // Every user preference must still match its default.
  return require('node:util').isDeepStrictEqual({ ...config, pcdnHost: defaults.pcdnHost }, defaults);
}

function segmentJumps(samples) {
  const jumps = [];
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1], sample = samples[index];
    if (!previous.media || !sample.media) continue;
    const elapsedSeconds = (sample.at - previous.at) / 1000;
    const deltaSeconds = sample.media.currentTime - previous.media.currentTime;
    if (deltaSeconds - elapsedSeconds > 2 || deltaSeconds < -2) jumps.push({ at: sample.at,
      fromSeconds: previous.media.currentTime, toSeconds: sample.media.currentTime, elapsedSeconds, deltaSeconds,
      videoIds: [previous.videoId, sample.videoId] });
  }
  return jumps;
}

const POST_FIRST_FRAME_MS = 60000;
function cohort(row, at) {
  const age = at - Date.parse(row.publishedAt);
  const groups = [];
  if (Number.isFinite(row.viewCount) && row.viewCount > 1000000) groups.push('popular');
  if (Number.isFinite(row.viewCount) && row.viewCount < 1000 || Number.isFinite(age) && age >= 0 && age < 86400000) groups.push('cold');
  return groups;
}
function hiddenIntervals(visibility, durationMs) {
  return visibility.flatMap((row, index) => row.visibility !== 'visible' ? [[row.at, visibility[index + 1]?.at ?? durationMs]] : []);
}
function foregroundDuration(samples, firstFrameAt) {
  return samples.reduce((sum, sample, index) => {
    const before = samples[index - 1];
    const active = row => row?.media && row.visibility === 'visible' && !row.media.paused && !row.media.seeking && !row.media.ended;
    return sum + (before && before.at >= firstFrameAt && active(before) && active(sample)
      ? Math.min(500, sample.at - before.at) : 0);
  }, 0);
}
function measuredPhaseSummary(run) {
  const hidden = hiddenIntervals(run.visibility, run.samples.at(-1)?.at || 0);
  const overlapsHidden = (start, end) => hidden.some(([from, to]) => start < to && end > from);
  const rawFirstFrame = run.firstFrameFromNavigationMs;
  const eligibleFirstFrame = Number.isFinite(rawFirstFrame) && !overlapsHidden(0, rawFirstFrame);
  const video = run.requests.filter(row => row.role === 'playback' && row.kind === 'video');
  for (const request of run.requests) {
    const start = Date.parse(request.startedAt) - run.timeOrigin;
    const end = request.totalMs === null ? run.samples.at(-1)?.at || start : start + request.totalMs;
    request.foregroundEligible = !overlapsHidden(start, end);
    request.observedWaitMs = Math.max(0, end - start);
    request.waitCensored = request.totalMs === null;
  }
  const eligibleVideo = video.filter(row => row.foregroundEligible);
  const firstMinuteEvents = (run.events || []).filter(event => Number.isFinite(rawFirstFrame) && event.readyState < 3 && event.event === 'waiting' && event.at > rawFirstFrame && event.visibility === 'visible'
    && !event.paused && !event.seeking && foregroundDuration(run.samples.filter(row => row.at <= event.at), rawFirstFrame) <= POST_FIRST_FRAME_MS);
  const session = run.candidateDiagnostics?.session;
  return { rawFirstFrameFromNavigationMs: rawFirstFrame, firstFrameFromNavigationMs: eligibleFirstFrame ? rawFirstFrame : null,
    firstFrameEligible: eligibleFirstFrame, foregroundAfterFirstFrameMs: Number.isFinite(rawFirstFrame) ? foregroundDuration(run.samples, rawFirstFrame) : 0,
    longestVideoFragmentWaitMs: eligibleVideo.length ? Math.max(...eligibleVideo.map(row => row.observedWaitMs)) : null,
    censoredVideoRequests: eligibleVideo.filter(row => row.waitCensored).length,
    bufferExhaustionsWithinFirst60ForegroundSeconds: firstMinuteEvents.length,
    raceCount: session?.races?.length ?? (['native', 'p0'].includes(run.arm) ? 0 : null),
    switchCount: session?.switchCount ?? (run.arm === 'p0' ? run.candidateDiagnostics?.recoveryAttempts ?? null : run.arm === 'native' ? 0 : null),
    startupProbeRounds: run.arm === 'p0' ? run.candidateDiagnostics?.events?.filter(event => event.type === 'probe-start').length ?? null : 0,
    additionalTrafficBytes: run.requests.filter(row => row.role === 'probe').reduce((sum, row) => sum + (row.bytes || 0), 0),
    foregroundAdditionalTrafficBytes: run.requests.filter(row => row.role === 'probe' && row.foregroundEligible).reduce((sum, row) => sum + (row.bytes || 0), 0),
    hiddenIntervals: hidden, visibilityBasis: 'Exclude whole requests overlapping a hidden interval; navigation first frame is ineligible if its interval was hidden.' };
}

function framesPerSecond(value) { const parts = String(value).split('/').map(Number); return parts.length === 2 ? parts[0] / parts[1] : parts[0]; }
function qualityCoverage(run, required) {
  const frames = run.samples.filter(row => row.frames > 0 && row.visibility === 'visible' && row.media?.width > 0);
  if (!frames.length) return false;
  if (required === 'site-default') return true;
  const matches = sample => required === '4k' ? Math.max(sample.media.width, sample.media.height) >= 3840
    : Math.min(sample.media.width, sample.media.height) >= 1080 && run.dashRepresentations.some(row => row.kind === 'video'
      && row.quality === sample.nativeQuality?.realQ && row.width === sample.media.width && row.height === sample.media.height && framesPerSecond(row.frameRate) >= 59);
  return frames.every(matches);
}

function summarizeRun(run, rate = 1) {
  run.summary = summarize(run.samples);
  run.summary.firstFrameFromNavigationMs = run.firstFrameFromNavigationMs ?? run.summary.firstFrameFromNavigationMs;
  run.summary.mediaBytes = run.requests.filter(row => row.role === 'playback').reduce((sum, row) => sum + row.bytes, 0);
  run.summary.probeBytes = run.requests.filter(row => row.role === 'probe').reduce((sum, row) => sum + row.bytes, 0);
  run.summary.unknownMediaByteRequests = run.requests.filter(row => row.role === 'playback' && row.bytes === null).length;
  run.summary.unknownProbeByteRequests = run.requests.filter(row => row.role === 'probe' && row.bytes === null).length;
  run.summary.diagnosticProbeBytes = run.candidateDiagnostics?.session?.races
    ? run.candidateDiagnostics.session.races.reduce((sum, race) => sum + race.samples.reduce((bytes, sample) => bytes + sample.bytes, 0), 0)
    : run.candidateDiagnostics?.probeBytes ?? null;
  run.summary.deliveryHosts = [...new Set(run.requests.filter(row => row.role === 'playback' && row.bytes > 0).map(row => row.host))];
  run.summary.decodedVideoTracks = run.mediaProperties.flatMap(event => event.properties.filter(item => item.name === 'kVideoTracks').flatMap(item => {
    try { return JSON.parse(item.value).map(track => ({ codec: track.codec, codedSize: track['coded size'], naturalSize: track['natural size'] })); }
    catch { return []; }
  }));
  const representations = run.dashRepresentations.filter(row => row.kind === 'video' &&
    run.requests.some(request => request.role === 'playback' && request.bytes > 0 && row.paths.includes(request.resourcePath)));
  const correctQualityAndRate = sample => sample.media && Math.abs(sample.media.rate - rate) < 0.01 &&
    representations.some(row => row.width === sample.media.width && row.height === sample.media.height);
  const active = sample => sample.media && sample.frames > 0 && !sample.media.paused && !sample.media.seeking && !sample.media.ended &&
    sample.visibility === 'visible' && sample.media.width > 0 && correctQualityAndRate(sample);
  run.summary.validFrameProgressMs = run.samples.reduce((sum, sample, index) => {
    const previous = run.samples[index - 1];
    return sum + (previous && active(previous) && active(sample) && sample.videoId === previous.videoId && sample.frames > previous.frames
      ? Math.min(500, sample.at - previous.at) : 0);
  }, 0);
  const mismatchedSamples = run.samples.filter(sample => sample.visibility === 'visible' && sample.media?.width > 0 && !correctQualityAndRate(sample)).length;
  run.segmentContinuity = { valid: true, toleranceSeconds: 2, jumps: segmentJumps(run.samples) };
  run.segmentContinuity.valid = run.segmentContinuity.jumps.length === 0;
  run.requestedConditions = { quality: 'site-default', rate,
    qualityVerified: run.samples.some(active), validFrameProgressMs: run.summary.validFrameProgressMs,
    mismatchedQualityOrRateSamples: mismatchedSamples,
    foregroundCoverage: run.samples.length ? run.summary.activeForegroundSamples / run.samples.length : 0,
    met: run.summary.validFrameProgressMs >= 5000 && mismatchedSamples === 0 && run.segmentContinuity.valid &&
      run.summary.activeForegroundSamples >= run.samples.length * 0.8,
    representations };
  if (!run.status) run.status = !run.segmentContinuity.valid ? 'invalid-segment'
    : run.mediaErrors.length || run.samples.some(sample => sample.media?.error) ? 'failed-media'
    : run.requestedConditions.met ? 'observed' : 'incomplete-playback-observation';
}

async function runOne(spec, opts, auth, extensions, ledger, persist) {
  const run = { ...spec, startedAt: new Date().toISOString(), phases: [], requests: [], dashRepresentations: [], networkBytes: 0,
    environment: { headed: true, window: opts.window, sound: 'muted', rate: opts.rate, occlusionBackgroundingDisabled: true,
      freshProfile: true, extensionSettings: 'build-own-defaults', startPosition,
      quality: qualityPreference[spec.video.quality] ? `saved site preference CURRENT_QUALITY=${qualityPreference[spec.video.quality]}; no selection, pause or seek`
        : 'account/site default; no selection, pause or seek',
      phases: spec.phases, observationSecondsAfterFirstFrame: opts.seconds,
      history: 'Startup uses a fresh profile. Immediate reload keeps that same profile, media cache and measured-routing history.' } };
  let context, page, phase, cdp, interval, closing, finalizeNetwork = () => {}, riskCheckRunning = false;
  const stop = reason => {
    ledger.stop ||= { reason, at: new Date().toISOString(), runId: run.id };
    run.status = 'stopped'; run.stop = ledger.stop;
    if (context && !closing) closing = context.close().catch(() => {});
  };
  const addBytes = (count, phaseName) => {
    ledger.networkBytes += count; run.networkBytes += count;
    if (phase && phase.phase === phaseName && !phase.finishedAt) phase.networkBytes += count;
    if (ledger.networkBytes >= ledger.maxBytes) stop('data-budget-exhausted');
  };
  const onSignal = () => stop('operator-interrupt');
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    const profile = await fs.mkdtemp(path.join(local.tmp, 'benchmark-profile-'));
    run.profile = path.relative(root, profile).replaceAll('\\', '/');
    // A covered macOS window otherwise becomes hidden and voids samples. These flags change visibility
    // and timer handling only, not networking or decoding.
    const args = ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-background-networking',
      `--window-size=${opts.window.width},${opts.window.height}`, `--window-position=${opts.window.left},${opts.window.top}`,
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'];
    if (spec.arm === 'native') args.push('--disable-extensions');
    else args.push(`--disable-extensions-except=${extensions[spec.arm]}`, `--load-extension=${extensions[spec.arm]}`);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false,
      viewport: null, args });
    await context.addCookies(auth.cookies); await context.addInitScript(observe);
    if (qualityPreference[spec.video.quality]) await context.addCookies([{ name: 'CURRENT_QUALITY', value: qualityPreference[spec.video.quality],
      domain: '.bilibili.com', path: '/' }]);
    await context.addInitScript(rate => {
      window.__benchmarkVisibility = [{ at: 0, visibility: document.visibilityState }];
      document.addEventListener('visibilitychange', () => window.__benchmarkVisibility.push({ at: performance.now(), visibility: document.visibilityState }));
      const mute = () => { for (const video of document.querySelectorAll('video')) { video.muted = true; video.playbackRate = rate; } };
      new MutationObserver(mute).observe(document, { childList: true, subtree: true }); mute();
    }, opts.rate);
    page = context.pages()[0] || await context.newPage(); await page.bringToFront();
    run.environment.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    run.browserVersion = context.browser()?.version(); run.platform = process.platform;
    cdp = await context.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Media.enable');
    finalizeNetwork = createNetworkTracker(cdp, run, stop, addBytes);
    cdp.on('Media.playerPropertiesChanged', event => { if (phase) phase.mediaProperties.push({ playerId: event.playerId,
      properties: event.properties.filter(item => ['kVideoTracks', 'kAudioTracks', 'kVideoDecoderName', 'kAudioDecoderName', 'kResolution'].includes(item.name)) }); });
    cdp.on('Media.playerErrorsRaised', event => { if (phase) phase.mediaErrors.push(event); });
    if (['p0', 'bilismooth'].includes(spec.arm)) {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
      run.extension = await worker.evaluate(async () => {
        const key = BiliSmoothSettingsMigration.key, stored = await chrome.storage.local.get(key);
        return { version: chrome.runtime.getManifest().version, name: chrome.runtime.getManifest().name,
          defaults: BiliSmoothSettings.normalize({}), preferencesPresent: Object.hasOwn(stored, key),
          preferencesBeforeVideo: BiliSmoothSettings.normalize(stored[key]) };
      });
      run.extension.defaultPreferencesVerified = require('node:util').isDeepStrictEqual(run.extension.preferencesBeforeVideo, run.extension.defaults);
      if (!run.extension.defaultPreferencesVerified) throw Error(`${spec.arm} preferences do not match that build's defaults`);
    }
    await page.goto('https://www.bilibili.com/robots.txt', { waitUntil: 'domcontentloaded', timeout: 25000 });
    run.authentication = await checkLogin(page);
    if (run.authentication !== true) { stop(run.authentication === false ? 'login-expired: log in again in the npm run dev browser' : 'login-status-unavailable'); return run; }
    interval = setInterval(async () => {
      if (Date.now() >= Date.parse(ledger.deadline)) stop('time-budget-exhausted');
      if (riskCheckRunning || ledger.stop || page.isClosed()) return;
      riskCheckRunning = true;
      try {
        const risk = await page.evaluate(() => {
          const visible = element => !!(element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
          if ([...document.querySelectorAll('[class*="geetest_panel"], [class*="geetest_holder"], [class*="bili-captcha"], #biliMainCaptcha')].some(visible)) return 'captcha-visible';
          if (/访问过于频繁|请求过于频繁|当前访问存在风险|异常访问|请完成安全验证/.test(document.body?.innerText || '')) return 'risk-control-visible';
          return null;
        });
        if (risk) stop(risk);
      } catch { /* A navigation or immediate safety close can destroy the execution context. */ }
      finally { riskCheckRunning = false; }
    }, 1000);
    for (const name of spec.phases) {
      if (ledger.stop) break;
      phase = { id: `${run.id}-${name}`, arm: spec.arm, phase: name, startedAt: new Date().toISOString(),
        historyBeforeNavigation: { profileReused: name === 'reload', routingRecordKeys: await page.evaluate(() =>
          Object.keys(localStorage).filter(key => key.startsWith('bilismooth.routing.rank.v4.')
            || key.startsWith('biliSmooth.playback-feedback.v1.') || key.startsWith('bilismooth.delivery-history.v1.'))) },
        requests: [], samples: [], mediaProperties: [], mediaErrors: [],
        dashRepresentations: [], networkBytes: 0, qualitySelection: { action: 'site-default' } };
      run.phases.push(phase);
      run.currentPhase = name; const currentPhase = phase;
      const pending = new Set();
      const onResponse = response => {
        if (response.status() === 412 || response.status() === 429) { stop(`risk-http-${response.status()}`); return; }
        const url = new URL(response.url());
        if (url.hostname !== 'api.bilibili.com' || !/json/i.test(response.headers()['content-type'] || '')) return;
        const reading = response.json().then(payload => {
          if ([-352, -412, -509].includes(payload?.code)) stop(`risk-api-${payload.code}`);
          if (/\/(?:playurl|playinfo)(?:\/|$)/.test(url.pathname)) { recordDash(currentPhase, payload); recordDash(run, payload); }
        }).catch(() => {});
        pending.add(reading); reading.finally(() => pending.delete(reading));
      };
      page.on('response', onResponse);
      const navigationUrl = new URL(spec.video.url); navigationUrl.searchParams.set(startPosition.parameter, String(startPosition.seconds));
      const navigation = name === 'reload'
        ? await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 })
        : await page.goto(navigationUrl.href, { waitUntil: 'domcontentloaded', timeout: 25000 });
      phase.navigationStatus = navigation?.status();
      if (phase.navigationStatus >= 400 && !ledger.stop) { phase.status = 'unavailable-video'; page.off('response', onResponse); break; }
      const target = new URL(page.url());
      if (target.origin + target.pathname.replace(/\/$/, '') !== spec.video.url.replace(/\/$/, '')) { phase.status = 'unavailable-video'; page.off('response', onResponse); break; }
      phase.timeOrigin = await page.evaluate(() => performance.timeOrigin);
      if (spec.arm === 'upstream') {
        await page.waitForFunction(() => window.__BILI_ACCELERATOR_INSTALLED__ === true, undefined, { timeout: 20000 });
        run.extension = await page.evaluate(() => ({ installed: window.__BILI_ACCELERATOR_INSTALLED__ === true,
          defaults: window.BiliAcceleratorCore?.normalizeConfig() || null,
          config: window.BiliAccelerator?.getConfig(), version: window.BiliAccelerator?.getDiagnostics()?.version }));
        if (!run.extension.installed || run.extension.version !== '0.5.0' || !require('node:util').isDeepStrictEqual(run.extension.config, run.extension.defaults))
          throw Error('Upstream installation or default configuration could not be verified');
      }
      const phaseDeadline = Date.now() + (opts.seconds + 30) * 1000; let lastCheckpoint = Date.now();
      while (Date.now() < phaseDeadline && !ledger.stop) {
        const sample = await page.evaluate(snapshot); phase.samples.push(sample);
        const observed = await page.evaluate(() => ({ firstFrame: window.__biliObservation.firstPrimaryFrameAt,
          firstFrameMediaTime: window.__biliObservation.firstPrimaryFrameMediaTime,
          events: window.__biliObservation.events, visibility: window.__benchmarkVisibility,
          video: window.__INITIAL_STATE__?.videoData ? { viewCount: window.__INITIAL_STATE__.videoData.stat?.view,
            publishedAt: Number.isFinite(window.__INITIAL_STATE__.videoData.pubdate) ? new Date(window.__INITIAL_STATE__.videoData.pubdate * 1000).toISOString() : null } : null }));
        phase.firstFrameFromNavigationMs = observed.firstFrame; phase.firstFrameMediaTime = observed.firstFrameMediaTime;
        phase.events = observed.events; phase.visibility = observed.visibility;
        if (observed.video) phase.siteMetadata = observed.video;
        if (!phase.dashRepresentations.length) { const payload = await page.evaluate(() => window.__playinfo__ || null); recordDash(phase, payload); recordDash(run, payload); }
        if (sample.media?.error) { phase.status = 'failed-media'; break; }
        if (Number.isFinite(observed.firstFrame) && foregroundDuration(phase.samples, observed.firstFrame) >= opts.seconds * 1000) break;
        if (Date.now() - lastCheckpoint >= 5000) { lastCheckpoint = Date.now(); finalizeNetwork(); await persist(run); }
        await delay(250);
      }
      if (!ledger.stop) {
        phase.candidateDiagnostics = await page.evaluate(() => window.BiliSmoothRuntime?.getDiagnostics() || null);
        if (spec.arm === 'upstream') phase.upstreamDiagnostics = await page.evaluate(() => window.BiliAccelerator.getDiagnostics());
        if (['p0', 'bilismooth'].includes(spec.arm)) {
          phase.defaultSettingsVerified = phase.samples.every(sample => sample.scheduler?.candidate && matchesDefaultRuntime(sample.scheduler.config, run.extension.defaults));
          if (!phase.defaultSettingsVerified) throw Error(`${spec.arm} runtime preferences differ from that build's defaults`);
        }
        await Promise.race([Promise.allSettled([...pending]), delay(500)]);
        finalizeNetwork(); phase.requests = structuredClone(run.requests.filter(row => row.phase === name)); summarizeRun(phase, opts.rate); Object.assign(phase.summary, measuredPhaseSummary(phase));
        phase.observedCohorts = phase.siteMetadata ? cohort(phase.siteMetadata, Date.parse(phase.startedAt)) : [];
        phase.observedConditions = { codecAndBitrate: phase.requestedConditions.representations,
          dimensions: phase.summary.dimensions, rates: phase.summary.rates, firstObservedPlayhead: phase.samples.find(row => row.frames > 0)?.media?.currentTime,
          firstFrameMediaTime: phase.firstFrameMediaTime, startPosition,
          requiredQuality: spec.video.quality, coverageMet: qualityCoverage(phase, spec.video.quality) };
        if (opts.mode === 'measure' && (!phase.summary.firstFrameEligible || phase.summary.foregroundAfterFirstFrameMs < POST_FIRST_FRAME_MS || spec.video.set !== 'reference' && !phase.observedCohorts.includes(spec.video.set) || !phase.observedConditions.coverageMet))
          phase.status = 'incomplete-playback-observation';
      }
      phase.finishedAt = new Date().toISOString(); page.off('response', onResponse);
      // No pause, new profile, state clearing, or quality manipulation before reload.
      await persist(run);
    }
    if (!run.status) run.status = run.phases.length === spec.phases.length && run.phases.every(row => row.status === 'observed') ? 'observed' : 'incomplete-playback-observation';
    run.summary = run.phases.map(row => ({ phase: row.phase, status: row.status, ...row.summary, observedConditions: row.observedConditions }));
  } catch (error) {
    run.error = redactReportUrls(String(error));
    if (!ledger.stop) { run.status = 'failed-harness'; ledger.stop = { reason: 'run-failed', runId: run.id, at: new Date().toISOString() }; }
  } finally {
    clearInterval(interval); if (context) await (closing || context.close()); finalizeNetwork();
    for (const entry of run.phases) if (!entry.finishedAt) entry.requests = structuredClone(run.requests.filter(row => row.phase === entry.phase));
    delete run.requests; delete run.dashRepresentations; delete run.currentPhase;
    run.finishedAt = new Date().toISOString(); await persist(run);
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
  }
  return run;
}


function summarizeGroups(results) {
  const groups = new Map();
  for (const run of results) for (const phase of run.summary || []) {
    const key = [run.arm, run.video.set, phase.phase].join('|');
    if (!groups.has(key)) groups.set(key, { arm: run.arm, cohort: run.video.set, phase: phase.phase, rows: [] });
    groups.get(key).rows.push(phase);
  }
  return [...groups.values()].map(group => {
    const eligible = group.rows.filter(row => row.status === 'observed' && Number.isFinite(row.firstFrameFromNavigationMs));
    const frames = eligible.map(row => row.firstFrameFromNavigationMs).sort((a,b) => a-b), middle = Math.floor(frames.length/2);
    const medianFirstFrameMs = frames.length ? frames.length%2 ? frames[middle] : (frames[middle-1]+frames[middle])/2 : null;
    const p90FirstFrameMs = frames.length ? frames[Math.ceil(frames.length*.9)-1] : null;
    const longestVideoFragmentWaitMs = eligible.length ? Math.max(...eligible.map(row => row.longestVideoFragmentWaitMs || 0)) : null;
    const bufferExhaustions = eligible.reduce((sum,row) => sum + row.bufferExhaustionsWithinFirst60ForegroundSeconds,0);
    const censoredRequests = eligible.reduce((sum,row) => sum + row.censoredVideoRequests,0);
    return { arm: group.arm, cohort: group.cohort, phase: group.phase, included: eligible.length, excluded: group.rows.length-eligible.length,
      medianFirstFrameMs, p90FirstFrameMs, percentileMethod: 'nearest rank', longestVideoFragmentWaitMs, bufferExhaustions, censoredRequests,
      goalEvidenceComplete: eligible.length >= 3 && eligible.length === group.rows.length && censoredRequests === 0,
      observedTargetsMet: eligible.length >= 3 && eligible.length === group.rows.length && censoredRequests === 0
        ? medianFirstFrameMs <= 3000 && p90FirstFrameMs <= 6000 && longestVideoFragmentWaitMs <= 3000 && bufferExhaustions === 0 : null };
  });
}

function summarizeComparisons(results, arms) {
  const videos = [...new Set(results.map(run => run.video.id))];
  const phases = [...new Set(results.flatMap(run => (run.summary || []).map(phase => phase.phase)))];
  return videos.flatMap(video => phases.map(name => {
    const observations = arms.map(arm => {
      const run = results.find(row => row.video.id === video && row.arm === arm);
      const phase = run?.summary?.find(row => row.phase === name);
      return { arm, status: phase?.status || 'missing', dimensions: phase?.observedConditions?.dimensions || [],
        rates: phase?.observedConditions?.rates || [], representations: phase?.observedConditions?.codecAndBitrate || [],
        firstObservedPlayhead: phase?.observedConditions?.firstObservedPlayhead ?? null };
    });
    const signature = row => JSON.stringify({ dimensions: [...row.dimensions].sort(), rates: [...row.rates].sort(),
      qualities: [...new Set(row.representations.map(rep => rep.quality))].sort() });
    return { video, phase: name, observations,
      sameObservedQualityAndRate: observations.every(row => row.status === 'observed') && observations.every(row => signature(row) === signature(observations[0])),
      limitation: 'The site URL requests the opening frame at 1 ms to override restored history. Verify actual first-frame media time and compare only matching observed quality and rate; no harness seek is injected.' };
  }));
}

async function writeJson(file, value) { await fs.writeFile(file, JSON.stringify(redactReportUrls(value), null, 2) + '\n'); }

async function main(argv = process.argv.slice(2)) {
  const opts = options(argv);
  if (opts.help) {
    console.log([
      'npm run check:benchmark -- --videos=local/<task>/videos.json "--arms=native,p0,bilismooth" --p0=local/tools/p0/dist/extension --auth --output=local/runs/benchmark/<label>',
      '',
      'Video input:',
      'Use verified IDs and metadata; see .claude/skills/playback-check/SKILL.md. No sample IDs are supplied.',
      'Each entry requires popular/cold set, verified viewCount/publishedAt, and expected quality coverage. Actual codec/bitrate/decoded dimensions are recorded.',
      'Each video/arm uses one fresh profile: startup then immediate reload in the same profile. Arm order rotates across videos.',
      '',
      'Create and freeze plan.md inside --output before starting. Its hash is checked on later runs.',
      '--mode=screen: native only, one 45-second run per candidate; set is ignored.',
      '--mode=measure: at least 60 foreground seconds after first frame in each phase; --seconds=60..180 (default 60).',
      '--pause=15: seconds between runs; allowed range 10..20.',
      '--rate=1: playback rate 1 or 2 from page start; one label carries one rate.',
      '--first-open-only: skip reload; observe only the first navigation in each fresh profile.',
      '--max-bytes=4294967296: default 4 GiB cumulative network budget; can only be reduced.',
      '--started-at=ISO --deadline=ISO: default deadline is three hours after the recorded start.',
      '--label=NAME: separate schedule within the output directory; defaults to the mode.',
      '--reported-only: a reported, unscored subset; skips the 3+3 and 1080p60/4K registration and accepts set "reference" without a cohort.',
      '--resume: continue the identical schedule. It cannot clear a recorded stop or repeat a partial run.',
      'All labels in one output directory share budget.json. Existing --auth login is required.',
      'Runs use headed Chromium, muted audio, the requested rate and account/site-default quality. No premeasurement quality selection, pause or seek.' ,
      'Rows registered as 4k or 1080p60 start with the site quality preference cookie CURRENT_QUALITY=120 or 116.',
      'Every navigation requests t=0.001 (1 ms); literal t=0 does not override account history. Actual first-frame media time is recorded.',
      '--upstream=PATH remains supported when --arms includes upstream; its default version check remains v0.5.0.'
    ].join('\n'));
    return;
  }
  await fs.mkdir(opts.output, { recursive: true }); await fs.mkdir(local.tmp, { recursive: true });
  const plan = await fs.readFile(path.join(opts.output, 'plan.md'), 'utf8');
  const videos = normalizeVideos(JSON.parse(await fs.readFile(opts.videos, 'utf8')), opts.mode, Date.now(), opts.reportedOnly);
  if (opts.mode === 'measure' && !opts.reportedOnly && ['popular','cold'].some(set => videos.filter(row => row.set === set).length < 3)) throw Error('Measurement needs at least three popular and three cold videos');
  if (opts.mode === 'measure' && !opts.reportedOnly && ['1080p60','4k'].some(quality => !videos.some(row => row.quality === quality))) throw Error('Register at least one 1080p60 and one 4k coverage sample; the script will verify actual playback without selecting quality');
  const auth = { cookies: await requireLoginCookies() };
  const ledgerPath = path.join(opts.output, 'budget.json');
  let ledger;
  try { ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!ledger) {
    const startedAt = opts.startedAt || new Date().toISOString();
    const deadline = opts.deadline || new Date(Date.parse(startedAt) + 3 * 3600000).toISOString();
    if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= Date.parse(startedAt)) throw Error('Invalid start or deadline');
    if (!Number.isFinite(opts.maxBytes) || opts.maxBytes <= 0 || opts.maxBytes > 4 * 1024 ** 3) throw Error('--max-bytes must be positive and <= 4 GiB');
    ledger = { startedAt, deadline, maxBytes: opts.maxBytes, networkBytes: 0, planSha256: hash(plan), stop: null };
  }
  if (ledger.planSha256 !== hash(plan)) throw Error('Plan changed after the benchmark began');
  if (ledger.stop) throw Error(`Benchmark stopped (${ledger.stop.reason}); resume cannot clear this stop`);
  if (Date.now() >= Date.parse(ledger.deadline) || ledger.networkBytes >= ledger.maxBytes) throw Error('Benchmark budget is exhausted');
  const extensions = {};
  for (const arm of opts.arms.filter(arm => arm !== 'native')) {
    const directory = arm === 'bilismooth' ? path.join(root, 'dist', 'extension') : arm === 'p0' ? opts.p0 : opts.upstream;
    if (!directory) throw Error('--upstream is required for the upstream arm');
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (manifest.manifest_version !== 3) throw Error(`${arm} must be an MV3 build`);
    if (arm === 'bilismooth') await assertBuildMatches(root, directory);
    if (arm === 'p0') {
      const build = JSON.parse(await fs.readFile(path.join(directory, 'BUILD.json'), 'utf8'));
      for (const [file, expected] of Object.entries(build.outputSha256)) if (hash(await fs.readFile(path.join(directory, file))) !== expected) throw Error(`P0 build checksum mismatch: ${file}`);
    }
    extensions[arm] = directory;
  }
  const schedulePath = path.join(opts.output, `${opts.label}-schedule.json`);
  const runsPath = path.join(opts.output, `${opts.label}-runs`);
  const schedule = makeSchedule(videos, opts.arms, opts.mode, opts.firstOpenOnly);
  opts.window = await benchmarkWindow();
  const settings = { mode: opts.mode, arms: opts.arms, seconds: opts.seconds, pause: opts.pause, rate: opts.rate, reportedOnly: opts.reportedOnly, window: opts.window, startPosition, builds: Object.fromEntries(await Promise.all(Object.entries(extensions).map(async ([arm,directory]) => [arm,{directory,manifestSha256:hash(await fs.readFile(path.join(directory,'manifest.json'))),bundleSha256:hash(await fs.readFile(path.join(directory,arm==='upstream'?'bili-accelerator.page.js':'playback.js')))}]))), schedule };
  let previous;
  try { previous = JSON.parse(await fs.readFile(schedulePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && !opts.resume) throw Error('Schedule exists; use --resume or another label');
  if (previous && previous.settingsSha256 !== hash(JSON.stringify(settings))) throw Error('Resume cannot change schedule settings');
  const report = previous || { createdAt: new Date().toISOString(), settingsSha256: hash(JSON.stringify(settings)), ...settings, results: [],
    observation: { sampleMs: 250, stallThresholdMs: 1500, definition: 'Shared check-playback observer: after first frame, no frame progress for >=1500 ms while foreground, playing, not seeking or ended. Startup is separate.' },
    network: { bytes: 'CDP body bytes, including partial requests. Budget uses max(body, encoded) per request for all page traffic.',
      probeClassification: 'BiliSmooth playback.js initiator frame named measure; compare P0 probeBytes or P1 session race sample bytes.',
      ttfb: 'Request start to response headers, including connection setup; serverWaitMs excludes setup when available.',
      privacy: 'Only media host/path and selected decoder fields are retained. URL queries, cookies, titles and page text are omitted.' } };
  await fs.mkdir(runsPath, { recursive: true }); await writeJson(ledgerPath, ledger); await writeJson(schedulePath, report);
  const persist = async run => {
    await writeJson(path.join(runsPath, `${run.id}.json`), run);
    await writeJson(ledgerPath, ledger);
  };
  for (const spec of schedule) {
    if (report.results.some(result => result.id === spec.id)) continue;
    if (Date.now() >= Date.parse(ledger.deadline)) { ledger.stop = { reason: 'time-budget-exhausted', at: new Date().toISOString() }; break; }
    const runPath = path.join(runsPath, `${spec.id}.json`);
    try { await fs.access(runPath); throw Error(`Partial run ${spec.id} already exists; preserve it and do not rerun it silently`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    console.log(JSON.stringify({ event: 'run-start', id: spec.id, arm: spec.arm, set: spec.video.set, bytesUsed: ledger.networkBytes }));
    const recent = (ledger.runHistory || []).slice(-5);
    const expectedBytes = Math.max(64 * 1024 ** 2, ...recent.map(run => run.networkBytes * 1.25));
    const expectedMs = (spec.phases.length * (opts.seconds + 30) + opts.pause) * 1000;
    if (ledger.maxBytes - ledger.networkBytes < expectedBytes || Date.parse(ledger.deadline) - Date.now() < expectedMs) {
      ledger.stop = { reason: 'insufficient-budget-for-next-run', at: new Date().toISOString(), expectedBytes, expectedMs }; break;
    }
    const run = await runOne(spec, opts, auth, extensions, ledger, persist);
    (ledger.runHistory ||= []).push({ networkBytes: run.networkBytes || 0, durationMs: Date.parse(run.finishedAt) - Date.parse(run.startedAt) });
    report.results.push({ id: run.id, video: run.video, arm: run.arm, phases: run.phases.map(row => ({phase:row.phase,status:row.status})), status: run.status,
      summary: run.summary, file: path.relative(opts.output, runPath).replaceAll('\\', '/') });
    await writeJson(schedulePath, report);
    console.log(JSON.stringify({ event: 'run-finish', id: run.id, status: run.status, summary: run.summary, stop: ledger.stop }));
    if (ledger.stop) break;
    if (report.results.length < schedule.length) await delay(opts.pause * 1000);
  }
  report.groups = summarizeGroups(report.results);
  report.comparisons = summarizeComparisons(report.results, opts.arms);
  report.finishedAt = new Date().toISOString(); report.stop = ledger.stop;
  report.status = ledger.stop ? 'stopped' : report.results.length === schedule.length && report.results.every(row => row.status === 'observed') ? 'complete' : 'incomplete';
  await writeJson(ledgerPath, ledger); await writeJson(schedulePath, report);
  console.log(JSON.stringify({ report: schedulePath, status: report.status, budget: ledger }));
  if (report.status !== 'complete') process.exitCode = 2;
}

module.exports = { options, benchmarkWindow, normalizeVideos, makeSchedule, rangeLength, isProbe, createNetworkTracker, recordDash, summarizeRun,
  summarizeGroups, summarizeComparisons, cohort, hiddenIntervals, foregroundDuration, measuredPhaseSummary, qualityCoverage, matchesDefaultRuntime, segmentJumps };
if (require.main === module) main().catch(error => { console.error(redactReportUrls(String(error))); process.exitCode = 1; });
