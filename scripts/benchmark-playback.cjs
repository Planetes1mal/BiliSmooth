// Reproducible, bounded playback observations. Reports contain no signed URLs or cookies.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { loadAuthState, checkLogin } = require('./playback-auth.cjs');
const { assertBuildMatches, redactReportUrls } = require('./validation-support.cjs');
const { observe, snapshot, summarize } = require('./playback-observer.cjs');
const root = path.resolve(__dirname, '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const armNames = ['native', 'upstream', 'bilismooth'];
const hostPolicy = require('../src/core/routing-policy.js').createPolicy({});

function options(argv) {
  const value = (name, fallback) => argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  if (argv.includes('--help')) return { help: true };
  const mode = value('mode', 'measure'), arms = value('arms', mode === 'screen' ? 'native' : armNames.join(',')).split(',');
  if (!['screen', 'measure'].includes(mode)) throw Error('--mode must be screen or measure');
  if (!arms.length || new Set(arms).size !== arms.length || arms.some(arm => !armNames.includes(arm))) throw Error('Unknown or repeated arm');
  if (mode === 'screen' && (arms.length !== 1 || arms[0] !== 'native')) throw Error('Screening uses native only');
  if (!argv.includes('--auth')) throw Error('Benchmark requires --auth; use npm run test:login if saved login is unavailable');
  const videos = value('videos'), output = value('output');
  if (!videos || !output) throw Error('--videos and --output are required');
  const seconds = Number(value('seconds', mode === 'screen' ? 45 : 90)), pause = Number(value('pause', 15));
  if (!Number.isInteger(seconds) || seconds < 15 || seconds > 180) throw Error('--seconds must be 15–180');
  if (!Number.isInteger(pause) || pause < 10 || pause > 20) throw Error('--pause must be 10–20');
  const label = value('label', mode);
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(label)) throw Error('Invalid --label');
  const outputPath = path.resolve(root, output);
  if (!outputPath.startsWith(path.join(root, 'outputs') + path.sep)) throw Error('--output must be inside outputs/');
  return { mode, arms, videos: path.resolve(root, videos), output: outputPath, seconds, pause, label,
    upstream: value('upstream') ? path.resolve(root, value('upstream')) : null,
    startedAt: value('started-at'), deadline: value('deadline'), maxBytes: Number(value('max-bytes', 4 * 1024 ** 3)),
    resume: argv.includes('--resume') };
}

function normalizeVideos(input, mode) {
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
    if (mode === 'measure' && !['stutter', 'control'].includes(row.set)) throw Error(`Set must be stutter or control: ${id}`);
    return { id, url: url.origin + '/video/' + id + '/', set: mode === 'screen' ? 'candidate' : row.set };
  });
}

