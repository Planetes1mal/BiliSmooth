// Request bookkeeping for the current video: in-flight video requests, per-video retention
// (switch counts, cooldowns, raced ranges, fragment hosts, failures, races, switches), per-host
// throughput and the network epoch that invalidates old evidence.
import { constants as C } from '../core/delivery-policy.js';
import { create as createThroughput } from '../core/throughput.js';

export function createLedger({ delivery, now, wallNow, document, emit, hostOf, absolute, classifyRequest, playbackEvidence, requestGeneration,
  watchedVideo, watchVideo, recordHostFailure, onFragmentComplete, afterChange }) {
  const videoRequests = new Map(), recentFragments = new Map(), retention = new Map(), measurements = new Map();
  let requestSerial = 0, networkEpoch = 0, mediaGeneration;

  function retained(cid) {
    if (!retention.has(cid)) retention.set(cid, { switchCount: 0, nextTestAt: 0, nextAutomaticAt: 0, automaticDelayMs: 0,
      raced: new Set(), fragments: new Map(), failures: [], races: [], switches: [], runnerUp: null });
    return retention.get(cid);
  }
  // Identity of one video or audio Range of one representation of one video.
  function fragmentKey(raw, range) {
    const rep = delivery.get(raw);
    return rep && ['video', 'audio'].includes(rep.kind) && /^bytes=\d+-\d+$/.test(range) ? `${rep.cid}|${rep.key}|${range}` : null;
  }
  function fragmentState(row, key) {
    if (!row.fragments.has(key)) row.fragments.set(key, { host: null, failedHosts: new Set() });
    return row.fragments.get(key);
  }
  function noteHostFailure(request, host) {
    if (request.deliveryFailureRecorded) return;
    request.deliveryFailureRecorded = true;
    const row = retained(request.cid), at = wallNow();
    row.failures = row.failures.filter(failure => at - failure.at <= C.ERROR_WINDOW_MS);
    row.failures.push({ host, at });
    recordHostFailure(host, at);
  }
  function clearMediaRequests() { videoRequests.clear(); recentFragments.clear(); }
  function beginRequest(originalUrl, url, transport, method, range = '') {
    // The first request from a replaced player can precede both observation
    // intervals. Synchronize ownership now so it is not tagged as old media.
    watchVideo();
    let kind = 'unknown';
    try { kind = classifyRequest?.(originalUrl, url) || kind; } catch {}
    const representation = delivery.request(originalUrl) || delivery.request(url);
    const evidence = playbackEvidence();
    const generation = evidence?.mediaGeneration ?? requestGeneration();
    if (generation !== mediaGeneration) { mediaGeneration = generation; clearMediaRequests(); }
    const request = { id: 'media-' + (++requestSerial), originalUrl: absolute(originalUrl), url: absolute(url), host: hostOf(url),
      transport, method, range, startedAt: now(), kind, networkEpoch,
      cid: representation?.cid ?? null, representationKind: representation?.kind ?? null,
      mediaGeneration: generation, player: watchedVideo() };
    if (request.representationKind === 'video' && transport === 'xhr') {
      request.bytes = 0; request.firstByteAt = null; request.hiddenOverlap = !!document?.hidden; videoRequests.set(request.id, request);
    }
    // DOM references are private request ownership, never part of event data.
    const { player, ...observed } = request;
    emit({ type: 'request', ...observed }); afterChange(); return request;
  }
  function reportTransfer(type, request, detail) {
    if (!request) return;
    const responseUrl = detail.responseUrl || '';
    const event = { type, id: request.id, host: responseUrl ? hostOf(responseUrl) : request.host, requestedHost: request.host,
      transport: request.transport, method: request.method, range: request.range, startedAt: request.startedAt,
      elapsedMs: Math.max(0, now() - request.startedAt), bytes: 0, complete: false, ...detail };
    emit(event);
    if (videoRequests.has(request.id)) {
      request.bytes = event.bytes; request.firstByteAt = event.firstByteAt; request.hiddenOverlap = event.hiddenOverlap;
      if (type === 'transfer') {
        videoRequests.delete(request.id);
        if (event.complete) { request.completedAt = event.completedAt; recentFragments.set(request.cid, request); }
      }
    }
    if (type === 'transfer' && request.cid && request.networkEpoch === networkEpoch) {
      const key = fragmentKey(request.originalUrl, request.range);
      if (key && !event.hiddenOverlap) {
        const player = watchedVideo();
        // An abort counts as a failure only when the player had no reason of its own to cancel.
        const failed = ['timeout', 'network-error', 'http-error'].includes(event.outcome)
          || event.outcome === 'aborted' && !event.complete && (request.representationKind === 'video' || !(event.bytes > 0))
            && request.mediaGeneration === requestGeneration() && request.player === player && event.elapsedMs >= C.NO_RESPONSE_MS
            && (playbackEvidence()?.startupPending || !player?.seeking && !player?.paused);
        if (failed) {
          fragmentState(retained(request.cid), key).failedHosts.add(event.host);
          if (request.representationKind === 'video') noteHostFailure(request, event.host);
        } else if (event.complete) {
          retained(request.cid).fragments.delete(key);
          onFragmentComplete(key, event.host);
        }
      }
      let meter = measurements.get(request.cid);
      if (!meter) { meter = createThroughput(); measurements.set(request.cid, meter); }
      meter.record({ host: event.host, kind: request.representationKind, transport: request.transport,
        range: /^bytes=\d+-\d*$/.test(request.range) ? request.range : '', bytes: event.bytes, elapsedMs: event.elapsedMs,
        firstByteMs: event.firstByteMs, completedAt: event.completedAt, hidden: event.hiddenOverlap,
        outcome: event.complete ? event.outcome : 'incomplete' });
    }
    afterChange();
  }
  // The request a race measures: the foreground in-flight video request, else the last completed fragment.
  function raceableRequest(session) {
    return [...videoRequests.values()].find(item => item.cid === session.cid && !item.hiddenOverlap) || recentFragments.get(session.cid) || null;
  }
  const measurementFor = (cid, host) => measurements.get(cid)?.snapshot().find(row => row.host === host);
  function resetNetwork() {
    networkEpoch++; clearMediaRequests(); measurements.clear();
    for (const row of retention.values()) { row.fragments.clear(); row.failures = []; row.runnerUp = null; }
  }
  function markHidden() { for (const request of videoRequests.values()) request.hiddenOverlap = true; }
  return { retained, fragmentKey, fragmentState, noteHostFailure, beginRequest, reportTransfer, clearMediaRequests, raceableRequest,
    measurementFor, measurements, videoRequests, resetNetwork, markHidden, epoch: () => networkEpoch,
    generation: () => mediaGeneration };
}
