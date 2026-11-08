// Unit observations only: simulated player state is never claimed as real playback evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import emitter from '../support/emitter.cjs';
import { createSession } from '../../src/page/session.js';
import { installControlBridge } from '../../src/page/control-bridge.js';
const A = 'upos-sz-mirrorcosov.bilivideo.com', B = 'upos-sz-mirroraliov.bilivideo.com';
const raw = `https://${A}/upgcxcode/1/video.m4s?sign=TOP_SECRET`, audio = `https://${B}/upgcxcode/1/audio.m4s?token=SECRET_AUDIO`;
const payload = { data: { dash: { video: [{ id: 120, baseUrl: raw, backupUrl: [], width: 3840, height: 2160, frame_rate: '60' }], audio: [{ id: 1, baseUrl: audio }] } } };
function harness(options = {}) {
  let clock = 100000, serial = 0, emit, installedConfig, config, kernelOptions, calls = [], reloads = 0;
  const kernelState = { delivery: { status: 'native', nativeHost: A, activeHost: null, nextTestAt: 0, canTest: false, comparedHosts: [] } };
  const timers = new Map(), messages = [], store = new Map(Object.entries(options.storage || {}));
  const video = emitter({ paused: false, ended: false, seeking: false, currentTime: 1, readyState: 4, videoWidth: 3840, videoHeight: 2160,
    playbackRate: 2, buffered: { length: 1, start: () => 0, end: () => 30 }, getVideoPlaybackQuality: () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 }), ...options.video });
  const callbacks = new Map();
  if (options.rvfc) {
    video.requestVideoFrameCallback = fn => { callbacks.set(++serial, fn); return serial; };
    video.cancelVideoFrameCallback = id => callbacks.delete(id);
  }
  let players = options.noPlayer ? [] : [video];
  const document = emitter({ readyState: 'complete', hidden: false, querySelectorAll: () => players });
  class LocalDate extends Date { static now() { return clock; } }
  const scope = emitter({ URL, JSON: { parse: JSON.parse, stringify: JSON.stringify }, console, Date: LocalDate,
    performance: { now: () => clock }, document, navigator: { connection: options.noConnection ? undefined : emitter({ ...options.connection }) },
    localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    location: { origin: 'https://www.bilibili.com', href: 'https://www.bilibili.com/video/BVunit', reload: () => reloads++ },
    postMessage: message => messages.push(JSON.parse(JSON.stringify(message))),
    setInterval: fn => { timers.set(++serial, { fn, interval: true }); return serial; }, clearInterval: id => timers.delete(id),
    setTimeout: (fn, delay) => { timers.set(++serial, { fn, at: clock + delay }); return serial; }, clearTimeout: id => timers.delete(id) });
  // A fake kernel: the session's only decision maker is replaced by a recorder of calls.
  const createKernel = input => { kernelOptions = input; emit = input.onEvent; config = input.config; installedConfig = { ...config }; emit({ type: 'config', config });
    return { setConfig(next) { calls.push('config'); config = next; emit({ type: 'config', config }); }, getState: () => kernelState,
      getFlags: () => ({ needReload: !!kernelState.needReload, delivery: kernelState.delivery }),
      resetNetwork() { calls.push('reset'); }, retry() { calls.push('retry'); return true; }, rewriteUrl: value => value }; };
  const api = createSession({ scope, version: '2.8.3', createKernel });
  installControlBridge({ scope, runtime: api });
  const message = data => scope.emit('message', { source: scope, origin: scope.location.origin, data });
  return { scope, api, emit, calls, messages, store, video, document, installedConfig, kernelState, kernelOptions,
    setPlayers(next) { players = next; },
    presentFrame(ms, metadata, callbackAt = null) { clock += ms; video.currentTime = metadata.mediaTime; const pending = [...callbacks.values()]; callbacks.clear(); for (const fn of pending) fn(callbackAt ?? clock, metadata); },
    message, advance(ms) { clock += ms; for (const [id, timer] of [...timers]) { if (timer.interval) timer.fn(); else if (timer.at <= clock) { timers.delete(id); timer.fn(); } } }, reloads: () => reloads };
}

test('compact snapshot reads cached observations and delivery flags without constructing session records', () => {
  const h = harness();
  h.document.querySelectorAll = () => { throw Error('compact view must not scan DOM'); };
  Object.defineProperty(h.kernelState, 'session', { get() { throw Error('compact view must not copy session records'); } });
  const view = h.api.getViewState();
  assert.equal(view.media.present, true); assert.equal(view.bufferWallSeconds, 14.5);
  assert.equal(view.observedAt, 100000); assert.equal(view.events, undefined); assert.equal(view.session, undefined);
  view.config.candidatePool.length = 0; view.media.frameHealth.state = 'modified';
  assert.equal(h.api.getConfig().candidatePool.length, 9); assert.notEqual(h.api.getViewState().media.frameHealth.state, 'modified');
  h.kernelState.needReload = true; h.kernelState.delivery.status = 'testing';
  assert.equal(h.api.getViewState().needReload, true); assert.equal(h.api.getViewState().delivery.status, 'testing');
});

