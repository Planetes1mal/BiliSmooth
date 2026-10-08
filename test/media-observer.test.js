const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const observer = require('../src/core/media-observer.js');
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
  vm.runInContext(fs.readFileSync(require.resolve('../src/core/media-observer.js'), 'utf8'), context);
  const catalog = context.BiliSmoothCatalog.create(); assert.deepEqual(Object.keys(catalog).sort(), ['activeAudio','activeVideo','clear','collect','get','request','tracks'].sort());
  catalog.collect({ dash: { video: [video(1)] } }); catalog.request(url(1)); assert.ok(catalog.get(url(1)).url.includes('PRIVATE_1')); assert.ok(!catalog.get(url(1)).resourceId.includes('PRIVATE'));
  catalog.clear(); assert.equal(catalog.get(url(1)), null); assert.equal(catalog.activeVideo(), null); assert.equal(catalog.tracks().length, 0);
});

test('delivery sessions retain native signatures, derive only UPOS mirrors and remember requested video demand', () => {
  const Delivery = require('../src/core/delivery-session.js'), load = require('./support/kernel-harness.cjs');
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
