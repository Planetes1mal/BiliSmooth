// Diagnostic feedback loop: real kernel + session + frame monitor, fake browser/time.
// Does not contact a CDN, decode video, or establish real-world throughput.
const test = require('node:test');
const assert = require('node:assert/strict');
const sharedEmitter = require('./support/emitter.cjs');
const loadKernel = require('./support/kernel-harness.cjs');
const emitter = value => sharedEmitter(value, { event: true, targetOnly: false });
const A = 'upos-sz-mirroraliov.bilivideo.com';
const B = 'upos-sz-mirrorcosov.bilivideo.com';
const START = 1788836240000;
const RANK_KEY = 'bilismooth.routing.rank.v4.America/New_York|en-US';
const media = host => `https://${host}/upgcxcode/1/video.m4s`;
function harness({ store = new Map(), at = START, initial = {}, config = {}, fps = '60', kernelOptions = {}, rvfc = false } = {}) {
  const h = loadKernel({ session: true, store, now: at, video: initial, kernelOptions, rvfc,
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'America/New_York' }) }) },
    config: { enabled: true, mode: 'force', selection: 'auto', stallRecovery: true, ...config },
    payload: { data: { dash: { video: [{ id: 120, baseUrl: media(A), backupUrl: [], width: 3840, height: 2160, frame_rate: fps }] } } } });
  const request = h.request;
  h.request = (raw = media(A)) => request(raw);
  return h;
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
  const xhr = h.request(); h.advance(10000, { move: false }); xhr.progress(1048576); xhr.expire(1048576);
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
  xhr.send(); h.advance(10000, { move: false }); xhr.progress(1048576); xhr.expire(1048576);
  const retries = h.kernel.getState().recoveries; h.close();
  assert.equal(delivered, 1, 'the native timeout event must reach the original player listener exactly once');
  assert.notEqual(new URL(retry.url).hostname, A, 'the target must change before native player timeout listeners issue the next request');
  assert.equal(retries, 1, 'timeout and loadend must not count the same failed request twice');
});

test('real video failures, silent cancellations and slow probes keep later video off the failing route', () => {
  const HW = 'upos-sz-mirrorhw.bilivideo.com', host = xhr => new URL(xhr.url).hostname, audio = `https://${A}/upgcxcode/1/audio.m4s`;
  const store = new Map([[RANK_KEY, JSON.stringify({ ranking: [HW, A, B], samples: [], at: START - 60000 })]]);
  const h = harness({ store, initial: preparing, config: { mode: 'bad-only' } });
  h.scope.__playinfo__ = { data: { dash: { video: [{ id: 120, baseUrl: media(A), backupUrl: [] }], audio: [{ id: 30280, baseUrl: audio, backupUrl: [] }] } } };
  h.video.emit('loadedmetadata'); h.video.emit('seeking');
  const first = h.request();
  h.advance(10000, { move: false }); first.progress(1048576); first.expire(1048576);
  const retry = h.request(), sound = h.request(audio);
  const avoided = h.api.getDiagnostics().events.find(event => event.type === 'route-avoided'), at = h.now(); h.close();
  assert.equal(host(first), A, 'a native route without failure evidence keeps its original host');
  assert.equal(host(retry), HW, 'the next video request leaves the native host that timed out');
  assert.equal(host(sound), A, 'video failures do not move working audio');
  assert.deepEqual([avoided?.fromHost, avoided?.toHost, avoided?.reason], [A, HW, 'request-failed']);
  const refreshed = harness({ store, at: at + 600000, initial: preparing, config: { mode: 'bad-only' } });
  const startup = refreshed.request(); refreshed.close();
  assert.equal(host(startup), HW, 'a refresh within the failure memory starts on the working target');
  store.set(RANK_KEY, JSON.stringify({ ranking: [A, HW, B], samples: [], at: START - 60000 }));
  const reranked = harness({ store, at: at + 600000, config: { mode: 'force' } }), target = reranked.api.getState().targetHost; reranked.close();
  assert.equal(target, HW, 'a probe winner with an unresolved real failure is not selected as the target');
  const playing = harness({ config: { mode: 'bad-only' }, store: new Map([[RANK_KEY, JSON.stringify({ ranking: [A, HW], samples: [], at: START - 60000 })]]) });
  playing.advance(3000, { frames: true });
  const failed = playing.request(); playing.advance(1000, { frames: true }); failed.progress(65536); failed.expire(65536);
  const replacement = playing.request(), replaced = playing.api.getState().targetHost; playing.close();
  assert.deepEqual([replaced, host(replacement)], [HW, HW], 'a playing target with a real failure is replaced before its buffer runs out');
  const silent = harness({ config: { mode: 'bad-only' }, store: new Map([[RANK_KEY, JSON.stringify({ ranking: [A, HW], samples: [], at: START - 60000 })]]) });
  silent.advance(3000, { frames: true });
  const seek = silent.request(); silent.advance(500, { frames: true }); seek.cancel();
  const kept = silent.api.getState().targetHost;
  const hung = silent.request(); silent.advance(2050, { frames: true }); hung.cancel();
  const after = silent.request(), switched = silent.api.getState().targetHost; silent.close();
  assert.equal(kept, A, 'a quick cancellation is not delivery evidence');
  assert.deepEqual([switched, host(after)], [HW, HW], 'a request the player abandons without a byte counts as a failed route');
  const slow = harness({ initial: preparing, config: { mode: 'bad-only' }, store: new Map([[RANK_KEY, JSON.stringify({ ranking: [HW, A], at: START - 60000,
    samples: [{ host: HW, ok: true, bytes: 786432, ttfb: 300, mbps: 20, elapsedMs: 320, status: 200 },
      { host: A, ok: true, timedOut: true, bytes: 195338, ttfb: 1999, mbps: 0.4, elapsedMs: 4001, status: 200 }] })]]) });
  const probed = slow.request(); slow.close();
  assert.equal(host(probed), HW, 'a probe that could not finish its sample marks the host too slow for video');
});

