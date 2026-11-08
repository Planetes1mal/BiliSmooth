const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const observer = require('../../src/core/media-observer.js');
const url = (id, host = 'upos-sz-mirrorcosov.bilivideo.com') => `https://${host}/upgcxcode/1/${id}.m4s?deadline=123&sign=PRIVATE_${id}`;
const video = (id, extra = {}) => ({ id, base_url: url(id), width: 3840, height: 2160, bandwidth: 9000000, frame_rate: '60000/1001', codecs: 'hev1', codecid: 12, ...extra });

test('DASH metadata is immutable and preserves supplied URL spellings and payload', () => {
  const catalog = observer.create(), payload = { data: { dash: { video: [video(80)], audio: [{ id: 30280, baseUrl: url(30280), bandwidth: 192000, codecs: 'mp4a' }] } } };
  const before = JSON.stringify(payload), tracks = catalog.collect(payload), v = tracks.find(t => t.kind === 'video');
  assert.equal(JSON.stringify(payload), before); assert.equal(v.url, payload.data.dash.video[0].base_url);
  assert.equal(v.fps, 60000 / 1001); assert.equal(v.width, 3840); assert.equal(v.bandwidth, 9000000); assert.equal(v.codecId, 12);
  assert.equal(Object.isFrozen(v), true); assert.equal(Object.isFrozen(v.urls), true); assert.equal(catalog.tracks().length, 2);
});

test('Camel/snake URL aliases and protocol-relative lookups identify the same representation', () => {
  const catalog = observer.create(), raw = '//upos-sz-mirrorcosov.bilivideo.com/upgcxcode/1/v.m4s?sign=PRIVATE';
  catalog.collect({ dash: { video: [video(1, { base_url: raw, baseUrl: raw, backupUrl: [url('camel')], backup_url: [url('snake')] })] } });
  const track = catalog.get(raw); assert.equal(track.url, raw); assert.equal(catalog.get('https:' + raw), track);
  assert.equal(catalog.get(url('camel')), track); assert.equal(catalog.get(url('snake')), track);
  assert.equal(catalog.get(raw + '&different=1'), null); assert.equal(catalog.get(url('camel', 'upos-sz-mirroraliov.bilivideo.com')), null);
});

test('HTTP upgrade is a lookup alias only, not a metadata or payload rewrite', () => {
  const catalog = observer.create(), raw = url(1).replace('https:', 'http:'), item = video(1, { base_url: raw });
  catalog.collect({ dash: { video: [item] } }); assert.equal(item.base_url, raw); assert.equal(catalog.get(url(1)).url, raw);
});

test('Nested known containers support DASH, Dolby, FLAC and multiplexed durl without crawling unrelated objects', () => {
  const catalog = observer.create(); const container = { dash: { video: [video(1)], dolby: { audio: [{ id: 2, base_url: url(2) }] }, flac: { audio: { id: 3, baseUrl: url(3) } } }, durl: [{ order: 1, url: url('mux'), length: 12340, size: 5000000 }] };
  const payload = { data: { result: { data: { video_info: container } } }, unrelated: { dash: { video: [video(99)] } } };
  const tracks = catalog.collect(payload); assert.equal(tracks.length, 4); assert.equal(tracks.filter(t => t.kind === 'audio').length, 2);
  assert.equal(catalog.get(url('mux')).duration, 12.34); assert.equal(catalog.get(url('mux')).bandwidth, 0); assert.equal(catalog.get(url(99)), null);
  const cyclic = { data: payload }; cyclic.result = cyclic; assert.equal(catalog.collect(cyclic).length, 4);
});

test('Requests, not collection order, select separate active video and audio tracks', () => {
  const catalog = observer.create(); catalog.collect({ dash: { video: [video(1), video(2)], audio: [{ id: 3, base_url: url(3) }] } });
  assert.equal(catalog.activeVideo(), null); catalog.request(url(2)); catalog.request(url(3)); assert.equal(catalog.activeVideo().id, 2); assert.equal(catalog.activeAudio().id, 3);
  assert.equal(catalog.request(url(99)), null); assert.equal(catalog.activeVideo().id, 2); catalog.activeVideo(url(3)); assert.equal(catalog.activeVideo().id, 2);
  catalog.activeVideo(null); assert.equal(catalog.activeVideo(), null); assert.equal(catalog.activeAudio().id, 3);
});