test('site gates block manual recovery while preserving shared settings and automatic network resets', () => {
  for (const reason of ['region', 'unavailable', 'payment']) {
    const h = harness({ noPlayer: true, connection: { type: 'wifi' } });
    const block = { textContent: '非常抱歉，根据版权方要求 您所在的地区无法观看本片',
      getBoundingClientRect: () => ({ width: 810, height: 502 }) };
    h.document.getElementById = id => reason === 'region' && id === 'big-block-panel' ? block : null;
    h.scope.__INITIAL_STATE__ = reason === 'unavailable' ? { error: { code: 404, trueCode: -404, message: '啥都木有' } }
      : reason === 'payment' ? { videoData: { is_upower_exclusive: true, is_upower_play: false, is_upower_preview: false } } : {};
    h.advance(1000);
    assert.equal(h.api.getViewState().availability?.reason, reason);
    assert.equal(h.api.getState().media.playback, 'error');
    assert.equal(h.api.applyRoute(B), true, 'route selection saves a shared preference even when this source is gated');
    assert.equal(h.api.getConfig().pcdnHost, B);
    assert.equal(h.api.retry(), false);
    assert.equal(h.api.resetNetwork(), false);
    assert.deepEqual(h.calls, ['config'], 'manual playback actions stay blocked without preventing settings saves');
    h.scope.emit('online');
    h.scope.navigator.connection.type = 'cellular'; h.scope.navigator.connection.emit('change');
    assert.deepEqual(h.calls, ['config', 'reset', 'reset'], 'real network changes still invalidate old network evidence');
    h.document.getElementById = () => null; h.scope.__INITIAL_STATE__ = {};
    h.advance(1000);
    assert.equal(h.api.getViewState().availability, null, 'the site gate must clear when it disappears');
  }
});

test('acknowledged preferences no longer mask a later authoritative update', async () => {
  const h = harness(); h.message({ __bilismoothConfig: 'config', config: {} });
  h.api.setConfig({ floatingEntryType: 'buffer' });
  const save = h.messages.filter(row => row.__bilismoothConfig === 'save').at(-1);
  h.message({ __bilismoothConfig: 'saved', id: save.id, ok: true }); await h.api.flushSettings();
  h.message({ __bilismoothConfig: 'config', config: { floatingEntryType: 'speed' } });
  assert.equal(h.api.getConfig().floatingEntryType, 'speed');
  assert.equal(h.api.getState().needReload, false);
});

