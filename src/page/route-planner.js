// Request routing for the current video: the policy's plan, overridden by measured decisions
// (a fragment retry host or the video's active host) in automatic mode. Also prepares payloads.
export function createRouter({ config, policy, delivery, ledger, state, log, emit, plainCopy, hostOf, onPayload }) {
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
  function planRoute(raw, { range = '' } = {}) {
    const session = delivery.current(), representation = delivery.get(raw), facts = policy().describe(raw);
    if (config().selection === 'auto' && session && representation?.cid === session.cid
      && facts.media && (facts.distribution || facts.international) && !facts.shared && !facts.live && !facts.scheduler && !facts.relaySource) {
      const row = ledger.retained(session.cid), fragment = row.fragments.get(ledger.fragmentKey(raw, range));
      let host = fragment?.host || (session.activeEpoch === ledger.epoch() ? session.activeHost : null);
      if (fragment?.failedHosts.size) {
        host = fragment.host && !fragment.failedHosts.has(fragment.host) ? fragment.host
          : row.runnerUp && !fragment.failedHosts.has(row.runnerUp) ? row.runnerUp : null;
        const url = host && delivery.addressForHost(raw, host);
        return { original: raw, url: url || raw, changed: !!url && url !== raw, reason: 'fragment-retry', targetHost: host };
      }
      const url = host && delivery.addressForHost(raw, host);
      if (url) return { original: raw, url, changed: url !== raw, reason: 'measured-route', targetHost: host };
    }
    return policy().route(raw);
  }
  function route(raw, context) {
    const result = planRoute(raw, context);
    if (result.changed) record([result], 'segment');
    return result.url;
  }
  return { prepare, planRoute, route };
}
