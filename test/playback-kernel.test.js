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

test('all playback globals preserve native backups while preparing shared media', () => {
  const h = harness();
  for (const name of ['__playinfo__', '__INITIAL_STATE__', '__NEPTUNE_IS_MY_WAIFU__']) {
    h.scope[name] = payload();
    assert.equal(h.scope[name].data.dash.video[0].baseUrl, media());
    assert.equal(h.scope[name].data.dash.video[0].backupUrl.length, 0);
  }
  const parsed = h.scope.JSON.parse(JSON.stringify(payload()));
  assert.equal(parsed.data.dash.video[0].baseUrl, media());
  const observed = h.events.find(event => event.type === 'payload');
  assert.equal(observed.original.data.dash.video[0].baseUrl, peer);
  assert.equal(observed.prepared.data.dash.video[0].baseUrl, media());
  assert.ok(!JSON.stringify(h.kernel.getState()).includes('PRIVATE'));
  h.kernel.destroy();
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
  assert.equal(h.kernel.retry(), false, 'unidentified media cannot create comparison traffic');
  assert.equal(h.kernel.rewriteUrl(media()), media());
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

test('unchanged native metadata responses retain their body and headers', async () => {
  const original = new Response(JSON.stringify(payload(media())), { headers: { 'content-type': 'application/json', 'content-encoding': 'gzip', etag: 'stale' } });
  Object.defineProperty(original, 'url', { value: 'https://api.bilibili.com/x/player/wbi/playurl' });
  const h = harness({ config: { selection: 'fixed' }, fetch: () => original });
  h.kernel.setConfig({ selection: 'auto' });
  const result = await h.scope.fetch(original.url);
  assert.equal(result, original); assert.equal(result.url, original.url); assert.equal(result.headers.get('etag'), 'stale');
  assert.equal((await result.json()).data.dash.video[0].backupUrl.length, 0);
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

test('Dolby and FLAC retain metadata and native audio alternatives', () => {
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
    assert.deepEqual(dolby.backupUrl, [media(B)]);
    assert.equal(flac.backup_url, undefined);
    assert.equal(dolby.codecs, 'ec-3'); assert.equal(dolby.bandwidth, 448000);
    assert.equal(flac.codecs, 'fLaC'); assert.equal(flac.bandwidth, 1411200);
    assert.equal(prepared.data.dash.dolby.type, 1); assert.equal(prepared.data.dash.flac.display, true);
    assert.equal(h.events.find(event => event.type === 'payload').original.data.dash.dolby.audio[0].baseUrl, peer);
    h.kernel.destroy();
  }
});

test('nested native video_info preserves missing backup fields in automatic and fixed modes', async () => {
  const special = { data: { video_info: { dash: {
    dolby: { audio: [{ baseUrl: media() }] }, flac: { audio: { base_url: media() } }
  }, durl: [{ url: media() }] } } };
  for (const selection of ['auto', 'fixed']) {
    const original = new Response(JSON.stringify(special), { headers: { 'content-type': 'application/json' } });
    const h = harness({ config: { selection }, fetch: () => original });
    const response = await h.scope.fetch('https://api.bilibili.com/x/player/wbi/playurl');
    const prepared = await response.json(), info = prepared.data.video_info;
    assert.equal(response, original);
    assert.equal(info.dash.dolby.audio[0].backupUrl, undefined);
    assert.equal(info.dash.flac.audio.backup_url, undefined);
    assert.equal(info.durl[0].backup_url, undefined);
    h.kernel.destroy();
  }
});

test('network reset aborts a race and late winners cannot change the next native request', async () => {
  const pending = [], issued = `https://${A}/upgcxcode/1/42231991605-1-30080.m4s`;
  const h = harness({ fetch: (address, init) => new Promise(resolve => pending.push({ address, init, resolve })) });
  h.scope.__playinfo__ = { dash: { video: [{ id: 80, bandwidth: 9000000, baseUrl: issued, backupUrl: [] }] } };
  assert.equal(h.calls.length, 0);
  const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', issued); xhr.setRequestHeader('Range', 'bytes=0-1048575'); xhr.send();
  await h.advance(1000); assert.equal(h.kernel.testRoutes(), true); const before = h.calls.length;
  h.kernel.resetNetwork(); await h.flush();
  assert.ok(pending.every(item => item.init.signal.aborted)); assert.equal(h.calls.length, before);
  for (const item of pending) item.resolve({ status: 206, body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(786432) }) }) } });
  await h.flush(); const next = h.request(issued);
  assert.equal(new URL(next.url).hostname, A); h.kernel.destroy();
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
  for (const [name, range, loaded, finished, duration, firstStatus, runner, switched, previousGoodput, completesDuringRace] of [
    ['remaining fragment', 'bytes=4096-2101247', 131072, false, 1000, 206, true, true],
    ['next fragment', 'bytes=0-131071', 131072, true, 1000, 206, true, true],
    ['zero-byte hang after healthy fragments', 'bytes=1024-33791', 0, false, 1000, 206, false, true, true],
    ['current host stays faster', 'bytes=0-2097151', 1048576, false, 100, 206, true, false],
    ['ignored Range is not a winner', 'bytes=0-1048575', 0, false, 1000, 200, true, true],
    ['current completes before the winner', 'bytes=0-1048575', 0, false, 1000, 206, true, false, false, true]
  ]) {
    const pending = [], store = new Map();
    store.set('bilismooth.delivery-history.v1.' + Intl.DateTimeFormat().resolvedOptions().timeZone + '|en-US', JSON.stringify({ version: 1,
      rows: [...settings.candidatePool, akamai].map(host => ({ host, meanBps: host === akamai ? 30000000 : host === B ? 20000000 : 1000000,
        weight: 1, measuredAt: 100000, failedAt: 0 })) }));
    const h = harness({ store, globals: { Math: Object.assign(Object.create(Math), { random: () => 0.9 }) },
      fetch: (url, init) => new Promise(resolve => pending.push({ url, init, resolve })) });
    h.scope.__playinfo__ = { dash: { video: [{ id: 120, bandwidth: 9000000, baseUrl: issued, backupUrl: [alternate] }] } };
    assert.equal(pending.length, 0, 'loading the manifest starts no probes');
    if (previousGoodput) {
      const healthy = new h.scope.XMLHttpRequest(); healthy.open('GET', issued); healthy.setRequestHeader('Range', 'bytes=0-131071'); healthy.send();
      await h.advance(20); healthy.progress(131072); healthy.complete(131072);
    }
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
    if (completesDuringRace) { await h.advance(100); xhr.progress(end - start + 1); xhr.complete(end - start + 1); }
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
    if (completesDuringRace) assert.equal(result.verdict, 'current-fastest', name);
    assert.equal(result.winner, firstStatus === 206 ? akamai : B, name);
    assert.equal(result.runnerUp, runner && firstStatus === 206 ? B : null, name);
    assert.ok(result.samples.reduce((sum, item) => sum + item.bytes, 0) <= 2 * bytes, name);
    assert.ok(result.samples.every(item => item.bytes <= bytes && item.elapsedMs <= 4000), name);
    assert.equal(h.kernel.rewriteUrl(issued), switched ? firstStatus === 206 ? alternate : issued.replace(A, B) : issued, name);
    assert.doesNotMatch(JSON.stringify(final), /UPOS|AKAMAI|private|https?:|sign=/); h.kernel.destroy();
  }
});