test('current-video metadata clears immediately on route change and waits for the matching page title', () => {
  const h = harness();
  h.document.title = '第一段_哔哩哔哩_bilibili';
  h.document.querySelector = () => ({ content: 'https://i0.hdslb.com/bfs/archive/first.jpg?tracking=private' });
  h.video.duration = 180; h.advance(1000);
  assert.equal(h.api.getViewState().videoMeta.title, '第一段');
  assert.equal(h.api.getViewState().media.duration, 180);
  assert.equal(h.api.getViewState().videoMeta.coverUrl, 'https://i0.hdslb.com/bfs/archive/first.jpg');
  h.scope.location.href = 'https://www.bilibili.com/video/BVnext/?tracking=private'; h.advance(1000);
  assert.equal(h.api.getViewState().videoMeta.title, ''); h.advance(1000); assert.equal(h.api.getViewState().videoMeta.coverUrl, '');
  h.document.title = '下一段_哔哩哔哩_bilibili'; h.advance(1000);
  assert.equal(h.api.getViewState().videoMeta.title, '下一段'); assert.equal(h.api.getViewState().videoMeta.coverUrl, '');
  h.document.querySelector = () => ({ content: 'https://i0.hdslb.com/bfs/archive/next.jpg' }); h.advance(1000);
  assert.equal(h.api.getViewState().videoMeta.title, '下一段'); assert.equal(h.api.getViewState().videoMeta.url, 'https://www.bilibili.com/video/BVnext/');
  assert.equal(h.api.getViewState().videoMeta.coverUrl, 'https://i0.hdslb.com/bfs/archive/next.jpg');
  for (const list of ['watchlater', 'ml123']) {
    h.scope.location.href = `https://www.bilibili.com/list/${list}?bvid=BV${list}&oid=123&tracking=private`;
    h.document.title = `${list}_哔哩哔哩_bilibili`; h.advance(1000);
    assert.equal(h.api.getViewState().videoMeta.url, `https://www.bilibili.com/video/BV${list}/`);
    assert.equal(h.api.getViewState().videoMeta.title, list);
  }
});
test('synchronous namespace config reaches kernel before storage handshake and does not overwrite storage on install', () => {
  const h = harness({ storage: { 'bilismooth.startup.v4': JSON.stringify({ enabled: false, pcdnHost: B, mcdnStrategy: 'replace', p2pGuard: true }) } });
  assert.equal(h.installedConfig.enabled, false); assert.equal(h.installedConfig.pcdnHost, B);
  assert.equal(h.installedConfig.mcdnStrategy, 'replace'); assert.equal(h.installedConfig.p2pGuard, true);
  assert.equal(h.messages.filter(row => row.__bilismoothConfig === 'save').length, 0);
  h.message({ __bilismoothConfig: 'config', config: { enabled: true, pcdnHost: A } });
  assert.equal(h.api.getState().startupReady, true); assert.equal(h.api.getConfig().enabled, true);
  assert.equal(h.messages.filter(row => row.__bilismoothConfig === 'save').length, 0);
});
test('late authoritative changes flag delivered manifests for refresh and preserve early user edits', () => {
  const h = harness(); h.emit({ type: 'payload', original: payload, prepared: payload, source: 'initial-global' });
  h.api.setConfig({ theme: 'dark', mcdnStrategy: 'proxy-v1' });
  h.message({ __bilismoothConfig: 'config', config: { enabled: false, theme: 'light', mcdnStrategy: 'replace' } });
  const state = h.api.getState();
  assert.equal(state.config.enabled, false); assert.equal(state.config.theme, 'dark'); assert.equal(state.config.mcdnStrategy, 'proxy-v1');
  assert.ok(state.reloadReasons.includes('startup-config'));
});
test('fixed route preserves mode and exposes a storage acknowledgement', async () => {
  const h = harness({ noPlayer: true }); h.message({ __bilismoothConfig: 'config', config: {} });
  assert.equal(h.api.applyRoute(B), true); assert.equal(h.api.getConfig().selection, 'fixed'); assert.equal(h.api.getConfig().mode, 'bad-only');
  assert.equal(h.api.applyRoute('attacker.example'), false);
  const message = h.messages.filter(row => row.id).at(-1);
  h.message({ __bilismoothConfig: 'saved', id: 'unrelated', ok: true }); assert.equal(h.reloads(), 0);
  assert.equal(h.api.getState().settingsSave.status, 'pending');
  h.message({ __bilismoothConfig: 'saved', id: message.id, ok: true });
  await h.api.flushSettings(); assert.equal(h.api.getState().settingsSave.status, 'saved');
  assert.equal(h.reloads(), 0, 'the control bridge owns reload after responding to the caller');
});
test('request target, actual video bytes and playback recovery remain separate; race/audio traffic never becomes video speed', () => {
  const h = harness(); h.emit({ type: 'payload', original: payload, prepared: payload, source: 'global' });
  h.emit({ type: 'request', id: 'v', originalUrl: raw, url: raw, host: A, transport: 'fetch', startedAt: 100000 });
  assert.equal(h.api.getState().requestedHost, A); assert.equal(h.api.getState().actualHost, null);
  h.emit({ type: 'transfer', id: 'v', status: 200, outcome: 'response' });
  assert.equal(h.api.getDiagnostics().requests.length, 1); assert.equal(h.api.getState().lastMbps, null);
  h.emit({ type: 'race', reason: 'finished', host: A, bytes: 786432 });
  h.emit({ type: 'request', id: 'a', originalUrl: audio, url: audio, host: B, transport: 'xhr', startedAt: 100000 });
  h.advance(1000); h.emit({ type: 'progress', id: 'a', status: 206, bytes: 10000, responseUrl: audio });
  assert.equal(h.api.getState().lastMbps, null); assert.equal(h.api.getState().audioHost, B);
  h.emit({ type: 'transfer', id: 'v', status: 206, bytes: 1000000, responseUrl: raw, outcome: 'unverified' });
  const state = h.api.getState(); assert.equal(state.actualHost, A); assert.equal(state.lastMbps, 8); assert.equal(state.counters.recoveries, 0);
  assert.doesNotMatch(JSON.stringify(h.api.getDiagnostics()), /TOP_SECRET|SECRET_AUDIO|\?sign|\?token/);
  h.advance(3000); assert.equal(h.api.getState().lastMbps, 0, 'a continuously observed quiet window has no video bytes');
});
test('network reset preserves in-flight request lifetime but old network bytes cannot populate new speeds', () => {
  const h = harness(); h.emit({ type: 'payload', original: payload, prepared: payload });
  h.emit({ type: 'request', id: 'v', originalUrl: raw, url: raw, host: A, transport: 'xhr', startedAt: 100000 });
  h.api.resetNetwork(); assert.equal(h.api.getDiagnostics().requests.length, 1);
  h.advance(1000); h.emit({ type: 'progress', id: 'v', status: 206, bytes: 1000000, responseUrl: raw });
  assert.equal(h.api.getState().lastMbps, null); assert.equal(h.api.getState().counters.videoBytes, 0);
  h.emit({ type: 'transfer', id: 'v', bytes: 1000000, status: 206, outcome: 'complete' });
  assert.equal(h.api.getDiagnostics().requests.length, 0); assert.deepEqual(h.calls, ['reset']);
});

test('completed video bursts decay over the observed wall-clock window instead of holding a flat rate and becoming gaps', () => {
  const h = harness(); h.emit({ type: 'payload', original: payload, prepared: payload });
  h.emit({ type: 'request', id: 'burst', originalUrl: raw, url: raw, host: A, transport: 'xhr', startedAt: 100000 });
  h.advance(1000); h.emit({ type: 'transfer', id: 'burst', status: 206, bytes: 1000000, responseUrl: raw, outcome: 'complete' });
  assert.equal(h.api.getViewState().lastMbps, 8);
  h.advance(1000);
  const tail = h.api.getViewState();
  assert.ok(tail.lastMbps > 0 && tail.lastMbps < 8, 'one idle second must lower observed rolling throughput instead of replaying the completed burst rate');
  h.advance(1000); h.advance(1000);
  const idle = h.api.getViewState();
  assert.equal(idle.lastMbps, 0, 'an observed interval without transferred bytes is zero, not an unknown sample');
  assert.equal(idle.speedObservedAt, 104000, 'idle throughput has a fresh observation timestamp independent of the last byte');
  const samples = h.api.getState().speedSamples.filter(row => row.at >= 102000);
  assert.ok(samples.every(row => Number.isFinite(row.mbps)), 'known idle intervals must not split chart bursts into separate filled blocks');
});

test('speed observation gaps and changed media never inherit the previous burst', () => {
  const h = harness(); h.emit({ type: 'payload', original: payload, prepared: payload });
  h.emit({ type: 'request', id: 'burst', originalUrl: raw, url: raw, host: A, transport: 'xhr', startedAt: 100000 });
  h.advance(1000); h.emit({ type: 'transfer', id: 'burst', status: 206, bytes: 1000000, responseUrl: raw, outcome: 'complete' });
  h.video.emit('emptied');
  assert.equal(h.api.getViewState().lastMbps, null, 'new media must not show the old request throughput');
  h.advance(5000);
  assert.equal(h.api.getViewState().lastMbps, null, 'a long unobserved interval stays unknown');
  assert.equal(h.api.getViewState().speedObservedAt, null);
});

