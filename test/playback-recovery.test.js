// Diagnostic feedback loop: real kernel + session + frame monitor, fake browser/time.
// Does not contact a CDN, decode video, or establish real-world throughput.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const A = 'upos-sz-mirroraliov.bilivideo.com';
const B = 'upos-sz-mirrorcosov.bilivideo.com';
const START = 1788836240000;
const RANK_KEY = 'bilismooth.routing.rank.v4.America/New_York|en-US';
const media = host => `https://${host}/upgcxcode/1/video.m4s`;
function emitter(value = {}, { targetOnly = false } = {}) {
  const listeners = new Map();
  const capture = options => options === true || options?.capture === true;
  value.addEventListener = (type, fn, options) => {
    if (!listeners.has(type)) listeners.set(type, []);
    const rows = listeners.get(type), useCapture = capture(options);
    if (!rows.some(row => row.fn === fn && row.capture === useCapture)) rows.push({ fn, capture: useCapture, once: !!options?.once });
  };
  value.removeEventListener = (type, fn, options) => {
    const rows = listeners.get(type) || [], index = rows.findIndex(row => row.fn === fn && row.capture === capture(options));
    if (index >= 0) rows.splice(index, 1);
  };
  value.emit = (type, data = {}) => {
    const rows = listeners.get(type) || [];
    // Native XMLHttpRequest is a target-only EventTarget: capture does not
    // reorder its listeners. Chromium was checked independently for this seam.
    const ordered = targetOnly ? [...rows] : [...rows].sort((a, b) => Number(b.capture) - Number(a.capture));
    for (const row of ordered) {
      if (!rows.includes(row)) continue;
      if (row.once) rows.splice(rows.indexOf(row), 1);
      row.fn({ type, target: value, currentTarget: value, ...data });
    }
  };
  return value;
}
function harness({ store = new Map(), at = START, initial = {}, config = {}, fps = '60', kernelOptions = {}, rvfc = false } = {}) {
  let clock = at, serial = 0, count = 0, bufferEnd = 40;
  const timers = new Map();
  const video = emitter({ paused: false, ended: false, seeking: false, currentTime: 1, readyState: 4,
    currentSrc: 'blob:fixture', videoWidth: 3840, videoHeight: 2160, playbackRate: 1,
    buffered: { length: 1, start: () => 0, end: () => bufferEnd },
    getVideoPlaybackQuality: () => ({ totalVideoFrames: count, droppedVideoFrames: 0 }), ...initial });
  const frameCallbacks = new Map();
  if (rvfc) {
    video.requestVideoFrameCallback = fn => { frameCallbacks.set(++serial, fn); return serial; };
    video.cancelVideoFrameCallback = id => frameCallbacks.delete(id);
  }
  let currentVideo = video;
  const document = emitter({ readyState: 'complete', hidden: false, querySelector: () => currentVideo, querySelectorAll: () => currentVideo ? [currentVideo] : [] });
  class FakeDate extends Date { static now() { return clock; } }
  class XHR {
    constructor() { emitter(this, { targetOnly: true }); this.readyState = 0; this.responseType = ''; this.status = 0; }
    open(method, url) { this.url = url; this.responseURL = url; this.readyState = 1; }
    send() {}
    setRequestHeader() {}
    getResponseHeader() { return 'video/mp4'; }
    progress(bytes) { this.status = 206; this.emit('progress', { loaded: bytes }); }
    complete(bytes) { this.readyState = 4; this.status = 206; this.emit('load'); this.emit('loadend', { loaded: bytes }); }
    timeout(bytes = 0) { this.readyState = 4; this.status = 0; this.emit('timeout'); this.emit('loadend', { loaded: bytes }); }
  }
  const scope = emitter({ console, URL, Request, Response, Headers, AbortController, XMLHttpRequest: XHR,
    JSON: { parse: JSON.parse, stringify: JSON.stringify }, Date: FakeDate, performance: { now: () => clock },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'America/New_York' }) }) },
    navigator: { language: 'en-US', connection: emitter() }, document,
    location: { origin: 'https://www.bilibili.com', href: 'https://www.bilibili.com/video/BVfixture' },
    localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    postMessage() {},
    setTimeout(fn, ms) { timers.set(++serial, { fn, at: clock + ms }); return serial; }, clearTimeout: id => timers.delete(id),
    setInterval(fn, ms) { timers.set(++serial, { fn, at: clock + ms, interval: ms }); return serial; }, clearInterval: id => timers.delete(id) });
  scope.globalThis = scope;
  const context = vm.createContext(scope);
  for (const file of ['src/core/settings.js', 'src/core/routing-policy.js', 'src/core/media-observer.js',
    'src/page/frame-monitor.js', 'src/core/playback-feedback.js', 'src/page/network-probe.js', 'src/page/request-interceptor.js', 'src/page/playback-kernel.js'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  let kernel;
  const actualKernel = scope.BiliSmoothPlaybackKernel;
  scope.BiliSmoothPlaybackKernel = { ...actualKernel, create(options) { kernel = actualKernel.create({ ...options, ...kernelOptions }); return kernel; } };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/page/passive-session.js'), 'utf8'), context, { filename: 'src/page/passive-session.js' });
  const api = scope.BiliSmoothSession;
  api.setConfig({ enabled: true, mode: 'force', selection: 'auto', stallRecovery: true, ...config });
  scope.__playinfo__ = { data: { dash: { video: [{ id: 120, baseUrl: media(A), backupUrl: [], width: 3840, height: 2160, frame_rate: fps }] } } };
  function advance(ms, { frames = false, move = true } = {}) {
    const target = clock + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      const end = next ? next[1].at : target;
      const elapsed = end - clock;
      if (move && !video.paused && !video.seeking) video.currentTime += elapsed / 1000 * video.playbackRate;
      if (frames) count += Math.round(elapsed / 1000 * 60 * video.playbackRate);
      clock = end;
      if (frames) for (const [id, callback] of [...frameCallbacks]) {
        frameCallbacks.delete(id); callback(clock, { presentedFrames: count, mediaTime: video.currentTime });
      }
      if (!next) break;
      if (next[1].interval) next[1].at += next[1].interval; else timers.delete(next[0]);
      next[1].fn();
    }
  }
  function request(raw = media(A)) { const xhr = new scope.XMLHttpRequest(); xhr.open('GET', raw); xhr.send(); return xhr; }
  function close() { scope.emit('pagehide'); kernel.destroy(); }
  return { api, kernel, store, video, document, scope, advance, request, close, now: () => clock,
    replacePlayer(next = null) { currentVideo = next; },
    stopObservations() { for (const [id, timer] of timers) if (timer.interval === 1000 && timer.fn.name === 'tick') timers.delete(id); },
    buffer: seconds => { bufferEnd = video.currentTime + seconds; } };
}
function cachedStore() {
  return new Map([[RANK_KEY, JSON.stringify({ ranking: [A, B], samples: [], at: START - 60000 })]]);
}

