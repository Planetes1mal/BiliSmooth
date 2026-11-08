// Ends one hung media XHR through the player's own timeout callbacks so the player retries
// the Range on the race winner. At most one per Range; disabled for the page if the player
// does not retry within SYNTHETIC_RETRY_CHECK_MS.
import { constants as C } from '../core/delivery-policy.js';

const callbackProperties = ['onloadstart', 'onprogress', 'onabort', 'onerror', 'onload', 'ontimeout', 'onloadend', 'onreadystatechange'];

export function createSyntheticTimeouts({ scope, now, active, onSynthetic, xhr }) {
  const syntheticRanges = new Set(), pendingSynthetic = new Map();
  let disabled = false;
  function event(phase, checkpoint, extra = {}) {
    onSynthetic?.({ type: 'synthetic-timeout', phase, id: checkpoint.id, cid: checkpoint.cid, range: checkpoint.range,
      host: checkpoint.host, at: now(), ...extra });
  }
  // Called when the player sends a request: a send of the raced Range confirms the retry.
  function confirmRetry(tx) {
    const checkpoint = pendingSynthetic.get(tx.fragmentKey);
    if (!checkpoint) return;
    scope.clearTimeout(checkpoint.timer); pendingSynthetic.delete(tx.fragmentKey);
    const delayMs = now() - checkpoint.at;
    if (delayMs > C.SYNTHETIC_RETRY_CHECK_MS) {
      disabled = true; event('disabled', checkpoint, { reason: 'retry-not-observed-in-time', delayMs });
    } else event('retried', checkpoint, { retryId: tx.token.id, delayMs });
  }
  function trigger(id) {
    const tx = [...xhr.live].find(item => item.token?.id === id);
    // At most one per Range, on whichever attempt is in flight: the player may already have retried it.
    if (!active() || disabled || !tx || tx.finished || !tx.fragmentKey || syntheticRanges.has(tx.fragmentKey)
      || typeof tx.xhr.ontimeout !== 'function') return false;
    syntheticRanges.add(tx.fragmentKey);
    const target = tx.xhr, callbacks = Object.fromEntries(callbackProperties.map(name => [name, target[name]]));
    const checkpoint = { id, cid: tx.token.cid, range: tx.range, host: tx.token.host, at: now() };
    // Register before player callbacks: ontimeout can synchronously send its retry.
    pendingSynthetic.set(tx.fragmentKey, checkpoint);
    checkpoint.timer = scope.setTimeout(() => {
      pendingSynthetic.delete(tx.fragmentKey); disabled = true;
      event('disabled', checkpoint, { reason: 'retry-not-observed-in-time' });
    }, C.SYNTHETIC_RETRY_CHECK_MS);
    for (const name of callbackProperties) target[name] = null;
    xhr.outcome(tx, 'synthetic-timeout'); xhr.detach(tx, true); xhr.detachEarly(target);
    event('triggered', checkpoint);
    Reflect.apply(xhr.original.abort, target, []);
    for (const name of ['ontimeout', 'onloadend']) {
      const progress = new scope.ProgressEvent(name.slice(2));
      Object.defineProperties(progress, { target: { value: target }, currentTarget: { value: target } });
      callbacks[name]?.call(target, progress);
    }
    return true;
  }
  return {
    trigger, confirmRetry,
    status: () => ({ enabled: !disabled, pending: pendingSynthetic.size > 0 }),
    dispose() { for (const checkpoint of pendingSynthetic.values()) scope.clearTimeout(checkpoint.timer); pendingSynthetic.clear(); }
  };
}