test('background delivery remains observable but long timer gaps stay unknown until fresh network evidence', () => {
  const h = harness(); h.emit({ type: 'payload', original: payload, prepared: payload });
  h.document.hidden = true; h.document.emit('visibilitychange');
  h.emit({ type: 'request', id: 'background', originalUrl: raw, url: raw, host: A, transport: 'xhr', startedAt: 100000 });
  h.advance(1000); h.emit({ type: 'progress', id: 'background', status: 206, bytes: 1000000, responseUrl: raw });
  assert.equal(h.api.getViewState().lastMbps, 8, 'opening the dashboard must not hide still-observed background video bytes');
  h.advance(1000); assert.equal(h.api.getViewState().lastMbps, 4);
  h.advance(5000); assert.equal(h.api.getViewState().lastMbps, null); assert.equal(h.api.getViewState().speedObservedAt, null);
  h.advance(1000); assert.equal(h.api.getViewState().lastMbps, null, 'silence after a real observation gap is not evidence of zero');
  h.emit({ type: 'request', id: 'fresh', originalUrl: raw, url: raw, host: A, transport: 'xhr', startedAt: 108000 });
  h.advance(1000); h.emit({ type: 'transfer', id: 'fresh', status: 206, bytes: 500000, responseUrl: raw, outcome: 'complete' });
  assert.equal(h.api.getViewState().lastMbps, 4);
  assert.ok(h.api.getState().speedSamples.some(row => row.at === 107000 && row.mbps === null));
});

test('parallel video byte windows share wall time without dropping throughput or counting audio', () => {
  const h = harness(); h.emit({ type: 'payload', original: payload, prepared: payload });
  for (const id of ['one','two']) h.emit({ type: 'request', id, originalUrl: raw, url: raw, host: A, transport: 'xhr', startedAt: 100000 });
  h.advance(1000);
  for (const id of ['one','two']) h.emit({ type: 'transfer', id, status: 206, bytes: 1000000, responseUrl: raw, outcome: 'complete' });
  assert.equal(h.api.getViewState().lastMbps, 16);
  h.advance(1000); assert.equal(h.api.getViewState().lastMbps, 8);
  h.scope.emit('offline'); assert.equal(h.api.getViewState().lastMbps, null); assert.equal(h.api.getViewState().speedObservedAt, null);
});

test('out-of-order parallel completions include the earlier observed request interval', () => {
  const h = harness(); h.emit({ type: 'payload', original: payload, prepared: payload });
  h.emit({ type: 'request', id: 'earlier', originalUrl: raw, url: raw, host: A, transport: 'xhr', startedAt: 100000 });
  h.advance(500);
  h.emit({ type: 'request', id: 'later', originalUrl: raw, url: raw, host: A, transport: 'xhr', startedAt: 100500 });
  h.advance(500);
  h.emit({ type: 'transfer', id: 'later', status: 206, bytes: 500000, responseUrl: raw, outcome: 'complete' });
  h.emit({ type: 'transfer', id: 'earlier', status: 206, bytes: 1000000, responseUrl: raw, outcome: 'complete' });
  assert.equal(h.api.getViewState().lastMbps, 12, '1.5MB over one shared observed second');
});

test('connection estimates alone do not reset network records', () => {
  const h = harness({ connection: { type: 'wifi', effectiveType: '4g', rtt: 50, downlink: 10, saveData: false } });
  const connection = h.scope.navigator.connection;
  for (const patch of [{ rtt: 100 }, { downlink: 3 }, { effectiveType: '3g' }, { saveData: true }, {}, {}]) {
    Object.assign(connection, patch); connection.emit('change');
  }
  assert.deepEqual(h.calls, [], 'quality estimates must not invoke the kernel reset that restarts probing');
  assert.equal(h.api.getState().networkEpoch, 0);
  assert.equal(h.api.getDiagnostics().events.filter(row => row.type === 'network-reset').length, 0);
});

test('connection changes reset once for a known transport transition while manual and online resets remain available', () => {
  const h = harness({ connection: { type: 'wifi' } }), connection = h.scope.navigator.connection;
  connection.type = 'cellular'; connection.emit('change'); connection.emit('change');
  assert.deepEqual(h.calls, ['reset']); assert.equal(h.api.getState().networkEpoch, 1);
  assert.equal(h.api.getDiagnostics().events.at(-1).reason, 'connection-change');
  h.api.resetNetwork(); h.scope.emit('online');
  assert.deepEqual(h.calls, ['reset', 'reset', 'reset']); assert.equal(h.api.getState().networkEpoch, 3);
});

