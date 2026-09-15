// Product behavior contracts: expected outcomes are explicit; no archived runtime is executed.
const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../src/core/settings.js');
const policy = require('../src/core/routing-policy.js');
const probe = require('../src/page/network-probe.js');
const load = require('./kernel-harness.cjs');
const A = 'upos-sz-mirrorcosov.bilivideo.com', B = 'upos-sz-mirroraliov.bilivideo.com';
const C = 'upos-tf-all-tx.bilivideo.com';
const media = host => `https://${host}/upgcxcode/21/video.m4s?token=PRIVATE`;
const peer = media('upos-sz-302ppio.bilivideo.com');
const payload = () => ({ data: { dash: { video: [{ id: 120, baseUrl: peer, backupUrl: [] }] } } });
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

test('settings v4 is the single default authority and cannot be replaced by an unvalidated route pool', () => {
  assert.deepEqual(Object.keys(policy).sort(), ['addressForHost', 'createPolicy']);
  const config = settings.normalize({ pcdnHost: 'attacker.test', candidatePool: ['attacker.test'], maxDepth: 9000 });
  assert.equal(config.schemaVersion, 4);
  assert.equal(config.pcdnHost, A);
  assert.deepEqual(config.candidatePool, settings.candidatePool);
  assert.equal(config.candidatePool.length, 9);
  assert.equal(config.maxDepth, 20);
});

test('restricted routing replaces shared delivery addresses while preserving healthy, live and analytics URLs', () => {
  const route = policy.createPolicy({ selection: 'fixed', pcdnHost: B }).route;
  for (const host of ['upos-sz-302ppio.bilivideo.com', 'upos-sz-mirror14b.bilivideo.com',
    'node.mountaintoys.cn', 'node.nexusedgeio.com', 'node.ahdohpiechei.com', '192.0.2.1:8443', '[2001:db8::1]']) {
    assert.equal(route(media(host)).url, media(B), host);
  }
  const analytics = 'https://data.bilibili.com/log?media=' + encodeURIComponent(peer);
  for (const url of [media(A), media('upos-hz-mirrorakam.akamaized.net'), analytics,
    'https://node.mcdn.bilivideo.cn:443/live-bvc/1/live.flv?os=mcdn']) {
    assert.equal(route(url).url, url);
  }
  assert.equal(route(new URL(peer)).url, media(B));
  assert.equal(route('//node.mountaintoys.cn/upgcxcode/21/video.m4s?token=PRIVATE').url, media(B));
});

test('compatibility relay all, resource-format-only and direct modes retain their distinct wire behavior', () => {
  const resource = 'https://node.mcdn.bilivideo.cn:486/v1/resource/video.m4s?sign=x';
  const ordinary = 'https://node.mcdn.bilivideo.cn:486/upgcxcode/21/video.m4s?token=PRIVATE';
  const relay = url => 'https://proxy-tf-all-ws.bilivideo.com/?url=' + encodeURIComponent(url);
  const all = policy.createPolicy({ mcdnStrategy: 'proxy-all' });
  assert.equal(all.route(resource).url, relay(resource));
  assert.equal(all.route(ordinary).url, relay(ordinary));
  assert.equal(all.route(relay(resource)).url, relay(resource), 'do not wrap an existing relay twice');
  const format = policy.createPolicy({ mcdnStrategy: 'proxy-v1' });
  assert.equal(format.route(resource).url, relay(resource));
  assert.equal(format.route(ordinary).url, media(A));
  assert.equal(policy.createPolicy({ mcdnStrategy: 'replace' }).route(resource).url,
    'https://' + A + '/v1/resource/video.m4s?sign=x');
});

test('scheduler source, alternate ports and international inclusion have independent switches', () => {
  const scheduled = media('node.szbdyd.com') + '&xy_usource=' + B;
  assert.equal(policy.createPolicy({}).route(scheduled).url, media(B) + '&xy_usource=' + B);
  const unusual = media(A + ':8443');
  assert.equal(policy.createPolicy({ pcdnHost: B }).route(unusual).url, media(B));
  assert.equal(policy.createPolicy({ pcdnHost: B, portHeuristic: false }).route(unusual).url, unusual);
  const international = media('upos-hz-mirrorakam.akamaized.net');
  assert.equal(policy.createPolicy({ rewriteAkamai: true }).route(international).url, media(A));
  assert.equal(policy.createPolicy({ mode: 'force', pcdnHost: B }).route(media(A)).url, media(B));
  assert.equal(policy.createPolicy({ mode: 'force', pcdnHost: B }).route(international).url, media(B));
  for (const config of [{ enabled: false }, { mode: 'off' }]) assert.equal(policy.createPolicy(config).route(peer).url, peer);
});

