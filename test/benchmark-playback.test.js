'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const { makeSchedule, normalizeVideos, createNetworkTracker, summarizeRun, beginConditionedPlayback, prepareNativeStart, matchesDefaultRuntime,
  qualitySettled, segmentJumps, requestNativeQuality } = require('../scripts/benchmark-playback.cjs');

test('benchmark interleaves arms, rotates repetitions, and screens each candidate once', () => {
  const videos = normalizeVideos([{ id: 'BVstutter', set: 'stutter' }, { id: 'BVcontrol', set: 'control' }], 'measure');
  assert.deepEqual(makeSchedule(videos, ['native', 'upstream', 'bilismooth'], 'measure').map(row => row.arm),
    ['native', 'upstream', 'bilismooth', 'upstream', 'bilismooth', 'native', 'upstream', 'bilismooth', 'native']);
  assert.equal(makeSchedule(videos, ['native'], 'screen').length, 2);
  assert.throws(() => normalizeVideos([{ id: 'BVsame', set: 'stutter' }, { id: 'BVsame', set: 'control' }], 'measure'), /Repeated/);
});

test('default automatic host rotation is valid but changed user preferences are not', () => {
  const defaults = require('../src/core/settings.js').normalize({});
  const rotated = { ...defaults, pcdnHost: defaults.candidatePool[1] };
  assert.equal(matchesDefaultRuntime(rotated, defaults), true);
  assert.equal(matchesDefaultRuntime({ ...rotated, selection: 'fixed' }, defaults), false);
  assert.equal(matchesDefaultRuntime({ ...rotated, mode: 'force' }, defaults), false);
});

test('native quality preparation distinguishes pending Auto from settled Auto and fixed quality', () => {
  assert.equal(qualitySettled({ nowQ: 80, newQ: 0, realQ: 80 }), false);
  assert.equal(qualitySettled({ nowQ: 0, newQ: 0, realQ: 112 }), true);
  assert.equal(qualitySettled({ nowQ: 0, newQ: 0, realQ: 80 }, 80), false);
  assert.equal(qualitySettled({ nowQ: 80, newQ: 80, realQ: 80 }, 80), true);
});

test('native quality request is awaited, leaves audio unspecified, and skips an already selected quality', async () => {
  let current = { nowQ: 0, newQ: 0, realQ: 112 }, settle;
  const calls = [];
  const player = { getQuality: () => current, requestQuality(...args) {
    calls.push(args);
    return new Promise(resolve => { settle = () => { current = { nowQ: 80, newQ: 80, realQ: 80 }; resolve(); }; });
  } };
  const scope = { window: { player }, performance: { now: () => 1 }, setTimeout, clearTimeout, Date,
    input: { selectedQualityId: 80, offeredQualityIds: [80, 64], lowerQualityId: 64 } };
  let finished = false;
  const operation = vm.runInNewContext(`(${requestNativeQuality.toString()})(input)`, scope).then(result => { finished = true; return result; });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.deepEqual(calls, [[80]]);
  settle();
  assert.equal((await operation).after.nowQ, 80);
  const second = await vm.runInNewContext(`(${requestNativeQuality.toString()})(input)`, scope);
  assert.equal(second.requested, false);
  assert.equal(calls.length, 1);
});

test('Auto same-rendered-quality rejection permits only one awaited lower-then-target preparation', async () => {
  let current = { nowQ: 0, newQ: 0, realQ: 112 }, finishLower, finishTarget;
  const calls = [], nativeError = { code: 20004, msg: 'same rendered index', isChange: false };
  const player = { getQuality: () => current, requestQuality(...args) {
    calls.push(args);
    if (calls.length === 1) return Promise.reject(nativeError);
    return new Promise(resolve => {
      const finish = () => { current = { nowQ: args[0], newQ: args[0], realQ: args[0] }; resolve(); };
      if (args[0] === 64) finishLower = finish; else finishTarget = finish;
    });
  } };
  const scope = { window: { player }, performance: { now: () => 1 }, setTimeout, clearTimeout, Date,
    input: { selectedQualityId: 80, offeredQualityIds: [80, 64], lowerQualityId: 64 } };
  const resultPromise = vm.runInNewContext(`(${requestNativeQuality.toString()})(input)`, scope);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [[80], [64]]);
  finishLower();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [[80], [64], [80]]);
  finishTarget();
  const result = await resultPromise;
  assert.equal(result.error, null);
  assert.equal(JSON.stringify(result.commands[0].error), JSON.stringify(nativeError));
  assert.equal(result.commands.length, 3);
  assert.equal(result.after.nowQ, 80);
  for (const code of [403, 20004]) {
    const errors = [];
    const deniedScope = { ...scope, input: { selectedQualityId: 80,
      offeredQualityIds: code === 403 ? [80, 64] : [80], lowerQualityId: code === 403 ? 64 : null },
      window: { player: { getQuality: () => ({ nowQ: 0, newQ: 0, realQ: 112 }),
        requestQuality(...args) { errors.push(args); return Promise.reject({ code, msg: 'blocked', isChange: false }); } } } };
    const failed = await vm.runInNewContext(`(${requestNativeQuality.toString()})(input)`, deniedScope);
    assert.equal(failed.error.code, code);
    assert.equal(errors.length, 1);
  }
});

