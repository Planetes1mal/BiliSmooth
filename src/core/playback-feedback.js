/* Short-lived playback evidence. This module only orders hosts; it never routes requests.
 * The kernel owns request deduplication, network/generation checks and persistence.
 * Pass parsed snapshot() data as initial on refresh; resetWindow() on media changes;
 * clear() on network changes. Unfinished success runs are deliberately not persisted.
 */
(function (scope) {
  'use strict';
  const SUCCESS_COUNT = 3, SUCCESS_WINDOW_MS = 10000, STABLE_TTL_MS = 600000, FAILURE_TTL_MS = 120000;
  // Small initialization/range requests do not establish sustained media delivery.
  const MIN_MEDIA_BYTES = 65536, SUCCESS_MAX_GAP_MS = 30000;
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
        timeouts: Array.isArray(row.timeouts) ? row.timeouts.slice(-64).filter(time => fresh(time, loadedAt, FAILURE_TTL_MS))
          .sort((a, b) => a - b).slice(-2) : []
      });
    }
    function prune(at) {
      for (const [host, row] of records) {
        row.timeouts = row.timeouts.filter(time => fresh(time, at, FAILURE_TTL_MS)).slice(-2);
        if (!fresh(row.stableAt, at, STABLE_TTL_MS)) row.stableAt = 0;
        if (!row.stableAt && !row.timeouts.length) records.delete(host);
      }
    }
    function record(event) {
      if (!event || !hosts.has(event.host) || event.transport !== 'xhr'
        || !['video', 'muxed'].includes(event.kind)
        || !['timeout', 'http-error', 'network-error', 'complete'].includes(event.outcome)) return false;
      if (event.outcome === 'complete' && (!([200, 206].includes(event.status))
        || !Number.isFinite(event.bytes) || event.bytes < MIN_MEDIA_BYTES
        || !Number.isFinite(event.elapsedMs) || event.elapsedMs <= 0)) return false;
      const at = now(); prune(at);
      const row = records.get(event.host) || { stableAt: 0, timeouts: [] };
      if (event.outcome !== 'complete') {
        if (event.outcome === 'timeout') row.timeouts.push(at);
        row.stableAt = 0; windows.delete(event.host);
      } else {
        let window = windows.get(event.host);
        if (!window || at - window.lastAt > SUCCESS_MAX_GAP_MS) window = { startedAt: at, count: 0 };
        window.count = Math.min(SUCCESS_COUNT, window.count + 1); window.lastAt = at; windows.set(event.host, window);
        if (window.count >= SUCCESS_COUNT && at - window.startedAt >= SUCCESS_WINDOW_MS) row.stableAt = at;
      }
      records.set(event.host, row); return true;
    }
    function rank(candidates) {
      prune(now());
      // Stable, unproven, then repeatedly timed out; preserve probe order within each tier.
      function tier(host) { const row = records.get(host); return row?.timeouts.length >= 2 ? 2 : row?.stableAt ? 0 : 1; }
      return (Array.isArray(candidates) ? [...candidates] : []).sort((a, b) => tier(a) - tier(b));
    }
    function snapshot() {
      prune(now());
      return { version: 1, rows: [...records].map(([host, row]) => ({ host, stableAt: row.stableAt, timeouts: [...row.timeouts] })) };
    }
    function resetWindow() { windows.clear(); }
    function clear() { records.clear(); resetWindow(); }
    return { record, rank, snapshot, resetWindow, clear };
  }
  const api = { create };
  scope.BiliSmoothPlaybackFeedback = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
