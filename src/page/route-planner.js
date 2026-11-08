// Request routing for the current video: the policy's plan, overridden by measured decisions
// (a fragment retry host or the video's active host) in automatic mode. Also prepares payloads.
// A video's first video request may set its active host from regional history (startOnBest).
export function createRouter({ config, policy, delivery, ledger, history, state, log, emit, plainCopy, hostOf, onPayload }) {
  const preparedPayloads = new WeakSet();
  function record(changes, source) {
    if (!changes.length) return;
    state.rewriteCount += changes.length;
    for (const row of changes) log('route', { source, reason: row.reason, fromHost: hostOf(row.original), toHost: hostOf(row.url) });
  }
  function prepare(value, source) {
    if (!value || typeof value !== 'object') return { value, changed: false };
    if (!preparedPayloads.has(value)) delivery.collect(value);
    onPayload();
    let original; try { original = plainCopy(value); } catch { original = null; }
    const prepared = policy().prepare(value);
    preparedPayloads.add(prepared.value);
    record(prepared.rewrites, source); emit({ type: 'payload', source, original, prepared: prepared.value, payload: prepared.value });
    return prepared;
  }
  const measurable = facts => facts.media && (facts.distribution || facts.international) && !facts.shared && !facts.live && !facts.scheduler && !facts.relaySource;
  // Once per video, at its first video request: start on the region's best known host instead of the issued one when
  // the history is trustworthy (playback-feedback.startHost). No request is added; recovery and races take over from it.
  function chooseStart(raw) {
    const session = delivery.current(), representation = delivery.get(raw);
    if (!session || representation?.cid !== session.cid || representation.kind !== 'video' || session.startChecked) return;
    session.startChecked = true;
    const facts = policy().describe(raw), epoch = ledger.epoch();
    if (!config().startOnBest || config().selection !== 'auto' || !measurable(facts) || session.activeEpoch === epoch && session.activeHost) return;
    const host = history.startHost(delivery.candidates(raw), { current: facts.host, requiredBps: representation.bandwidth });
    if (host) { session.activeHost = host; session.activeEpoch = epoch; session.startHost = host; }
  }
  // A failure on the start host before any race returns the video to the issued addresses and their order.
  function leaveFailedStart(session) {
    if (!session?.startHost || session.activeHost !== session.startHost || session.activeEpoch !== ledger.epoch()) return;
    const row = ledger.retained(session.cid);
    if (!row.races.length && row.failures.some(failure => failure.host === session.startHost)) session.activeHost = null;
  }
  function planRoute(raw, { range = '' } = {}) {
    const session = delivery.current(), representation = delivery.get(raw), facts = policy().describe(raw);
    if (config().selection === 'auto' && session && representation?.cid === session.cid && measurable(facts)) {
      const row = ledger.retained(session.cid), fragment = row.fragments.get(ledger.fragmentKey(raw, range));
      let host = fragment?.host || (session.activeEpoch === ledger.epoch() ? session.activeHost : null);
      if (fragment?.failedHosts.size) {
        host = fragment.host && !fragment.failedHosts.has(fragment.host) ? fragment.host
          : row.runnerUp && !fragment.failedHosts.has(row.runnerUp) ? row.runnerUp : null;
        const url = host && delivery.addressForHost(raw, host);
        return { original: raw, url: url || raw, changed: !!url && url !== raw, reason: 'fragment-retry', targetHost: host };
      }
      const url = host && delivery.addressForHost(raw, host);
      const reason = host === session.startHost && !fragment?.host && !row.switches.length ? 'history-start' : 'measured-route';
      if (url) return { original: raw, url, changed: url !== raw, reason, targetHost: host };
    }
    return policy().route(raw);
  }
  function route(raw, context) {
    leaveFailedStart(delivery.current()); chooseStart(raw);
    const result = planRoute(raw, context);
    if (result.changed) record([result], 'segment');
    return result.url;
  }
  return { prepare, planRoute, route };
}