test('measured routing retains healthy fragments, bounds switching and preserves native retry paths', async () => {
  const C = settings.candidatePool[2], D = settings.candidatePool[3], cid = '42231991605';
  const url = (host = A, id = '30080', video = cid) => `https://${host}/upgcxcode/1/${video}-1-${id}.m4s?sign=PRIVATE`;
  const range = index => `bytes=${index * 1048576}-${(index + 1) * 1048576 - 1}`;
  const manifest = (video = cid) => ({ dash: { video: ['30080', '30112'].map(id => ({ id: Number(id), bandwidth: 9000000,
    baseUrl: url(A, id, video), backupUrl: [B, C, D].map(host => url(host, id, video)) })),
    audio: [{ id: 30280, bandwidth: 128000, baseUrl: url(A, '30280', video), backupUrl: [B, C, D].map(host => url(host, '30280', video)) }] } });
  for (const scenario of ['cooldown', 'no-switch cooldown', 'four-switch limit', 'healthy fragment', 'video retry', 'audio retry', 'missing runner-up']) {
    const pending = [], store = new Map();
    store.set('bilismooth.delivery-history.v1.' + Intl.DateTimeFormat().resolvedOptions().timeZone + '|en-US', JSON.stringify({ version: 1,
      rows: settings.candidatePool.map(host => ({ host, meanBps: host === B ? 40000000 : host === C ? 30000000 : host === D ? 20000000 : 1000000,
        weight: 1, measuredAt: 100000, failedAt: 0 })) }));
    const h = harness({ store, globals: { Math: Object.assign(Object.create(Math), { random: () => 0.9 }) },
      fetch: (address, init) => new Promise(resolve => pending.push({ address, init, resolve })) });
    h.scope.__playinfo__ = manifest();
    const open = (address = url(), requestedRange = range(0)) => {
      const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', address); xhr.setRequestHeader('Range', requestedRange); xhr.send(); return xhr;
    };
    const routed = (host, requestedRange, id = '30080', expected = host) => {
      const xhr = open(url(host, id), requestedRange); assert.equal(new URL(xhr.url).hostname, expected, scenario); xhr.cancel();
    };
    const compare = async (trigger = 'manual', hasRunner = true) => {
      const before = pending.length; assert.equal(h.kernel.testRoutes({ trigger }), true, scenario);
      assert.equal(pending.length - before, 2, scenario);
      const response = (item, status) => { const [start, end] = item.init.headers.Range.slice(6).split('-').map(Number);
        return { status, body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(end - start + 1) }) }) } }; };
      await h.advance(200); pending[before].resolve(response(pending[before], 206)); await h.flush();
      await h.advance(100); pending[before + 1].resolve(response(pending[before + 1], hasRunner ? 206 : 503)); await h.flush();
      return new URL(pending[before].address).hostname;
    };
    const blocked = trigger => { const before = pending.length; assert.equal(h.kernel.testRoutes({ trigger }), false, scenario); assert.equal(pending.length, before, scenario); };
    if (scenario === 'cooldown' || scenario === 'no-switch cooldown') {
      const xhr = open(url(), 'bytes=0-2097151');
      await h.advance(scenario === 'cooldown' ? 1000 : 100); if (scenario === 'no-switch cooldown') xhr.progress(1048576);
      const winner = await compare(); routed(A, range(10), '30080', scenario === 'cooldown' ? winner : A);
      await h.advance(9899); blocked('manual'); await h.advance(1);
      xhr.cancel(); const next = open(url(), 'bytes=3145728-5242879');
      if (scenario === 'no-switch cooldown') { await h.advance(100); next.progress(1048576); }
      await compare('errors'); await h.advance(19899); blocked('errors'); await h.advance(1); await compare('errors');
      await h.advance(9900); blocked('errors'); await compare('manual');
    } else if (scenario === 'four-switch limit') {
      for (let index = 0; index < 4; index++) {
        const xhr = open(url(), range(index)); await h.advance(index ? 10000 : 1000);
        const winner = await compare(); routed(A, range(index + 10), '30080', winner); xhr.cancel();
      }
      await h.advance(80000); blocked('manual'); blocked('errors');
      h.scope.__playinfo__ = manifest('42242147914'); open(url(A, '30080', '42242147914')); await h.advance(1000); await compare();
      h.scope.__playinfo__ = manifest(); blocked('manual');
    } else if (scenario === 'healthy fragment') {
      const healthy = open(); await h.advance(20); healthy.progress(131072); healthy.complete(131072);
      const hanging = open(url(), range(1)); await h.advance(1000); const winner = await compare('stuck');
      routed(A, range(1), '30080', winner); routed(winner, range(2), '30080', A); routed(winner, range(1), '30112', A); hanging.cancel();
      await h.advance(10000); open(url(winner), range(3)); await h.advance(1000); const nextWinner = await compare('stuck');
      routed(A, range(4), '30080', nextWinner);
    } else {
      const xhr = open(); await h.advance(1000); const winner = await compare('manual', scenario !== 'missing runner-up'); xhr.cancel();
      const id = scenario === 'audio retry' ? '30280' : '30080', failed = open(url(A, id), range(5));
      assert.equal(new URL(failed.url).hostname, winner, scenario); failed.expire();
      const retry = open(url(D, id), range(5)); assert.equal(new URL(retry.url).hostname, scenario === 'missing runner-up' ? D : C, scenario);
      if (scenario !== 'missing runner-up') {
        retry.expire(); h.kernel.setConfig({ mode: 'force' }); routed(D, range(5), id, D);
      }
    }
    h.kernel.destroy();
  }
});

