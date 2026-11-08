// Download speed as video bytes over complete observed wall-clock windows of 3 s. A known quiet
// interval counts as zero; before any transfer or after an observation gap the value is unknown.
const WINDOW_MS = 3000;

export function createSpeedMeter({ now, wallNow }) {
  let windows = [], lastMbps = null, observedAt = null, observedFrom = null, clock = null, samples = [];
  function reset() {
    windows = []; lastMbps = null; observedAt = null; observedFrom = null; clock = null;
    if (samples.at(-1)?.mbps != null) { samples.push({ at: wallNow(), mbps: null }); samples = samples.slice(-60); }
  }
  function advanceClock(at) {
    if (clock !== null && (at < clock || at - clock > WINDOW_MS)) reset();
    clock = at;
  }
  // bytes of one video transfer observed between start and at.
  function record(start, at, bytes) {
    advanceClock(at);
    const from = Math.max(start, at - WINDOW_MS);
    observedFrom = observedFrom === null ? from : Math.min(observedFrom, from);
    windows.push({ start, end: at, bytes });
  }
  // observing: a player exists, the page is not suspended and the browser is online.
  function calculate(at, observing) {
    advanceClock(at);
    if (!observing) { reset(); return; }
    if (observedFrom === null) { lastMbps = null; observedAt = null; return; }
    windows = windows.filter(row => row.end > at - WINDOW_MS).slice(-1024);
    const rows = windows.map(row => ({ ...row, start: Math.max(row.start, at - WINDOW_MS),
      bytes: row.bytes * Math.min(1, (row.end - Math.max(row.start, at - WINDOW_MS)) / Math.max(1, row.end - row.start)) }));
    const elapsed = at - Math.max(observedFrom, at - WINDOW_MS), total = rows.reduce((sum, row) => sum + row.bytes, 0);
    // Throughput is bytes over the complete observed wall-clock window. Reusing the last
    // busy-interval rate turned ordinary segmented delivery into flat plateaus followed by false gaps.
    lastMbps = elapsed > 0 ? total * 8 / elapsed / 1000 : null;
    observedAt = lastMbps === null ? null : wallNow();
  }
  function sample(at) { samples.push({ at, mbps: lastMbps }); samples = samples.slice(-60); }
  return { reset, record, calculate, sample, mbps: () => lastMbps, observedAt: () => observedAt, samples: () => samples };
}
