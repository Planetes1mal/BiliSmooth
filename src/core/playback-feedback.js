/* Regional challenger history. The kernel owns request identity and persistence. */
(function (scope) {
  'use strict';
  const DeliveryPolicy = scope.BiliSmoothDeliveryPolicy || (typeof require === 'function' ? require('./delivery-policy.js') : null);
  const Settings = scope.BiliSmoothSettings || (typeof require === 'function' ? require('./settings.js') : null);
  function validHost(host) {
    return typeof host === 'string' && host.length <= 253
      && (/^upos-[a-z0-9-]+\.bilivideo\.(?:com|cn|net)$/.test(host) || /^upos-[a-z0-9-]+\.akamaized\.net$/.test(host));
  }
  function createHistory({ now = Date.now, random = Math.random, initial } = {}) {
    const C = DeliveryPolicy.constants, rows = new Map(), loadedAt = now();
    const mainland = new Set(Settings.candidatePool.filter(host => !/ov\./.test(host)));
    const validTime = (value, at) => Number.isSafeInteger(value) && value > 0 && value <= at;
    if (initial?.version === 1 && Array.isArray(initial.rows)) for (const row of initial.rows.slice(0, C.HISTORY_INPUT_MAX_ROWS)) {
      if (!row || !validHost(row.host) || rows.has(row.host)) continue;
      const measured = Number.isFinite(row.meanBps) && row.meanBps > 0
        && Number.isFinite(row.weight) && row.weight > 0 && validTime(row.measuredAt, loadedAt);
      const failedAt = validTime(row.failedAt, loadedAt) ? row.failedAt : 0;
      if (measured || failedAt) rows.set(row.host, { host: row.host, meanBps: measured ? row.meanBps : null,
        weight: measured ? row.weight : 0, measuredAt: measured ? row.measuredAt : 0, failedAt });
    }
    function entry(host) {
      let row = rows.get(host);
      if (!row) { row = { host, meanBps: null, weight: 0, measuredAt: 0, failedAt: 0 }; rows.set(host, row); }
      return row;
    }
    function recordFailure(host, at = now()) {
      if (!validHost(host)) return false; // Relay hosts are not CDN history candidates.
      const row = entry(host); row.failedAt = Math.max(row.failedAt, at); return true;
    }
    function recordRace(results) {
      const at = now();
      for (const sample of results) {
        if (sample.ok) {
          const row = entry(sample.host), weight = row.weight * 2 ** (-(at - row.measuredAt) / C.HISTORY_HALF_LIFE_MS);
          row.meanBps = ((row.meanBps || 0) * weight + sample.bytes * 8000 / sample.elapsedMs) / (weight + 1);
          row.weight = weight + 1; row.measuredAt = at;
        } else if (['http', 'network', 'timeout', 'incomplete-range'].includes(sample.error)) recordFailure(sample.host, at);
      }
    }
    function importFailures(legacy) {
      if (legacy?.version !== 1 || !Array.isArray(legacy.rows)) return false;
      const at = now(); let changed = false;
      for (const row of legacy.rows.slice(0, C.HISTORY_INPUT_MAX_ROWS)) {
        if (!row || !validHost(row.host) || !validTime(row.failedAt, at) || at - row.failedAt >= C.HISTORY_FAILURE_MS) continue;
        const current = entry(row.host);
        if (row.failedAt > current.failedAt) { current.failedAt = row.failedAt; changed = true; }
      }
      return changed;
    }
    function challengers(candidates) {
      const at = now(), failed = host => { const row = rows.get(host); return row?.failedAt > 0 && at - row.failedAt < C.HISTORY_FAILURE_MS; };
      const available = [...new Set(candidates)], measured = available.filter(host => !failed(host))
        .map(host => rows.get(host)?.meanBps).filter(value => value > 0).sort((a, b) => a - b);
      const unknown = measured.length ? measured[Math.floor((measured.length - 1) / 2)] : 0;
      const score = host => rows.get(host)?.meanBps ?? unknown;
      available.sort((a, b) => Number(failed(a)) - Number(failed(b)) || score(b) - score(a)
        || Number(mainland.has(b)) - Number(mainland.has(a)));
      const picked = [];
      while (available.length && picked.length < C.RACE_CHALLENGERS) {
        const sameTier = available.filter(host => failed(host) === failed(available[0])).length;
        const index = sameTier > 1 && random() < C.EXPLORATION_SHARE ? 1 + Math.floor(random() * (sameTier - 1)) : 0;
        picked.push(available.splice(index, 1)[0]);
      }
      return picked;
    }
    return { recordRace, recordFailure, importFailures, challengers,
      snapshot: () => ({ version: 1, rows: [...rows.values()].map(row => ({ ...row })) }), clear: () => rows.clear() };
  }
  const api = { createHistory };
  scope.BiliSmoothPlaybackFeedback = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
