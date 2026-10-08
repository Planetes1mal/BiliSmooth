/* Short-lived playback evidence. This module orders hosts and reports failed ones; it never routes requests.
 * The kernel owns request deduplication, network/generation checks and persistence.
 * Pass parsed snapshot() data as initial on refresh; resetWindow() on media changes;
 * clear() on network changes. Unfinished success runs are deliberately not persisted.
 */
(function (scope) {
  'use strict';
  const DeliveryPolicy = scope.BiliSmoothDeliveryPolicy || (typeof require === 'function' ? require('./delivery-policy.js') : null);
  const Settings = scope.BiliSmoothSettings || (typeof require === 'function' ? require('./settings.js') : null);
  const SUCCESS_COUNT = 3, SUCCESS_WINDOW_MS = 10000, STABLE_TTL_MS = 600000, FAILURE_TTL_MS = 120000;
  // Small initialization/range requests do not establish sustained media delivery.
  const MIN_MEDIA_BYTES = 65536, SUCCESS_MAX_GAP_MS = 30000;
  // Avoiding a failed host costs one rewrite; retrying it can block a segment
  // for the player's whole timeout. Keep that memory as long as a ranking cache.
  const AVOID_TTL_MS = 21600000;
  function validHost(host) {
    return typeof host === 'string' && host.length <= 253
      && (/^upos-[a-z0-9-]+\.bilivideo\.(?:com|cn|net)$/.test(host) || /^upos-[a-z0-9-]+\.akamaized\.net$/.test(host));
  }
  function fresh(time, at, ttl) { return Number.isSafeInteger(time) && time >= 0 && time <= at && at - time < ttl; }
  function create(options = {}) {
    const hosts = new Set((Array.isArray(options.hosts) ? options.hosts : []).filter(validHost).slice(0, 32));
    const now = typeof options.now === 'function' ? options.now : Date.now, records = new Map(), windows = new Map();
    const initial = options.initial, loadedAt = now();
    if (initial?.version === 1 && Array.isArray(initial.rows)) for (const row of initial.rows.slice(0, 64)) {
      if (!row || !hosts.has(row.host) || records.has(row.host)) continue;
      records.set(row.host, {
        stableAt: fresh(row.stableAt, loadedAt, STABLE_TTL_MS) ? row.stableAt : 0,
        failedAt: fresh(row.failedAt, loadedAt, AVOID_TTL_MS) ? row.failedAt : 0,
        timeouts: Array.isArray(row.timeouts) ? row.timeouts.slice(-64).filter(time => fresh(time, loadedAt, FAILURE_TTL_MS))
          .sort((a, b) => a - b).slice(-2) : []
      });
    }
    function prune(at) {
      for (const [host, row] of records) {
        row.timeouts = row.timeouts.filter(time => fresh(time, at, FAILURE_TTL_MS)).slice(-2);
        if (!fresh(row.stableAt, at, STABLE_TTL_MS)) row.stableAt = 0;
        if (!fresh(row.failedAt, at, AVOID_TTL_MS)) row.failedAt = 0;
        if (!row.stableAt && !row.timeouts.length && !row.failedAt) records.delete(host);
      }
    }
    function record(event) {
      if (!event || !hosts.has(event.host) || event.transport !== 'xhr'
        || !['video', 'muxed'].includes(event.kind)
        || !['timeout', 'http-error', 'network-error', 'no-response', 'complete'].includes(event.outcome)) return false;
      if (event.outcome === 'complete' && (!([200, 206].includes(event.status))
        || !Number.isFinite(event.bytes) || event.bytes < MIN_MEDIA_BYTES
        || !Number.isFinite(event.elapsedMs) || event.elapsedMs <= 0)) return false;
      const at = now(); prune(at);
      const row = records.get(event.host) || { stableAt: 0, failedAt: 0, timeouts: [] };
      if (event.outcome !== 'complete') {
        if (event.outcome === 'timeout') row.timeouts.push(at);
        row.stableAt = 0; row.failedAt = at; windows.delete(event.host);
      } else {
        let window = windows.get(event.host);
        if (!window || at - window.lastAt > SUCCESS_MAX_GAP_MS) window = { startedAt: at, count: 0 };
        window.count = Math.min(SUCCESS_COUNT, window.count + 1); window.lastAt = at; windows.set(event.host, window);
        if (window.count >= SUCCESS_COUNT && at - window.startedAt >= SUCCESS_WINDOW_MS) { row.stableAt = at; row.failedAt = 0; }
      }
      records.set(event.host, row); return true;
    }
    function rank(candidates) {
      prune(now());
      // Stable, unproven, then repeatedly timed out; preserve probe order within each tier.
      function tier(host) { const row = records.get(host); return row?.timeouts.length >= 2 ? 2 : row?.stableAt ? 0 : 1; }
      return (Array.isArray(candidates) ? [...candidates] : []).sort((a, b) => tier(a) - tier(b));
    }
    // A real video failure without later stable delivery from the same host.
    function failing(host) { prune(now()); return !!records.get(host)?.failedAt; }
    function stable(host) { prune(now()); return !!records.get(host)?.stableAt; }
    function snapshot() {
      prune(now());
      return { version: 1, rows: [...records].map(([host, row]) => ({ host, stableAt: row.stableAt, timeouts: [...row.timeouts],
        ...(row.failedAt ? { failedAt: row.failedAt } : {}) })) };
    }
    function resetWindow() { windows.clear(); }
    function clear() { records.clear(); resetWindow(); }
    return { record, rank, failing, stable, snapshot, resetWindow, clear };
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
  const api = { create, createHistory };
  scope.BiliSmoothPlaybackFeedback = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