test('connection without a reliable transport type does not invent topology changes', () => {
  for (const type of [undefined, 'unknown', 'other', 'none', 'mixed']) {
    const h = harness({ connection: { type, effectiveType: '4g' } }), connection = h.scope.navigator.connection;
    connection.effectiveType = '3g'; connection.emit('change');
    connection.type = 'wifi'; connection.emit('change'); connection.emit('change');
    connection.type = 'unknown'; connection.emit('change');
    connection.type = 'cellular'; connection.emit('change');
    assert.deepEqual(h.calls, [], 'an unknown observation clears the baseline instead of inferring a switch');
  }
  const absent = harness({ noConnection: true });
  absent.scope.emit('online'); absent.api.resetNetwork();
  assert.deepEqual(absent.calls, ['reset', 'reset']);
});
test('missing response URLs and unknown status cannot turn the document host into the actual media route', () => {
  const h = harness(); h.emit({ type: 'payload', original: payload, prepared: payload });
  h.emit({ type: 'request', id: 'v', originalUrl: raw, url: raw, host: A, transport: 'xhr', startedAt: 100000 });
  h.advance(1000); h.emit({ type: 'progress', id: 'v', status: 0, bytes: 100000, responseUrl: '' });
  assert.equal(h.api.getState().actualHost, null); assert.equal(h.api.getState().lastMbps, null);
  h.advance(1000); h.emit({ type: 'progress', id: 'v', status: 206, bytes: 200000, responseUrl: '' });
  assert.equal(h.api.getState().actualHost, null); assert.equal(h.api.getState().requestedHost, A);
});
test('passive stall observations never ask the kernel to dispatch or terminate requests', () => {
  const h = harness(); h.video.readyState = 2; h.video.emit('waiting'); h.advance(10000);
  assert.equal(h.api.getState().counters.stalls, 1); assert.deepEqual(h.calls, []);
  h.document.hidden = true; h.document.emit('visibilitychange');
  assert.equal(h.api.getState().counters.recoveries, 0); assert.deepEqual(h.calls, []);
});
test('absence of an initial compositor baseline remains unknown and is not a frozen-picture claim', () => {
  const h = harness(); h.advance(3000);
  assert.equal(h.api.getState().media.playback, 'playing');
  assert.equal(h.api.getState().media.frameHealth.state, 'unknown');
  assert.equal(h.api.getState().counters.frameStalls, 0);
});
test('control whitelist carries settings only after successful persistence', async () => {
  const h = harness(); h.message({ __biliSmooth: 'request', id: 'advanced', action: 'config', patch: { mcdnStrategy: 'replace', p2pGuard: true, portHeuristic: false, rewriteAkamai: true, lang: 'en', accent: 'teal' } });
  assert.equal(h.messages.some(row => row.id === 'advanced'), false);
  const save = h.messages.find(row => row.__bilismoothConfig === 'save');
  h.message({ __bilismoothConfig: 'saved', id: save.id, ok: true });
  await h.api.flushSettings(); await Promise.resolve();
  const response = h.messages.find(row => row.id === 'advanced'); assert.equal(response.ok, true);
  assert.equal(response.result.config.mcdnStrategy, 'replace'); assert.equal(response.result.config.accent, 'teal');
  assert.equal(response.result.needReload, true);
});

test('ordinary saves have unique acknowledgements, preserve patches and flush the latest failure', async () => {
  const h = harness(); h.message({ __bilismoothConfig: 'config', config: {} });
  h.api.setConfig({ theme: 'dark' });
  const first = h.messages.filter(row => row.__bilismoothConfig === 'save').at(-1);
  let settled = false;
  const pending = h.api.flushSettings().finally(() => { settled = true; });
  h.api.setConfig({ mode: 'force' });
  const second = h.messages.filter(row => row.__bilismoothConfig === 'save').at(-1);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first.patch, { theme: 'dark' });
  assert.deepEqual(second.patch, { theme: 'dark', mode: 'force' });
  h.message({ __bilismoothConfig: 'config', config: { theme: 'light', lang: 'en' } });
  assert.equal(h.api.getConfig().theme, 'dark'); assert.equal(h.api.getConfig().lang, 'en');
  h.message({ __bilismoothConfig: 'saved', id: first.id, ok: true });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false); assert.equal(h.api.getState().settingsSave.status, 'pending');
  const rejected = assert.rejects(pending, /storage-write-failed/);
  h.message({ __bilismoothConfig: 'saved', id: second.id, ok: false }); await rejected;
  assert.equal(h.api.getState().settingsSave.status, 'error'); assert.equal(h.reloads(), 0);
  assert.ok(h.api.getDiagnostics().events.some(event => event.type === 'settings-save-failed'));
});

test('missing storage acknowledgement times out, ignores late ack and can retry without losing edits', async () => {
  const h = harness(); h.api.setConfig({ theme: 'dark' });
  const original = h.messages.filter(row => row.__bilismoothConfig === 'save').at(-1);
  const rejected = assert.rejects(h.api.flushSettings(), /storage-ack-timeout/);
  h.advance(5000); await rejected;
  assert.equal(h.api.getState().settingsSave.error, 'storage-ack-timeout');
  h.message({ __bilismoothConfig: 'saved', id: original.id, ok: true });
  assert.equal(h.api.getState().settingsSave.status, 'error');
  h.api.reload();
  const retry = h.messages.filter(row => row.__bilismoothConfig === 'save').at(-1);
  assert.notEqual(retry.id, original.id); assert.equal(retry.patch.theme, 'dark');
  h.message({ __bilismoothConfig: 'saved', id: retry.id, ok: true }); await h.api.flushSettings();
  assert.equal(h.api.getState().settingsSave.status, 'saved');
  assert.equal(h.api.getState().reloadReasons.includes('storage-write-failed'), false);
  assert.equal(h.reloads(), 0);
});

function movingFrames(h) {
  let count = 0;
  h.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: count, droppedVideoFrames: 0 });
  return (ms = 1000) => { count += Math.round(ms * 0.12); h.video.currentTime += ms / 500; h.advance(ms); };
}