test('recorded history jump invalidates the segment while a small recovery nudge does not', () => {
  const sample = (at, currentTime) => ({ at, videoId: 1, media: { currentTime, rate: 1 } });
  const recorded = [sample(19658.7, 12.796515), sample(19923.2, 85.192)];
  const jumps = segmentJumps(recorded);
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].fromSeconds, 12.796515);
  assert.equal(jumps[0].toSeconds, 85.192);
  assert.deepEqual(segmentJumps([sample(1000, 0.25), sample(1250, 0.9), sample(1500, 1.15)]), []);
});

test('native start preparation pauses and awaits one seek before timed playback starts', async () => {
  const calls = []; let finishSeek;
  const video = { currentTime: 46, paused: false, seeking: false, readyState: 4,
    getBoundingClientRect: () => ({ width: 1920 }), requestVideoFrameCallback() {} };
  const player = { pause() { calls.push('pause'); video.paused = true; }, seek(time) {
    calls.push(['seek', time]); video.seeking = true;
    return new Promise(resolve => { finishSeek = () => { video.currentTime = 0.023; video.seeking = false; resolve(); }; });
  }, play() { calls.push('play'); video.paused = false; return Promise.resolve(); } };
  const scope = { window: { player, __biliObservation: { events: [] } }, document: { querySelectorAll: () => [video] },
    performance: { now: () => 100 }, setTimeout, clearTimeout, Date };
  const preparation = vm.runInNewContext(`(${prepareNativeStart.toString()})()`, scope);
  await Promise.resolve();
  assert.deepEqual(calls, ['pause', ['seek', 0]]);
  assert.equal(video.paused, true);
  finishSeek();
  const prepared = await preparation;
  assert.equal(prepared.seekResolved, true);
  assert.equal(prepared.after.paused, true);
  vm.runInNewContext(`(${beginConditionedPlayback.toString()})()`, scope);
  assert.deepEqual(calls, ['pause', ['seek', 0], 'play']);
});

test('a mid-run quality downgrade cannot pass the paired quality condition', () => {
  const run = { samples: [], requests: [{ role: 'playback', resourcePath: '/1080.m4s', bytes: 1000 }],
    mediaProperties: [], mediaErrors: [], qualitySelection: { selectedHeight: 1080, selectedQualityId: 80, selectedLabel: '1080P 高清' },
    dashRepresentations: [{ kind: 'video', quality: 80, width: 1920, height: 1080, paths: ['/1080.m4s'] }] };
  for (let at = 0; at <= 90000; at += 250) run.samples.push({ at, videoId: 1, frames: at / 250 + 1,
    firstFrameAt: 0, lastFrameAt: at, visibility: 'visible', quality: '1080P 高清', nativeQuality: { nowQ: 80, newQ: 80, realQ: 80 },
    media: { currentTime: at / 1000, width: at < 6250 ? 1920 : 1280,
      height: at < 6250 ? 1080 : 720, rate: 1, paused: false, seeking: false, ended: false } });
  summarizeRun(run);
  assert.ok(run.summary.validFrameProgressMs >= 5000);
  assert.equal(run.requestedConditions.met, false);
  assert.equal(run.status, 'incomplete-playback-observation');
});

test('equal-resolution premium quality and a queued history frame cannot pass conditioning', () => {
  const run = { samples: [], requests: [{ role: 'playback', resourcePath: '/ordinary.m4s', bytes: 1000 },
    { id: 'premium', role: 'playback', kind: 'video', qualityId: 112, resourcePath: '/premium.m4s', bytes: 1000, startedAt: new Date(2000).toISOString() }],
    conditionedWallTime: 1000, mediaProperties: [], mediaErrors: [],
    qualitySelection: { selectedHeight: 1080, selectedQualityId: 80, selectedLabel: '1080P 高清' },
    dashRepresentations: [{ kind: 'video', quality: 80, width: 1920, height: 1080, paths: ['/ordinary.m4s'] }] };
  for (let at = 0; at <= 6000; at += 250) run.samples.push({ at, videoId: 1, frames: at / 250 + 1, firstFrameAt: 0,
    lastFrameAt: at, visibility: 'visible', quality: '1080P 高码率\n自动', nativeQuality: { nowQ: 112, newQ: 112, realQ: 112 },
    media: { currentTime: at / 1000, width: 1920, height: 1080, rate: 1, paused: false, seeking: false, ended: false } });
  summarizeRun(run);
  assert.equal(run.requestedConditions.met, false);
  assert.deepEqual(run.requestedConditions.mismatchedQualityRequests, ['premium']);
  const callbacks = [], video = { seeking: false, paused: false, currentTime: 0,
    requestVideoFrameCallback: callback => callbacks.push(callback), play() { throw Error('Conditioning must not issue a second play'); },
    getBoundingClientRect: () => ({ width: 1920 }) };
  let at = 100;
  const scope = { document: { querySelectorAll: () => [video] },
    window: { player: { play: () => Promise.resolve() }, __biliObservation: { events: [] } }, performance: { now: () => at }, Date };
  vm.runInNewContext(`(${beginConditionedPlayback.toString()})()`, scope);
  at = 101; callbacks.shift()(at, { mediaTime: 43 });
  assert.equal(scope.window.__benchmarkConditionedFrame, null);
  video.currentTime = 0.1; at = 120; callbacks.shift()(at, { mediaTime: 0.1 });
  assert.equal(scope.window.__benchmarkConditionedFrame, 20);
});

