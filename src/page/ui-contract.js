// The contract between the playback core and both UIs. The floating control calls this object
// directly as `BiliSmoothRuntime`; the dashboard reaches it through the control bridge by command
// name. Everything the UI may read or do is defined here, nowhere else.

// Commands the dashboard may send through the content script. 'state' and 'diagnostics' read; the
// rest act. 'resetFloatingPosition' is handled by the floating control itself.
export const COMMANDS = Object.freeze(['state', 'diagnostics', 'config', 'applyRoute', 'retry', 'reset', 'reload', 'clearEvents', 'clearData', 'resetFloatingPosition']);
// Commands whose settings write must be acknowledged by storage before the bridge replies.
export const SAVING_COMMANDS = Object.freeze(['config', 'applyRoute', 'clearData', 'reload']);

// View state, cheap enough for every render of the floating control: cached observations only,
// no DOM scan, no frame sample, no session records.
//   version          build version string
//   media            { present, playback, width, height, fps, fpsSource, duration, currentTime, frameHealth, readyState, networkState, errorCode, totalVideoFrames, droppedVideoFrames }
//   status           'smooth' when playing with healthy frames, otherwise media.playback
//   availability     null, or { reason: 'region' | 'payment' | 'unavailable' } read from the page
//   config           the normalized settings
//   observedAt       wall time of the last sample
//   hidden           document.hidden at the time of the call
//   videoMeta        { title, url, coverUrl } of the current video (UI only; never in diagnostics)
//   rate, buffer, bufferWallSeconds   playback rate, playable media seconds, and the same divided by the rate (null when the rate is unknown)
//   actualHost, requestedHost, targetHost   where video bytes came from, where the last video request went, where the next one goes
//   lastMbps, speedObservedAt, lastTransferAt   download speed over the last complete 3 s window (null = unknown), when it was observed, when video bytes last arrived
//   mediaGeneration, startupReady          media source counter; whether the authoritative settings have arrived
//   settingsSave     { status: 'saved' | 'pending' | 'error', error? }
//   delivery         { status, nativeHost, activeHost, nextTestAt, canTest, comparedHosts } from the kernel
//   needReload, reloadReasons              whether a settings change needs a page reload, and why
//   allowedHosts     the fixed-route host list
// Full state (dashboard, once per second) adds: startup, startupHistory, session (per-video delivery record),
// counters { stalls, frameStalls, recoveries, switches, bytes, videoBytes, audioBytes, totalStallMs }, recoveryAttempts,
// audioHost, networkEpoch, speedSamples, sampledAt, events (recent log rows).
export function createRuntimeContract({ version, document, settings, sync, observer, meta, speed, transfers, episodes, startup, events, kernel, listeners, clone, notify, actions }) {
  function view() {
    const config = sync.config(), current = observer.current(), flags = kernel.getFlags(), hosts = transfers.hosts();
    const buffer = observer.bufferSeconds(), rate = observer.player()?.playbackRate || 1;
    return { version, media: { ...current, frameHealth: { ...current.frameHealth } }, availability: observer.availability() && { ...observer.availability() },
      status: current.playback === 'playing' && current.frameHealth.state === 'healthy' ? 'smooth' : current.playback,
      config: clone(config), observedAt: observer.observedAt(), hidden: !!document.hidden, videoMeta: meta.current(),
      rate, buffer, bufferWallSeconds: observer.bufferWallSeconds(buffer),
      actualHost: hosts.actualHost, requestedHost: hosts.requestedHost,
      targetHost: config.selection === 'fixed' ? config.pcdnHost : flags.delivery?.activeHost || hosts.requestedHost,
      lastMbps: speed.mbps(), speedObservedAt: speed.observedAt(), lastTransferAt: transfers.lastTransferAt(),
      mediaGeneration: observer.generation(), startupReady: sync.startupReady(), settingsSave: sync.status(),
      delivery: flags.delivery, needReload: sync.needsReload() || !!flags.needReload, reloadReasons: sync.reloadReasons(),
      allowedHosts: [...settings.fixedHosts] };
  }
  function state() {
    observer.refresh();
    const k = kernel.getState(), counters = { ...transfers.counters(), ...episodes.counters() };
    return { ...view(), startup: startup.snapshot(), startupHistory: clone(startup.history()), session: k.session,
      counters, recoveryAttempts: k.session?.switches.length || 0, audioHost: transfers.hosts().audioHost,
      networkEpoch: actions.networkEpoch(), speedSamples: clone(speed.samples()), sampledAt: actions.sampledAt(), events: clone(events.recent()) };
  }
  // Exports keep hosts, times and Ranges; never signed URLs, cookies, page titles or page text.
  function diagnostics() {
    const { videoMeta, ...rest } = state();
    const rows = events.diagnosticEvents();
    return { ...rest, diagnosticSchema: 2, rewriteCount: kernel.getState().rewriteCount, events: clone(rows), observations: clone(events.observations()),
      retention: events.retention(rows),
      stallTiming: 'durationMs=incident span; totalStallMs=observed buffering/frozen intervals, excluding seeking and observation gaps',
      episodes: clone(episodes.episodes()), activeEpisode: clone(episodes.active()), requests: transfers.pending(observer.generation()) };
  }
  return Object.freeze({
    version,
    getConfig: () => clone(sync.config()), getViewState: view, getState: state, getDiagnostics: diagnostics,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setConfig: patch => sync.save(patch), flushSettings: () => sync.flush(),
    applyRoute(host) {
      if (!settings.isCdnHost(host)) return false;
      sync.save({ enabled: true, selection: 'fixed', pcdnHost: host, mode: sync.config().mode === 'off' ? 'bad-only' : sync.config().mode }); return true;
    },
    retry() { observer.refresh(); if (observer.availability()) return false; const result = kernel.retry(); notify(); return result !== false; },
    resetNetwork: actions.resetNetwork, reload() { sync.persist(); return true; },
    clearEvents() { events.clear(); episodes.clear(); notify(); }, clearData: actions.clearData,
    // Test hook for the lifecycle check: the route the kernel would give a media URL now.
    rewriteUrl: raw => kernel.rewriteUrl(raw)
  });
}
