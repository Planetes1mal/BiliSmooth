// Real kernel, passive session and frame monitor with simulated media and network time.
import test from 'node:test';
import assert from 'node:assert/strict';
import loadKernel from '../support/kernel-harness.js';
import sharedEmitter from '../support/emitter.cjs';
const A = 'upos-sz-mirroraliov.bilivideo.com', B = 'upos-sz-mirrorcosov.bilivideo.com';
const media = (host = A, cid = '42231991605') => `https://${host}/upgcxcode/1/${cid}-1-30080.m4s`;
const payload = (cid = '42231991605', fps = '60') => ({ data: { dash: { video: [{ id: 120, bandwidth: 9000000,
  baseUrl: media(A, cid), backupUrl: [media(B, cid)], width: 3840, height: 2160, frame_rate: fps }] } } });
const preparing = { paused: true, seeking: true, readyState: 1, currentTime: 139 };
function harness({ initial = {}, config = {}, fps = '60', rvfc = false } = {}) {
  const pending = [], h = loadKernel({ session: true, now: 1788836240000, video: initial, rvfc,
    config: { enabled: true, mode: 'bad-only', selection: 'auto', stallRecovery: true, ...config }, payload: payload('42231991605', fps),
    globals: { ProgressEvent: class extends Event {}, Math: Object.assign(Object.create(Math), { random: () => 0.9 }) },
    fetch: (url, init) => new Promise(resolve => pending.push({ url, init, resolve })) });
  h.pending = pending;
  h.request = (raw = media(), range = 'bytes=0-1048575', timeout) => {
    const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', raw); xhr.setRequestHeader('Range', range);
    if (timeout) { xhr.ontimeout = timeout; xhr.onloadend = () => {}; }
    xhr.send(); return xhr;
  };
  h.deliver = async item => {
    const [start, end] = item.init.headers.Range.slice(6).split('-').map(Number);
    item.resolve({ status: 206, body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(end - start + 1) }) }) } });
    await h.flush();
  };
  return h;
}

test('presentation and low buffer alone cannot start a route comparison without an in-flight video fragment', () => {
  for (const [name, options, advanceFrames, expected] of [
    ['frozen compositor', { rvfc: true }, false, 'frozen'],
    ['healthy compositor', { rvfc: true }, true, 'healthy'],
    ['no baseline', {}, false, 'unknown'],
    ['slow frame cadence', { fps: '0.5' }, true, 'healthy']
  ]) {
    const h = harness(options);
    if (name !== 'no baseline') h.advance(2000, { frames: true });
    h.buffer(0); h.video.emit('waiting'); h.advance(2500, { frames: advanceFrames });
    const state = h.api.getState(); h.close();
    assert.equal(state.media.frameHealth.state, expected, name);
    assert.equal(h.pending.length, 0, name);
  }
});

test('measured requests retry safely, disable unconfirmed synthetic timeouts and detect shortfall on send', async () => {
  for (const scenario of ['player retries', 'player does not retry', 'shortfall on send', 'player retried before the winner', 'player retry completed before the winner']) {
    const retries = scenario === 'player retries';
    const h = harness({ initial: preparing }); h.buffer(0); h.video.emit('loadedmetadata'); h.video.emit('seeking');
    assert.equal(h.pending.length, 0, 'startup metadata does not probe the candidate pool');
    if (scenario === 'shortfall on send') {
      h.buffer(20);
      for (let index = 0; index < 4; index++) {
        const xhr = h.request(media(), `bytes=${index * 65536}-${(index + 1) * 65536 - 1}`);
        h.advance(2000, { move: false }); xhr.progress(65536); xhr.complete(65536);
      }
      assert.equal(h.pending.length, 0);
      h.request(media(), 'bytes=262144-327679');
      assert.equal(h.pending.length, 2, 'the next real send compares measured shortfall without waiting for a timer');
      h.close(); continue;
    }
    if (scenario.startsWith('player retr')) {
      let third; const first = h.request(media(), 'bytes=0-1048575', () => {});
      h.advance(1000, { move: false }); await h.flush(); assert.equal(h.pending.length, 2);
      h.advance(1000, { move: false }); first.cancel();
      const retry = h.request(media(B), 'bytes=0-1048575', () => { third = h.request(media(B)); });
      if (scenario === 'player retry completed before the winner') {
        h.advance(100, { move: false }); retry.progress(1048576); retry.complete(1048576);
        h.advance(100, { move: false }); await h.deliver(h.pending[0]);
        const session = h.kernel.getState().session;
        assert.equal(session.lastRace.verdict, 'current-fastest'); assert.equal(session.switchCount, 0);
        assert.equal(new URL(h.request(media(B), 'bytes=1048576-2097151').url).hostname, B);
        h.close(); continue;
      }
      h.advance(200, { move: false }); await h.deliver(h.pending[0]);
      assert.ok(third, 'the in-flight retry of the raced Range is moved to the winner');
      assert.equal(new URL(third.url).hostname, new URL(h.pending[0].url).hostname);
      h.close(); continue;
    }
    let retry, delivered = 0;
    h.request(media(), 'bytes=0-1048575', () => { delivered++; if (retries) retry = h.request(); });
    h.advance(1000, { move: false }); await h.flush(); assert.equal(h.pending.length, 2);
    h.advance(200, { move: false }); await h.deliver(h.pending[0]); assert.equal(delivered, 1);
    if (retries) {
      assert.equal(new URL(retry.url).hostname, new URL(h.pending[0].url).hostname);
      assert.notEqual(new URL(retry.url).hostname, A);
    }
    h.advance(100, { move: false }); await h.deliver(h.pending[1]);
    h.advance(2900, { move: false }); await h.flush();
    assert.equal(h.kernel.getState().session.syntheticTimeouts.enabled, retries);
    if (retries) {
      const before = h.pending.length; h.advance(30000, { move: false }); await h.flush();
      assert.equal(h.pending.length, before, 'automatic comparison of this representation and Range occurs once');
    } else {
      h.advance(10000, { move: false });
      const later = h.request(media(), 'bytes=1048576-2097151', () => { delivered++; });
      h.advance(1250, { move: false }); await h.flush(); assert.equal(h.pending.length, 4);
      h.advance(200, { move: false }); await h.deliver(h.pending[2]); await h.deliver(h.pending[3]);
      assert.equal(delivered, 1); assert.equal(later.readyState, 1);
      assert.equal(h.kernel.getState().session.syntheticTimeouts.enabled, false);
    }
    h.close();
  }
});