test('Resource and alias eviction remain bounded while active tracks survive collection', () => {
  const catalog = observer.create({ limit: 16 }); catalog.collect({ dash: { video: [video('active')], audio: [{ id: 'audio', base_url: url('audio') }] } }); catalog.request(url('active')); catalog.request(url('audio'));
  catalog.collect({ dash: { video: Array.from({ length: 2000 }, (_, i) => video(i)) } });
  assert.equal(catalog.tracks().length, 16); assert.equal(catalog.activeVideo().id, 'active'); assert.equal(catalog.activeAudio().id, 'audio'); assert.equal(catalog.get(url(0)), null); assert.equal(catalog.get(url(1999)), null);
  const capped = observer.create(); capped.collect({ dash: { video: [video('many', { backup_url: Array.from({ length: 2000 }, (_, i) => url('backup-' + i)) })] } });
  assert.equal(capped.tracks()[0].urls.length, 32); assert.equal(capped.get(url('backup-1999')), null);
});

test('New playinfo owns shared aliases without stale-record eviction deleting newer metadata', () => {
  const catalog = observer.create({ limit: 16 }); catalog.collect({ dash: { video: [video(1)] } }); catalog.request(url(1));
  catalog.collect({ dash: { video: [video(1, { codecid: 7, backup_url: [url('new-backup')] })] } }); assert.equal(catalog.get(url(1)).codecId, 7);
  catalog.activeVideo(null); catalog.collect({ dash: { video: Array.from({ length: 15 }, (_, i) => video('other-' + i)) } });
  assert.equal(catalog.get(url(1)).codecId, 7); assert.equal(catalog.get(url('new-backup')).codecId, 7);
});

test('Invalid addresses and unknown numeric metadata do not become playback evidence', () => {
  const catalog = observer.create(); catalog.collect({ dash: { video: [video(1, { base_url: 'javascript:alert(1)' }), video(2, { base_url: 'https://user:secret@cdn.example/v.m4s' }), video(3, { width: -1, height: Infinity, frame_rate: '1/0', bandwidth: 'bad' })] } });
  assert.equal(catalog.tracks().length, 1); const v = catalog.get(url(3)); assert.equal(v.width, 0); assert.equal(v.height, 0); assert.equal(v.fps, 0); assert.equal(v.bandwidth, 0);
});

test('Browser global keeps signatures only in memory, exposes no preparation or routing API, and clear removes aliases', () => {
  const forbidden = () => { throw Error('Observer must not perform network or persistence'); };
  const context = vm.createContext({ URL, localStorage: { getItem: forbidden, setItem: forbidden }, fetch: forbidden, chrome: { storage: { local: { set: forbidden } } } });
  vm.runInContext(fs.readFileSync(require.resolve('../../src/core/media-observer.js'), 'utf8'), context);
  const catalog = context.BiliSmoothCatalog.create(); assert.deepEqual(Object.keys(catalog).sort(), ['activeAudio','activeVideo','clear','collect','get','request','tracks'].sort());
  catalog.collect({ dash: { video: [video(1)] } }); catalog.request(url(1)); assert.ok(catalog.get(url(1)).url.includes('PRIVATE_1')); assert.ok(!catalog.get(url(1)).resourceId.includes('PRIVATE'));
  catalog.clear(); assert.equal(catalog.get(url(1)), null); assert.equal(catalog.activeVideo(), null); assert.equal(catalog.tracks().length, 0);
});