test('delivery rendering preserves signed resource spelling and encodes the relay envelope once', () => {
  const source = 'http://name:pass@192.0.2.2:8443/upgcxcode/a%2Fb.m4s?sig=a%2Bb%20c&empty=#';
  assert.equal(policy.addressForHost(source, B), 'https://name:pass@' + B + '/upgcxcode/a%2Fb.m4s?sig=a%2Bb%20c&empty=#');
  assert.equal(policy.addressForHost('https://old.test/video.m4s?', B + ':443'), 'https://' + B + '/video.m4s?');
  assert.throws(() => policy.addressForHost(source, 'other.test/path'));
  const raw = 'https://node.mcdn.bilivideo.cn/v1/resource/a.m4s?sig=a%2Bb%20c';
  const resolved = policy.createPolicy({ mode: 'force', mcdnStrategy: 'proxy-all' }).route(raw).url;
  assert.equal(new URL(resolved).searchParams.get('url'), raw);
  assert.equal(policy.createPolicy({}).route(resolved).url, resolved);
});

test('overlapping address facts admit independent intents with an authoritative source preference', () => {
  const raw = media('node.szbdyd.com') + '&os=mcdn&xy_usource=' + C;
  const configured = policy.createPolicy({ mode: 'force', pcdnHost: B });
  assert.equal(configured.describe(raw).shared, true);
  assert.equal(configured.describe(raw).scheduler, true);
  assert.equal(new URL(configured.route(raw).url).hostname, C);
  assert.equal(configured.route(raw).reason, 'scheduler-source');
});

test('manifest preparation preserves quality metadata, input objects and mixed address field conventions', () => {
  const input = { result: { video_info: { quality: 120, accept_quality: [120, 116, 80], dash: {
    video: [{ id: 120, width: 3840, height: 2160, codecs: 'hev1.2.4.L153', baseUrl: peer, base_url: peer, backupUrl: [], backup_url: [] }],
    audio: [{ id: 30280, base_url: peer }], dolby: { type: 1, audio: [{ id: 30250, codecs: 'ec-3', baseUrl: peer }] },
    flac: { display: true, audio: { id: 30251, codecs: 'fLaC', base_url: peer } }
  }, durl: [{ order: 1, length: 3000, url: peer.replace('m4s', 'mp4'), backup_url: [] }] } } };
  const before = JSON.stringify(input);
  const result = policy.createPolicy({}).prepare(input, { ranking: [C, B, A] });
  assert.equal(result.changed, true);
  assert.equal(JSON.stringify(input), before);
  const info = result.value.result.video_info, video = info.dash.video[0];
  assert.equal(video.baseUrl, media(A)); assert.equal(video.base_url, media(A));
  assert.deepEqual(video.backupUrl, [media(C), media(B)]);
  assert.deepEqual(video.backup_url, video.backupUrl);
  assert.deepEqual(info.accept_quality, [120, 116, 80]);
  assert.equal(info.quality, 120); assert.equal(video.id, 120); assert.equal(video.width, 3840);
  assert.equal(video.height, 2160); assert.equal(video.codecs, 'hev1.2.4.L153');
  for (const entry of [info.dash.audio[0], info.dash.flac.audio]) assert.deepEqual(entry.backup_url, video.backupUrl);
  assert.deepEqual(info.dash.dolby.audio[0].backupUrl, video.backupUrl);
  assert.equal(info.dash.dolby.audio[0].codecs, 'ec-3'); assert.equal(info.dash.flac.audio.codecs, 'fLaC');
  assert.equal(info.durl[0].length, 3000);
  assert.deepEqual(info.durl[0].backup_url, [media(C).replace('m4s', 'mp4'), media(B).replace('m4s', 'mp4')]);
});

