import test from 'node:test';
import assert from 'node:assert/strict';
import feedback from '../../src/core/playback-feedback.js';
test('regional history ranks only challengers with decay, failure tiers and independent exploration', () => {
  const A='upos-sz-mirroraliov.bilivideo.com', H='upos-tf-all-hw.bilivideo.com', C='upos-sz-mirrorcos.bilivideo.com', K='upos-hz-mirrorakam.akamaized.net';
  const race = (host, mbps) => ({ host, ok: true, bytes: mbps * 125000, elapsedMs: 1000 });
  const half = 3*24*60*60*1000;
  for (const row of [
    { name:'unknown mainland ties', candidates:[A,K,C,H], expected:[C,H] },
    { name:'lower median', samples:[race(H,10),race(C,30)], candidates:[K,H,C], expected:[C,H] },
    { name:'unrelated history does not set candidate median', samples:[race(H,10),race(C,30),race(A,900)], candidates:[K,H,C], expected:[C,H] },
    { name:'failure tier beats exploration', failures:[C], candidates:[C,H,A], random:[0,0], expected:[A,H] },
    { name:'each slot explores', candidates:[A,H,C,K], random:[0,0.99,0,0], expected:[K,C] },
    { name:'all failed still available', samples:[race(A,20),race(H,10)], failures:[A,H], candidates:[H,A,H], expected:[A,H] }
  ]) {
    let at=1000000; const values=[...(row.random||[])], h=feedback.createHistory({now:()=>at,random:()=>values.length?values.shift():0.9});
    h.recordRace(row.samples||[]); for(const host of row.failures||[])h.recordFailure(host);
    const before=[...row.candidates];assert.deepEqual(h.challengers(row.candidates),row.expected,row.name);assert.deepEqual(row.candidates,before);
  }
  let at=1000000;const h=feedback.createHistory({now:()=>at,random:()=>0.9});h.recordRace([race(H,10)]);at+=half;h.recordRace([race(H,40)]);
  assert.equal(h.snapshot().rows[0].meanBps,30000000);assert.equal(h.snapshot().rows[0].weight,1.5);
  h.recordRace([{host:A,ok:false,error:'timeout'},{host:C,ok:false,error:'cancelled'}]);assert.deepEqual(h.challengers([A,H]),[H,A]);
  assert.equal(h.snapshot().rows.some(row=>row.host===C),false);h.recordRace([race(A,50)]);assert.deepEqual(h.challengers([A,H]),[H,A]);
  at+=3600000;assert.deepEqual(h.challengers([A,H]),[A,H]);
  const legacy={version:1,rows:[{host:H,failedAt:at-500,stableAt:at},{host:C,failedAt:at-3600000},{host:K,failedAt:at-1000},{host:'bad.example',failedAt:at}]};
  assert.equal(h.importFailures(legacy),true);assert.equal(h.importFailures(legacy),false);
  const clean=feedback.createHistory({now:()=>at,initial:{version:1,rows:[...h.snapshot().rows,{host:H,meanBps:999,weight:1,measuredAt:at},
    {host:'https://bad.example/?sign=PRIVATE',failedAt:at},{host:C,meanBps:Infinity,weight:1,measuredAt:at+1,failedAt:at+1}]} });
  assert.deepEqual(clean.snapshot(),h.snapshot());assert.doesNotMatch(JSON.stringify(clean.snapshot()),/PRIVATE|https?:|stableAt/);
  const copy=clean.snapshot();copy.rows[0].failedAt=0;assert.notDeepEqual(clean.snapshot(),copy);
  for(const initial of [null,{version:2,rows:h.snapshot().rows},{version:1,rows:'PRIVATE'}])assert.deepEqual(feedback.createHistory({initial}).snapshot(),{version:1,rows:[]});
});
test('a video starts on the history host only when that history is recent, repeated, failure-free and clearly faster', () => {
  const N='upos-sz-mirrorcosov.bilivideo.com', B='upos-sz-mirroraliov.bilivideo.com', U='cn-jxnc-cmcc-bcache-06.bilivideo.com', K='upos-hz-mirrorakam.akamaized.net';
  const hour=3600000, day=24*hour, base=10*day, required=4000000;
  const row=(host, mbps, extra={}) => ({ host, meanBps: mbps*1e6, weight: 2, measuredAt: base-hour, failedAt: 0, ...extra });
  const start=(rows, candidates=[N,B,U,K], at=base) => feedback.createHistory({ now: () => at, initial: { version: 1, rows } })
    .startHost(candidates, { current: N, requiredBps: required });
  for (const [name, rows, expected, candidates] of [
    ['issued host unknown, best is fast enough', [row(B, 30)], B],
    ['user server with good history', [row(B, 20), row(U, 40)], U],
    ['no history', [], null],
    ['a single sample', [row(B, 30, { weight: 1 })], null],
    ['measured over a day ago', [row(B, 30, { measuredAt: base - day - 1 })], null],
    ['failed within a day', [row(B, 30, { failedAt: base - 20 * hour })], null],
    ['under twice the bitrate', [row(B, 7.9)], null],
    ['issued host measured and not clearly slower', [row(B, 30), row(N, 21)], null],
    ['issued host measured and clearly slower', [row(B, 30), row(N, 20)], B],
    ['issued host failed within the hour', [row(B, 30), row(N, 40, { failedAt: base - 1000 })], B],
    ['the issued host is the best', [row(N, 50), row(B, 30)], null],
    ['only listed candidates', [row(B, 30)], null, [N, U]]
  ]) assert.equal(start(rows, candidates), expected, name);
  const h=feedback.createHistory({ now: () => base, initial: { version: 1, rows: [row(B, 30)] } });
  assert.equal(h.startHost([N,B], { current: N, requiredBps: 0 }), null, 'an unknown bitrate starts nowhere else');
  const ties=feedback.createHistory({ now: () => base, random: () => 0.9 });
  assert.deepEqual(ties.challengers([B, 'upos-sz-mirrorali.bilivideo.com', U], [U]), [U, 'upos-sz-mirrorali.bilivideo.com'], 'a user server wins ties');
  ties.recordRace([{ host: U, ok: true, bytes: 125000, elapsedMs: 1000 }, { host: B, ok: true, bytes: 1250000, elapsedMs: 1000 }]);
  assert.deepEqual(ties.challengers([B, U], [U]), [B, U], 'a measured slow user server ranks by speed');
  assert.equal(ties.snapshot().rows.some(item => item.host === U), true, 'user server history persists');
});