test('delivery sessions retain native signatures, derive only UPOS mirrors and remember requested video demand', () => {
  const Delivery = require('../../src/core/delivery-session.js'), load = require('../support/kernel-harness.cjs');
  const cosov = 'upos-sz-mirrorcosov.bilivideo.com', akamai = 'upos-hz-mirrorakam.akamaized.net', mirror = 'upos-tf-all-hw.bilivideo.com';
  const issued = (host, file, sign) => `https://${host}/upgcxcode/05/91/${file}?os=${host === akamai ? 'akam' : 'cosovbv'}&sign=${sign}%2Bprivate`;
  const rows = [[7, 'avc1.640033', 30064, 4000000, cosov], [12, 'hev1.2.4.L153', 30080, 8000000, cosov], [13, 'av01.0.12M.10', 30120, 9000000, akamai]];
  const videos = rows.map(([codecid, codecs, rep, bandwidth, primary]) => {
    const file = `42231991605-1-${rep}.m4s`, backup = primary === akamai ? cosov : akamai;
    return { id: 120, codecid, codecs, bandwidth, baseUrl: issued(primary, file, 'native'), backupUrl: [issued(backup, file, 'backup')] };
  });
  const audio = { id: 30280, bandwidth: 99000000, baseUrl: issued(cosov, '42231991605-1-30280.m4s', 'audio') };
  const payload = { data: { dash: { video: videos, audio: [audio] } } }, before = JSON.stringify(payload), delivery = Delivery.create();
  delivery.collect(payload); assert.equal(delivery.snapshot().requiredBps, 0);
  for (const item of videos) {
    const rep = delivery.request(item.baseUrl), native = [item.baseUrl, ...item.backupUrl];
    assert.equal(rep.codecId, item.codecid); assert.equal(delivery.snapshot().requiredBps, item.bandwidth);
    for (const raw of native) assert.equal(delivery.addressForHost(item.baseUrl, new URL(raw).hostname), raw);
    const upos = native.find(raw => new URL(raw).hostname === cosov), derived = upos.replace(cosov, mirror);
    assert.equal(delivery.addressForHost(item.baseUrl, mirror), derived); assert.equal(delivery.get(derived), rep);
    assert.equal(delivery.addressForHost(item.baseUrl, 'upos-sz-mirrorakam.akamaized.net'), null);
  }
  delivery.request(videos[0].baseUrl); delivery.request(audio.baseUrl); assert.equal(delivery.snapshot().requiredBps, 9000000);
  const refreshed = structuredClone(payload); refreshed.data.dash.video[2].backupUrl[0] += '&deadline=456';
  delivery.collect(refreshed); assert.equal(delivery.addressForHost(videos[2].baseUrl, cosov), refreshed.data.dash.video[2].backupUrl[0]);
  assert.equal(delivery.snapshot().requiredBps, 9000000); assert.equal(JSON.stringify(payload), before);
  assert.doesNotMatch(JSON.stringify(delivery.snapshot()), /https?:|private|sign=|deadline=/);
  const onlyAkamai = Delivery.create(); onlyAkamai.collect({ dash: { video: [{ ...videos[2], backupUrl: [] }] } });
  assert.equal(onlyAkamai.addressForHost(videos[2].baseUrl, mirror), null, 'Akamai signatures never seed mirror addresses');
  const other = { ...videos[0], baseUrl: videos[0].baseUrl.replace('42231991605', '42242147914'), backupUrl: [] };
  delivery.collect({ dash: { video: [other] } }); delivery.request(other.baseUrl);
  assert.deepEqual([delivery.snapshot().cid, delivery.snapshot().requiredBps], ['42242147914', other.bandwidth]);
  delivery.request(videos[2].baseUrl); assert.equal(delivery.snapshot().requiredBps, 9000000);
  const h = load(); h.scope.__playinfo__ = h.scope.JSON.parse(before);
  for (const item of videos) h.xhr(item.baseUrl);
  const session = h.state().session; h.api.destroy();
  assert.equal(session.requiredBps, 9000000);
  assert.ok(session.representations.every(rep => rep.issuedHosts.length === (rep.kind === 'audio' ? 1 : 2)));
  assert.doesNotMatch(JSON.stringify(session), /https?:|private|sign=/);
});