test('backup additions retain existing alternatives, deduplicate and obey fixed-selection behavior', () => {
  const input = { data: { dash: { video: [{ baseUrl: media(A), backupUrl: [media(B), 'https://cdn.example/video.m4s'] }] } } };
  const prepared = policy.createPolicy({}).prepare(input, { ranking: [B, C] }).value;
  assert.deepEqual(prepared.data.dash.video[0].backupUrl, [media(B), media(C), 'https://cdn.example/video.m4s']);
  assert.equal(policy.createPolicy({ selection: 'fixed' }).prepare(input).value, input);
  const disabled = policy.createPolicy({ enabled: false }).prepare(payload());
  assert.equal(disabled.changed, false); assert.equal(disabled.value.data.dash.video[0].baseUrl, peer);
});

test('live manifests can remove shared alternatives only when another usable address survives', () => {
  const slow = { host: 'https://node.mcdn.bilivideo.cn:486', extra: '?os=mcdn' };
  const healthy = { host: 'https://d1--cn-gotcha208.bilivideo.com', extra: '?token=PRIVATE' };
  const prepare = entries => policy.createPolicy({}).prepare({ data: { base_url: '/live-bvc/123/live.flv', url_info: entries } });
  assert.deepEqual(prepare([slow, healthy]).value.data.url_info, [healthy]);
  assert.deepEqual(prepare([slow]).value.data.url_info, [slow]);
  assert.deepEqual(prepare([slow, { ...slow }]).value.data.url_info, [slow, slow]);
  assert.equal(prepare([slow, healthy]).value.data.base_url, '/live-bvc/123/live.flv');
});

test('unrelated JSON is untouched and changed cyclic objects retain their graph without prototype mutation', () => {
  const arbitrary = { count: 3, name: 'ordinary' };
  assert.equal(policy.createPolicy({}).prepare(arbitrary).value, arbitrary);
  const input = JSON.parse('{"__proto__":{"baseUrl":"' + peer + '"}}'); input.self = input;
  const result = policy.createPolicy({}).prepare(input).value;
  assert.notEqual(result, input); assert.equal(result.self, result);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(result.__proto__.baseUrl, media(A)); assert.equal(input.__proto__.baseUrl, peer);
});

test('existing and later playback globals plus JSON revivers use the same independent preparation contract', () => {
  for (const name of ['__playinfo__', '__INITIAL_STATE__', '__NEPTUNE_IS_MY_WAIFU__']) {
    const h = load({ config: { selection: 'fixed' }, globals: { [name]: payload() } });
    assert.equal(h.scope[name].data.dash.video[0].baseUrl, media(A));
    h.scope[name] = payload(); assert.equal(h.scope[name].data.dash.video[0].baseUrl, media(A));
    h.api.destroy();
  }
  const h = load({ config: { selection: 'fixed' } });
  const parsed = h.scope.JSON.parse(JSON.stringify(payload()), (key, value) => key === 'id' ? 999 : value);
  assert.equal(parsed.data.dash.video[0].id, 999); assert.equal(parsed.data.dash.video[0].baseUrl, media(A));
  h.api.destroy();
});

test('binary fetch string, URL and Request inputs retain native bodies and request options', async () => {
  for (const kind of ['string', 'url', 'request']) {
    const response = new Response('BINARY', { headers: { 'content-type': 'video/mp4' } });
    response.clone = () => { throw Error('A media response must never be cloned'); };
    const h = load({ config: { selection: 'fixed' }, fetch: () => response });
    const controller = new AbortController();
    const input = kind === 'string' ? peer : kind === 'url' ? new URL(peer) :
      new Request(peer, { headers: { Range: 'bytes=10-20' }, credentials: 'omit', signal: controller.signal });
    const result = await h.scope.fetch(input, { cache: 'no-store' });
    assert.equal(result, response); assert.equal(response.bodyUsed, false);
    const call = h.calls.at(-1), effective = new Request(call.input, call.init);
    assert.equal(effective.url, media(A)); assert.equal(effective.cache, 'no-store');
    if (kind === 'request') { assert.equal(effective.headers.get('range'), 'bytes=10-20'); assert.equal(effective.credentials, 'omit'); controller.abort(); assert.equal(effective.signal.aborted, true); }
    assert.equal(await result.text(), 'BINARY'); h.api.destroy();
  }
});

