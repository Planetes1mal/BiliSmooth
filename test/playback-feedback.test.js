const test = require('node:test'), assert = require('node:assert/strict');
const feedback = require('../src/core/playback-feedback.js');
const ALIOV = 'upos-sz-mirroraliov.bilivideo.com', COS = 'upos-sz-mirrorcos.bilivideo.com';
const HW = 'upos-tf-all-hw.bilivideo.com', hosts = [ALIOV, HW, COS];
const timeout = host => ({ host, kind: 'video', outcome: 'timeout', transport: 'xhr' });
const complete = host => ({ host, kind: 'video', outcome: 'complete', transport: 'xhr', status: 206, bytes: 1048576, elapsedMs: 1000 });
function clock() { let time = 1000000; return { now: () => time, advance: ms => time += ms }; }

test('Repeated actual playback timeouts demote the probe winner without removing candidates', () => {
  const time = clock(), history = feedback.create({ hosts, now: time.now });
  history.record(timeout(ALIOV));
  assert.deepEqual(history.rank(hosts), [ALIOV, HW, COS], 'one failure is insufficient');
  time.advance(10000); history.record(timeout(ALIOV));
  assert.deepEqual(history.rank(hosts), [HW, COS, ALIOV]);
});

test('A replacement needs three complete video requests spanning ten seconds before promotion', () => {
  const time = clock(), history = feedback.create({ hosts, now: time.now });
  history.record(complete(COS)); assert.deepEqual(history.rank(hosts), [ALIOV, HW, COS]);
  time.advance(5000); history.record(complete(COS)); assert.deepEqual(history.rank(hosts), [ALIOV, HW, COS]);
  time.advance(5000); history.record(complete(COS)); assert.deepEqual(history.rank(hosts), [COS, ALIOV, HW]);
  history.record(timeout(COS)); assert.deepEqual(history.rank(hosts), [ALIOV, HW, COS], 'a new timeout breaks stability');
});

test('Refresh preserves confirmed evidence while failure and stability expire during ranking', () => {
  const time = clock(), history = feedback.create({ hosts, now: time.now });
  history.record(timeout(ALIOV)); time.advance(1000); history.record(timeout(ALIOV));
  history.record(complete(COS)); time.advance(5000); history.record(complete(COS));
  time.advance(5000); history.record(complete(COS));
  const restored = feedback.create({ hosts, now: time.now, initial: JSON.parse(JSON.stringify(history.snapshot())) });
  assert.deepEqual(restored.rank(hosts), [COS, HW, ALIOV]);
  time.advance(120000); assert.deepEqual(restored.rank(hosts), [COS, ALIOV, HW]);
  time.advance(480000); assert.deepEqual(restored.rank(hosts), [ALIOV, HW, COS]);
  assert.deepEqual(restored.snapshot(), { version: 1, rows: [] });
});

test('Only full substantive XHR video or muxed completions count as positive evidence', () => {
  for (const patch of [
    { kind: 'audio' }, { kind: 'unknown' }, { transport: 'fetch', bodyVerified: true },
    { transport: 'resource-timing' }, { outcome: 'headers' }, { outcome: 'aborted' },
    { status: 403 }, { bytes: 1544 }, { bytes: NaN }, { elapsedMs: 0 }
  ]) {
    const time = clock(), history = feedback.create({ hosts, now: time.now });
    for (let index = 0; index < 3; index++) { history.record({ ...complete(COS), ...patch }); time.advance(5000); }
    assert.deepEqual(history.rank(hosts), [ALIOV, HW, COS], JSON.stringify(patch));
  }
  const time = clock(), history = feedback.create({ hosts, now: time.now });
  for (let index = 0; index < 3; index++) {
    history.record({ ...timeout(ALIOV), kind: 'audio' });
    history.record({ ...complete(COS), kind: 'muxed' }); time.advance(5000);
  }
  assert.deepEqual(history.rank(hosts), [COS, ALIOV, HW]);
});

test('HTTP and network failures break a stable run without being counted as timeouts', () => {
  for (const outcome of ['http-error', 'network-error']) {
    const time = clock(), history = feedback.create({ hosts, now: time.now });
    for (let index = 0; index < 3; index++) { history.record(complete(COS)); time.advance(5000); }
    assert.deepEqual(history.rank(hosts), [COS, ALIOV, HW]);
    history.record({ ...timeout(COS), outcome }); history.record({ ...timeout(COS), outcome });
    assert.deepEqual(history.rank([COS, ALIOV, HW]), [COS, ALIOV, HW], 'these errors do not create a timeout penalty');
    assert.deepEqual(history.rank(hosts), [ALIOV, HW, COS], 'stable preference has ended');
    history.record(complete(COS)); assert.deepEqual(history.rank(hosts), [ALIOV, HW, COS]);
  }
});