test('complete video XHR samples expose conservative rates, first-byte timing and bounded recent delivery', () => {
  const throughput = require('../../src/core/throughput.js'), load = require('../support/kernel-harness.cjs');
  const host = 'upos-sz-mirrorcosov.bilivideo.com', MiB = 1024 * 1024;
  const sample = (patch = {}) => ({ host, kind: 'video', transport: 'xhr', outcome: 'complete', hidden: false,
    range: 'bytes=0-131071', bytes: 128 * 1024, elapsedMs: 2000, firstByteMs: 500, completedAt: 2000, ...patch });
  const cases = [
    ...[{ kind: 'audio' }, { transport: 'fetch' }, { outcome: 'aborted' }, { hidden: true }, { bytes: 16383 }]
      .map(patch => ({ name: JSON.stringify(patch), samples: [sample(patch)], expected: [] })),
    { name: '16 KiB is measured but not trusted', samples: [sample({ bytes: 16384 })],
      expected: { goodputBps: null, ttfbMedianMs: 500, recentBytes: 16384, recentMs: 2000, recentBps: 65536 } },
    { name: '128 KiB is trusted and first estimate is bias-corrected', samples: [sample()],
      expected: { goodputBps: 524288, ttfbMedianMs: 500, recentBytes: 131072, recentMs: 2000, recentBps: 524288 } },
    { name: 'first-byte waiting remains in goodput', samples: [sample({ firstByteMs: 1900 })],
      expected: { goodputBps: 524288, ttfbMedianMs: 1900 } },
    { name: 'rising rate uses slower average and aggregates trust', samples: [sample({ bytes: 65536, firstByteMs: 100 }), sample({ completedAt: 4000, firstByteMs: 300 })],
      expected: { goodputBps: 411270.924791, ttfbMedianMs: 200 } },
    { name: 'falling rate uses faster average', samples: [sample(), sample({ bytes: 65536, completedAt: 4000 })],
      expected: { goodputBps: 349525.333333, ttfbMedianMs: 500 } },
    { name: 'longer samples receive duration-based weight', samples: [sample(), sample({ elapsedMs: 4000, completedAt: 6000 })],
      expected: { goodputBps: 299593.142857, ttfbMedianMs: 500 } },
    { name: '4 MiB recent window removes earlier samples', samples: [100, 200, 300, 400, 500].map((firstByteMs, i) => sample({ bytes: MiB, elapsedMs: 1000, firstByteMs, completedAt: (i + 1) * 1000 })),
      expected: { goodputBps: 8388608, ttfbMedianMs: 350, recentBytes: 4 * MiB, recentMs: 4000, recentBps: 8388608 } },
    { name: '8 second recent window removes earlier samples', samples: [100, 200, 300, 400, 500].map((firstByteMs, i) => sample({ firstByteMs, completedAt: (i + 1) * 2000 })),
      expected: { goodputBps: 524288, ttfbMedianMs: 350, recentBytes: 524288, recentMs: 8000, recentBps: 524288 } }
  ];
  for (const { name, samples, expected } of cases) {
    const meter = throughput.create(); samples.forEach(value => meter.record(value)); const rows = meter.snapshot();
    if (Array.isArray(expected)) { assert.deepEqual(rows, expected, name); continue; }
    assert.equal(rows.length, 1, name); assert.equal(rows[0].host, host, name);
    for (const [key, value] of Object.entries(expected)) {
      if (value === null) assert.equal(rows[0][key], null, `${name}: ${key}`);
      else assert.ok(Math.abs(rows[0][key] - value) < 0.001, `${name}: ${key} ${rows[0][key]} != ${value}`);
    }
    const last = samples.at(-1);
    assert.deepEqual(rows[0].lastFragment, { range: last.range, firstByteMs: last.firstByteMs, elapsedMs: last.elapsedMs, completedAt: last.completedAt }, name);
  }
  const media = id => `https://${host}/upgcxcode/1/${id}-1-30080.m4s?sign=PRIVATE`, raw = media(42231991605);
  const payload = address => ({ dash: { video: [{ id: 120, bandwidth: 2000000, baseUrl: address }] } });
  const h = load({ session: true, now: 100000, config: { enabled: false }, payload: payload(raw) });
  for (const hidden of [false, true]) {
    const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', raw); xhr.setRequestHeader('Range', 'bytes=0-131071'); xhr.send();
    h.advance(100); xhr.progress(65536);
    h.document.hidden = hidden; h.document.emit('visibilitychange'); h.advance(900);
    h.document.hidden = false; h.document.emit('visibilitychange'); h.advance(1000); xhr.complete(131072);
  }
  const initial = h.api.getDiagnostics().session.hosts[0];
  assert.equal(initial.goodputBps, 524288); assert.equal(initial.ttfbMedianMs, 100);
  assert.deepEqual(JSON.parse(JSON.stringify(initial.lastFragment)), { range: 'bytes=0-131071', firstByteMs: 100, elapsedMs: 2000, completedAt: 102000 });
  const next = media(42242147914); h.scope.__playinfo__ = payload(next);
  const xhr = h.request(next); h.advance(500); xhr.progress(32768); h.advance(500); xhr.complete(65536);
  const current = h.api.getDiagnostics().session; assert.equal(current.hosts[0].goodputBps, null);
  assert.equal(current.cid, '42242147914'); assert.equal(current.hosts[0].ttfbMedianMs, 500);
  h.request(raw); assert.equal(h.api.getDiagnostics().session.hosts[0].goodputBps, 524288);
  assert.doesNotMatch(JSON.stringify(h.api.getDiagnostics()), /PRIVATE|sign=|https?:/); h.close();

});