test('confirmed frozen frames plus empty buffer must not lose recovery to readyState=4', () => {
  const h = harness({ store: cachedStore(), rvfc: true });
  h.advance(2000, { frames: true });
  assert.equal(h.api.getState().media.frameHealth.state, 'healthy', 'fixture establishes actual FrameMonitor baseline');
  assert.equal(h.api.getState().media.frameHealth.source, 'rvfc');
  h.buffer(0);
  h.video.emit('waiting');
  h.advance(2500);
  const d = h.api.getDiagnostics();
  const signal = { frameHealth: d.media.frameHealth.state, buffer: d.buffer, readyState: d.media.readyState,
    playhead: d.observations.at(-1)?.playhead, recoveryAttempts: d.recoveryAttempts,
    decision: d.events.filter(e => e.type === 'stall-timer').map(e => ({ action: e.action, reason: e.reason })) };
  h.close();
  assert.equal(signal.frameHealth, 'frozen');
  assert.equal(signal.buffer, 0);
  assert.equal(signal.readyState, 4);
  assert.ok(signal.recoveryAttempts > 0, 'confirmed stalled presentation with depleted buffer must reach the sole recovery scheduler');
});

const preparing = { paused: true, seeking: true, readyState: 1, currentTime: 139 };
test('startup partial video timeout reroutes the next request even while paused and resuming a saved position', () => {
  const h = harness({ store: cachedStore(), initial: preparing });
  h.video.emit('loadedmetadata'); h.video.emit('seeking');
  const xhr = h.request(); h.advance(10000, { move: false }); xhr.progress(1048576); xhr.timeout(1048576);
  const next = h.request();
  const before = h.api.getDiagnostics(); h.close();
  assert.equal(before.media.frameHealth.state, 'unknown', 'no presented frame ever exists during this startup fixture');
  assert.notEqual(new URL(next.url).hostname, A, 'first timed-out startup video request must make the next attempt avoid that target');
});

