/* Pure decisions for measured video delivery; thresholds live here. */
(function (scope) {
  'use strict';
  const RACE_CHALLENGERS = 2, RACE_SAMPLE_BYTES = 768 * 1024, MIN_MEASURABLE_BYTES = 128 * 1024;
  const constants = Object.freeze({
    DELIVERY_TICK_MS: 250, PLAYBACK_EVIDENCE_MAX_AGE_MS: 1500,
    THROUGHPUT_FAST_HALF_LIFE_MS: 2000, THROUGHPUT_SLOW_HALF_LIFE_MS: 5000,
    THROUGHPUT_SAMPLE_MIN_BYTES: 16 * 1024, THROUGHPUT_TRUST_MIN_BYTES: MIN_MEASURABLE_BYTES,
    THROUGHPUT_RECENT_BYTES: 4 * 1024 * 1024, THROUGHPUT_RECENT_MS: 8000,
    STUCK_RANGE_MIN_BYTES: MIN_MEASURABLE_BYTES, STUCK_LOADED_MIN_BYTES: MIN_MEASURABLE_BYTES,
    STUCK_FIRST_BYTE_MS: 1000, STUCK_BUFFER_SECONDS: 3, COMPLETION_RESERVE_SECONDS: 2,
    STUCK_TRANSFER_MIN_MS: 500, STUCK_REMAINING_MIN_MS: 1000, STUCK_RATE_FACTOR: 1.3,
    SHORTFALL_BUFFER_SECONDS: 30, SHORTFALL_RATE_FACTOR: 1.2,
    ERROR_WINDOW_MS: 30000, ERROR_COUNT: 2,
    NO_RESPONSE_MS: 1990,
    RACE_CHALLENGERS, RACE_SAMPLE_BYTES, RACE_TIMEOUT_MS: 4000, RACE_MAX_BYTES: RACE_CHALLENGERS * RACE_SAMPLE_BYTES,
    RACE_SPEEDUP: 1.5, SYNTHETIC_TIMEOUTS_PER_RANGE: 1, SYNTHETIC_RETRY_CHECK_MS: 3000,
    RACE_COOLDOWN_MS: 10000, RACE_COOLDOWN_MULTIPLIER: 2, MAX_SWITCHES_PER_VIDEO: 4,
    HISTORY_INPUT_MAX_ROWS: 64, HISTORY_HALF_LIFE_MS: 3 * 24 * 60 * 60 * 1000, HISTORY_FAILURE_MS: 60 * 60 * 1000,
    EXPLORATION_SHARE: 1 / 5
  });
  function decide(input) {
    const { requestAgeMs, firstByteMs, rangeBytes, transferMs, loadedBytes, goodputBps, remainingMs,
      bufferWallSeconds, recent, requiredBps, now, failedAt } = input;
    const firstByteStuck = firstByteMs === null && requestAgeMs >= constants.STUCK_FIRST_BYTE_MS
      && bufferWallSeconds < constants.STUCK_BUFFER_SECONDS;
    const deliveryStuck = (transferMs >= constants.STUCK_TRANSFER_MIN_MS || loadedBytes >= constants.STUCK_LOADED_MIN_BYTES)
      && goodputBps !== null && goodputBps < requiredBps * constants.STUCK_RATE_FACTOR
      && remainingMs !== null && remainingMs > constants.STUCK_REMAINING_MIN_MS
      && remainingMs > (bufferWallSeconds - constants.COMPLETION_RESERVE_SECONDS) * 1000;
    if (rangeBytes >= constants.STUCK_RANGE_MIN_BYTES && (firstByteStuck || deliveryStuck)) return 'stuck';
    if ((recent.bytes >= constants.THROUGHPUT_RECENT_BYTES || recent.elapsedMs >= constants.THROUGHPUT_RECENT_MS)
      && recent.goodputBps !== null && recent.goodputBps < requiredBps * constants.SHORTFALL_RATE_FACTOR
      && bufferWallSeconds < constants.SHORTFALL_BUFFER_SECONDS) return 'shortfall';
    if (failedAt.filter(at => now - at <= constants.ERROR_WINDOW_MS).length >= constants.ERROR_COUNT) return 'errors';
    return null;
  }
  // Both durations refer to the same byte count. Only completed contenders enter.
  function beatsCurrent(candidate, current) { return candidate * constants.RACE_SPEEDUP <= current; }
  const api = Object.freeze({ constants, decide, beatsCurrent });
  scope.BiliSmoothDeliveryPolicy = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
