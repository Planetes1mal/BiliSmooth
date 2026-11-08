// Per-video delivery coordination: the only place that decides measurement, racing, request
// targets and recovery. Composes the ledger, history, router, race coordinator and monitor.
import settings from '../core/settings.js';
import { createPolicy } from '../core/routing-policy.js';
import { create as createDeliverySession } from '../core/delivery-session.js';
import { constants as C } from '../core/delivery-policy.js';
import { install as installInterceptor } from './request-interceptor.js';
import { createHistoryStore } from './history-store.js';
import { createLedger } from './kernel-ledger.js';
import { createRouter } from './route-planner.js';
import { createRaceCoordinator } from './route-race.js';
import { createDeliveryMonitor } from './delivery-monitor.js';
import { createSnapshots } from './kernel-snapshot.js';

const instances = new WeakMap();

// options: scope, config, onEvent(event), getPlayer(), classifyRequest(originalUrl, url), getPlaybackEvidence().
export function createKernel(options = {}) {
  const root = options.scope || globalThis;
  if (instances.has(root)) return instances.get(root);
  const document = root.document, json = root.JSON || JSON;
  const nativeParse = json.parse, nativeStringify = json.stringify, nativeFetch = root.fetch;
  const plainCopy = value => Reflect.apply(nativeParse, json, [Reflect.apply(nativeStringify, json, [value])]);
  const now = () => root.performance?.now?.() ?? Date.now(), wallNow = () => root.Date?.now?.() ?? Date.now();
  const hostOf = raw => { try { return new URL(raw, root.location?.href).hostname; } catch { return ''; } };
  const absolute = raw => { try { return new URL(String(raw), root.location?.href).href; } catch { return String(raw || ''); } };
  let config = settings.normalize(options.config), policy = createPolicy(config), destroyed = false;
  const initialGuard = config.p2pGuard;
  const state = { rewriteCount: 0, lastMediaHost: null, needReload: false };
  const delivery = createDeliverySession({ pool: config.candidatePool }), syntheticHistory = new Map();
  const active = () => !destroyed && config.enabled && config.mode !== 'off';
  function emit(event) { if (!destroyed) try { options.onEvent?.({ at: wallNow(), ...event }); } catch {} }
  const log = (type, details = {}) => emit({ type, ...details });
  function playbackEvidence() {
    try {
      const data = options.getPlaybackEvidence?.();
      return data && data.player === monitor.watched() && Number.isFinite(data.sampledAt) && now() >= data.sampledAt
        && now() - data.sampledAt <= C.PLAYBACK_EVIDENCE_MAX_AGE_MS ? data : null;
    } catch { return null; }
  }
  function requestGeneration() { try { return options.getPlaybackEvidence?.()?.mediaGeneration; } catch { return undefined; } }
  function observedMediaUrl(raw, depth = 0) {
    try {
      const url = new URL(raw, root.location?.href);
      if (!['http:', 'https:'].includes(url.protocol)) return false;
      if (url.hostname === config.proxyHost && url.pathname === '/' && depth === 0) return observedMediaUrl(url.searchParams.get('url'), 1);
      if (!/\.(m4s|mp4|flv|m3u8)$/i.test(url.pathname) && !/^\/(upgcxcode|v1\/resource|live-bvc)\//.test(url.pathname)) return false;
      const kind = policy.describe(url);
      return kind.distribution || kind.international || kind.shared || kind.scheduler || !!url.port;
    } catch { return false; }
  }

  const store = createHistoryStore({ root, json, wallNow }), history = store.history;
  let interceptor = null, monitor = null, race = null;
  const ledger = createLedger({ delivery, now, wallNow, document, emit, hostOf, absolute, classifyRequest: options.classifyRequest,
    playbackEvidence, requestGeneration, watchedVideo: () => monitor.watched(), watchVideo: () => monitor.watchVideo(),
    recordHostFailure: (host, at) => { if (history.recordFailure(host, at)) store.save(); },
    onFragmentComplete: (key, host) => race.onFragmentComplete(key, host), afterChange: () => monitor.evaluate() });
  race = createRaceCoordinator({ root, document, now, wallNow, nativeFetch, config: () => config, active, delivery, ledger, history,
    saveHistory: store.save, log, interceptor: () => interceptor, watchedVideo: () => monitor.watched() });
  monitor = createDeliveryMonitor({ root, document, now, wallNow, config: () => config, active, delivery, ledger, race, playbackEvidence, getPlayer: options.getPlayer, log });
  const router = createRouter({ config: () => config, policy: () => policy, delivery, ledger, state, log, emit, plainCopy, hostOf, onPayload: () => race.stopIfOtherVideo() });
  const views = createSnapshots({ document, wallNow, nativeFetch, config: () => config, active, delivery, ledger, race, interceptor: () => interceptor, plainCopy, syntheticHistory, state });

  function beginRequest(info) {
    if (!observedMediaUrl(info.originalUrl) && !observedMediaUrl(info.url)) return null;
    const request = ledger.beginRequest(info.originalUrl, info.url, info.transport, info.method, info.range);
    state.lastMediaHost = request.host || state.lastMediaHost;
    return request;
  }
  function resetNetwork() {
    ledger.resetNetwork(); race.stop(); history.clear(); store.save();
    log('network-reset'); return views.getState();
  }
  function setConfig(next) {
    const before = config; config = settings.normalize({ ...config, ...next }); policy = createPolicy(config);
    if (before.enabled !== config.enabled || config.p2pGuard !== initialGuard) state.needReload = true;
    if (!active() || config.selection !== 'auto' || !config.stallRecovery) race.stop();
    emit({ type: 'config', config: plainCopy(config) }); return plainCopy(config);
  }
  function destroy() {
    if (destroyed) return; race.stop(); monitor.stop(); interceptor?.destroy();
    if (initialGuard) state.needReload = true;
    destroyed = true; instances.delete(root);
  }
  const api = { getConfig: () => plainCopy(config), setConfig, getFlags: views.getFlags, getState: views.getState, resetNetwork,
    retry: () => race.testRoutes(), testRoutes: race.testRoutes,
    rewriteUrl: (raw, context) => active() ? router.planRoute(raw, context).url : raw, destroy };
  instances.set(root, api);
  interceptor = installInterceptor({ scope: root, active, route: router.route, prepare: router.prepare, sharingPolicy: initialGuard,
    fragmentKey: (raw, range) => delivery.get(raw)?.kind === 'video' ? ledger.fragmentKey(raw, range) : null,
    onSynthetic(event) {
      const { cid, at, ...record } = event;
      if (!syntheticHistory.has(cid)) syntheticHistory.set(cid, []);
      syntheticHistory.get(cid).push({ ...record, at: wallNow() });
      log('synthetic-timeout', { phase: event.phase, id: event.id, host: event.host, reason: event.reason, delayMs: event.delayMs });
    },
    begin: beginRequest, onTransfer: ledger.reportTransfer,
    onSharingBlock: name => log('p2p-blocked', { api: name }) });
  monitor.start(); emit({ type: 'config', config: plainCopy(config) }); return api;
}
const playbackKernel = Object.freeze({ create: createKernel });
export default playbackKernel;
