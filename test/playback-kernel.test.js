const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core/routing-policy.js');
const settings = require('../src/core/settings.js');
const Kernel = require('../src/page/playback-kernel.js');
const A = settings.candidatePool[0], B = settings.candidatePool[1];
const media = (host = A) => `https://${host}/upgcxcode/1/video.m4s?sign=PRIVATE`;
const peer = media('upos-sz-302ppio.bilivideo.com');
const payload = (base = peer) => ({ data: { dash: { video: [{ id: 120, baseUrl: base, backupUrl: [] }] } } });
const loadKernel = require('./support/kernel-harness.cjs');
const harness = (options = {}) => loadKernel({ ...options, kernel: Kernel, now: options.clock ?? 100000 });

test('all three globals and JSON.parse prepare playback with the full configured backup set', () => {
  const h = harness();
  for (const name of ['__playinfo__', '__INITIAL_STATE__', '__NEPTUNE_IS_MY_WAIFU__']) {
    h.scope[name] = payload();
    assert.equal(h.scope[name].data.dash.video[0].baseUrl, media());
    assert.equal(h.scope[name].data.dash.video[0].backupUrl.length, 8);
  }
  const parsed = h.scope.JSON.parse(JSON.stringify(payload()));
  assert.equal(parsed.data.dash.video[0].baseUrl, media());
  const observed = h.events.find(event => event.type === 'payload');
  assert.equal(observed.original.data.dash.video[0].baseUrl, peer);
  assert.equal(observed.prepared.data.dash.video[0].baseUrl, media());
  assert.ok(!JSON.stringify(h.kernel.getState()).includes('PRIVATE'));
  h.kernel.destroy();
});

test('headless player observation retains the specified stall timing and traverses more than two nodes', async () => {
  const h = harness();
  const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', media()); xhr.send();
  h.video.readyState = 2; h.video.emit('waiting');
  await h.advance(2499); assert.equal(h.kernel.getState().recoveries, 0);
  await h.advance(1); assert.equal(h.kernel.getState().recoveries, 1); assert.equal(h.kernel.getConfig().pcdnHost, B);
  assert.equal(h.events.filter(event => event.type === 'config').at(-1).config.pcdnHost, B);
  await h.advance(5000); assert.equal(h.kernel.getState().recoveries, 2); assert.equal(h.kernel.getConfig().pcdnHost, settings.candidatePool[2]);
  h.document.hidden = true; h.document.emit('visibilitychange'); await h.advance(10000);
  assert.equal(h.kernel.getState().recoveries, 2);
  h.document.hidden = false; h.document.emit('visibilitychange'); await h.advance(2500);
  assert.equal(h.kernel.getState().recoveries, 3);
  h.kernel.destroy(); assert.equal(h.video.count('waiting'), 0);
});

test('repeated waiting and stalled signals cannot defer the first or continued recovery deadline', async () => {
  const h = harness(); h.video.readyState = 2; h.video.seeking = false;
  h.video.emit('waiting');
  for (let i = 0; i < 4; i++) { await h.advance(500); h.video.emit(i % 2 ? 'stalled' : 'waiting'); }
  await h.advance(499); assert.equal(h.kernel.getState().recoveries, 0);
  await h.advance(1); assert.equal(h.kernel.getState().recoveries, 1);
  for (let i = 0; i < 4; i++) { await h.advance(1000); h.video.emit(i % 2 ? 'waiting' : 'stalled'); }
  await h.advance(999); assert.equal(h.kernel.getState().recoveries, 1);
  await h.advance(1); assert.equal(h.kernel.getState().recoveries, 2);
  assert.deepEqual(h.events.filter(event => event.type === 'recovery-attempt').map(event => event.at), [102500, 107500]);
  const kept = h.events.filter(event => event.type === 'stall-timer' && event.action === 'kept');
  assert.equal(kept.length, 8); assert.equal(kept[0].deadlineAt, 102500); assert.equal(kept.at(-1).deadlineAt, 107500);
  const raw = h.events.find(event => event.type === 'player-event' && event.source === 'stalled');
  assert.equal(raw.readyState, 2); assert.equal(raw.hidden, false); assert.equal(raw.paused, false);
  assert.equal(raw.seeking, false); assert.equal(raw.playhead, 10); assert.ok(Number.isFinite(raw.at));
  h.kernel.destroy();
});