function makeSchedule(videos, arms, mode) {
  const schedule = [];
  videos.forEach((video, index) => {
    const repeats = mode === 'screen' ? 1 : video.set === 'stutter' ? 2 : 1;
    for (let repetition = 0; repetition < repeats; repetition++) {
      const offset = (index + repetition) % arms.length;
      const order = [...arms.slice(offset), ...arms.slice(0, offset)];
      for (const arm of order) schedule.push({ id: `${video.id}-${repetition + 1}-${arm}`, video, arm, repetition: repetition + 1 });
    }
  });
  return schedule;
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
    arm === 'bilismooth' && frame.functionName === 'measure' && /(?:^|\/)playback\.js(?:$|[?#])/.test(frame.url) ||
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
  if (!data?.dash) return;
  run.playinfoQuality = data.quality;
  for (const kind of ['video', 'audio']) for (const representation of data.dash[kind] || []) {
    const urls = [representation.baseUrl, representation.base_url, ...(representation.backupUrl || representation.backup_url || [])].filter(Boolean);
    const paths = [...new Set(urls.map(mediaPath))];
    const row = { kind, quality: representation.id, width: representation.width, height: representation.height,
      bandwidthBps: representation.bandwidth, codec: representation.codecs, paths };
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
    const row = { id: `${event.requestId}-${run.requests.length}`, ...address, resourcePath: mediaPath(event.request.url),
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
    addBytes(accounted - (row.accountedBytes || 0)); row.accountedBytes = accounted;
    onBodyBytes?.({ at: Date.parse(row.startedAt) + (event.timestamp - row.startedTimestamp) * 1000,
      bytes: event.dataLength, role: row.isMedia ? row.role : 'other' });
  });
  cdp.on('Network.loadingFinished', event => {
    const row = all.get(event.requestId);
    if (!row) return;
    row.encodedBytes = Math.max(row.encodedBytes, event.encodedDataLength);
    const accounted = Math.max(row.bytes, row.encodedBytes);
    addBytes(accounted - (row.accountedBytes || 0)); row.accountedBytes = accounted;
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

function qualityLabelMatches(actual, selected) {
  const compact = value => String(value || '').replace(/\s+/g, '');
  return !!selected && !/自动|auto/i.test(actual || '') && compact(actual) === compact(selected);
}

function matchesDefaultRuntime(config, defaults) {
  if (!config || config.selection !== 'auto' || !defaults.candidatePool.includes(config.pcdnHost)) return false;
  // The default automatic policy changes this target after ranking or recovery.
  // Every user preference must still match its default.
  return require('node:util').isDeepStrictEqual({ ...config, pcdnHost: defaults.pcdnHost }, defaults);
}

function qualitySettled(quality, selectedQualityId) {
  if (!quality || !Number.isFinite(quality.nowQ) || quality.nowQ !== quality.newQ || !(quality.realQ > 0)) return false;
  // Auto is represented by nowQ=newQ=0 while realQ names the delivered quality.
  return selectedQualityId === undefined ? quality.nowQ === 0 || quality.realQ === quality.nowQ
    : quality.nowQ === selectedQualityId && quality.realQ === selectedQualityId;
}

function qualityPrepared(sample, selection, representations, requests) {
  return qualityLabelMatches(sample.quality, selection.selectedLabel) &&
    qualitySettled(sample.nativeQuality, selection.selectedQualityId) && sample.media?.readyState >= 1 &&
    representations.some(row => row.kind === 'video' && row.quality === selection.selectedQualityId &&
      row.width === sample.media.width && row.height === sample.media.height &&
      requests.some(request => request.role === 'playback' && request.bytes > 0 && row.paths.includes(request.resourcePath)));
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

async function requestNativeQuality({ selectedQualityId, offeredQualityIds, lowerQualityId }) {
  const player = window.player;
  if (typeof player?.getQuality !== 'function' || typeof player.requestQuality !== 'function') throw Error('Native quality API is unavailable');
  const state = () => { const quality = player.getQuality(); return { nowQ: quality.nowQ, newQ: quality.newQ, realQ: quality.realQ }; };
  const errorInfo = error => ({ code: typeof error?.code === 'number' || typeof error?.code === 'string' ? error.code : null,
    msg: typeof error?.msg === 'string' ? error.msg : typeof error?.message === 'string' ? error.message : typeof error === 'string' ? error : null,
    isChange: typeof error?.isChange === 'boolean' ? error.isChange : null });
  const before = state(), requestedAt = performance.now(), commands = [];
  if (before.nowQ === selectedQualityId) return { requested: false, requestedAt, before, after: before, commands, error: null };
  async function command(qualityId) {
    const entry = { qualityId, startedAt: performance.now(), startedWallTime: Date.now(), before: state() }; commands.push(entry);
    let timer;
    try {
      // Audio is deliberately unspecified. Native permission checks still apply.
      await Promise.race([player.requestQuality(qualityId), new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error('Native quality request did not settle within 20 seconds')), 20000);
      })]);
      entry.error = null;
    } catch (error) { entry.error = errorInfo(error); }
    finally { clearTimeout(timer); entry.finishedAt = performance.now(); entry.finishedWallTime = Date.now(); entry.after = state(); }
    return entry.error;
  }
  let error = await command(selectedQualityId), workaround = null;
  const current = state();
  if (error?.code === 20004 && current.nowQ === 0 && current.newQ === 0 && offeredQualityIds.includes(selectedQualityId) &&
    Number.isFinite(lowerQualityId) && offeredQualityIds.includes(lowerQualityId)) {
    // The native adapter can reject the rendered index as unchanged while Auto
    // remains active. One offered lower quality establishes a different index.
    workaround = { reason: 'SET_QUALITY_SAME_VALUE-in-auto', lowerQualityId };
    error = await command(lowerQualityId);
    if (!error) error = await command(selectedQualityId);
  }
  return { requested: true, requestedAt, settledAt: performance.now(), before, after: state(), commands, workaround, error };
}

async function selectQuality(page) {
  await page.locator('.bpx-player-container').hover({ timeout: 5000 });
  await page.locator('.bpx-player-ctrl-quality').hover({ timeout: 5000 });
  const menu = page.locator('.bpx-player-ctrl-quality-menu-item');
  await menu.first().waitFor({ state: 'visible', timeout: 5000 });
  const entries = await menu.evaluateAll(items => items.map((item, index) => ({ index,
    label: item.textContent.trim(), qualityId: Number(item.getAttribute('data-value')) || null,
    disabled: item.getAttribute('aria-disabled') === 'true' || /disabled|locked/.test(item.className) })));
  const candidates = entries.map(item => ({ ...item, height: Number(item.label.match(/(\d{3,4})\s*P/i)?.[1] || 0) }))
    .filter(item => item.height > 0 && item.height <= 1080 && !/高码率|高帧率|60帧|120帧|HDR|杜比|4K|8K|增强|自动|auto/i.test(item.label))
    .sort((a, b) => b.height - a.height || a.index - b.index);
  const selected = candidates[0];
  if (!selected || selected.disabled) throw Error('Native 1080P-or-lower quality is unavailable');
  const selectedQualityId = selected.qualityId || ({ 1080: 80, 720: 64, 480: 32, 360: 16 })[selected.height] || null;
  if (!selectedQualityId) throw Error('The native quality option has no recognized quality ID');
  // Enumerate offered options through the menu, then use the player's own
  // permission-checked API. Pointer selection was observed to leave Auto active.
  await page.mouse.move(0, 0);
  const qualityId = item => item.qualityId || ({ 1080: 80, 720: 64, 480: 32, 360: 16 })[item.height] || null;
  const lower = candidates.find(item => !item.disabled && item.height < selected.height);
  const nativeRequest = await page.evaluate(requestNativeQuality, { selectedQualityId,
    offeredQualityIds: candidates.filter(item => !item.disabled).map(qualityId).filter(Number.isFinite),
    lowerQualityId: lower ? qualityId(lower) : null });
  return { action: 'native-quality-api', availableOptionsSource: 'native-quality-menu', requestedCeiling: 1080,
    selectedHeight: selected.height, selectedQualityId, selectedLabel: selected.label, options: entries, nativeRequest };
}

function beginConditionedPlayback() {
  const video = [...document.querySelectorAll('video')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  video.muted = true; video.playbackRate = 1;
  const at = performance.now(); window.__benchmarkConditionedFrame = null;
  function frame(now, metadata) {
    // A queued frame from restored viewing history must not count as a frame at zero.
    if (!video.seeking && !video.paused && metadata.mediaTime >= 0 && metadata.mediaTime <= 2 &&
      Math.abs(metadata.mediaTime - video.currentTime) < 0.5) window.__benchmarkConditionedFrame = performance.now() - at;
    else video.requestVideoFrameCallback(frame);
  }
  video.requestVideoFrameCallback(frame);
  window.player.play().catch(error => window.__biliObservation.events.push({ event: 'harness-play-rejected', at: performance.now(), message: String(error) }));
  return { at, wallTime: Date.now() };
}

async function prepareNativeStart() {
  const video = [...document.querySelectorAll('video')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  const player = window.player;
  if (typeof player?.pause !== 'function' || typeof player.seek !== 'function' || typeof player.play !== 'function')
    throw Error('Native playback controls are unavailable');
  const read = () => ({ currentTime: video.currentTime, paused: video.paused, seeking: video.seeking, readyState: video.readyState });
  const result = { requestedAt: performance.now(), requestedStartTime: 0, previousTime: video.currentTime,
    timeoutMs: 20000, before: read() };
  video.muted = true; video.playbackRate = 1;
  player.pause(); result.pausedAt = performance.now();
  let timer;
  try {
    await Promise.race([player.seek(0), new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error('Native paused seek did not settle within 20 seconds')), result.timeoutMs);
    })]);
    result.seekResolved = true;
  } catch (error) {
    result.seekResolved = false;
    result.error = { code: error?.code ?? null, msg: error?.msg ?? error?.message ?? String(error), isChange: error?.isChange ?? null };
  } finally { clearTimeout(timer); result.finishedAt = performance.now(); result.elapsedMs = result.finishedAt - result.requestedAt; result.after = read(); }
  return result;
}

