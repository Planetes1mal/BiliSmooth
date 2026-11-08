// The dashboard speed chart: timestamped samples become one slot per second; unknown never becomes zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { series, paths, monotone, ceilingFor, CEILING, SPAN } from '../../src/ui/dashboard/chart.js';

const now = 100000;
const samples = values => values.map((mbps, index) => ({ at: now - (values.length - 1 - index) * 1000, mbps }));

test('samples fill one slot per second, anchored on the newest sample; unknown and missing stay null', () => {
  const { values, anchor } = series([...samples([8, null, 0, 16]), { at: now - 30000, mbps: 24 }], now + 400);
  assert.equal(anchor, now);
  assert.equal(values.length, SPAN + 1);
  assert.deepEqual(values.slice(-4), [1, null, 0, 2], 'megabits become MB/s; an observed idle zero stays zero');
  assert.equal(values[SPAN - 30], 3);
  assert.equal(values.filter(value => value !== null).length, 4);
  assert.equal(series([], now).anchor, now, 'no samples: the right edge is now');
  assert.equal(series(samples([8]), now + 10000).anchor, now + 10000, 'a stale sample does not pin the right edge');
});

test('a gap is drawn as a dashed link between runs, never as a dip to zero', () => {
  const values = [2, 2, null, null, 4, 4];
  const result = paths(values, { step: 10, height: 100 });
  assert.equal((result.line.match(/M/g) || []).length, 2, 'two solid runs');
  assert.match(result.gap, /^M10\.0 \S+ L40\.0 \S+$/, 'one dashed link from the last known point to the next');
  const ys = result.line.replace(/[MC]/g, ' ').trim().split(/\s+/).map(Number).filter((_, index) => index % 2);
  assert.ok(ys.length && ys.every(y => y < 98), 'no point of the line reaches the zero baseline');
  assert.deepEqual(result.end.map(Number), [50, (100 - 2) - 4 / CEILING * (100 - 5 - 2)]);
  assert.deepEqual(paths([null, null], { step: 10, height: 100 }), { line: '', area: '', gap: '', end: null });
});

test('the ceiling is fixed and the curve does not overshoot its points', () => {
  const high = paths([CEILING * 3, CEILING], { step: 10, height: 100 });
  assert.match(high.line, /^M0\.0 5\.0 C/, 'values above the ceiling sit at the top');
  const points = [[0, 50], [10, 10], [20, 10], [30, 90]];
  const controls = [...monotone(points).matchAll(/C(\S+) (\S+) (\S+) (\S+) (\S+) (\S+)/g)];
  controls.forEach((match, index) => {
    const [low, top] = [Math.min(points[index][1], points[index + 1][1]), Math.max(points[index][1], points[index + 1][1])];
    for (const y of [Number(match[2]), Number(match[4])]) assert.ok(y >= low - 1e-9 && y <= top + 1e-9, `segment ${index} stays within ${low}..${top}`);
  });
});

test('the ceiling doubles until the fastest value fits, so a fast server is never clipped', () => {
  assert.equal(ceilingFor([null, 2.4, 7.9]), CEILING);
  assert.equal(ceilingFor([18.65, null]), 32);
  assert.equal(ceilingFor([]), CEILING);
});