test('canplay and playing still cancel recovery even at low readyState; callback skips retain context', async () => {
  for (const source of ['canplay', 'playing']) {
    const h = harness(); h.video.readyState = 2; h.video.emit('waiting'); await h.advance(1000); h.video.emit(source);
    await h.advance(2000); assert.equal(h.kernel.getState().recoveries, 0);
    const cancel = h.events.find(event => event.type === 'stall-timer' && event.action === 'cancelled');
    assert.equal(cancel.reason, source); assert.equal(cancel.readyState, 2);
    h.video.emit('waiting'); await h.advance(2500); assert.equal(h.kernel.getState().recoveries, 1); h.kernel.destroy();
  }
  for (const [reason, mutate] of [
    ['paused', video => video.paused = true], ['ended', video => video.ended = true], ['ready', video => video.readyState = 3]
  ]) {
    const h = harness(); h.video.readyState = 2; h.video.seeking = true; h.video.emit('waiting'); mutate(h.video);
    await h.advance(2500); assert.equal(h.kernel.getState().recoveries, 0);
    const check = h.events.find(event => event.type === 'stall-timer' && event.action === 'check');
    assert.equal(check.reason, reason); assert.equal(check.seeking, true); assert.equal(check.deadlineAt, 102500);
    assert.ok(h.events.some(event => event.type === 'stall-timer' && event.action === 'skipped' && event.reason === reason));
    h.kernel.destroy();
  }
});