test('healthy frames and clock clear a stale stalled hint without asking the kernel to change route', () => {
  const h = harness(), step = movingFrames(h);
  step(); step(); assert.equal(h.api.getState().media.frameHealth.state, 'healthy');
  h.video.emit('stalled');
  for (let i = 0; i < 7; i++) step();
  assert.equal(h.api.getState().media.playback, 'playing');
  assert.equal(h.api.getState().counters.stalls, 0);
  assert.ok(h.api.getDiagnostics().events.some(row => row.type === 'waiting-cleared'));
  assert.deepEqual(h.calls, []);
});

test('existing stall survives a seek and recovers only after fresh healthy frames; seek time is separate', () => {
  const h = harness(), step = movingFrames(h);
  step(); step();
  h.video.readyState = 2; h.video.emit('waiting');
  h.advance(1000); h.advance(1000);
  h.video.seeking = true; h.video.emit('seeking');
  h.advance(1000); h.advance(1000); h.advance(1000);
  assert.equal(h.api.getDiagnostics().activeEpisode.seekTransitions, 1);
  assert.equal(h.api.getDiagnostics().episodes.length, 0);
  h.video.seeking = false; h.video.readyState = 4; h.video.emit('seeked'); h.video.emit('playing');
  assert.equal(h.api.getState().counters.recoveries, 0);
  for (let i = 0; i < 6; i++) step();
  const report = h.api.getDiagnostics(), episode = report.episodes[0];
  assert.equal(report.counters.stalls, 1); assert.equal(report.counters.recoveries, 1); assert.equal(episode.outcome, 'recovered');
  assert.equal(episode.seekTransitions, 1); assert.equal(episode.seekingMs, 3000);
  assert.equal(episode.observedStallMs, 2000); assert.equal(report.counters.totalStallMs, 2000);
  assert.ok(episode.durationMs > episode.observedStallMs + episode.seekingMs);
  assert.ok(report.events.some(row => row.type === 'player-event' && row.source === 'seeking'));
  assert.deepEqual(h.calls, []);
});

test('a seek without a previous stall does not create a stall during seek grace', () => {
  const h = harness(); h.video.readyState = 2; h.video.seeking = true; h.video.emit('seeking'); h.advance(1000);
  h.video.seeking = false; h.video.emit('seeked'); h.advance(500);
  assert.equal(h.api.getState().counters.stalls, 0);
  h.video.readyState = 4; h.video.emit('playing'); h.advance(1000);
  assert.equal(h.api.getState().counters.stalls, 0);
});

test('failed transfers preserve request correlation and target without inventing a response host', () => {
  const h = harness(); h.emit({ type: 'payload', original: payload, prepared: payload });
  h.emit({ type: 'request', id: 'media-42', at: 100000, originalUrl: raw, url: raw, host: A, transport: 'xhr', startedAt: 100000 });
  h.emit({ type: 'request', id: 'media-43', originalUrl: 'https://data.bilibili.com/log', url: 'https://data.bilibili.com/log', host: 'data.bilibili.com' });
  assert.equal(h.api.getState().requestedHost, A);
  h.advance(1000); h.emit({ type: 'transfer', id: 'media-42', at: 100900, status: 0, responseUrl: '', bytes: 1000, elapsedMs: 900, outcome: 'timeout' });
  const row = h.api.getDiagnostics().events.find(row => row.type === 'transfer');
  assert.equal(row.id, 'media-42'); assert.equal(row.at, 100900); assert.equal(row.requestedHost, A);
  assert.equal(row.host, undefined); assert.equal(row.responseHost, undefined); assert.equal(h.api.getState().actualHost, null);
});

test('critical timeline survives segment traffic eviction and exports bounded retention and observations', () => {
  const h = harness(); h.video.readyState = 2; h.video.emit('waiting');
  h.emit({ type: 'race', reason: 'finished', at: 100000, host: A, bytes: 786432, url: raw });
  for (let i = 0; i < 300; i++) h.emit({ type: 'request', id: 'reference-' + i, originalUrl: raw, url: raw, host: A });
  assert.equal(h.api.getState().events.length, 200);
  let report = h.api.getDiagnostics();
  assert.ok(report.events.some(row => row.type === 'stall'));
  const race = report.events.find(row => row.type === 'race');
  assert.equal(race.reason, 'finished'); assert.equal(race.host, A); assert.equal(race.bytes, 786432);
  assert.ok(report.retention.droppedEvents >= 100);
  for (let i = 0; i < 810; i++) { h.emit({ type: 'player-event', source: 'waiting' }); h.advance(1000); }
  report = h.api.getDiagnostics();
  assert.ok(report.events.length <= 1000); assert.equal(report.observations.length, 600);
  assert.ok(report.retention.droppedCriticalEvents > 0); assert.equal(report.retention.droppedObservations, 210);
  assert.equal(report.observations.at(-1).rate, 2); assert.equal(report.observations.at(-1).hidden, false);
  assert.doesNotMatch(JSON.stringify(report), /TOP_SECRET|SECRET_AUDIO|https?:|\?sign/);
});

test('long gaps in observation are reported separately instead of counted as certain stall time', () => {
  const h = harness(); h.video.readyState = 2; h.video.emit('waiting'); h.advance(10000);
  h.video.paused = true; h.video.emit('pause');
  const report = h.api.getDiagnostics();
  assert.equal(report.counters.totalStallMs, 0); assert.equal(report.episodes[0].unobservedMs, 10000);
});