test('COSOV hanging, slow and repeated-timeout shapes trigger only their measured decisions', () => {
  const { decide, beatsCurrent } = require('../../src/core/delivery-policy.js');
  const first = 1791477720540, second = 1791477736124, bytes = 2980583, elapsedMs = 10195.7;
  const goodputBps = bytes * 8000 / elapsedMs;
  const base = { requestAgeMs: 0, firstByteMs: 43.1, rangeBytes: 5874782, transferMs: 0, loadedBytes: 0,
    goodputBps: null, remainingMs: null, bufferWallSeconds: 31.112,
    recent: { bytes: 0, elapsedMs: 0, goodputBps: null }, requiredBps: 10133022, now: second, failedAt: [] };
  const slow = { bytes, elapsedMs, goodputBps };
  const delayed = { ...base, loadedBytes: bytes, transferMs: elapsedMs - base.firstByteMs, goodputBps,
    remainingMs: (5874782 - bytes) * 8000 / goodputBps, bufferWallSeconds: 0.480092 };
  // Recorded request values, with explicit decision-boundary variations of those shapes.
  const rows = [
    ['first-play D media-5 hangs without bytes', decide, [{ ...base, requestAgeMs: 2070, firstByteMs: null, bufferWallSeconds: 0 }], 'stuck'],
    ['the later zero-byte wait has buffered playback', decide, [{ ...base, requestAgeMs: 2050, firstByteMs: null, bufferWallSeconds: 9 }], null],
    ['do not trigger the first-byte rule before one second', decide, [{ ...base, requestAgeMs: 999, firstByteMs: null, bufferWallSeconds: 0 }], null],
    ['small COSOV initialization ranges cannot trigger stuck', decide, [{ ...base, requestAgeMs: 2070, firstByteMs: null, rangeBytes: 4503, bufferWallSeconds: 0 }], null],
    ['partial slow timeout exhausts the measured time window', decide, [{ ...base, recent: slow, bufferWallSeconds: 0 }], 'shortfall'],
    ['the same slow transfer with enough buffer is retained', decide, [{ ...base, recent: slow, bufferWallSeconds: 30 }], null],
    ['predicted remainder cannot beat the observed low buffer', decide, [delayed], 'stuck'],
    ['ETA needs enough active transfer time or loaded bytes', decide, [{ ...delayed, transferMs: 499, loadedBytes: 65536 }], null],
    ['half a second supplies the ETA observation time', decide, [{ ...delayed, transferMs: 500, loadedBytes: 65536 }], 'stuck'],
    ['loaded bytes can satisfy ETA observation before half a second', decide, [{ ...delayed, transferMs: 499, loadedBytes: 131072 }], 'stuck'],
    ['remaining transfers within one second keep the current host', decide, [{ ...delayed, remainingMs: 1000 }], null],
    ['a current rate meeting the approved margin is retained', decide, [{ ...delayed, goodputBps: base.requiredBps * 1.3 }], null],
    ['two recorded timeouts occur within thirty seconds', decide, [{ ...base, failedAt: [first, second] }], 'errors'],
    ['the first recorded timeout has left the error window', decide, [{ ...base, now: first + 30001, failedAt: [first, second] }], null],
    ['HW completion beats COSOV estimate for the same retry bytes', beatsCurrent, [2962.9, 5874782 * 8000 / goodputBps], true],
    ['a one-point-five speedup is enough', beatsCurrent, [2000, 3000], true],
    ['a smaller speedup retains the current host', beatsCurrent, [2001, 3000], false]
  ];
  for (const [label, decideResult, args, expected] of rows) assert.equal(decideResult(...args), expected, label);
});