test('startup timeout reroutes a synchronous player retry registered after open and before send', () => {
  const h = harness({ store: cachedStore(), initial: preparing });
  h.video.emit('loadedmetadata'); h.video.emit('seeking');
  const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', media(A));
  let retry, delivered = 0;
  xhr.addEventListener('timeout', () => { delivered++; retry = h.request(); });
  xhr.send(); h.advance(10000, { move: false }); xhr.progress(1048576); xhr.timeout(1048576);
  const retries = h.kernel.getState().recoveries; h.close();
  assert.equal(delivered, 1, 'the native timeout event must reach the original player listener exactly once');
  assert.notEqual(new URL(retry.url).hostname, A, 'the target must change before native player timeout listeners issue the next request');
  assert.equal(retries, 1, 'timeout and loadend must not count the same failed request twice');
});

for (const [name, options, act] of [
  ['explicit user pause', {}, h => h.video.emit('pause')],
  ['hidden document', {}, h => { h.document.hidden = true; h.document.emit('visibilitychange'); }],
  ['fixed selection', { config: { selection: 'fixed', pcdnHost: A } }, () => {}],
  ['disabled extension', { config: { enabled: false } }, () => {}],
  ['disabled stall recovery', { config: { stallRecovery: false } }, () => {}]
]) {
  test(`startup timeout respects ${name}`, () => {
    const h = harness({ store: cachedStore(), initial: preparing, ...options });
    h.video.emit('loadedmetadata'); h.video.emit('seeking');
    const xhr = h.request(); act(h); h.advance(10000, { move: false }); xhr.timeout(1048576);
    const after = h.api.getDiagnostics(); h.close();
    assert.equal(after.recoveryAttempts, 0);
    assert.equal(after.targetHost, A);
  });
}

for (const [name, mutate] of [
  ['user pause', h => { h.video.paused = true; h.video.emit('pause'); }],
  ['active seek', h => { h.video.seeking = true; h.video.emit('seeking'); }],
  ['hidden document', h => { h.document.hidden = true; h.document.emit('visibilitychange'); }],
  ['fixed selection', h => h.api.setConfig({ selection: 'fixed' })],
  ['disabled extension', h => h.api.setConfig({ enabled: false })],
  ['old observation', h => h.stopObservations()]
]) {
  test(`high readyState recovery rejects ${name}`, () => {
    const h = harness({ store: cachedStore() });
    h.advance(2000, { frames: true }); h.buffer(0);
    if (name === 'old observation') { h.advance(2000); assert.equal(h.api.getState().media.frameHealth.state, 'frozen'); }
    h.video.emit('waiting'); mutate(h); h.advance(2500);
    const attempts = h.kernel.getState().recoveries; h.close();
    assert.equal(attempts, 0);
  });
}

test('frozen-frame evidence with ample buffer does not diagnose a delivery failure', () => {
  const h = harness({ store: cachedStore() });
  h.advance(2000, { frames: true }); h.buffer(30); h.video.emit('waiting'); h.advance(2500);
  const before = h.api.getDiagnostics(); h.close();
  assert.equal(before.media.frameHealth.state, 'frozen');
  assert.equal(before.recoveryAttempts, 0);
});