test('normal fetch ResourceTiming completions cannot evict critical events, and active observed stall time is included', () => {
  const h = harness(); h.emit({ type: 'payload', original: payload, prepared: payload });
  h.video.readyState = 2; h.video.emit('waiting');
  for (let i = 0; i < 5; i++) h.advance(1000);
  assert.equal(h.api.getState().counters.totalStallMs, 5000);
  for (let i = 0; i < 805; i++) {
    const id = 'reference-' + i;
    h.emit({ type: 'request', id, originalUrl: raw, url: raw, host: A, transport: 'fetch' });
    h.emit({ type: 'transfer', id, status: 206, responseUrl: raw, bytes: 1000, outcome: 'unverified' });
  }
  const report = h.api.getDiagnostics();
  assert.ok(report.events.some(row => row.type === 'stall'));
  assert.equal(report.retention.droppedCriticalEvents, 0);
  h.video.paused = true; h.video.emit('pause');
  assert.equal(h.api.getState().counters.totalStallMs, 5000);
});

test('startup preserves first milestones across repeated playinfo and distinguishes preparation from native paused state', () => {
  const h = harness({ video: { paused: true, currentTime: 0, readyState: 0 } });
  h.emit({ type: 'payload', original: payload, prepared: payload, source: raw });
  h.advance(100);
  h.emit({ type: 'payload', original: payload, prepared: payload, source: 'JSON.parse' });
  h.emit({ type: 'request', id: 'v', originalUrl: raw, url: raw, host: A, transport: 'xhr', startedAt: 100100 });
  h.advance(100);
  h.emit({ type: 'progress', id: 'v', status: 0, bytes: 100, responseUrl: raw });
  assert.equal(h.api.getState().startup.firstValidByteAt, null);
  h.emit({ type: 'progress', id: 'v', status: 206, bytes: 200, responseUrl: raw });
  h.video.readyState = 1; h.video.emit('loadedmetadata');
  let s = h.api.getState();
  assert.equal(s.startup.firstPlayinfoAt, 100000); assert.equal(s.startup.firstMediaRequestAt, 100100);
  assert.equal(s.startup.firstValidByteAt, 100200); assert.equal(s.startup.loadedMetadataAt, 100200);
  assert.equal(s.startup.phase, 'preparing'); assert.equal(s.startup.pauseEvidence, 'none');
  assert.equal(h.kernelOptions.getPlaybackEvidence().startupPending, true);
  h.video.seeking = true; h.video.emit('seeking');
  s = h.api.getState(); assert.equal(s.startup.phase, 'startup-seeking'); assert.equal(s.startup.seekIntent, 'unknown');
  assert.equal(s.media.playback, 'buffering', 'resuming a saved position before the first frame is shown as waiting for media');
  assert.equal(h.kernelOptions.getPlaybackEvidence().startupPending, true);
  h.video.emit('pause');
  assert.equal(h.api.getState().startup.phase, 'paused'); assert.equal(h.api.getState().startup.pauseEvidence, 'pause-event');
  assert.equal(h.kernelOptions.getPlaybackEvidence().startupPending, false);
  h.video.seeking = false; h.video.paused = false; h.video.emit('play');
  assert.equal(h.api.getState().startup.pauseEvidence, 'none');
  assert.equal(h.kernelOptions.getPlaybackEvidence().startupPending, true);
  assert.doesNotMatch(JSON.stringify(h.api.getDiagnostics()), /TOP_SECRET|SECRET_AUDIO|BVunit|https?:|\?sign/);
  assert.deepEqual(h.calls, []);
});

test('playing and decoded quality never invent a first compositor frame or leave startup recovery pending forever', () => {
  const h = harness(); h.emit({ type: 'payload', original: payload, prepared: payload });
  h.emit({ type: 'request', id: 'v', originalUrl: raw, url: raw, host: A });
  h.video.emit('loadeddata'); h.video.emit('playing');
  const step = movingFrames(h); for (let i = 0; i < 6; i++) step();
  const s = h.api.getState();
  assert.equal(s.startup.firstPresentedFrameAt, null); assert.equal(s.startup.firstFrameEvidence, 'unsupported');
  assert.equal(s.startup.playingAt, 100000); assert.equal(s.startup.playinfoToFirstFrameMs, null);
  assert.equal(h.kernelOptions.getPlaybackEvidence().startupPending, false);
  assert.equal(s.bufferWallSeconds, s.buffer / 2);
  assert.equal(h.api.getDiagnostics().observations.at(-1).bufferWallSeconds, s.bufferWallSeconds);
});

test('startup first frame is an actual rVFC and stable frames require a fresh continuous confirmation window', () => {
  const h = harness({ rvfc: true, video: { currentTime: 0, playbackRate: 1 } });
  h.emit({ type: 'payload', original: payload, prepared: payload });
  h.video.emit('playing');
  assert.equal(h.api.getState().startup.firstPresentedFrameAt, null);
  h.presentFrame(50, { presentedFrames: 1, mediaTime: 0.05 });
  assert.equal(h.api.getState().startup.firstPresentedFrameAt, 100050);
  h.presentFrame(50, { presentedFrames: 4, mediaTime: 0.1 }); h.api.getState();
  h.presentFrame(50, { presentedFrames: 7, mediaTime: 0.15 }); h.api.getState();
  assert.equal(h.api.getState().startup.stableFramesAt, null);
  h.advance(3000);
  assert.equal(h.api.getState().startup.stableFramesAt, null);
  for (let i = 1; i <= 10; i++) { h.presentFrame(400, { presentedFrames: 7 + i * 24, mediaTime: 3.15 + i * 0.4 }); h.api.getState(); }
  const s = h.api.getState();
  assert.equal(s.startup.firstFrameEvidence, 'rvfc'); assert.ok(s.startup.stableFramesAt >= 105150);
  assert.equal(s.startup.stableFrameEvidence, 'rvfc'); assert.equal(s.startup.playinfoToFirstFrameMs, 50);
  assert.deepEqual(h.calls, []);
});