test('suspend is passive, hidden cancels deadlines, and raw player diagnostics stay bounded without URLs', async () => {
  const h = harness(); h.video.readyState = 2; h.video.currentSrc = media();
  h.video.emit('waiting'); await h.advance(1000); h.video.emit('suspend');
  await h.advance(1500); assert.equal(h.kernel.getState().recoveries, 1);
  assert.ok(h.events.some(event => event.type === 'player-event' && event.source === 'suspend'));
  h.document.hidden = true; h.document.emit('visibilitychange'); await h.advance(6000);
  assert.equal(h.kernel.getState().recoveries, 1);
  assert.ok(h.events.some(event => event.type === 'stall-timer' && event.action === 'cancelled' && event.reason === 'hidden' && event.hidden));
  h.document.hidden = false; h.document.emit('visibilitychange');
  for (let i = 0; i < 100; i++) h.video.emit(i % 2 ? 'stalled' : 'waiting');
  assert.ok(h.kernel.getState().events.length <= 60);
  assert.doesNotMatch(JSON.stringify(h.kernel.getState()), /PRIVATE|https:\/\//);
  await h.advance(2500); assert.equal(h.kernel.getState().recoveries, 2);
  assert.equal(h.video.count('waiting'), 1); assert.equal(h.video.count('suspend'), 1);
  h.kernel.destroy(); assert.equal(h.video.count('waiting'), 0); assert.equal(h.video.count('suspend'), 0);
});

test('analytics URLs embedding media retain native arguments and cannot replace the last media host or recovery source', async () => {
  const response = new Response('ok', { headers: { 'content-type': 'application/octet-stream' } });
  response.clone = () => { throw new Error('native analytics response must remain untouched'); };
  const h = harness({ fetch: () => response });
  const mediaXhr = new h.scope.XMLHttpRequest(); mediaXhr.open('GET', media()); mediaXhr.send();
  const analytics = 'https://data.bilibili.com/log/web?media=' + encodeURIComponent(media()) + '&path=/upgcxcode/1';
  const controller = new AbortController();
  const request = new Request(analytics, { method: 'POST', body: 'original body', credentials: 'include', headers: { 'X-Event': 'original' }, signal: controller.signal });
  const init = { cache: 'no-store', keepalive: true };
  assert.equal(await h.scope.fetch(request, init), response);
  assert.equal(h.calls[0].input, request); assert.equal(h.calls[0].init, init);
  const xhr = new h.scope.XMLHttpRequest(); xhr.open('POST', analytics, false, 'name', 'password'); xhr.setRequestHeader('X-Event', 'original'); xhr.send('unchanged');
  assert.deepEqual(xhr.openArgs, ['POST', analytics, false, 'name', 'password']);
  assert.equal(xhr.body, 'unchanged'); assert.equal(xhr.headers['X-Event'], 'original');
  xhr.finish({ ok: true });
  assert.equal(h.kernel.getState().lastMediaHost, A);
  assert.equal(h.events.filter(event => ['request', 'transfer', 'progress'].includes(event.type)).length, 1);
  h.kernel.retry(); assert.equal(h.events.filter(event => event.type === 'recovery-attempt').at(-1).fromHost, A);
  assert.equal(h.kernel.rewriteUrl(media()), media(B), 'bad-only recovery still avoids the real stalled media node');
  h.kernel.destroy();
});

test('media observation preserves PCDN, scheduler, MCDN proxy, IP, Akamai and live request coverage without changing routing', () => {
  const mcdn = 'https://xy1x2x3x4xy.mcdn.bilivideo.cn:486/v1/resource/token?sign=PRIVATE';
  const proxy = 'https://proxy-tf-all-ws.bilivideo.com/?url=' + encodeURIComponent(mcdn);
  const urls = [peer, media('edge.mountaintoys.cn'), media('edge.nexusedgeio.com'), media('edge.ahdohpiechei.com'),
    media('edge.szbdyd.com') + '&xy_usource=' + B, mcdn, proxy, media('192.0.2.10:8443'),
    'https://192.0.2.11/video.mp4', 'https://[2001:db8::1]/video.mp4',
    media('upos-hz-mirrorakam.akamaized.net'), 'https://live.bilivideo.com/live-bvc/live.flv?sign=PRIVATE'];
  for (const raw of urls) {
    const h = harness({ config: { mode: 'force' } });
    const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', raw); xhr.send();
    assert.equal(xhr.openArgs[1], core.createPolicy(h.kernel.getConfig()).route(raw).url, raw);
    const observed = h.events.filter(event => event.type === 'request'); assert.equal(observed.length, 1, raw);
    assert.equal(observed[0].originalUrl, raw); assert.equal(observed[0].url, xhr.openArgs[1]);
    assert.equal(h.kernel.getState().lastMediaHost, new URL(xhr.openArgs[1]).hostname);
    h.kernel.destroy();
  }
});

test('media fetch remains a native response while Request options and Range survive routing', async () => {
  const response = new Response('media bytes', { headers: { 'content-type': 'video/mp4' } });
  response.clone = () => { throw new Error('must not clone media'); };
  const h = harness({ fetch: () => response });
  const caller = new AbortController();
  const input = new Request(peer, { credentials: 'include', headers: { Range: 'bytes=0-99' }, signal: caller.signal });
  const received = await h.scope.fetch(input, { credentials: 'omit', headers: { Range: 'bytes=100-199' } });
  assert.equal(received, response); assert.equal(received.bodyUsed, false);
  assert.equal(h.calls[0].input.url, media()); assert.equal(h.calls[0].input.credentials, 'omit');
  assert.equal(h.calls[0].input.headers.get('range'), 'bytes=100-199');
  caller.abort(); assert.equal(h.calls[0].input.signal.aborted, true);
  assert.equal(await received.text(), 'media bytes'); h.kernel.destroy();
});

test('fetch API responses deliver backup-only additions and retain metadata', async () => {
  const original = new Response(JSON.stringify(payload(media())), { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', etag: 'stale' } });
  Object.defineProperty(original, 'url', { value: 'https://api.bilibili.com/x/player/wbi/playurl' });
  const h = harness({ config: { selection: 'fixed' }, fetch: () => original });
  h.kernel.setConfig({ selection: 'auto' });
  const result = await h.scope.fetch(original.url);
  assert.notEqual(result, original); assert.equal(result.url, original.url); assert.equal(result.headers.has('etag'), false);
  assert.equal((await result.json()).data.dash.video[0].backupUrl.length, 8);
  h.kernel.destroy();
});

test('XHR prepares JSON before existing consumer listeners and preserves JSON reader rules', () => {
  for (const responseType of ['', 'json']) {
    const h = harness(); const xhr = new h.scope.XMLHttpRequest(); let value;
    xhr.addEventListener('load', () => { value = responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText); });
    xhr.open('GET', 'https://api.bilibili.com/x/player/playurl', true); xhr.responseType = responseType; xhr.send(); xhr.finish(payload());
    assert.equal(value.data.dash.video[0].baseUrl, media());
    if (responseType === 'json') assert.throws(() => xhr.responseText, { name: 'InvalidStateError' });
    h.kernel.destroy();
  }
});

test('Dolby and FLAC retain their representation metadata and receive configured audio alternatives', () => {
  for (const flacAsArray of [false, true]) {
    const h = harness();
    const special = { data: { dash: {
      dolby: { type: 1, audio: [{ id: 30250, codecs: 'ec-3', bandwidth: 448000, baseUrl: peer, backupUrl: [media(B)] }] },
      flac: { display: true, audio: { id: 30251, codecs: 'fLaC', bandwidth: 1411200, base_url: peer } }
    } } };
    if (flacAsArray) special.data.dash.flac.audio = [special.data.dash.flac.audio];
    const prepared = h.scope.JSON.parse(JSON.stringify(special));
    const dolby = prepared.data.dash.dolby.audio[0];
    const flac = flacAsArray ? prepared.data.dash.flac.audio[0] : prepared.data.dash.flac.audio;
    assert.equal(dolby.baseUrl, media()); assert.equal(flac.base_url, media());
    assert.deepEqual(dolby.backupUrl, settings.candidatePool.slice(1, 9).map(host => media(host)));
    assert.deepEqual(flac.backup_url, dolby.backupUrl);
    assert.equal(dolby.codecs, 'ec-3'); assert.equal(dolby.bandwidth, 448000);
    assert.equal(flac.codecs, 'fLaC'); assert.equal(flac.bandwidth, 1411200);
    assert.equal(prepared.data.dash.dolby.type, 1); assert.equal(prepared.data.dash.flac.display, true);
    assert.equal(h.events.find(event => event.type === 'payload').original.data.dash.dolby.audio[0].baseUrl, peer);
    h.kernel.destroy();
  }
});

test('nested video_info backup-only audio enrichment reaches fetch consumers and respects fixed mode', async () => {
  const special = { data: { video_info: { dash: {
    dolby: { audio: [{ baseUrl: media() }] }, flac: { audio: { base_url: media() } }
  }, durl: [{ url: media() }] } } };
  for (const selection of ['auto', 'fixed']) {
    const original = new Response(JSON.stringify(special), { headers: { 'content-type': 'application/json' } });
    const h = harness({ config: { selection }, fetch: () => original });
    const response = await h.scope.fetch('https://api.bilibili.com/x/player/wbi/playurl');
    const prepared = await response.json(), info = prepared.data.video_info;
    if (selection === 'auto') {
      assert.notEqual(response, original);
      assert.equal(info.dash.dolby.audio[0].backupUrl.length, 8);
      assert.equal(info.dash.flac.audio.backup_url.length, 8);
      assert.equal(info.durl[0].backup_url.length, 8);
    } else {
      assert.equal(response, original);
      assert.equal(info.dash.dolby.audio[0].backupUrl, undefined);
      assert.equal(info.dash.flac.audio.backup_url, undefined);
      assert.equal(info.durl[0].backup_url, undefined);
    }
    h.kernel.destroy();
  }
});

function probeResponse(tools, bytes = Kernel.constants.PROBE_BYTES) {
  let read = false;
  return { ok: true, status: 200, body: { getReader: () => ({
    async read() { if (read) return { done: true }; read = true; tools.advance(100); return { done: false, value: new Uint8Array(bytes) }; },
    async cancel() {}
  }) } };
}
test('default probes cover every configured node without Range and cache sanitized rankings for six hours', async () => {
  const h = harness({ fetch: (_input, _init, tools) => probeResponse(tools) });
  h.scope.__playinfo__ = payload(); await h.flush();
  assert.equal(h.calls.length, settings.candidatePool.length);
  for (const call of h.calls) { assert.equal(call.init.headers, undefined); assert.equal(call.init.mode, 'cors'); assert.equal(call.init.credentials, 'omit'); }
  assert.equal(h.kernel.getState().probeBytes, settings.candidatePool.length * 768 * 1024); assert.equal(h.kernel.getState().ranking.length, settings.candidatePool.length);
  assert.ok([...h.store.keys()].every(key => key.startsWith(Kernel.constants.RANK_PREFIX)));
  assert.ok(!JSON.stringify([...h.store.values()]).includes('PRIVATE'));
  const cached = harness({ clock: 101000, store: h.store, fetch: () => { throw new Error('must use cache'); } });
  cached.scope.__playinfo__ = payload(); await cached.flush();
  assert.equal(cached.calls.length, 0); assert.equal(cached.kernel.getState().ranking.length, settings.candidatePool.length);
  h.kernel.destroy(); cached.kernel.destroy();
});

test('network reset aborts old probe work and late responses cannot overwrite the new ranking', async () => {
  const delayed = []; let calls = 0;
  const h = harness({ fetch: (_input, _init, tools) => ++calls <= settings.candidatePool.length ? new Promise(resolve => delayed.push(() => resolve(probeResponse(tools)))) : probeResponse(tools) });
  h.scope.__playinfo__ = payload(); await h.flush();
  const oldSignals = h.calls.map(call => call.init.signal);
  h.kernel.resetNetwork(); await h.flush();
  assert.ok(oldSignals.every(signal => signal.aborted)); assert.equal(h.calls.length, settings.candidatePool.length * 2);
  const before = h.kernel.getState();
  for (const deliver of delayed) deliver(); await h.flush();
  const after = h.kernel.getState();
  assert.deepEqual(after.ranking, before.ranking); assert.equal(after.probedAt, before.probedAt);
  assert.equal(after.probeBytes, before.probeBytes); h.kernel.destroy();
});

test('automatic native requests avoid zero-byte failed probes while healthy and fixed routes remain unchanged', async () => {
  const failed = settings.candidatePool[2];
  const h = harness({ fetch: (input, _init, tools) => new URL(input).hostname === failed
    ? Promise.reject(new Error('network')) : probeResponse(tools) });
  h.scope.__playinfo__ = payload(); await h.flush();
  assert.equal(h.kernel.getState().probeSamples.find(sample => sample.host === failed).ok, false);
  const native = new h.scope.XMLHttpRequest(); native.open('GET', media(failed)); native.send();
  assert.equal(new URL(native.openArgs[1]).hostname, h.kernel.getConfig().pcdnHost,
    'a player-held fallback must use the usable automatic target after a zero-byte probe failure');
  assert.equal(h.kernel.rewriteUrl(media(B)), media(B), 'healthy native routes remain unchanged');
  h.kernel.setConfig({ selection: 'fixed', pcdnHost: A });
  assert.equal(h.kernel.rewriteUrl(media(failed)), media(failed), 'fixed bad-only selection keeps its existing policy');
  h.kernel.setConfig({ selection: 'auto', enabled: false });
  assert.equal(h.kernel.rewriteUrl(media(failed)), media(failed));
  h.kernel.destroy();
});

test('a probe timed out after partial transfer remains ranked as slow with exact traffic accounting', async () => {
  const h = harness({ fetch: (_input, init) => {
    let read = false;
    return { ok: true, body: { getReader: () => ({
      async read() {
        if (!read) { read = true; return { done: false, value: new Uint8Array(65536) }; }
        return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('deadline', 'AbortError'))));
      }, async cancel() {}
    }) } };
  } });
  h.scope.__playinfo__ = payload(); await h.flush();
  await h.advance(4000);
  const state = h.kernel.getState();
  assert.equal(state.probing, false); assert.equal(state.ranking.length, settings.candidatePool.length);
  assert.equal(state.probeBytes, settings.candidatePool.length * 65536);
  assert.ok(state.probeSamples.every(sample => sample.ok && sample.timedOut && sample.bytes === 65536 && sample.mbps > 0));
  h.kernel.destroy();
});