test('basic recovery mode keeps low-ready-state eligibility', () => {
  const h = harness({ store: cachedStore(), config: { adaptiveRecovery: false } });
  h.advance(2000, { frames: true }); h.buffer(0); h.video.emit('waiting'); h.advance(2500);
  const before = h.api.getDiagnostics(); h.close();
  assert.equal(before.media.frameHealth.state, 'frozen');
  assert.equal(before.recoveryAttempts, 0);
});

test('low frame-rate cadence retains its longer confirmation window', () => {
  const h = harness({ store: cachedStore(), fps: '0.5' });
  const xhr = h.request(); xhr.complete(1048576);
  h.advance(2000, { frames: true }); h.buffer(0); h.video.emit('waiting'); h.advance(2500);
  const before = h.api.getDiagnostics(); h.close();
  assert.equal(before.media.fps, 0.5);
  assert.ok(before.media.frameHealth.thresholdMs > 2500);
  assert.notEqual(before.media.frameHealth.state, 'frozen');
  assert.equal(before.recoveryAttempts, 0);
});

for (const cause of ['network reset', 'player replacement']) {
  test(`late timeout from an old request cannot recover the new ${cause}`, () => {
    const h = harness({ store: cachedStore(), initial: preparing });
    const xhr = h.request(); h.advance(1000, { move: false });
    if (cause === 'network reset') h.api.resetNetwork();
    else { h.replacePlayer(emitter({ ...h.video, isConnected: true })); h.api.getState(); }
    h.advance(10000, { move: false }); xhr.timeout(1048576);
    const attempts = h.kernel.getState().recoveries; h.close();
    assert.equal(attempts, 0, 'request observations are owned by the playback and network at send time');
  });
}

test('a request sent immediately after player replacement belongs to the new startup', () => {
  const h = harness({ store: cachedStore(), initial: preparing });
  h.advance(250, { move: false });
  h.replacePlayer(emitter({ ...h.video, isConnected: true }));
  const xhr = h.request();
  h.advance(10000, { move: false }); xhr.timeout(1048576);
  const retry = h.request(); h.close();
  assert.notEqual(new URL(retry.url).hostname, A, 'player discovery intervals must not assign the new request to the replaced player');
});

test('control: readyState=4 and empty buffer with healthy advancing frames does not rotate', () => {
  const h = harness({ store: cachedStore() });
  h.advance(2000, { frames: true }); h.buffer(0); h.video.emit('waiting');
  h.advance(2500, { frames: true });
  const d = h.api.getDiagnostics(); h.close();
  assert.equal(d.media.frameHealth.state, 'healthy');
  assert.equal(d.recoveryAttempts, 0);
});

test('control: missing a presented-frame baseline cannot justify readyState=4 recovery', () => {
  const h = harness({ store: cachedStore() });
  h.buffer(0); h.video.emit('waiting'); h.advance(2500);
  const d = h.api.getDiagnostics(); h.close();
  assert.equal(d.media.frameHealth.state, 'unknown');
  assert.equal(d.recoveryAttempts, 0);
});

test('low readyState waiting during a seek does not rotate until playback is waiting again', () => {
  const h = harness({ store: cachedStore() });
  h.advance(2000, { frames: true });
  h.video.seeking = true; h.video.readyState = 2; h.buffer(0);
  h.video.emit('seeking'); h.video.emit('waiting'); h.advance(7500, { move: false });
  const duringSeek = h.kernel.getState().recoveries;
  h.video.seeking = false; h.video.emit('seeked'); h.video.emit('waiting'); h.advance(2500);
  const afterSeek = h.kernel.getState().recoveries; h.close();
  assert.equal(duringSeek, 0, 'a normal seek is not evidence that the selected CDN failed');
  assert.equal(afterSeek, 1, 'a new playback wait still reaches recovery after the seek');
});

