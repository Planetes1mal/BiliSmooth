// The page session: owns the kernel, the player observer and the settings sync, wires the
// kernel's events into the session's accounting and publishes the runtime contract.
import settings from '../core/settings.js';
import { create as createCatalog } from '../core/media-observer.js';
import { createKernel as defaultCreateKernel } from './playback-kernel.js';
import { createSettingsSync } from './settings-sync.js';
import { createEventLog } from './event-log.js';
import { createStartupTimeline } from './startup-timeline.js';
import { createStallEpisodes } from './stall-episodes.js';
import { createSpeedMeter } from './speed-meter.js';
import { createVideoMeta } from './video-meta.js';
import { createTransferAccounting } from './transfer-accounting.js';
import { createPlayerObserver } from './player-observer.js';
import { createRuntimeContract } from './ui-contract.js';

const sessions = new WeakMap();
const knownTransports = new Set(['bluetooth', 'cellular', 'ethernet', 'wifi', 'wimax']);

export function createSession({ scope, version = 'dev', createKernel = defaultCreateKernel } = {}) {
  if (sessions.has(scope)) return sessions.get(scope);
  const document = scope.document, json = scope.JSON || JSON;
  const nativeParse = json.parse, nativeStringify = json.stringify;
  const clone = value => Reflect.apply(nativeParse, json, [Reflect.apply(nativeStringify, json, [value])]);
  const now = () => scope.performance.now(), wallNow = () => (scope.Date || Date).now();
  const hostOf = raw => { try { return typeof raw === 'string' && /^https?:\/\//i.test(raw) ? new URL(raw).hostname : null; } catch { return null; } };
  const listeners = new Set(), notify = () => { for (const fn of listeners) { try { fn(); } catch {} } };
  const events = createEventLog({ wallNow }), log = events.log;
  const catalog = createCatalog(), startup = createStartupTimeline({ now, wallNow }), episodes = createStallEpisodes({ now, wallNow, log });
  const speed = createSpeedMeter({ now, wallNow }), meta = createVideoMeta({ scope, document });
  let networkEpoch = 0, kernel = null, timer = null, sampledAt = 0;
  const connection = scope.navigator?.connection;
  const connectionType = () => knownTransports.has(connection?.type) ? connection.type : null;
  let networkTransport = connectionType();
  const transfers = createTransferAccounting({ now, wallNow, catalog, speed, startup, log, hostOf,
    context: () => ({ mediaGeneration: observer.generation(), networkEpoch,
      recording: !observer.suspended() && scope.navigator?.onLine !== false,
      observing: !!observer.player() && !observer.suspended() && scope.navigator?.onLine !== false }) });
  const observer = createPlayerObserver({ scope, document, now, wallNow, catalog, startup, episodes, speed, meta, transfers, log, notify });
  const sync = createSettingsSync({ scope, wallNow, clone, log, notify, onConfig: config => kernel?.setConfig(config) });

  function onKernel(event) {
    if (!event || typeof event !== 'object') return;
    switch (event.type) {
      case 'payload':
        sync.markPayloadObserved(); catalog.collect(event.original); catalog.collect(event.prepared || event.payload);
        startup.mark('firstPlayinfoAt'); log('playinfo', { source: event.source }); return;
      case 'config': sync.adopt(event.config); return;
      case 'request': transfers.onRequest(event); return;
      case 'progress': case 'transfer': transfers.onTransfer(event); return;
      case 'switch': if (event.scope === 'video') transfers.noteSwitch(); break;
    }
    log(event.type, event); notify();
  }
  kernel = createKernel({ scope, config: sync.config(), onEvent: onKernel,
    getPlayer: () => { observer.bind(); return observer.player(); },
    classifyRequest: (originalUrl, url) => (catalog.request(originalUrl) || catalog.request(url))?.kind || 'unknown',
    getPlaybackEvidence: () => observer.evidence() });
  function resetNetwork(reason = 'manual') {
    observer.refresh(); if (observer.availability() && reason === 'manual') return false;
    networkTransport = connectionType();
    networkEpoch++; speed.reset();
    // In-flight observations and the current media catalog survive network re-evaluation.
    kernel.resetNetwork(); log('network-reset', { reason }); notify(); return true;
  }
  function clearData() {
    episodes.end('clear-data', transfers.hosts().actualHost); sync.save(settings.defaults); resetNetwork('clear-data');
    events.clear(); episodes.clear(); episodes.resetCounters(); transfers.resetCounters(); notify();
  }
  function tick() {
    if (observer.suspended()) return;
    observer.refresh(); observer.observeEpisode(); sampledAt = wallNow();
    speed.sample(sampledAt); notify();
    const player = observer.player(), current = observer.current(), hosts = transfers.hosts(), config = sync.config();
    events.observe({ at: sampledAt, playhead: player?.currentTime ?? null, rate: player?.playbackRate || 1,
      playback: current.playback, frameHealth: current.frameHealth.state, readyState: player?.readyState ?? null,
      hidden: document.hidden, buffer: observer.bufferSeconds(), bufferWallSeconds: observer.bufferWallSeconds(),
      startupSequence: startup.current().sequence, startupPhase: startup.current().phase, actualHost: hosts.actualHost, requestedHost: hosts.requestedHost,
      targetHost: config.selection === 'fixed' ? config.pcdnHost : kernel.getFlags().delivery?.activeHost || hosts.requestedHost,
      videoBytes: transfers.counters().videoBytes, audioBytes: transfers.counters().audioBytes, networkEpoch, mediaGeneration: observer.generation() });
  }
  const runtime = createRuntimeContract({ version, document, settings, sync, observer, meta, speed, transfers, episodes, startup, events, kernel, listeners, clone, notify,
    actions: { resetNetwork, clearData, networkEpoch: () => networkEpoch, sampledAt: () => sampledAt } });
  sessions.set(scope, runtime);

  scope.addEventListener('message', event => {
    if (event.source !== scope || event.origin !== scope.location.origin) return;
    sync.handleMessage(event.data);
  });
  document.addEventListener('visibilitychange', () => observer.onVisibilityChange());
  scope.addEventListener('online', () => resetNetwork('online'));
  connection?.addEventListener('change', () => {
    // This event also reports throughput/RTT estimates. Those measurements must
    // not discard playback evidence for the current network.
    const previous = networkTransport; networkTransport = connectionType();
    if (previous && networkTransport && previous !== networkTransport) resetNetwork('connection-change');
  });
  scope.addEventListener('offline', () => { speed.reset(); log('offline'); notify(); });
  scope.addEventListener('pagehide', () => { observer.suspend(); scope.clearInterval(timer); });
  scope.addEventListener('pageshow', event => { if (event.persisted) { timer = scope.setInterval(tick, 1000); observer.resume(); } });
  function boot() { observer.refresh(); scope.clearInterval(timer); timer = scope.setInterval(tick, 1000); scope.postMessage({ __bilismoothConfig: 'ready' }, scope.location.origin); }
  scope.postMessage({ __bilismoothConfig: 'ready' }, scope.location.origin);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
  return runtime;
}