test('CDP records partial probe bytes and separates them from completed player requests', () => {
  const cdp = new EventEmitter(), run = { arm: 'bilismooth', requests: [], dashRepresentations: [
    { kind: 'video', paths: ['/video.m4s'], bandwidthBps: 1000, codec: 'avc1' }] };
  let bytes = 0, stopped;
  const finish = createNetworkTracker(cdp, run, reason => { stopped = reason; }, count => { bytes += count; });
  const request = (id, probe) => cdp.emit('Network.requestWillBeSent', { requestId: id, timestamp: 1, wallTime: 1000,
    request: { url: 'https://upos.example/video.m4s?secret=do-not-retain', method: 'GET', headers: { Range: 'bytes=0-1023' } }, type: 'Fetch',
    initiator: { stack: { callFrames: probe ? [{ functionName: 'measure', url: 'chrome-extension://id/playback.js' }] : [] } } });
  const response = (id, status = 206) => cdp.emit('Network.responseReceived', { requestId: id, timestamp: 1.2,
    response: { status, headers: {}, mimeType: 'video/mp4', protocol: 'h2' } });
  request('probe', true); response('probe');
  cdp.emit('Network.dataReceived', { requestId: 'probe', dataLength: 256, encodedDataLength: 256 });
  cdp.emit('Network.loadingFailed', { requestId: 'probe', timestamp: 1.5, errorText: 'net::ERR_ABORTED', canceled: true });
  request('player', false); response('player');
  cdp.emit('Network.dataReceived', { requestId: 'player', dataLength: 1024, encodedDataLength: 1024 });
  cdp.emit('Network.loadingFinished', { requestId: 'player', timestamp: 2, encodedDataLength: 1200 });
  finish();
  assert.equal(bytes, 1456);
  assert.deepEqual(run.requests.map(row => [row.role, row.bytes, row.completed, row.kind, row.rangeLength]),
    [['probe', 256, false, 'video', 1024], ['playback', 1024, true, 'video', 1024]]);
  assert.equal(run.requests[1].totalMs, 1000);
  assert.ok(Math.abs(run.requests[1].ttfbMs - 200) < 0.01);
  assert.ok(!JSON.stringify(run).includes('secret'));
  response('player', 412); assert.equal(stopped, 'risk-http-412');
});

test('extensionless MCDN and proxied media remain recorded with their actual delivery hosts', () => {
  const cdp = new EventEmitter(), run = { arm: 'bilismooth', requests: [], dashRepresentations: [] };
  createNetworkTracker(cdp, run, () => {}, () => {});
  const urls = ['https://example.mcdn.bilivideo.com/v1/resource/segment?os=mcdn',
    'https://proxy-tf-all-ws.bilivideo.com/?url=' + encodeURIComponent('https://example.mcdn.bilivideo.com/v1/resource/segment?token=private')];
  urls.forEach((url, index) => {
    const requestId = String(index);
    cdp.emit('Network.requestWillBeSent', { requestId, timestamp: 1, wallTime: 1000, type: 'XHR',
      request: { url, method: 'GET', headers: {} } });
    cdp.emit('Network.responseReceived', { requestId, timestamp: 1.1,
      response: { status: 206, headers: {}, mimeType: 'application/octet-stream', protocol: 'h2' } });
    cdp.emit('Network.dataReceived', { requestId, dataLength: 262144, encodedDataLength: 262144 });
  });
  assert.equal(run.requests.length, 2);
  assert.deepEqual(run.requests.map(row => row.host), ['example.mcdn.bilivideo.com', 'proxy-tf-all-ws.bilivideo.com']);
  assert.ok(run.requests.every(row => row.resourcePath === '/v1/resource/segment' && row.bytes === 262144));
  assert.ok(!JSON.stringify(run).includes('token'));
});