test('a short pause or seek gives resumed buffering a fresh recovery grace period', () => {
  for (const interruption of ['pause', 'seeking']) {
    const h = harness({ store: cachedStore() });
    h.video.readyState = 2; h.buffer(0); h.video.emit('waiting'); h.advance(2000);
    if (interruption === 'pause') h.video.paused = true;
    else h.video.seeking = true;
    h.video.emit(interruption); h.advance(100, { move: false });
    if (interruption === 'seeking') h.video.emit('waiting');
    h.advance(150, { move: false });
    h.video.paused = false; h.video.seeking = false;
    h.video.emit(interruption === 'pause' ? 'play' : 'seeked');
    if (interruption === 'pause') h.video.emit('waiting');
    h.advance(2499);
    const early = h.kernel.getState().recoveries;
    h.advance(1);
    const due = h.kernel.getState().recoveries; h.close();
    assert.equal(early, 0, interruption + ' must discard the previous wait deadline');
    assert.equal(due, 1, interruption + ' must still recover continued buffering after a full grace period');
  }
});

test('reusing the player for new media cannot inherit the previous waiting deadline', () => {
  const h = harness({ store: cachedStore() });
  h.video.readyState = 2; h.buffer(0); h.video.emit('waiting'); h.advance(2000);
  const previousGeneration = h.api.getState().mediaGeneration;
  h.video.readyState = 0; h.video.emit('emptied'); h.advance(250, { move: false });
  h.video.readyState = 2; h.video.emit('loadedmetadata'); h.video.emit('waiting');
  h.advance(2499);
  const early = h.kernel.getState().recoveries;
  h.advance(1);
  const state = h.api.getState(); h.close();
  assert.ok(state.mediaGeneration > previousGeneration);
  assert.equal(early, 0, 'the new media needs its own full buffering grace period');
  assert.equal(state.recoveryAttempts, 1);

  for (const transition of ['emptied', 'replacement']) {
    const recovered = harness({ store: cachedStore(), config: { mode: 'bad-only' } });
    recovered.request(media(A)); recovered.video.readyState = 2; recovered.buffer(0);
    recovered.video.emit('waiting'); recovered.advance(2500);
    assert.equal(recovered.kernel.getState().recoveries, 1);
    let nextPlayer = recovered.video;
    if (transition === 'emptied') {
      recovered.video.readyState = 0; recovered.video.emit('emptied');
      recovered.video.readyState = 2; recovered.video.emit('loadedmetadata');
    } else { nextPlayer = emitter({ ...recovered.video, isConnected: true }); recovered.replacePlayer(nextPlayer); }
    const nextMedia = recovered.request(media(A));
    assert.equal(new URL(nextMedia.url).hostname, A, 'new media must not inherit the previous forced recovery route');
    nextPlayer.emit('waiting'); recovered.advance(2499);
    assert.equal(recovered.kernel.getState().recoveries, 1);
    recovered.advance(1);
    const recoveries = recovered.kernel.getState().recoveries; recovered.close();
    assert.equal(recoveries, 2, 'new media receives its own grace period after an earlier recovery');
  }
});

test('manual retry gives its selected CDN a full retry interval when a waiting timer already exists', () => {
  const h = harness({ store: cachedStore() });
  h.video.readyState = 2; h.buffer(0); h.video.emit('waiting'); h.advance(2000);
  assert.equal(h.api.retry(), true);
  const manualHost = h.api.getState().targetHost;
  h.advance(4999);
  const beforeDeadline = h.kernel.getState();
  h.advance(1);
  const afterDeadline = h.kernel.getState(); h.close();
  assert.equal(beforeDeadline.recoveries, 1, 'the old waiting deadline must not immediately discard the manual retry');
  assert.equal(beforeDeadline.config.pcdnHost, manualHost);
  assert.equal(afterDeadline.recoveries, 2, 'continued waiting can recover again after five seconds');
});

