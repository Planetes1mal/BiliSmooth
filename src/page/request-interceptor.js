// Browser integration for one window: fetch, XHR, JSON.parse and the playinfo globals.
// Routing and recovery are injected decisions; this layer only observes and applies them.
import { protectCapabilitySlots } from './sharing-guard.js';
import { installPayloadHooks } from './payload-hooks.js';
import { installFetchHook } from './fetch-hook.js';
import { installXhrHook } from './xhr-hook.js';
import { createSyntheticTimeouts } from './synthetic-timeout.js';

const installations = new WeakMap();

// options: scope, active(), route(url, detail), prepare(payload, source), begin(info), onTransfer(type, token, detail),
// fragmentKey(url, range), onSynthetic(event), sharingPolicy, onSharingBlock(name).
export function install(options) {
  const scope = options.scope || globalThis;
  if (installations.has(scope)) return installations.get(scope);
  const json = scope.JSON || JSON, parse = json.parse, stringify = json.stringify;
  const now = () => scope.performance?.now?.() ?? Date.now();
  let disposed = false;
  const isDisposed = () => disposed, active = () => !disposed && options.active();
  function route(value, detail) { try { return active() ? options.route(value, detail) : value; } catch { return value; } }
  function transform(value, source) {
    try { return options.prepare(value, source); } catch { return { value, changed: false }; }
  }
  function begin(originalUrl, url, transport, method, range) {
    try { return !disposed ? options.begin({ originalUrl, url, transport, method, range }) : null; } catch { return null; }
  }
  function transfer(token, detail, type = 'transfer') {
    if (disposed || !token) return;
    try { options.onTransfer(type, token, detail); } catch {}
  }
  const shared = { scope, json, parse, stringify, now, active, isDisposed, route, begin, transfer, transform };
  const fetchHook = installFetchHook(shared);
  let synthetic = null;
  const xhrHook = installXhrHook({ ...shared, fragmentKey: options.fragmentKey, onSent: tx => synthetic.confirmRetry(tx) });
  synthetic = createSyntheticTimeouts({ scope, now, active, onSynthetic: options.onSynthetic, xhr: xhrHook });
  function destroy() {
    if (disposed) return;
    disposed = true;
    synthetic.dispose(); fetchHook.dispose(); xhrHook.dispose(); payloadHooks.restore();
    installations.delete(scope);
  }
  const api = { destroy, syntheticTimeout: id => synthetic.trigger(id), syntheticStatus: () => synthetic.status() };
  installations.set(scope, api);
  const payloadHooks = installPayloadHooks({ scope, json, transform, isDisposed });
  if (options.sharingPolicy) protectCapabilitySlots(scope, options.onSharingBlock);
  return api;
}
const requestInterceptor = Object.freeze({ install });
export default requestInterceptor;