test('startup timeout respects playback and configuration boundaries', () => {
  for (const [name, options, act] of [
    ['explicit user pause', {}, h => h.video.emit('pause')],
    ['hidden document', {}, h => { h.document.hidden = true; h.document.emit('visibilitychange'); }],
    ['fixed selection', { config: { selection: 'fixed', pcdnHost: A } }, () => {}],
    ['disabled extension', { config: { enabled: false } }, () => {}],
    ['disabled stall recovery', { config: { stallRecovery: false } }, () => {}]
  ]) {
    const h = harness({ store: cachedStore(), initial: preparing, ...options });
    h.video.emit('loadedmetadata'); h.video.emit('seeking');
    const xhr = h.request(); act(h); h.advance(10000, { move: false }); xhr.expire(1048576);
    const after = h.api.getDiagnostics(); h.close();
    assert.equal(after.recoveryAttempts, 0, name);
    assert.equal(after.targetHost, A, name);
  }
});

test('high readyState recovery rejects ineligible playback evidence', () => {
  for (const [name, mutate] of [
    ['user pause', h => { h.video.paused = true; h.video.emit('pause'); }],
    ['active seek', h => { h.video.seeking = true; h.video.emit('seeking'); }],
    ['hidden document', h => { h.document.hidden = true; h.document.emit('visibilitychange'); }],
    ['fixed selection', h => h.api.setConfig({ selection: 'fixed' })],
    ['disabled extension', h => h.api.setConfig({ enabled: false })],
    ['old observation', h => h.stopObservations()]
  ]) {
    const h = harness({ store: cachedStore() });
    h.advance(2000, { frames: true }); h.buffer(0);
    if (name === 'old observation') { h.advance(2000); assert.equal(h.api.getState().media.frameHealth.state, 'frozen', name); }
    h.video.emit('waiting'); mutate(h); h.advance(2500);
    const attempts = h.kernel.getState().recoveries; h.close();
    assert.equal(attempts, 0, name);
  }
});

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
    h.advance(10000, { move: false }); xhr.expire(1048576);
    const attempts = h.kernel.getState().recoveries; h.close();
    assert.equal(attempts, 0, 'request observations are owned by the playback and network at send time');
  });
}

test('a request sent immediately after player replacement belongs to the new startup', () => {
  const h = harness({ store: cachedStore(), initial: preparing });
  h.advance(250, { move: false });
  h.replacePlayer(emitter({ ...h.video, isConnected: true }));
  const xhr = h.request();
  h.advance(10000, { move: false }); xhr.expire(1048576);
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
    const xhr = h.request(); h.advance(1000, { frames: true }); xhr.progress(65536); xhr.expire(65536);
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
