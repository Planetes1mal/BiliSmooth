// The Servers page quality label: which of the current video's qualities a measured speed likely covers.
import test from 'node:test';
import assert from 'node:assert/strict';
import Delivery from '../../src/core/delivery-session.js';
import { videoQualities, qualityFit, QUALITY_HEADROOM } from '../../src/ui/shared/playback.js';
import { qualityName } from '../../src/ui/shared/format.js';

const host = 'upos-sz-mirrorcosov.bilivideo.com';
const file = (id, codecid, bandwidth, height) => ({ id, codecid, bandwidth, height, codecs: codecid === 7 ? 'avc1' : 'hev1',
  baseUrl: `https://${host}/upgcxcode/1/42231991605-1-${id}${codecid}.m4s?sign=private` });
const payload = { data: { dash: {
  video: [file(120, 12, 12e6, 2160), file(80, 7, 3e6, 1080), file(80, 12, 2e6, 1080), file(64, 7, 1.5e6, 720), file(64, 12, 1e6, 720)],
  audio: [{ id: 30280, bandwidth: 320000, baseUrl: `https://${host}/upgcxcode/1/42231991605-1-30280.m4s?sign=private` }] } } };

test('qualities come from the session snapshot: the requested codec, best first, video only', () => {
  const delivery = Delivery.create();
  delivery.collect(payload);
  assert.deepEqual(videoQualities(delivery.snapshot()), [
    { id: 120, height: 2160, bandwidth: 12e6, current: false },
    { id: 80, height: 1080, bandwidth: 3e6, current: false },
    { id: 64, height: 720, bandwidth: 1.5e6, current: false }], 'nothing requested yet: the highest bit rate of each quality');
  delivery.request(payload.data.dash.video[2].baseUrl);
  delivery.request(payload.data.dash.audio[0].baseUrl);
  assert.deepEqual(videoQualities(delivery.snapshot()), [
    { id: 120, height: 2160, bandwidth: 12e6, current: false },
    { id: 80, height: 1080, bandwidth: 2e6, current: true },
    { id: 64, height: 720, bandwidth: 1e6, current: false }], 'HEVC requested: HEVC bit rates, the requested quality is current');
  delivery.request(payload.data.dash.video[1].baseUrl);
  assert.deepEqual(videoQualities(delivery.snapshot()).map(row => [row.id, row.bandwidth, row.current]),
    [[120, 12e6, false], [80, 3e6, true], [64, 1.5e6, false]], 'AVC requested: 4K has no AVC file and keeps its own bit rate');
  assert.deepEqual(videoQualities(null), []);
  assert.deepEqual(videoQualities({ representations: [{ id: 1, kind: 'muxed', bandwidth: 0 }, { id: 2, kind: 'video', bandwidth: 0 }] }), []);
});

test('a speed covers a quality from bit rate × rate × headroom; below the lowest it is likely to stutter', () => {
  const rows = [{ id: 120, bandwidth: 12e6, current: true }, { id: 80, bandwidth: 2e6, current: false }, { id: 64, bandwidth: 1e6, current: false }];
  assert.equal(QUALITY_HEADROOM, 1.5);
  assert.deepEqual(qualityFit(18e6, rows, 1), { quality: rows[0], short: false }, 'exactly 12 × 1.5 Mb/s covers 4K');
  assert.deepEqual(qualityFit(18e6 - 1, rows, 1), { quality: rows[1], short: true }, 'just below: 1080P, short of the 4K being played');
  assert.deepEqual(qualityFit(18e6, rows, 2), { quality: rows[1], short: true }, '2× speed doubles the need');
  assert.deepEqual(qualityFit(9e6, rows, 0.5), { quality: rows[0], short: false }, '0.5× speed halves it');
  assert.deepEqual(qualityFit(18e6, rows, null), { quality: rows[0], short: false }, 'an unknown rate counts as 1×');
  assert.deepEqual(qualityFit(1.5e6, rows, 1), { quality: rows[2], short: true });
  assert.deepEqual(qualityFit(1.5e6 - 1, rows, 1), { quality: null, short: true }, 'below the lowest quality');
  assert.deepEqual(qualityFit(3e6, rows.map(row => ({ ...row, current: false })), 1), { quality: rows[1], short: false }, 'nothing played yet: never short');
  for (const speed of [null, undefined, NaN, -1]) assert.equal(qualityFit(speed, rows, 1), null, 'no measurement stays unknown');
  assert.equal(qualityFit(18e6, [], 1), null, 'no bit rate stays unknown');
});

test('quality names follow Bilibili quality numbers, then the height', () => {
  assert.equal(qualityName({ id: 116 }, 'zh'), '1080P60');
  assert.equal(qualityName({ id: 126 }, 'zh'), '杜比视界');
  assert.equal(qualityName({ id: 126 }, 'en'), 'Dolby Vision');
  assert.equal(qualityName({ id: 999, height: 2160 }, 'en'), '4K');
  assert.equal(qualityName({ id: 999, height: 1440 }, 'en'), '1440P');
  assert.equal(qualityName({ id: 999, height: null }, 'en'), null);
});