test('startup generation resets on replacement and emptied while pre-bind requests and bounded summaries survive', () => {
  const h = harness({ noPlayer: true });
  h.emit({ type: 'payload', original: payload, prepared: payload });
  h.emit({ type: 'request', id: 'v', originalUrl: raw, url: raw, host: A });
  h.setPlayers([h.video]); h.advance(1000);
  assert.equal(h.api.getState().startup.firstMediaRequestAt, 100000); assert.equal(h.api.getState().startup.sequence, 1);
  const next = emitter({ ...h.video, currentTime: 0, paused: true, readyState: 0 });
  h.setPlayers([next]); h.advance(1000);
  let s = h.api.getState(); assert.equal(s.startup.sequence, 2); assert.equal(s.startup.reason, 'player-change');
  assert.equal(s.startup.firstMediaRequestAt, null); assert.equal(s.startup.firstPresentedFrameAt, null);
  for (let i = 0; i < 12; i++) { next.emit('emptied'); h.advance(100); }
  s = h.api.getState(); assert.equal(s.startup.sequence, 14); assert.equal(s.startup.reason, 'emptied');
  assert.equal(s.startupHistory.length, 8); assert.equal(s.startup.mediaGeneration, s.mediaGeneration);
  assert.equal(h.kernelOptions.getPlayer(), next);
  assert.equal(h.kernelOptions.classifyRequest(raw, raw), 'video'); assert.equal(h.kernelOptions.classifyRequest(audio, audio), 'audio');
  const evidence = h.kernelOptions.getPlaybackEvidence();
  assert.equal(evidence.player, next); assert.equal(evidence.mediaGeneration, s.mediaGeneration);
  assert.equal(evidence.startupPending, false); assert.deepEqual(h.calls, []);
});

test('loadeddata and positive presented quality settle startup without fabricating first frame timing', () => {
  const h = harness({ video: { paused: true, currentTime: 0, readyState: 1 } });
  h.emit({ type: 'payload', original: payload, prepared: payload });
  h.emit({ type: 'request', id: 'v', originalUrl: raw, url: raw, host: A });
  h.video.emit('loadeddata');
  assert.equal(h.kernelOptions.getPlaybackEvidence().startupPending, true);
  h.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 1, droppedVideoFrames: 1 }); h.api.getState();
  assert.equal(h.kernelOptions.getPlaybackEvidence().startupPending, true);
  h.video.getVideoPlaybackQuality = () => ({ totalVideoFrames: 2, droppedVideoFrames: 1 });
  const s = h.api.getState();
  assert.equal(h.kernelOptions.getPlaybackEvidence().startupPending, false);
  assert.equal(s.startup.firstPresentedFrameAt, null); assert.equal(s.startup.playingAt, null);
  assert.equal(s.startup.phase, 'started'); assert.deepEqual(h.calls, []);
});

test('first compositor submission can be observed before play while explicit pause prevents false startup intent', () => {
  const h = harness({ rvfc: true, video: { paused: true, currentTime: 0, readyState: 1 } });
  h.emit({ type: 'payload', original: payload, prepared: payload });
  h.emit({ type: 'request', id: 'v', originalUrl: raw, url: raw, host: A });
  h.presentFrame(50, { presentedFrames: 1, mediaTime: 0 });
  const s = h.api.getState();
  assert.equal(s.startup.firstPresentedFrameAt, 100050); assert.equal(s.startup.playingAt, null);
  assert.equal(s.startup.firstPlayIntentAt, null); assert.equal(h.kernelOptions.getPlaybackEvidence().startupPending, false);
  assert.equal(s.startup.stableFramesAt, null);
  const paused = harness({ rvfc: true, video: { paused: true, currentTime: 0, readyState: 1 } });
  paused.video.emit('pause'); paused.presentFrame(50, { presentedFrames: 1, mediaTime: 0 });
  assert.equal(paused.api.getState().startup.firstPresentedFrameAt, null);
  assert.equal(paused.api.getState().startup.phase, 'paused'); assert.deepEqual(h.calls, []);
});

test('a queued rVFC timestamp behind the latest observation does not erase established presentation evidence', () => {
  const h = harness({ rvfc: true, video: { currentTime: 0, playbackRate: 1 } });
  h.presentFrame(10, { presentedFrames: 1, mediaTime: 0.01 });
  h.presentFrame(20, { presentedFrames: 2, mediaTime: 0.03 });
  h.presentFrame(20, { presentedFrames: 3, mediaTime: 0.05 });
  assert.equal(h.api.getState().media.frameHealth.state, 'healthy');
  h.advance(5); // A state sample at 100055 runs before the queued compositor callback.
  h.presentFrame(2, { presentedFrames: 4, mediaTime: 0.06 }, 100054);
  assert.equal(h.api.getState().media.frameHealth.state, 'healthy',
    'the callback was observed at 100057; its render timestamp of 100054 is not a local clock rollback');
  // Native captureStream stopped both frame production and video time in the lifecycle report.
  // This fixture verifies that retained evidence describes that condition, not an advancing-clock CDN freeze.
  for (let i = 0; i < 5; i++) h.advance(1000);
  const s = h.api.getState();
  assert.equal(h.video.currentTime, 0.06);
  assert.equal(s.media.playback, 'frozen'); assert.equal(s.media.frameHealth.source, 'rvfc');
  assert.equal(s.media.frameHealth.presentedFrames, 4); assert.deepEqual(h.calls, []);
});
