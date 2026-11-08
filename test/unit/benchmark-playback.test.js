'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const { makeSchedule, normalizeVideos, createNetworkTracker, summarizeRun, matchesDefaultRuntime, segmentJumps } = require('../../scripts/checks/benchmark.cjs');

test('benchmark rotates native/P0/P1 and optional upstream arms with startup and reload in one profile', () => {
  const at = Date.parse('2026-10-08T16:00:00Z');
  const videos = normalizeVideos([{ id: 'BVpopularfixture', set: 'popular', viewCount: 1000001, publishedAt: '2026-09-01T00:00:00Z' },
    { id: 'BVcoldfixture', set: 'cold', viewCount: 800, publishedAt: '2026-09-01T00:00:00Z' }], 'measure', at);
  for (const arms of [['native', 'p0', 'bilismooth'], ['native', 'upstream', 'bilismooth']]) {
    const schedule = makeSchedule(videos, arms, 'measure');
    assert.deepEqual(schedule.map(row => row.arm), [...arms, arms[1], arms[2], arms[0]]);
    assert.ok(schedule.every(row => JSON.stringify(row.phases) === '["startup","reload"]'));
  }
  assert.equal(makeSchedule(videos, ['native'], 'screen').length, 2);
  assert.throws(() => normalizeVideos([videos[0], videos[0]], 'measure', at), /Repeated/);
});

test('default automatic host rotation is valid but changed user preferences are not', () => {
  const defaults = require('../../src/core/settings.js').normalize({});
  const rotated = { ...defaults, pcdnHost: defaults.candidatePool[1] };
  assert.equal(matchesDefaultRuntime(rotated, defaults), true);
  assert.equal(matchesDefaultRuntime({ ...rotated, selection: 'fixed' }, defaults), false);
  assert.equal(matchesDefaultRuntime({ ...rotated, mode: 'force' }, defaults), false);
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

test('unmapped decoded dimensions cannot establish account-default quality and rate evidence', () => {
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

test('measured phases exclude hidden delivery and random CDN offsets keep one comparable interval', async () => {
  const { measuredPhaseSummary, qualityCoverage, summarizeGroups, summarizeComparisons } = require('../../scripts/checks/benchmark.cjs');
  const { randomOffset, measureInBrowser } = require('../../scripts/checks/cdn.cjs');
  const origin = Date.parse('2026-10-08T16:00:00Z');
  const samples = Array.from({ length: 325 }, (_, i) => ({ at: i * 250, videoId: 1, frames: i < 4 ? 0 : i - 3,
    visibility: i >= 40 && i < 80 ? 'hidden' : 'visible', nativeQuality: { realQ: 116 },
    media: { currentTime: i / 4, paused: false, seeking: false, ended: false, width: 1920, height: 1080, rate: 1 } }));
  const request = (start, totalMs, extra = {}) => ({ role: 'playback', kind: 'video', startedAt: new Date(origin + start).toISOString(), totalMs, bytes: 163840, ...extra });
  const run = { arm: 'bilismooth', timeOrigin: origin, firstFrameFromNavigationMs: 1000, samples,
    visibility: [{ at: 0, visibility: 'visible' }, { at: 10000, visibility: 'hidden' }, { at: 20000, visibility: 'visible' }],
    requests: [request(5000, 2000), request(9000, 3000), request(30000, null), request(50000, 250, { role: 'probe', bytes: 262144 })],
    events: [11000, 23000, 80000].map(at => ({ event: 'waiting', at, visibility: at === 11000 ? 'hidden' : 'visible', readyState: 2, paused: false, seeking: false })),
    candidateDiagnostics: { session: { races: [{}, {}], switchCount: 1 } }, dashRepresentations: [{ kind: 'video', quality: 116, width: 1920, height: 1080, frameRate: '60' }] };
  const cases = [
    { actual: () => { const result = measuredPhaseSummary(structuredClone(run)); return [result.firstFrameFromNavigationMs, result.longestVideoFragmentWaitMs, result.censoredVideoRequests, result.bufferExhaustionsWithinFirst60ForegroundSeconds, result.raceCount, result.switchCount, result.additionalTrafficBytes]; }, expected: [1000, 51000, 1, 1, 2, 1, 262144] },
    { actual: () => measuredPhaseSummary({ ...structuredClone(run), visibility: [{ at: 0, visibility: 'hidden' }, { at: 20000, visibility: 'visible' }] }).firstFrameFromNavigationMs, expected: null },
    { actual: () => [qualityCoverage(run, '1080p60'), qualityCoverage(run, '4k'), qualityCoverage({...run,dashRepresentations:[{...run.dashRepresentations[0],frameRate:'30000/1001'}]}, '1080p60')], expected: [true, false, false] },
    { actual: () => { const result = measuredPhaseSummary({ ...structuredClone(run), arm: 'p0', candidateDiagnostics: { recoveryAttempts: 3, events: [{type:'probe-start'}] } }); return [result.raceCount, result.switchCount, result.startupProbeRounds]; }, expected: [0, 3, 1] },
    { actual: () => [randomOffset(1048576, 786432, () => 0), randomOffset(1048576, 786432, () => .5), randomOffset(100, 786432, () => .5)], expected: [0, 131072, 0] }
  ];
  for (const row of cases) assert.deepEqual(row.actual(), row.expected);
  const phase = { phase: 'startup', status: 'observed', firstFrameFromNavigationMs: 1500,
    longestVideoFragmentWaitMs: 1000, censoredVideoRequests: 0, bufferExhaustionsWithinFirst60ForegroundSeconds: 0,
    observedConditions: { dimensions: ['1920x1080'], rates: [1], codecAndBitrate: [{ quality: 116, codec: 'avc1', bandwidthBps: 9000000 }], firstObservedPlayhead: 4 } };
  const groups = summarizeGroups([1000, 2000, 5000].map(firstFrameFromNavigationMs => ({ arm: 'bilismooth', video: {set:'cold'}, summary: [{...phase,firstFrameFromNavigationMs}] })));
  assert.deepEqual([groups[0].medianFirstFrameMs, groups[0].p90FirstFrameMs, groups[0].observedTargetsMet], [2000,5000,true]);
  const arms = ['native','p0','bilismooth'], paired = arms.map(arm => ({arm,video:{id:'BVfixture'},summary:[structuredClone(phase)]}));
  assert.equal(summarizeComparisons(paired, arms)[0].sameObservedQualityAndRate, true);
  paired[2].summary[0].observedConditions.dimensions = ['1280x720'];
  assert.equal(summarizeComparisons(paired, arms)[0].sameObservedQualityAndRate, false);
  let requestedRange;
  const scoped = { URL, Uint8Array, AbortController, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto,
    performance, input: { url: 'https://media.example/fixture.m4s', offset: 100, maxBytes: 4, timeoutMs: 1000 },
    fetch: async (_url, init) => { requestedRange = init.headers.Range; const response = new Response(Uint8Array.from([1, 2, 3, 4]), { status: 206, headers: { 'content-range': 'bytes 100-103/200', 'content-type': 'video/mp4' } }); Object.defineProperty(response, 'url', { value: _url }); return response; } };
  const measured = await vm.runInNewContext(`(${measureInBrowser.toString()})(input)`, scoped);
  assert.equal(requestedRange, 'bytes=100-103'); assert.equal(measured.ok, true); assert.equal(measured.bytes, 4);
});