test('recorded burst-and-stall fragments constrain the current host race estimate', async () => {
  const akamai = 'upos-hz-mirrorakam.akamaized.net', pending = [];
  const issued = media(akamai).replace('video.m4s', '42573040983-1-30112.m4s');
  const h = harness({ fetch: (url, init) => new Promise(resolve => pending.push({ url, init, resolve })) });
  h.scope.__playinfo__ = { dash: { video: [{ id: 112, bandwidth: 3898599, baseUrl: issued, backupUrl: [issued.replace(akamai, A)] }] } };
  let offset = 0;
  for (const [bytes, elapsed, complete] of [[2763619, 886, true], [1276174, 1278.9, true], [952787, 2253.9, true],
    [239394, 5002.6, false], [755784, 5276.4, false], [961646, 5275.9, false], [1338478, 5276.1, false], [3649985, 2741, true]]) {
    const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', issued); xhr.setRequestHeader('Range', `bytes=${offset}-${offset + 4194303}`); xhr.send();
    await h.advance(elapsed); xhr.progress(bytes); if (complete) xhr.complete(bytes); else xhr.expire(bytes);
    offset += 4194304;
  }
  const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', issued); xhr.setRequestHeader('Range', 'bytes=127298111-130175184'); xhr.send();
  await h.advance(1679.5); xhr.progress(1806801);
  assert.equal(h.kernel.testRoutes({ trigger: 'errors' }), true);
  const measured = h.kernel.getState().session;
  assert.ok(Math.abs(measured.hosts[0].recentBps - 4977822.903543) < 0.01);
  assert.ok(Math.abs(measured.lastRace.currentMs - 1263.897114) < 0.01);
  await h.advance(1881.5);
  pending[0].resolve({ status: 206, body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(786432) }) }) } });
  await h.flush();
  assert.equal(h.kernel.getState().session.lastRace.verdict, 'current-fastest');
  h.kernel.destroy();
});
