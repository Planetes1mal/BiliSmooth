/* Foreground video XHR measurements, including unfinished delivery and first-byte waiting. */
(function (scope) {
  'use strict';
  const Policy = scope.BiliSmoothDeliveryPolicy || (typeof require === 'function' ? require('./delivery-policy.js') : null);
  const C = Policy.constants;
  function average(halfLifeMs) {
    let sum = 0, weight = 0;
    return {
      record(rate, elapsedMs) {
        const decay = 2 ** (-elapsedMs / halfLifeMs);
        sum = sum * decay + rate * (1 - decay);
        weight = weight * decay + 1 - decay;
      },
      value: () => sum / weight
    };
  }
  function median(values) {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  function create() {
    const hosts = new Map();
    function record(sample) {
      if (sample.kind !== 'video' || sample.transport !== 'xhr' || !['complete', 'incomplete'].includes(sample.outcome)
        || sample.hidden || sample.bytes < C.THROUGHPUT_SAMPLE_MIN_BYTES || sample.elapsedMs <= 0) return false;
      let row = hosts.get(sample.host);
      if (!row) {
        row = { fast: average(C.THROUGHPUT_FAST_HALF_LIFE_MS), slow: average(C.THROUGHPUT_SLOW_HALF_LIFE_MS),
          totalBytes: 0, recent: [] };
        hosts.set(sample.host, row);
      }
      const rate = sample.bytes * 8000 / sample.elapsedMs;
      row.fast.record(rate, sample.elapsedMs); row.slow.record(rate, sample.elapsedMs); row.totalBytes += sample.bytes;
      row.recent.push({ bytes: sample.bytes, elapsedMs: sample.elapsedMs, firstByteMs: sample.firstByteMs });
      let bytes = 0, elapsedMs = 0, index = row.recent.length;
      while (index > 0 && bytes < C.THROUGHPUT_RECENT_BYTES && elapsedMs < C.THROUGHPUT_RECENT_MS) {
        const fragment = row.recent[--index]; bytes += fragment.bytes; elapsedMs += fragment.elapsedMs;
      }
      row.recent.splice(0, index); row.recentBytes = bytes; row.recentMs = elapsedMs;
      row.lastFragment = { range: sample.range, firstByteMs: sample.firstByteMs, elapsedMs: sample.elapsedMs, completedAt: sample.completedAt };
      return true;
    }
    function snapshot() {
      return [...hosts].map(([host, row]) => ({ host,
        goodputBps: row.totalBytes >= C.THROUGHPUT_TRUST_MIN_BYTES ? Math.min(row.fast.value(), row.slow.value()) : null,
        ttfbMedianMs: median(row.recent.map(sample => sample.firstByteMs)),
        recentBytes: row.recentBytes, recentMs: row.recentMs, recentBps: row.recentBytes * 8000 / row.recentMs,
        lastFragment: { ...row.lastFragment } }));
    }
    return { record, snapshot };
  }
  const api = Object.freeze({ create });
  scope.BiliSmoothThroughput = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
