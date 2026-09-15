/* Counts compositor submissions; it does not inspect video pixels or infer a CDN failure. */
(function (scope) {
  "use strict";

  const BASE_FREEZE_MS = 2000, MAX_SAMPLE_GAP_MS = 5000;
  const finite = value => typeof value === "number" && Number.isFinite(value);

  function create() {
    let latestTime = null, clock = null, movedAt = null, accepting = true;
    let source = null, count = null, mediaTime = null, lastFrameAt = null;
    let consecutive = 0, established = false, frozen = false;
    let observedIntervalMs = null, nominalFps = null, playbackRate = 1, reason = "no-baseline";

    function clearFrames(note) {
      source = null; count = null; mediaTime = null; lastFrameAt = null;
      consecutive = 0; established = false; frozen = false;
      observedIntervalMs = null; reason = note;
    }
    function reset(now) {
      latestTime = finite(now) ? now : null; clock = null; movedAt = null; accepting = true;
      nominalFps = null; playbackRate = 1; clearFrames("no-baseline");
    }
    function timeValid(now) {
      if (!finite(now)) return false;
      if (latestTime !== null && (now < latestTime || now - latestTime > MAX_SAMPLE_GAP_MS)) {
        clock = null; movedAt = null; clearFrames("time-jump");
      }
      latestTime = now;
      return true;
    }
    function intervalMs() {
      const nominal = nominalFps ? 1000 / (nominalFps * playbackRate) : 0;
      // A stalled renderer must not turn a known 60 fps video into an inferred 0.5 fps video.
      return nominal || observedIntervalMs || 0;
    }
    function thresholdMs() { return Math.max(BASE_FREEZE_MS, intervalMs() * 3 + 250); }
    function recoveryWindowMs() { return Math.max(source === "quality" ? 2500 : 1000, intervalMs() * 1.75 + 250); }

    function noteFrame(now, nextCount, nextMediaTime, nextSource) {
      if (source !== nextSource) {
        clearFrames("no-baseline"); source = nextSource;
      }
      if (count === null) {
        count = nextCount; mediaTime = nextMediaTime; lastFrameAt = now;
        return;
      }
      if (nextCount < count || (nextMediaTime !== null && mediaTime !== null && nextMediaTime < mediaTime - 0.05)) {
        clearFrames("counter-reset"); source = nextSource;
        count = nextCount; mediaTime = nextMediaTime; lastFrameAt = now;
        return;
      }
      if (nextCount === count) return;
      const deltaFrames = nextCount - count, elapsed = now - lastFrameAt;
      const mediaElapsed = nextMediaTime !== null && mediaTime !== null ? nextMediaTime - mediaTime : null;
      // The counter can jump when JS missed callbacks; do not mistake that for a low-frame-rate stream.
      const measuredInterval = mediaElapsed !== null && mediaElapsed > 0 ? mediaElapsed * 1000 / deltaFrames / playbackRate :
        elapsed > 0 ? elapsed / deltaFrames : null;
      if (!frozen && (!established || elapsed < thresholdMs()) && measuredInterval !== null && measuredInterval > 0 && measuredInterval <= 60000) {
        observedIntervalMs = observedIntervalMs === null ? measuredInterval : observedIntervalMs * 0.7 + measuredInterval * 0.3;
      }
      const inWindow = elapsed > 0 && elapsed <= recoveryWindowMs();
      // Separate observations are required even if one callback reports hundreds of frames.
      consecutive = inWindow ? consecutive + 1 : 1;
      established = true;
      count = nextCount; mediaTime = nextMediaTime; lastFrameAt = now;
      if (consecutive >= 2) { frozen = false; reason = "frames-advancing"; }
      else reason = frozen ? "confirming-recovery" : "confirming-frames";
    }

    function frame(input = {}) {
      if (!timeValid(input.now) || !accepting || !finite(input.presentedFrames) || input.presentedFrames < 0 ||
        !Number.isInteger(input.presentedFrames)) return false;
      noteFrame(input.now, input.presentedFrames, finite(input.mediaTime) ? input.mediaTime : null, "rvfc");
      return true;
    }
    function qualityFrames(quality) {
      if (!quality || !finite(quality.totalVideoFrames) || !finite(quality.droppedVideoFrames) ||
        quality.totalVideoFrames < 0 || quality.droppedVideoFrames < 0 || quality.droppedVideoFrames > quality.totalVideoFrames) return null;
      // totalVideoFrames includes dropped frames; decoded/dropped growth alone is not presentation progress.
      const value = quality.totalVideoFrames - quality.droppedVideoFrames;
      return Number.isInteger(value) ? value : null;
    }
    function result(state, now, note = reason) {
      return { state, ageMs: finite(now) && lastFrameAt !== null ? Math.max(0, now - lastFrameAt) : null,
        source, presentedFrames: count, thresholdMs: thresholdMs(), reason: note };
    }
    function sample(input = {}) {
      const now = input.now;
      if (!timeValid(now)) return result("unknown", null, "invalid-time");
      if (!input.active || input.grace) {
        clearFrames(input.grace ? "grace" : "inactive"); clock = null; movedAt = null; accepting = false;
        return result("unknown", now);
      }
      if (!accepting) { clearFrames("revalidating"); clock = null; movedAt = null; accepting = true; }
      const rate = finite(input.rate) && input.rate > 0 ? input.rate : 1;
      nominalFps = finite(input.fps) && input.fps > 0 && input.fps <= 1000 ? input.fps : null;
      if (rate !== playbackRate && observedIntervalMs !== null) observedIntervalMs *= playbackRate / rate;
      playbackRate = rate;
      if (!finite(input.playhead)) return result("unknown", now, "unknown-playhead");
      if (clock) {
        const elapsed = (now - clock.now) / 1000, delta = input.playhead - clock.playhead;
        if (delta < -0.05 || delta > Math.max(0, elapsed) * Math.max(playbackRate, clock.rate) + 0.75) {
          clearFrames("playhead-jump"); movedAt = null;
        } else if (delta > 0.01 && elapsed > 0) movedAt = now;
      }
      clock = { now, playhead: input.playhead, rate: playbackRate };
      // Once compositor callbacks are available, decode-quality counters cannot overrule their absence.
      if (source !== "rvfc") {
        const next = qualityFrames(input.quality);
        if (next !== null) noteFrame(now, next, null, "quality");
      }
      if (count === null || !established) return result("unknown", now);
      const age = now - lastFrameAt;
      const clockAdvancing = movedAt !== null && now - movedAt <= 1500;
      if (age >= thresholdMs() && clockAdvancing) {
        frozen = true; consecutive = 0; reason = "no-presented-frames";
      }
      if (frozen) return result(clockAdvancing || age < thresholdMs() ? "frozen" : "unknown", now,
        clockAdvancing || age < thresholdMs() ? reason : "clock-not-advancing");
      if (age >= thresholdMs()) return result("unknown", now, "clock-not-advancing");
      return result(consecutive >= 2 ? "healthy" : "unknown", now);
    }
    return { reset, frame, sample };
  }
  const api = Object.freeze({ create, constants: Object.freeze({ BASE_FREEZE_MS, MAX_SAMPLE_GAP_MS }) });
  if (typeof module === "object" && module.exports) module.exports = api;
  scope.BiliSmoothFrames = api;
})(typeof globalThis === "object" ? globalThis : this);
