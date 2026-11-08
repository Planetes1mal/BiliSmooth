// Read-only views of the kernel: the compact delivery flags for the floating control and the
// full per-video session record for the dashboard and diagnostics. Hosts only, never signed URLs.
import { constants as C } from '../core/delivery-policy.js';

export function createSnapshots({ document, wallNow, nativeFetch, config, active, delivery, ledger, race, interceptor, plainCopy, syntheticHistory, state }) {
  function deliveryView() {
    const session = delivery.current(), row = session && ledger.retained(session.cid), epoch = ledger.epoch();
    const last = session?.lastRace?.networkEpoch === epoch ? session.lastRace : null;
    const request = session && ledger.raceableRequest(session);
    const status = race.racing() ? 'testing' : last?.verdict === 'switched' ? 'switched' : last?.verdict === 'current-fastest' ? 'current-fastest' : last ? 'compared' : 'native';
    return { status, nativeHost: session?.nativeHost || null, activeHost: session?.activeEpoch === epoch ? session.activeHost : null,
      nextTestAt: row?.nextTestAt || 0,
      canTest: !!(active() && config().selection === 'auto' && !document?.hidden && !race.racing() && request && !request.hiddenOverlap
        && /^bytes=\d+-\d+$/.test(request.range) && row.switchCount < C.MAX_SWITCHES_PER_VIDEO && wallNow() >= row.nextTestAt && typeof nativeFetch === 'function'),
      comparedHosts: row ? [...new Set(row.races.flatMap(item => [item.currentHost, ...item.contenders]))].length : 0 };
  }
  function sessionSnapshot() {
    const session = delivery.snapshot(), current = delivery.current();
    const row = session && ledger.retained(session.cid);
    return session ? { ...session, hosts: ledger.measurements.get(session.cid)?.snapshot() || [],
      nativeHost: current.nativeHost || null, switchCount: row.switchCount, nextTestAt: row.nextTestAt, nextAutomaticAt: row.nextAutomaticAt,
      races: plainCopy(row.races), switches: plainCopy(row.switches),
      activeHost: current.activeEpoch === ledger.epoch() ? current.activeHost : null, startHost: current.startHost || null,
      syntheticTimeouts: { ...interceptor().syntheticStatus(), events: plainCopy(syntheticHistory.get(session.cid) || []) },
      racing: race.racingVideo() === session.cid, lastRace: current.lastRace ? plainCopy(current.lastRace) : null } : null;
  }
  const getFlags = () => ({ needReload: state.needReload, delivery: deliveryView() });
  const getState = () => ({ ...plainCopy(state), config: plainCopy(config()), session: sessionSnapshot() });
  return { deliveryView, sessionSnapshot, getFlags, getState };
}