test('refresh must not immediately prefer a repeatedly failing route over subsequent stable real-request observations', () => {
  const store = cachedStore(), h = harness({ store });
  h.advance(3000, { frames: true });
  for (let i = 0; i < 2; i++) {
    const xhr = h.request(); h.advance(1000, { frames: true }); xhr.progress(65536); xhr.timeout(65536);
  }
  h.video.readyState = 2; h.buffer(0); h.video.emit('waiting'); h.advance(2500);
  assert.equal(h.api.getState().targetHost, B, 'real recovery timer rotates from the cached target');
  h.video.readyState = 4; h.video.emit('playing');
  for (let i = 0; i < 12; i++) {
    const xhr = h.request(); h.buffer(20 + i); h.advance(1000, { frames: true }); xhr.complete(1000000);
  }
  const before = h.api.getDiagnostics();
  assert.equal(before.actualHost, B);
  assert.equal(before.media.frameHealth.state, 'healthy');
  const at = h.now(); h.close();
  const refreshed = harness({ store, at: at + 1000 });
  const signal = { failedHost: A, lastConfirmedHealthyHost: before.actualHost,
    successfulVideoRequests: before.events.filter(e => e.type === 'transfer' && e.outcome === 'complete' && e.kind === 'video').length,
    reloadedTarget: refreshed.api.getState().targetHost };
  refreshed.close();
  assert.notEqual(signal.reloadedTarget, A, 'recent repeated native video failures need a bounded memory across page refresh');
});

test('continued recovery excludes cached candidates whose probe delivered no bytes', () => {
  const hosts = require('../src/core/settings.js').candidatePool;
  const store = new Map([[RANK_KEY, JSON.stringify({ ranking: [A, B], at: START - 60000,
    samples: hosts.map(host => ({ host, ok: [A, B].includes(host), bytes: [A, B].includes(host) ? 786432 : 0,
      ttfb: [A, B].includes(host) ? 200 : null, mbps: [A, B].includes(host) ? 8 : 0,
      elapsedMs: 1000, status: [A, B].includes(host) ? 200 : 0, error: [A, B].includes(host) ? '' : 'network' })) })]]);
  const h = harness({ store });
  h.video.readyState = 2; h.buffer(0); h.video.emit('waiting'); h.advance(17500);
  const targets = h.api.getDiagnostics().events.filter(event => event.type === 'recovery-attempt').map(event => event.toHost);
  h.close();
  assert.ok(targets.length >= 3, 'the fixture reaches continued recovery after exhausting the successful probes');
  assert.ok(targets.every(host => [A, B].includes(host)), 'recovery must not resurrect known failed probe hosts');
});

test('recovery uses healthy ranking without assuming the configured target supplied the stalled request', () => {
  const C = 'upos-sz-mirrorhwb.bilivideo.com';
  const untriedStore = new Map([[RANK_KEY, JSON.stringify({ ranking: [A, B, C], samples: [], at: START - 60000 })]]);
  const untried = harness({ store: untriedStore, config: { mode: 'bad-only' } });
  const original = untried.request(media(B));
  assert.equal(new URL(original.url).hostname, B, 'the player still uses its original healthy-CDN URL');
  untried.video.readyState = 2; untried.buffer(0); untried.video.emit('waiting'); untried.advance(2500);
  const selected = untried.api.getState().targetHost;
  const redirected = untried.request(media(B));
  const attempt = untried.api.getDiagnostics().events.find(event => event.type === 'recovery-attempt');
  untried.close();
  assert.equal(selected, A, 'a configured target with no failed request must remain the best recovery choice');
  assert.equal(new URL(redirected.url).hostname, A, 'recovery must activate the existing target for the actual stalled host');
  assert.equal(attempt?.fromHost, B); assert.equal(attempt?.toHost, A);

  const store = new Map([[RANK_KEY, JSON.stringify({ ranking: [A, B, C], samples: [], at: START - 60000 })]]);
  const h = harness({ store, config: { mode: 'bad-only' } });
  h.advance(2000, { frames: true });
  for (let index = 0; index < 3; index++) {
    const xhr = h.request(media(C)); h.buffer(30); h.advance(5000, { frames: true }); xhr.complete(1048576);
  }
  assert.equal(h.kernel.getState().effectiveRanking[0], C, 'real stable delivery promotes a host above the current target');
  assert.equal(h.api.getState().targetHost, A);
  h.request(media(A)); h.video.readyState = 2; h.buffer(0); h.video.emit('waiting'); h.advance(2500);
  const target = h.api.getState().targetHost; h.close();
  assert.equal(target, C, 'a reordered ranking must be consulted from its best candidate instead of the current target index');
});
