// One bounded race per decision: the in-flight Range is fetched from two challengers; a completed
// sample that beats the current host switches the fragment or the whole video. Owns the race in progress.
import { constants as C, beatsCurrent } from '../core/delivery-policy.js';
import { race } from './network-probe.js';

export function createRaceCoordinator({ root, document, now, wallNow, nativeFetch, config, active, delivery, ledger, history, saveHistory, log, interceptor, watchedVideo }) {
  let measuredRace = null;
  function stop() { const round = measuredRace; measuredRace = null; round?.controller.abort(); }
  function stopIfOtherVideo() { if (measuredRace && measuredRace.cid !== delivery.current()?.cid) stop(); }
  function onFragmentComplete(key, host) { if (measuredRace?.key === key) measuredRace.completedHost ||= host; }
  function testRoutes({ request: selectedRequest, trigger = 'manual' } = {}) {
    const session = delivery.current();
    if (!active() || config().selection !== 'auto' || document?.hidden || measuredRace || !session || typeof nativeFetch !== 'function') return false;
    const row = ledger.retained(session.cid), at = wallNow(), epoch = ledger.epoch();
    if (row.switchCount >= C.MAX_SWITCHES_PER_VIDEO || at < row.nextTestAt || trigger !== 'manual' && at < row.nextAutomaticAt) return false;
    const request = selectedRequest || ledger.raceableRequest(session);
    if (!request || request.hiddenOverlap) return false;
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.range);
    if (!match) return false;
    const start = request.completedAt ? Number(match[2]) + 1 : Number(match[1]) + request.bytes;
    const end = request.completedAt ? start + C.RACE_SAMPLE_BYTES - 1 : Math.min(Number(match[2]), start + C.RACE_SAMPLE_BYTES - 1);
    if (start > end) return false;
    const rep = delivery.get(request.originalUrl), currentHost = request.host;
    const candidates = [...new Set([...rep.urls.keys(), ...config().candidatePool, ...config().customHosts])].filter(host => host !== currentHost)
      .map(host => ({ host, url: delivery.addressForHost(request.originalUrl, host) })).filter(target => target.url);
    const targets = history.challengers(candidates.map(target => target.host), config().customHosts).map(host => candidates.find(target => target.host === host));
    if (!targets.length) return false;
    const measured = ledger.measurementFor(session.cid, currentHost);
    const sustained = measured?.goodputBps ? Math.min(measured.goodputBps, measured.recentBps) : 0;
    row.failures = row.failures.filter(failure => at - failure.at <= C.ERROR_WINDOW_MS);
    const player = watchedVideo(), requiredBps = session.requiredBps * (player?.playbackRate || 1);
    // An audio sample is one small segment: it moves only its own Range and never rates a host.
    const audio = request.representationKind === 'audio';
    const keepHost = audio || trigger === 'stuck' && requiredBps > 0 && sustained >= requiredBps * C.SHORTFALL_RATE_FACTOR
      && !row.failures.some(failure => failure.host === currentHost);
    if (trigger === 'stuck' && !audio) ledger.noteHostFailure(request, currentHost);
    const currentRate = request.bytes * 8000 / ((request.completedAt || now()) - request.startedAt) || (request.completedAt ? sustained : 0);
    const rate = Math.min(currentRate, measured?.recentBps ?? Infinity);
    const currentMs = rate > 0 ? (end - start + 1) * 8000 / rate : Infinity;
    const record = { at, networkEpoch: epoch, currentHost, requestId: request.id, track: audio ? 'audio' : 'video', trigger, range: `bytes=${start}-${end}`, contenders: targets.map(target => target.host),
      currentMs: Number.isFinite(currentMs) ? currentMs : null, verdict: null, winner: null, runnerUp: null, samples: [], switched: false };
    row.races.push(record);
    session.lastRace = record;
    function decided() {
      row.automaticDelayMs = row.automaticDelayMs ? row.automaticDelayMs * C.RACE_COOLDOWN_MULTIPLIER : C.RACE_COOLDOWN_MS;
      row.nextTestAt = wallNow() + C.RACE_COOLDOWN_MS; row.nextAutomaticAt = wallNow() + row.automaticDelayMs;
    }
    const key = ledger.fragmentKey(request.originalUrl, request.range);
    const round = { cid: session.cid, key, completedHost: null, controller: new root.AbortController() }; measuredRace = round;
    log('race', { reason: 'started', id: request.id, host: currentHost });
    race({ scope: root, now, fetch: nativeFetch, signal: round.controller.signal, range: { start, end }, targets,
      onWinner(sample) {
        if (measuredRace !== round) return;
        record.winner = sample.host; record.samples = [sample];
        // Any attempt of the raced Range is a contender too, including the player's own retry elsewhere.
        if (round.completedHost && round.completedHost !== sample.host) { record.verdict = 'current-fastest'; decided(); }
        else if (beatsCurrent(sample.elapsedMs, currentMs)) {
          const previousHost = session.activeEpoch === epoch && session.activeHost || currentHost;
          const scope = keepHost || previousHost === sample.host ? 'fragment' : 'video';
          ledger.fragmentState(row, key).host = sample.host;
          if (scope === 'fragment') {
            if (!audio && (!session.activeHost || session.activeEpoch !== epoch)) session.activeHost = currentHost;
            record.verdict = 'fragment';
          } else {
            session.activeHost = sample.host; row.switchCount++; record.switched = true; record.verdict = 'switched';
          }
          if (!audio) session.activeEpoch = epoch;
          const change = { at: wallNow(), fromHost: currentHost, toHost: sample.host, scope, range: request.range };
          row.switches.push(change); log('switch', { ...change, id: request.id, reason: trigger });
          decided();
          // The player may have abandoned the raced attempt and retried the Range elsewhere.
          const attempt = [...ledger.mediaRequests.values()].reverse().find(item => item.host !== sample.host
            && ledger.fragmentKey(item.originalUrl, item.range) === key) || request;
          interceptor().syntheticTimeout(attempt.id);
        } else { record.verdict = sample.elapsedMs >= currentMs ? 'current-fastest' : 'below-margin'; decided(); }
      }
    }).then(result => {
      if (measuredRace !== round) return;
      measuredRace = null; history.recordRace(audio ? result.samples.filter(sample => !sample.ok) : result.samples); saveHistory(); record.samples = result.samples; record.runnerUp = result.runnerUp?.host || null; row.runnerUp = record.runnerUp;
      if (!record.winner) { record.verdict = 'no-completion'; decided(); }
      log('race', { reason: 'finished', id: request.id, host: record.winner || currentHost, bytes: result.totalBytes });
    });
    return true;
  }
  return { testRoutes, stop, stopIfOtherVideo, onFragmentComplete, racing: () => !!measuredRace, racingVideo: () => measuredRace?.cid ?? null };
}