function summarizeRun(run) {
  run.summary = summarize(run.samples);
  run.summary.firstFrameFromNavigationMs = run.firstFrameFromNavigationMs ?? run.summary.firstFrameFromNavigationMs;
  run.summary.conditionedFirstFrameMs = run.conditionedFirstFrameMs ?? null;
  run.summary.mediaBytes = run.requests.filter(row => row.role === 'playback').reduce((sum, row) => sum + row.bytes, 0);
  run.summary.probeBytes = run.requests.filter(row => row.role === 'probe').reduce((sum, row) => sum + row.bytes, 0);
  run.summary.unknownMediaByteRequests = run.requests.filter(row => row.role === 'playback' && row.bytes === null).length;
  run.summary.unknownProbeByteRequests = run.requests.filter(row => row.role === 'probe' && row.bytes === null).length;
  run.summary.diagnosticProbeBytes = run.candidateDiagnostics?.probeBytes ?? null;
  run.summary.deliveryHosts = [...new Set(run.requests.filter(row => row.role === 'playback' && row.bytes > 0).map(row => row.host))];
  run.summary.decodedVideoTracks = run.mediaProperties.flatMap(event => event.properties.filter(item => item.name === 'kVideoTracks').flatMap(item => {
    try { return JSON.parse(item.value).map(track => ({ codec: track.codec, codedSize: track['coded size'], naturalSize: track['natural size'] })); }
    catch { return []; }
  }));
  const representations = run.dashRepresentations.filter(row => row.kind === 'video' && row.quality === run.qualitySelection?.selectedQualityId &&
    run.requests.some(request => request.role === 'playback' && request.bytes > 0 && row.paths.includes(request.resourcePath)));
  const correctQualityAndRate = sample => sample.media && Math.abs(sample.media.rate - 1) < 0.01 &&
    qualityLabelMatches(sample.quality, run.qualitySelection?.selectedLabel) &&
    qualitySettled(sample.nativeQuality, run.qualitySelection?.selectedQualityId) &&
    representations.some(row => row.width === sample.media.width && row.height === sample.media.height);
  const active = sample => sample.media && sample.frames > 0 && !sample.media.paused && !sample.media.seeking && !sample.media.ended &&
    sample.visibility === 'visible' && sample.media.width > 0 && correctQualityAndRate(sample);
  run.summary.validFrameProgressMs = run.samples.reduce((sum, sample, index) => {
    const previous = run.samples[index - 1];
    return sum + (previous && active(previous) && active(sample) && sample.videoId === previous.videoId && sample.frames > previous.frames
      ? Math.min(500, sample.at - previous.at) : 0);
  }, 0);
  const mismatchedSamples = run.samples.filter(sample => sample.media?.width > 0 && !correctQualityAndRate(sample)).length;
  const wrongQualityRequests = run.requests.filter(request => request.role === 'playback' && request.kind === 'video' && request.bytes > 0 &&
    Number.isFinite(run.conditionedWallTime) && Date.parse(request.startedAt) >= run.conditionedWallTime &&
    request.qualityId !== undefined && request.qualityId !== run.qualitySelection?.selectedQualityId);
  run.segmentContinuity = { valid: true, toleranceSeconds: 2, jumps: segmentJumps(run.samples) };
  run.segmentContinuity.valid = run.segmentContinuity.jumps.length === 0;
  run.requestedConditions = { quality: run.qualitySelection?.selectedHeight ?? null, rate: 1,
    qualityVerified: run.samples.some(active), validFrameProgressMs: run.summary.validFrameProgressMs,
    mismatchedQualityOrRateSamples: mismatchedSamples,
    mismatchedQualityRequests: wrongQualityRequests.map(request => request.id),
    foregroundCoverage: run.samples.length ? run.summary.activeForegroundSamples / run.samples.length : 0,
    met: run.summary.validFrameProgressMs >= 5000 && mismatchedSamples === 0 && wrongQualityRequests.length === 0 && run.segmentContinuity.valid &&
      run.summary.activeForegroundSamples >= run.samples.length * 0.8,
    representations };
  if (!run.status) run.status = !run.segmentContinuity.valid ? 'invalid-segment'
    : run.mediaErrors.length || run.samples.some(sample => sample.media?.error) ? 'failed-media'
    : run.requestedConditions.met ? 'observed' : 'incomplete-playback-observation';
}