test('transformed metadata responses keep native clone and independent body consumption semantics', async () => {
  const source = new Response(JSON.stringify(payload()), { status: 202, statusText: 'Accepted', headers: { 'content-type': 'application/json', etag: 'old', 'content-length': '1', 'x-server': 'unchanged' } });
  Object.defineProperties(source, { url: { value: 'https://api.bilibili.com/x/player/playurl' }, redirected: { value: true }, type: { value: 'cors' } });
  const h = load({ config: { selection: 'fixed' }, fetch: () => source });
  const result = await h.scope.fetch(source.url), copy = result.clone(), secondCopy = copy.clone();
  for (const response of [result, copy, secondCopy]) {
    assert.equal(response instanceof Response, true); assert.equal(response.url, source.url); assert.equal(response.status, 202);
    assert.equal(response.statusText, 'Accepted'); assert.equal(response.redirected, true); assert.equal(response.type, 'cors');
    assert.equal(response.headers.get('x-server'), 'unchanged'); assert.equal(response.headers.has('etag'), false); assert.equal(response.headers.has('content-length'), false);
    assert.equal((await response.json()).data.dash.video[0].baseUrl, media(A));
    assert.throws(() => response.clone(), TypeError);
  }
  h.api.destroy();
});

test('completed XHR readers restore on destroy and reused XHR objects cannot leak the previous transformed body', () => {
  const h = load({ config: { selection: 'fixed' } });
  const address = 'https://api.bilibili.com/x/player/playurl';
  const xhr = h.xhr(address, { text: JSON.stringify(payload()), complete: true });
  assert.equal(JSON.parse(xhr.responseText).data.dash.video[0].baseUrl, media(A));
  xhr.open('GET', address); xhr.send(); xhr.status = 200; xhr.text = '{"data":{"unrelated":true}}'; xhr.readyState = 4;
  xhr.emit('load'); xhr.emit('loadend', { loaded: xhr.text.length });
  assert.deepEqual(JSON.parse(xhr.responseText), { data: { unrelated: true } });
  h.api.destroy();
  assert.equal(Object.hasOwn(xhr, 'response'), false); assert.equal(Object.hasOwn(xhr, 'responseText'), false);
  assert.equal(h.scope.XMLHttpRequest.prototype.open, h.native.open);
});

test('synchronous XHR reuse retains the completed body evidence before native fields reset', () => {
  for (const event of ['readystatechange', 'load']) {
    const h = load({ config: { selection: 'fixed' } });
    const xhr = new h.scope.XMLHttpRequest();
    xhr.addEventListener(event, () => { if (xhr.readyState === 4) { xhr.open('GET', media(B)); xhr.send(); } });
    xhr.open('GET', peer); xhr.send(); xhr.status = 200; xhr.responseURL = media(A);
    xhr.emit('progress', { loaded: 256 }); xhr.readyState = 4; xhr.emit(event);
    const completed = h.events.filter(value => value.type === 'transfer' && value.outcome === 'complete');
    assert.equal(completed.length, 1, event);
    assert.equal(completed[0].id, h.events.find(value => value.type === 'request').id);
    assert.equal(completed[0].bytes, 256); assert.equal(completed[0].responseUrl, media(A));
    assert.equal(completed[0].complete, true); assert.equal(xhr.url, media(B));
    h.api.destroy();
  }
});

test('lightweight kernel flags expose only current reload and probe state', () => {
  const h = load();
  assert.deepEqual(plain(h.api.getFlags()), { needReload: false, probing: false });
  h.api.setConfig({ enabled: false });
  assert.deepEqual(plain(h.api.getFlags()), { needReload: true, probing: false });
  assert.equal(h.api.getFlags().needReload, h.api.getState().needReload);
  const changed = h.api.getFlags(); changed.needReload = false;
  assert.equal(h.api.getFlags().needReload, true);
  h.api.destroy();
});

test('protected capability slots remain inert when a later page publisher assigns SDKs or peer constructors', () => {
  let initialized = 0;
  const h = load({ config: { p2pGuard: true } });
  for (const name of ['PCDNLoader', 'BPP2PSDK', 'SeederSDK']) {
    const gate = h.scope[name];
    h.scope[name] = function Publisher() { initialized++; };
    assert.equal(h.scope[name], gate);
    const instance = new h.scope[name]();
    assert.equal(instance instanceof gate, true);
    assert.equal(instance.on('ready', () => initialized++), undefined);
  }
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']) {
    const gate = h.scope[name]; h.scope[name] = function Publisher() { initialized++; };
    assert.equal(h.scope[name], gate); assert.throws(() => new h.scope[name](), { name: 'NotAllowedError' });
  }
  assert.equal(initialized, 0); h.api.destroy(); assert.equal(h.api.getFlags().needReload, true);
});