test('startup automatic comparison respects user pause, visibility and configuration boundaries', async () => {
  for (const [name, config, mutate] of [
    ['explicit user pause', {}, h => h.video.emit('pause')],
    ['hidden document', {}, h => { h.document.hidden = true; h.document.emit('visibilitychange'); }],
    ['fixed selection', { selection: 'fixed', pcdnHost: B }, () => {}],
    ['disabled extension', { enabled: false }, () => {}],
    ['original routing', { mode: 'off' }, () => {}],
    ['disabled automatic recovery', { stallRecovery: false }, () => {}]
  ]) {
    const h = harness({ initial: preparing, config }); h.buffer(0); h.video.emit('loadedmetadata'); h.video.emit('seeking');
    const xhr = h.request(); mutate(h); h.advance(2500, { move: false }); await h.flush();
    assert.equal(h.pending.length, 0, name); assert.equal(new URL(xhr.url).hostname, A, name); h.close();
  }
});

test('after playback starts, paused, seeking, hidden and stale observations cannot trigger comparisons', async () => {
  for (const [name, mutate] of [
    ['user pause', h => { h.video.paused = true; h.video.emit('pause'); }],
    ['active seek', h => { h.video.seeking = true; h.video.emit('seeking'); }],
    ['hidden document', h => { h.document.hidden = true; h.document.emit('visibilitychange'); }],
    ['old observation', h => { h.stopObservations(); h.advance(2000, { move: false }); }]
  ]) {
    const h = harness({ rvfc: true }); h.advance(2000, { frames: true }); h.buffer(0); mutate(h);
    h.request(); h.advance(2500, { move: false }); await h.flush();
    assert.equal(h.pending.length, 0, name); h.close();
  }
});

test('late old requests and race results cannot move a new network, player or video session', async () => {
  for (const cause of ['network reset', 'player replacement', 'new video']) {
    const h = harness({ initial: preparing }); h.buffer(0); h.video.emit('loadedmetadata'); h.video.emit('seeking');
    const xhr = h.request(); h.advance(1000, { move: false }); await h.flush(); assert.equal(h.pending.length, 2, cause);
    if (cause === 'network reset') h.api.resetNetwork();
    else if (cause === 'player replacement') { h.replacePlayer(sharedEmitter({ ...h.video, isConnected: true }, { event: true, targetOnly: false })); h.api.getState(); }
    else h.scope.__playinfo__ = payload('42242147914');
    h.advance(250, { move: false }); await h.flush();
    assert.ok(h.pending.every(item => item.init.signal.aborted), cause);
    for (const item of h.pending) await h.deliver(item);
    xhr.expire(); const next = h.request(media(A, cause === 'new video' ? '42242147914' : '42231991605'));
    assert.equal(new URL(next.url).hostname, A, cause); h.close();
  }
});

test('recorded partial abort joins the prior failure without counting seek or replaced-media cancellation', async () => {
  for (const cause of ['startup', 'playing', 'seek', 'pause', 'emptied', 'player replacement', 'network reset', 'short abort']) {
    const h = harness({ initial: cause === 'startup' ? preparing : {}, rvfc: true });
    if (cause !== 'startup') h.advance(1000, { frames: true });
    h.buffer(40);
    const first = h.request(); h.advance(2051.1, { frames: cause !== 'startup', move: false }); first.cancel();
    const partial = h.request(media(), 'bytes=1048576-2097151');
    h.advance(cause === 'short abort' ? 59.4 : 3587.3, { frames: cause !== 'startup', move: false });
    partial.progress(cause === 'short abort' ? 3620 : 457449);
    h.advance(cause === 'short abort' ? 18.8 : 462.6, { frames: cause !== 'startup', move: false });
    if (cause === 'seek') { h.video.seeking = true; h.video.emit('seeking'); }
    if (cause === 'pause') { h.video.paused = true; h.video.emit('pause'); }
    if (cause === 'emptied') h.video.emit('emptied');
    if (cause === 'player replacement') { h.replacePlayer(sharedEmitter({ ...h.video }, { event: true })); h.api.getState(); }
    if (cause === 'network reset') h.api.resetNetwork();
    partial.cancel();
    h.video.seeking = false; h.video.paused = false;
    h.request(media(), 'bytes=2097152-3145727');
    assert.equal(h.pending.length, ['startup', 'playing'].includes(cause) ? 2 : 0, cause);
    if (h.pending.length) assert.equal(h.kernel.getState().session.lastRace.trigger, 'errors', cause);
    h.close();
  }
});