test('probe speed includes first-byte latency so a delayed burst cannot outrank faster completion', async () => {
  const Probes = require('../src/page/network-probe.js');
  async function sample(ttfb, bodyMs) {
    let clock = 0;
    const result = await Probes.run({ scope: { setTimeout, clearTimeout, AbortController }, now: () => clock,
      targets: [{ host: A, url: media(A) }], maxBytes: Kernel.constants.PROBE_BYTES,
      fetch: async () => {
        clock += ttfb;
        return { ok: true, status: 200, body: { getReader: () => ({
          read: async () => { clock += bodyMs; return { done: false, value: new Uint8Array(Kernel.constants.PROBE_BYTES) }; },
          cancel: async () => {}
        }) } };
      } });
    return result.samples[0];
  }
  const fast = await sample(100, 900), delayedBurst = await sample(1900, 100);
  assert.equal(fast.bytes, delayedBurst.bytes);
  assert.ok(fast.elapsedMs < delayedBurst.elapsedMs);
  assert.ok(fast.mbps > delayedBurst.mbps, 'ranking speed must include the wait before bytes arrive');
  assert.equal(fast.mbps, Kernel.constants.PROBE_BYTES * 0.008 / fast.elapsedMs);
});

test('disable stops future routing and guards report reload requirements without duplicating interceptors', () => {
  const h = harness(); assert.equal(Kernel.create({ scope: h.scope }), h.kernel);
  h.kernel.setConfig({ enabled: false }); const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', peer);
  assert.equal(xhr.openArgs[1], peer); assert.equal(h.kernel.getState().needReload, true);
  h.kernel.setConfig({ p2pGuard: true }); assert.equal(h.scope.PCDNLoader, undefined);
  h.kernel.destroy(); assert.equal(h.scope.JSON.parse, h.originals.parse); assert.equal(h.scope.XMLHttpRequest.prototype.open, h.originals.open);
  const guarded = harness({ config: { p2pGuard: true } });
  assert.equal(typeof guarded.scope.PCDNLoader, 'function');
  assert.throws(() => new guarded.scope.RTCPeerConnection(), { name: 'NotAllowedError' });
  guarded.kernel.destroy(); assert.equal(guarded.kernel.getState().needReload, true);
});