async function runOne(spec, opts, auth, extensions, ledger, persist) {
  const run = { ...spec, startedAt: new Date().toISOString(), requests: [], samples: [], mediaProperties: [], mediaErrors: [],
    dashRepresentations: [], environment: { headed: true, viewport: { width: 2560, height: 1440 }, sound: 'muted', rate: 1,
      freshProfile: true, extensionSettings: 'defaults', observationSeconds: opts.seconds,
      presentationScale: 'Browser presentation scale is not controlled; decoded quality is selected independently.' } };
  let context, page, cdp, closing, finalizeNetwork = () => {}, interval, riskCheckRunning = false, recordingQualityBytes = false;
  const qualityByteEvents = [];
  const stop = reason => {
    ledger.stop ||= { reason, at: new Date().toISOString(), runId: run.id };
    run.status = 'stopped'; run.stop = ledger.stop;
    if (context && !closing) closing = context.close().catch(() => {});
  };
  const addBytes = count => {
    ledger.networkBytes += count; run.networkBytes = (run.networkBytes || 0) + count;
    if (ledger.networkBytes >= ledger.maxBytes) stop('data-budget-exhausted');
  };
  const onSignal = () => stop('operator-interrupt');
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    const profile = await fs.mkdtemp(path.join(root, 'work', 'benchmark-profile-'));
    run.profile = path.relative(root, profile).replaceAll('\\', '/');
    const args = ['--autoplay-policy=no-user-gesture-required', '--disable-background-networking', '--window-size=2560,1440'];
    if (spec.arm === 'native') args.push('--disable-extensions');
    else args.push(`--disable-extensions-except=${extensions[spec.arm]}`, `--load-extension=${extensions[spec.arm]}`);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: false,
      viewport: { width: 2560, height: 1440 }, args });
    await context.addCookies(auth.cookies);
    await context.addInitScript(observe);
    await context.addInitScript(() => {
      const mute = () => { for (const video of document.querySelectorAll('video')) video.muted = true; };
      new MutationObserver(mute).observe(document, { childList: true, subtree: true }); mute();
    });
    page = context.pages()[0] || await context.newPage();
    await page.bringToFront();
    run.browserVersion = context.browser()?.version();
    cdp = await context.newCDPSession(page);
    finalizeNetwork = createNetworkTracker(cdp, run, stop, addBytes, event => { if (recordingQualityBytes) qualityByteEvents.push(event); });
    await cdp.send('Network.enable'); await cdp.send('Media.enable');
    cdp.on('Media.playerPropertiesChanged', event => run.mediaProperties.push({ playerId: event.playerId,
      properties: event.properties.filter(item => ['kVideoTracks', 'kAudioTracks', 'kVideoDecoderName', 'kAudioDecoderName', 'kResolution'].includes(item.name)) }));
    cdp.on('Media.playerErrorsRaised', event => run.mediaErrors.push(event));
    const pending = new Set();
    page.on('response', response => {
      if (response.status() === 412 || response.status() === 429) { stop(`risk-http-${response.status()}`); return; }
      const url = new URL(response.url());
      if (url.hostname !== 'api.bilibili.com' || !/json/i.test(response.headers()['content-type'] || '')) return;
      const reading = response.json().then(payload => {
        if ([-352, -412, -509].includes(payload?.code)) stop(`risk-api-${payload.code}`);
        if (/\/(?:playurl|playinfo)(?:\/|$)/.test(url.pathname)) recordDash(run, payload);
      }).catch(() => {});
      pending.add(reading); reading.finally(() => pending.delete(reading));
    });
    interval = setInterval(async () => {
      if (Date.now() >= Date.parse(ledger.deadline)) stop('time-budget-exhausted');
      if (riskCheckRunning || ledger.stop || !page || page.isClosed()) return;
      riskCheckRunning = true;
      try {
        const risk = await page.evaluate(() => {
          const visible = element => !!(element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
          if ([...document.querySelectorAll('[class*="geetest_panel"], [class*="geetest_holder"], [class*="bili-captcha"], #biliMainCaptcha')].some(visible)) return 'captcha-visible';
          if (/访问过于频繁|请求过于频繁|当前访问存在风险|异常访问|请完成安全验证/.test(document.body?.innerText || '')) return 'risk-control-visible';
          return null;
        });
        if (risk) stop(risk);
      } catch { /* A navigation or an immediate safety close can destroy the execution context. */ }
      finally { riskCheckRunning = false; }
    }, 1000);
    if (spec.arm === 'bilismooth') {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
      run.extension = await worker.evaluate(async () => {
        const key = BiliSmoothSettingsMigration.key, stored = await chrome.storage.local.get(key);
        return { version: chrome.runtime.getManifest().version, name: chrome.runtime.getManifest().name,
          preferencesPresent: Object.hasOwn(stored, key), preferencesBeforeVideo: BiliSmoothSettings.normalize(stored[key]) };
      });
      run.extension.defaultPreferencesVerified = require('node:util').isDeepStrictEqual(run.extension.preferencesBeforeVideo,
        require('../src/core/settings.js').normalize({}));
      if (!run.extension.defaultPreferencesVerified) throw Error('BiliSmooth stored preferences do not match defaults before video navigation');
    }
    await page.goto('https://www.bilibili.com/robots.txt', { waitUntil: 'domcontentloaded', timeout: 25000 });
    run.authentication = await checkLogin(page);
    if (run.authentication !== true) { stop(run.authentication === false ? 'saved-login-expired: run npm run test:login' : 'login-status-unavailable'); return run; }
    const navigation = await page.goto(spec.video.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    run.navigationStatus = navigation?.status();
    if (run.navigationStatus >= 400 && !ledger.stop) { run.status = 'unavailable-video'; return run; }
    try { await page.waitForFunction(() => !!document.querySelector('video'), undefined, { timeout: 20000 }); }
    catch (error) { if (ledger.stop) throw error; run.status = 'unavailable-video'; return run; }
    if (spec.arm === 'upstream') {
      run.extension = await page.evaluate(() => ({ installed: window.__BILI_ACCELERATOR_INSTALLED__ === true,
        configStored: localStorage.getItem('biliAccelerator.config.v2') !== null,
        defaults: window.BiliAcceleratorCore?.normalizeConfig() || null,
        config: window.BiliAccelerator?.getConfig(), version: window.BiliAccelerator?.getDiagnostics()?.version }));
      if (!run.extension.installed || run.extension.version !== '0.5.0' ||
        !require('node:util').isDeepStrictEqual(run.extension.config, run.extension.defaults))
        throw Error('Upstream installation or default configuration could not be verified');
    }
    const target = new URL(page.url());
    if (target.origin + target.pathname.replace(/\/$/, '') !== spec.video.url.replace(/\/$/, '')) { run.status = 'unavailable-video'; return run; }
    recordDash(run, await page.evaluate(() => window.__playinfo__ || null));
    // The site's quality setter compares against nowQ, so a request can be
    // ignored while a different newQ is still pending. Wait for that boundary.
    run.initialPreparation = { observations: [], timeoutMs: 20000, stableMs: 1000 };
    const initialDeadline = Date.now() + run.initialPreparation.timeoutMs;
    let initialStableSince = null, initialKey = null, initialReady = false;
    while (Date.now() < initialDeadline && !ledger.stop) {
      const sample = await page.evaluate(snapshot), quality = sample.nativeQuality;
      const ready = sample.frames > 0 && sample.media?.readyState >= 2 && !sample.media.seeking && qualitySettled(quality);
      const key = ready ? JSON.stringify([sample.videoId, quality]) : null;
      run.initialPreparation.observations.push({ at: sample.at, frames: sample.frames, seeking: sample.media?.seeking,
        nativeQuality: quality, label: sample.quality });
      if (!ready || key !== initialKey) initialStableSince = ready ? Date.now() : null;
      initialKey = key;
      if (initialStableSince !== null && Date.now() - initialStableSince >= 1000) { initialReady = true; break; }
      await delay(250);
    }
    if (!initialReady) {
      if (ledger.stop) return run;
      run.status = 'unavailable-quality'; run.error = 'The native initial quality transition did not settle before selection'; return run;
    }
    const bytesBeforeQuality = run.networkBytes || 0;
    recordingQualityBytes = true;
    try { run.qualitySelection = await selectQuality(page); }
    catch (error) { if (ledger.stop) throw error; run.status = 'unavailable-quality'; run.error = redactReportUrls(String(error)); return run; }
    finally { recordingQualityBytes = false; }
    run.qualitySelection.preparationNetworkBytes = (run.networkBytes || 0) - bytesBeforeQuality;
    for (const command of run.qualitySelection.nativeRequest.commands) {
      const traffic = qualityByteEvents.filter(event => event.at >= command.startedWallTime && event.at <= command.finishedWallTime);
      command.networkBodyBytes = traffic.reduce((sum, event) => sum + event.bytes, 0);
      command.mediaBytes = traffic.filter(event => event.role === 'playback').reduce((sum, event) => sum + event.bytes, 0);
      command.probeBytes = traffic.filter(event => event.role === 'probe').reduce((sum, event) => sum + event.bytes, 0);
    }
    if (run.qualitySelection.nativeRequest.error) {
      run.status = 'unavailable-quality'; run.error = 'Native quality request failed';
      run.nativeQualityError = run.qualitySelection.nativeRequest.error; return run;
    }
    // Complete native quality preparation before the timed observation starts.
    // Metadata establishes dimensions even if the first decoded frame is slow.
    try {
      const qualityDeadline = Date.now() + 20000;
      let dimensionsReady = false, stableSince = null;
      run.qualityPreparation = { observations: [] };
      while (Date.now() < qualityDeadline && !ledger.stop) {
        const sample = await page.evaluate(snapshot);
        const latestVideoRequest = [...run.requests].reverse().find(request => request.role === 'playback' && request.bytes > 0 &&
          run.dashRepresentations.some(row => row.kind === 'video' && row.paths.includes(request.resourcePath)));
        const latestQuality = run.dashRepresentations.find(row => row.kind === 'video' && row.paths.includes(latestVideoRequest?.resourcePath))?.quality;
        // A completed quality switch can reuse buffered target data. An older
        // request for the temporary lower quality does not identify the decoder.
        dimensionsReady = qualityPrepared(sample, run.qualitySelection, run.dashRepresentations, run.requests);
        run.qualityPreparation.observations.push({ at: sample.at, label: sample.quality, latestDeliveredQualityId: latestQuality ?? null,
          nativeQuality: sample.nativeQuality, width: sample.media?.width, height: sample.media?.height });
        if (dimensionsReady) stableSince ??= Date.now();
        else stableSince = null;
        if (stableSince !== null && Date.now() - stableSince >= 1000) break;
        await delay(250);
      }
      if (!dimensionsReady || stableSince === null || Date.now() - stableSince < 1000) throw Error('Selected fixed quality unavailable');
    } catch (error) { if (ledger.stop) throw error; run.status = 'unavailable-quality'; run.error = 'Selected fixed quality and decoded dimensions were not established after native preparation'; return run; }
    run.firstFrameFromNavigationMs = await page.evaluate(() => window.__biliObservation.firstPrimaryFrameAt);
    run.startPreparation = await page.evaluate(prepareNativeStart);
    try {
      if (!run.startPreparation.seekResolved) throw Error('Native paused seek did not complete');
      await page.waitForFunction(() => {
        const video = [...document.querySelectorAll('video')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
        return video && video.paused && !video.seeking && video.readyState >= 2 && video.currentTime >= 0 && video.currentTime <= 1;
      }, undefined, { timeout: Math.max(1, run.startPreparation.timeoutMs - run.startPreparation.elapsedMs) });
      run.startPreparation.completed = true;
      run.startPreparation.result = await page.evaluate(snapshot);
      if (!qualityLabelMatches(run.startPreparation.result.quality, run.qualitySelection.selectedLabel) ||
        !qualitySettled(run.startPreparation.result.nativeQuality, run.qualitySelection.selectedQualityId)) throw Error('Quality changed during seek preparation');
    } catch (error) {
      if (ledger.stop) throw error;
      run.startPreparation.completed = false;
      run.startPreparation.result = await page.evaluate(snapshot);
      run.status = 'invalid-start'; run.error = 'The requested beginning and fixed quality were not established within 20 seconds'; return run;
    }
    const conditioned = await page.evaluate(beginConditionedPlayback);
    run.conditionedAt = conditioned.at; run.conditionedWallTime = conditioned.wallTime;
    const start = Date.now(); let lastCheckpoint = start, retriedPlayback = false;
    while (Date.now() - start < opts.seconds * 1000 && !ledger.stop) {
      const sample = await page.evaluate(snapshot); run.samples.push(sample);
      if (!retriedPlayback && sample.media && sample.media.readyState >= 1 && (sample.media.paused || Math.abs(sample.media.rate - 1) > 0.01)) {
        retriedPlayback = true;
        await page.evaluate(() => { const video = [...document.querySelectorAll('video')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
          video.muted = true; video.playbackRate = 1; void video.play().catch(() => {}); });
      }
      if (Date.now() - lastCheckpoint >= 5000) { lastCheckpoint = Date.now(); finalizeNetwork(); await persist(run); }
      await delay(250);
    }
    if (!ledger.stop) {
      run.conditionedFirstFrameMs = await page.evaluate(() => window.__benchmarkConditionedFrame);
      const observation = await page.evaluate(() => window.__biliObservation);
      run.firstFrameFromNavigationMs = observation.firstPrimaryFrameAt;
      const ids = new Set(run.samples.map(sample => sample.videoId));
      run.events = observation.events.filter(event => ids.has(event.videoId));
      run.candidateDiagnostics = await page.evaluate(() => window.BiliSmoothSession?.getDiagnostics() || null);
      if (spec.arm === 'upstream') run.upstreamDiagnostics = await page.evaluate(() => window.BiliAccelerator.getDiagnostics());
      if (spec.arm === 'bilismooth') {
        const state = run.samples.at(-1)?.scheduler, defaults = require('../src/core/settings.js').normalize({});
        run.defaultSettingsVerified = run.extension.defaultPreferencesVerified && run.samples.every(sample =>
          sample.scheduler?.candidate && matchesDefaultRuntime(sample.scheduler.config, defaults));
        run.runtimeAutoTargets = [...new Set(run.samples.map(sample => sample.scheduler?.config?.pcdnHost).filter(Boolean))];
        if (!state?.candidate || !run.defaultSettingsVerified) throw Error('BiliSmooth default settings or session could not be verified');
      }
      await Promise.race([Promise.allSettled([...pending]), delay(500)]);
    }
  } catch (error) {
    run.error = redactReportUrls(String(error));
    if (!ledger.stop) { run.status = 'failed-harness'; ledger.stop = { reason: 'run-failed', runId: run.id, at: new Date().toISOString() }; }
  } finally {
    clearInterval(interval);
    if (page && !page.isClosed() && !closing) {
      try {
        const observation = await page.evaluate(() => window.__biliObservation);
        if (observation) { run.events ||= observation.events; run.firstFrameFromNavigationMs = observation.firstPrimaryFrameAt; }
      } catch { /* Context loss during a safety close leaves earlier checkpoints intact. */ }
    }
    if (context) await (closing || context.close());
    finalizeNetwork();
    run.finishedAt = new Date().toISOString(); summarizeRun(run);
    await persist(run);
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
  }
  return run;
}

async function writeJson(file, value) { await fs.writeFile(file, JSON.stringify(redactReportUrls(value), null, 2) + '\n'); }

async function main(argv = process.argv.slice(2)) {
  const opts = options(argv);
  if (opts.help) {
    console.log([
      'npm run benchmark -- --videos=outputs/benchmark-YYYYMMDD/videos.json --arms=native,upstream,bilismooth --upstream=work/bilibili-accelerator/dist/extension --auth --output=outputs/benchmark-YYYYMMDD',
      '',
      'Video file example (replace the example IDs with actual video IDs):',
      '[{"id":"BV1example","set":"stutter"},{"id":"BV2example","set":"control"}]',
      'Each entry accepts id or a normal Bilibili video-page url. Measurement requires set=stutter or control.',
      'Stutter videos run twice per arm; controls run once. Arms are interleaved and their order rotates.',
      '',
      'Create and freeze plan.md inside --output before starting. Its hash is checked on later runs.',
      '--mode=screen: native only, one 45-second run per candidate; set is ignored.',
      '--mode=measure: 90 seconds per run (default). --seconds=15..180 overrides the duration.',
      '--pause=15: seconds between runs; allowed range 10..20.',
      '--max-bytes=4294967296: default 4 GiB cumulative network budget; can only be reduced.',
      '--started-at=ISO --deadline=ISO: default deadline is three hours after the recorded start.',
      '--label=NAME: separate schedule within the output directory; defaults to the mode.',
      '--resume: continue the identical schedule. It cannot clear a recorded stop or repeat a partial run.',
      'All labels in one output directory share budget.json. Existing --auth login is required.',
      'Runs use fresh headed Chromium profiles, muted audio, 1x, a 2560x1440 viewport, and ordinary 1080P or the highest offered quality below it.'
    ].join('\n'));
    return;
  }
  await fs.mkdir(opts.output, { recursive: true }); await fs.mkdir(path.join(root, 'work'), { recursive: true });
  const plan = await fs.readFile(path.join(opts.output, 'plan.md'), 'utf8');
  const videos = normalizeVideos(JSON.parse(await fs.readFile(opts.videos, 'utf8')), opts.mode);
  const auth = await loadAuthState(root);
  if (!auth) throw Error('Saved login is missing; run npm run test:login');
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
    const directory = arm === 'bilismooth' ? path.join(root, 'dist', 'extension') : opts.upstream;
    if (!directory) throw Error('--upstream is required for the upstream arm');
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (manifest.manifest_version !== 3) throw Error(`${arm} must be an MV3 build`);
    if (arm === 'bilismooth') await assertBuildMatches(root, directory);
    extensions[arm] = directory;
  }
  const schedulePath = path.join(opts.output, `${opts.label}-schedule.json`);
  const runsPath = path.join(opts.output, `${opts.label}-runs`);
  const schedule = makeSchedule(videos, opts.arms, opts.mode);
  const settings = { mode: opts.mode, arms: opts.arms, seconds: opts.seconds, pause: opts.pause, schedule };
  let previous;
  try { previous = JSON.parse(await fs.readFile(schedulePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && !opts.resume) throw Error('Schedule exists; use --resume or another label');
  if (previous && previous.settingsSha256 !== hash(JSON.stringify(settings))) throw Error('Resume cannot change schedule settings');
  const report = previous || { createdAt: new Date().toISOString(), settingsSha256: hash(JSON.stringify(settings)), ...settings, results: [],
    observation: { sampleMs: 250, stallThresholdMs: 1500, definition: 'Shared check-playback observer: after first frame, no frame progress for >=1500 ms while foreground, playing, not seeking or ended. Startup is separate.' },
    network: { bytes: 'CDP body bytes, including partial requests. Budget uses max(body, encoded) per request for all page traffic.',
      probeClassification: 'BiliSmooth playback.js initiator frame named measure; independently compare diagnostic probeBytes.',
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
    const expectedMs = (opts.seconds + opts.pause + 30) * 1000;
    if (ledger.maxBytes - ledger.networkBytes < expectedBytes || Date.parse(ledger.deadline) - Date.now() < expectedMs) {
      ledger.stop = { reason: 'insufficient-budget-for-next-run', at: new Date().toISOString(), expectedBytes, expectedMs }; break;
    }
    const run = await runOne(spec, opts, auth, extensions, ledger, persist);
    (ledger.runHistory ||= []).push({ networkBytes: run.networkBytes || 0, durationMs: Date.parse(run.finishedAt) - Date.parse(run.startedAt) });
    report.results.push({ id: run.id, video: run.video, arm: run.arm, repetition: run.repetition, status: run.status,
      summary: run.summary, file: path.relative(opts.output, runPath).replaceAll('\\', '/') });
    await writeJson(schedulePath, report);
    console.log(JSON.stringify({ event: 'run-finish', id: run.id, status: run.status, summary: run.summary, stop: ledger.stop }));
    if (ledger.stop) break;
    if (report.results.length < schedule.length) await delay(opts.pause * 1000);
  }
  report.finishedAt = new Date().toISOString(); report.stop = ledger.stop;
  report.status = ledger.stop ? 'stopped' : report.results.length === schedule.length ? 'complete' : 'incomplete';
  await writeJson(ledgerPath, ledger); await writeJson(schedulePath, report);
  console.log(JSON.stringify({ report: schedulePath, status: report.status, budget: ledger }));
  if (report.status !== 'complete') process.exitCode = 2;
}

module.exports = { options, normalizeVideos, makeSchedule, rangeLength, isProbe, createNetworkTracker, recordDash, summarizeRun,
  qualityLabelMatches, beginConditionedPlayback, prepareNativeStart, matchesDefaultRuntime, qualitySettled, qualityPrepared, segmentJumps, requestNativeQuality };
if (require.main === module) main().catch(error => { console.error(redactReportUrls(String(error))); process.exitCode = 1; });