test('fresh rank cache suppresses probing; expired or corrupt timestamps produce one bounded round', async () => {
  for (const age of [5 * 3600000, 6 * 3600000 + 1, 'corrupt']) {
    const h = load({ storageGet: (key, now) => /rank/i.test(key) ? JSON.stringify({ ranking: [C], at: age === 'corrupt' ? 'bad-time' : now - age }) : null,
      fetch: () => ({ ok: false, status: 403, body: { cancel() {} } }) });
    h.scope.__playinfo__ = payload(); await h.flush();
    assert.equal(h.calls.length, age === 5 * 3600000 ? 0 : settings.candidatePool.length);
    if (age === 5 * 3600000) assert.equal(h.config().pcdnHost, C);
    h.scope.__playinfo__ = payload(); await h.flush();
    assert.equal(h.calls.length, age === 5 * 3600000 ? 0 : settings.candidatePool.length, 'a second manifest must not duplicate this round');
    h.api.destroy();
  }
});

test('probe cancellation settles even when fetch or body ignores abort, and discarded rounds cannot report success', async () => {
  for (const stage of ['fetch', 'body']) {
    const timers = new Map(), controller = new AbortController(), samples = [];
    let cancelled = 0, calls = 0, late;
    const scope = { AbortController, performance: { now: () => 100 }, setTimeout: fn => { timers.set(1, fn); return 1; }, clearTimeout: id => timers.delete(id) };
    const stuck = new Promise(resolve => { late = resolve; });
    const request = probe.run({ scope, targets: [{host:A,url:media(A)}], signal: controller.signal, onSample: sample => samples.push(sample),
      fetch: () => { calls++; return stage === 'fetch' ? stuck : { ok: true, status: 200, body: { getReader: () => ({ read: () => stuck, cancel: () => { cancelled++; } }) } }; } });
    await flush(); controller.abort();
    const result = await request;
    assert.equal(calls, 1); assert.equal(result.samples[0].ok, false); assert.equal(result.samples[0].error, 'cancelled');
    assert.equal(result.totalBytes, 0); assert.equal(samples.length, 1); assert.equal(timers.size, 0);
    assert.equal(cancelled, stage === 'body' ? 1 : 0);
    late(stage === 'fetch' ? { ok: true, status: 200 } : { value: new Uint8Array(100), done: false }); await flush();
    assert.equal(samples.length, 1); assert.equal(result.totalBytes, 0);
  }
});

test('probe traffic is actual body bytes and stops at the first chunk reaching the budget', async () => {
  let time = 0, reads = 0, cancels = 0;
  const calls = [];
  const scope = { AbortController, performance: { now: () => time }, setTimeout: () => 1, clearTimeout() {} };
  const result = await probe.run({ scope, targets: [A,A,B].map(host=>({host,url:media(host)})), maxBytes: 100,
    fetch: (url, options) => { calls.push({ url, options }); time += 5; return { ok: true, status: 200, body: { getReader: () => ({
      read: async () => { reads++; time += 10; return { done: false, value: new Uint8Array(64) }; }, cancel: () => { cancels++; }
    }) } }; } });
  assert.equal(calls.length, 2); assert.equal(reads, 4); assert.equal(cancels, 2); assert.equal(result.totalBytes, 256);
  assert.ok(result.samples.every(sample => sample.ok && sample.bytes === 128 && sample.mbps > 0));
  for (const call of calls) { assert.equal(call.options.headers, undefined); assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.method, 'GET'); }
});

test('empty successful probe responses cannot rank a CDN that delivered no media bytes', async () => {
  for (const response of [new Response(null, { status: 204 }), new Response('', { status: 200 }), new Response('MEDIA', { status: 200 })]) {
    const result = await probe.run({ targets: [{ host: A, url: media(A) }], fetch: () => response });
    const sample = result.samples[0];
    assert.equal(sample.ok, sample.bytes > 0);
    if (!sample.bytes) { assert.equal(sample.ttfb, null); assert.equal(sample.mbps, 0); assert.equal(sample.error, 'empty-body'); }
    else { assert.equal(sample.bytes, 5); assert.equal(sample.error, ''); }
  }
});
