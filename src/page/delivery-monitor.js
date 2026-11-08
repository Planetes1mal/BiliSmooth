// Watches the current <video> and, every DELIVERY_TICK_MS, asks the delivery policy whether an
// in-flight video Range is stuck, short or failing, or an audio Range is stuck; a verdict starts one race.
import { constants as C, decide } from '../core/delivery-policy.js';

const playerEvents = ['waiting', 'stalled', 'playing', 'canplay', 'suspend', 'pause', 'seeking', 'seeked', 'emptied', 'ended', 'error'];

export function createDeliveryMonitor({ root, document, now, wallNow, config, active, delivery, ledger, race, playbackEvidence, getPlayer, log }) {
  let watchedVideo = null, timer = null;
  const every = (root.setInterval || globalThis.setInterval).bind(root), clearEvery = (root.clearInterval || globalThis.clearInterval).bind(root);
  function playerContext() {
    return { readyState: Number.isFinite(watchedVideo?.readyState) ? watchedVideo.readyState : null,
      paused: !!watchedVideo?.paused, seeking: !!watchedVideo?.seeking, ended: !!watchedVideo?.ended,
      hidden: !!document?.hidden, playhead: Number.isFinite(watchedVideo?.currentTime) ? watchedVideo.currentTime : null };
  }
  function wallBuffer(evidence) {
    if (!Number.isFinite(evidence?.buffer) || evidence.buffer < 0) return Infinity;
    return evidence.buffer / (Number.isFinite(evidence.rate) && evidence.rate > 0 ? evidence.rate : 1);
  }
  function onPlayerEvent(event) {
    log('player-event', { source: event.type, ...playerContext() });
    if (event.type === 'emptied') { ledger.clearMediaRequests(); race.stop(); }
    else if (['pause', 'seeking', 'ended', 'error'].includes(event.type) && !playbackEvidence()?.startupPending) race.stop();
  }
  function unwatch() { for (const name of playerEvents) watchedVideo?.removeEventListener(name, onPlayerEvent); }
  function watchVideo() {
    const player = getPlayer ? getPlayer() : document?.querySelector?.('video');
    if (player === watchedVideo) return;
    unwatch(); ledger.clearMediaRequests(); race.stop(); watchedVideo = player || null;
    for (const name of playerEvents) watchedVideo?.addEventListener(name, onPlayerEvent, { passive: true });
  }
  function onVisibilityChange() {
    if (document.hidden) { ledger.markHidden(); race.stop(); }
  }
  function evaluate() {
    watchVideo();
    if (!active() || config().selection !== 'auto' || !config().stallRecovery || document?.hidden || !watchedVideo || watchedVideo.ended || watchedVideo.error) return;
    const evidence = playbackEvidence(), session = delivery.current();
    if (!evidence || !session || !evidence.startupPending && (watchedVideo.paused || watchedVideo.seeking)) return;
    const row = ledger.retained(session.cid), at = now(), epoch = ledger.epoch();
    for (const request of ledger.mediaRequests.values()) {
      if (request.cid !== session.cid || request.networkEpoch !== epoch || request.mediaGeneration !== evidence.mediaGeneration
        || request.player !== watchedVideo && !(request.player === null && evidence.startupPending) || request.hiddenOverlap) continue;
      const key = ledger.fragmentKey(request.originalUrl, request.range), range = /^bytes=(\d+)-(\d+)$/.exec(request.range);
      if (!range || row.raced.has(key)) continue;
      const rangeBytes = Number(range[2]) - Number(range[1]) + 1;
      if (request.bytes >= rangeBytes) continue;
      const rate = request.bytes * 8000 / (at - request.startedAt) || 0;
      const measured = ledger.measurementFor(session.cid, request.host), kind = request.representationKind;
      const requiredBps = kind === 'audio' ? delivery.get(request.originalUrl)?.bandwidth || 0 : session.requiredBps;
      const trigger = decide({ kind, requestAgeMs: at - request.startedAt,
        firstByteMs: request.firstByteAt === null ? null : request.firstByteAt - request.startedAt,
        rangeBytes, transferMs: request.firstByteAt === null ? 0 : at - request.firstByteAt, loadedBytes: request.bytes,
        goodputBps: rate, remainingMs: rate > 0 ? (rangeBytes - request.bytes) * 8000 / rate : Infinity,
        bufferWallSeconds: wallBuffer(evidence), requiredBps: requiredBps * evidence.rate,
        recent: { bytes: measured?.recentBytes || 0, elapsedMs: measured?.recentMs || 0, goodputBps: measured?.recentBps ?? null },
        now: wallNow(), failedAt: row.failures.filter(failure => failure.host === request.host).map(failure => failure.at) });
      if (trigger && race.testRoutes({ request, trigger })) { row.raced.add(key); break; }
    }
  }
  function start() {
    document?.addEventListener?.('visibilitychange', onVisibilityChange); watchVideo();
    timer = every(evaluate, C.DELIVERY_TICK_MS);
  }
  function stop() {
    clearEvery(timer); unwatch();
    document?.removeEventListener?.('visibilitychange', onVisibilityChange);
  }
  return { start, stop, evaluate, watchVideo, watched: () => watchedVideo };
}