test('Generation changes, refresh and long gaps cannot combine unfinished success runs', () => {
  const time = clock(), history = feedback.create({ hosts, now: time.now });
  history.record(complete(COS)); time.advance(5000); history.record(complete(COS));
  const restored = feedback.create({ hosts, now: time.now, initial: history.snapshot() });
  time.advance(5000); restored.record(complete(COS)); assert.deepEqual(restored.rank(hosts), [ALIOV, HW, COS]);
  history.resetWindow(); history.record(complete(COS)); assert.deepEqual(history.rank(hosts), [ALIOV, HW, COS]);
  time.advance(5000); history.record(complete(COS)); time.advance(30001); history.record(complete(COS));
  assert.deepEqual(history.rank(hosts), [ALIOV, HW, COS], 'a gap of more than thirty seconds starts a new run');
  time.advance(5000); history.record(complete(COS)); time.advance(5000); history.record(complete(COS));
  assert.deepEqual(history.rank(hosts), [COS, ALIOV, HW]);
  history.clear(); assert.deepEqual(history.rank(hosts), [ALIOV, HW, COS]);
  assert.deepEqual(history.snapshot(), { version: 1, rows: [] });
});

test('Cache loading drops private fields, unknown hosts, invalid timestamps and duplicate rows', () => {
  const time = clock(), initial = { version: 1, privateUrl: 'https://example.invalid/?sign=SECRET', rows: [
    { host: ALIOV, stableAt: 0, timeouts: [998000, 999000], url: 'SECRET' },
    { host: ALIOV, stableAt: 1000000, timeouts: [], token: 'SECRET' },
    { host: COS, stableAt: 1000000, timeouts: [], cookie: 'SECRET' },
    { host: HW, stableAt: 1000001, timeouts: [NaN, Infinity, -1, 1000001, '999000', 0] },
    { host: 'attacker.example', stableAt: 1000000, timeouts: [] },
    { host: `https://${COS}/video?sign=SECRET`, stableAt: 1000000, timeouts: [] },
    null, 7
  ] };
  const history = feedback.create({ hosts, now: time.now, initial });
  assert.deepEqual(history.rank(hosts), [COS, HW, ALIOV]);
  assert.deepEqual(history.snapshot(), { version: 1, rows: [
    { host: ALIOV, stableAt: 0, timeouts: [998000, 999000] },
    { host: COS, stableAt: 1000000, timeouts: [] }
  ] });
  history.record({ ...complete(HW), url: 'SECRET', requestId: 'PRIVATE' });
  assert.doesNotMatch(JSON.stringify(history.snapshot()), /SECRET|PRIVATE|attacker|https:/);
  const exported = history.snapshot(); exported.rows[0].timeouts.length = 0;
  assert.deepEqual(history.rank(hosts), [COS, HW, ALIOV], 'exported cache cannot mutate live evidence');
  for (const initial of [null, 'SECRET', [], { version: 2, rows: [{ host: COS, stableAt: 1000000, timeouts: [] }] },
    { version: 1, rows: {} }, { version: 1, rows: [{ host: COS, stableAt: '1000000', timeouts: {} }] }]) {
    const restored = feedback.create({ hosts, now: time.now, initial });
    assert.deepEqual(restored.rank(hosts), [ALIOV, HW, COS]); assert.deepEqual(restored.snapshot(), { version: 1, rows: [] });
  }
});

test('Even when every candidate times out, the original candidate set and tie order survive', () => {
  const time = clock(), history = feedback.create({ hosts, now: time.now });
  for (const host of hosts) { history.record(timeout(host)); time.advance(1000); history.record(timeout(host)); }
  const input = [...hosts]; assert.deepEqual(history.rank(input), [ALIOV, HW, COS]);
  assert.deepEqual(input, [ALIOV, HW, COS], 'ranking does not mutate the probe ranking');
  time.advance(120000); assert.deepEqual(history.rank(hosts), [ALIOV, HW, COS]);
  assert.deepEqual(history.snapshot(), { version: 1, rows: [] });
});

test('A burst of successful requests and hosts outside the allowlist cannot manufacture stability', () => {
  const time = clock(), history = feedback.create({ hosts: [...hosts, 'https://example.invalid/?sign=SECRET'], now: time.now });
  for (let index = 0; index < 3; index++) { history.record(complete(COS)); time.advance(1000); }
  assert.deepEqual(history.rank(hosts), [ALIOV, HW, COS], 'three seconds is not a ten second stability window');
  for (const host of ['https://example.invalid/?sign=SECRET', 'upos-sz-mirrorali.bilivideo.com']) {
    assert.equal(history.record(timeout(host)), false); assert.equal(history.record(complete(host)), false);
  }
  assert.deepEqual(history.snapshot(), { version: 1, rows: [] });
});