test('measured races preserve issued signatures, bound Range bytes and route on the first complete winner', async () => {
  const akamai = 'upos-hz-mirrorakam.akamaized.net', bytes = 768 * 1024;
  const issued = `https://${A}/upgcxcode/1/42231991605-1-30080.m4s?sign=UPOS%2Bprivate`;
  const alternate = issued.replace(A, akamai).replace('UPOS', 'AKAMAI');
  const rankKey = Kernel.constants.RANK_PREFIX + Intl.DateTimeFormat().resolvedOptions().timeZone + '|en-US';
  for (const [name, range, loaded, finished, duration, firstStatus, runner, switched] of [
    ['remaining fragment', 'bytes=4096-2101247', 131072, false, 1000, 206, true, true],
    ['next fragment', 'bytes=0-131071', 131072, true, 1000, 206, true, true],
    ['short range and deadline', 'bytes=1024-33791', 0, false, 1000, 206, false, true],
    ['current host stays faster', 'bytes=0-2097151', 1048576, false, 100, 206, true, false],
    ['ignored Range is not a winner', 'bytes=0-1048575', 0, false, 1000, 200, true, true]
  ]) {
    const pending = [], store = new Map([[rankKey, JSON.stringify({ ranking: [A, B], samples: [], at: 100000 })]]);
    const h = harness({ store, fetch: (url, init) => new Promise(resolve => pending.push({ url, init, resolve })) });
    h.scope.__playinfo__ = { dash: { video: [{ id: 120, bandwidth: 9000000, baseUrl: issued, backupUrl: [alternate] }] } };
    const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', issued); xhr.setRequestHeader('Range', range); xhr.send();
    let timeouts = 0; xhr.addEventListener('timeout', () => timeouts++);
    await h.advance(duration); if (loaded) xhr.progress(loaded); if (finished) xhr.complete(loaded);
    assert.equal(h.kernel.testRoutes(), true, name); assert.equal(pending.length, 2, name);
    const [start, end] = range.slice(6).split('-').map(Number), offset = finished ? end + 1 : start + loaded;
    const expectedBytes = finished ? bytes : Math.min(bytes, end - offset + 1), wantedRange = `bytes=${offset}-${offset + expectedBytes - 1}`;
    assert.equal(pending[0].url, alternate, name);
    assert.equal(pending[1].url, issued.replace(A, B), name);
    for (const item of pending) {
      assert.deepEqual(item.init.headers, { Range: wantedRange }, name);
      assert.equal(item.init.credentials, 'omit'); assert.equal(item.init.mode, 'cors');
    }
    const response = status => ({ status, body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(expectedBytes) }) }) } });
    await h.advance(200); pending[0].resolve(response(firstStatus)); await h.flush();
    const early = h.kernel.getState().session;
    assert.equal(early.racing, true, name);
    assert.equal(h.kernel.rewriteUrl(issued), firstStatus === 206 && switched ? alternate : issued, name);
    assert.equal(h.kernel.getConfig().pcdnHost, A, name); assert.equal(timeouts, 0, name);
    assert.equal(xhr.url, issued, 'the race does not end or replace the native request in flight');
    if (runner) { await h.advance(100); pending[1].resolve(response(206)); await h.flush(); }
    else await h.advance(3800);
    const final = h.kernel.getState().session, result = final.lastRace;
    assert.equal(final.racing, false, name); assert.equal(result.switched, switched, name);
    assert.equal(result.winner, firstStatus === 206 ? akamai : B, name);
    assert.equal(result.runnerUp, runner && firstStatus === 206 ? B : null, name);
    assert.ok(result.samples.reduce((sum, item) => sum + item.bytes, 0) <= 2 * bytes, name);
    assert.ok(result.samples.every(item => item.bytes <= bytes && item.elapsedMs <= 4000), name);
    assert.equal(h.kernel.rewriteUrl(issued), switched ? firstStatus === 206 ? alternate : issued.replace(A, B) : issued, name);
    assert.doesNotMatch(JSON.stringify(final), /UPOS|AKAMAI|private|https?:|sign=/); h.kernel.destroy();
  }
});
