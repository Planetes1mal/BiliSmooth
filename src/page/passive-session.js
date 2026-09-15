/* UI and local observations only. PlaybackKernel is the sole request scheduler. */
(function (scope) {
  'use strict';
  if (scope.BiliSmoothSession) return;
  const VERSION = "2.8.2";
  const settings = scope.BiliSmoothSettings, document = scope.document;
  const nativeParse = JSON.parse.bind(JSON), clone = value => nativeParse(JSON.stringify(value));
  const sameSetting = (a, b) => a === b || Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);
  const now = () => scope.performance.now();
  const connection = scope.navigator?.connection;
  const knownTransports = new Set(['bluetooth', 'cellular', 'ethernet', 'wifi', 'wimax']);
  const connectionType = () => knownTransports.has(connection?.type) ? connection.type : null;
  let networkTransport = connectionType();
  const hostOf = raw => { try { return typeof raw === 'string' && /^https?:\/\//i.test(raw) ? new URL(raw).hostname : null; } catch { return null; } };
  const catalog = scope.BiliSmoothCatalog.create(), frames = scope.BiliSmoothFrames.create();
  const listeners = new Set(), requests = new Map(), reloadReasons = new Set();
  let config = settings.normalize(), kernel = null, startupReady = false, observedPayload = false, configuring = true, earlyEdits = {};
  let player = null, playerListeners = [], frameCallback = null, waiting = false, suspended = false;
  let lastPosition = null, lastMovedAt = now(), graceUntil = 0, mediaGeneration = 0, networkEpoch = 0;
  let actualHost = null, requestedHost = null, audioHost = null, lastMbps = null, lastTransferAt = 0;
  let speedObservedAt = null, speedObservedFrom = null, speedClock = null;
  let events = [], episodes = [], activeEpisode = null, healthySince = null, speedWindows = [];
  let criticalEvents = [], observations = [], eventSerial = 0, droppedEvents = 0, droppedCriticalEvents = 0, droppedObservations = 0;
  let episodeSampleAt = null, episodeSampleKind = null;
  let speedHistory = [], speedSamples = [], bufferHistory = [], sampledAt = 0, timer = null;
  let current = { present: false, playback: 'idle', frameHealth: { state: 'unknown' } };
  let observedAt = 0, videoMeta = { title: '', url: '', coverUrl: '' }, metadataSignature = '', metadataTitle = '', pendingMetadataTitle = null, previousCoverUrl = '';
  let saveSerial = 0, latestSave = null, unsavedEdits = {}, settingsSave = { status: 'saved' };
  const pendingSaves = new Map(), SAVE_TIMEOUT_MS = 5000;
  let playbackSampledAt = null, startupSequence = 0, startupHistory = [], startupTimes = {};
  let startup = newStartup('session-start'), startupPaused = false, startupPlaybackStarted = false;
  let startupHealthySince = null, startupSampledAt = null;
  const counters = { stalls: 0, frameStalls: 0, recoveries: 0, switches: 0, bytes: 0, videoBytes: 0, audioBytes: 0, totalStallMs: 0 };
  try { config = settings.normalize(nativeParse(scope.localStorage.getItem(settings.cacheKey) || '{}')); } catch {}
  const installedP2pGuard = config.p2pGuard;
  function startupCache() { try { scope.localStorage.setItem(settings.cacheKey, JSON.stringify(config)); } catch {} }
  function newStartup(reason) {
    return { sequence: ++startupSequence, mediaGeneration, reason, startedAt: Date.now(), phase: 'preparing',
      playbackIntent: 'unknown', pauseEvidence: 'none', pauseAt: null, seekIntent: 'unknown', seekTransitions: 0,
      firstPlayIntentAt: null, firstPlayinfoAt: null, firstMediaRequestAt: null, firstResponseAt: null,
      firstValidByteAt: null, loadedMetadataAt: null, loadedDataAt: null, playingAt: null,
      firstPresentedFrameAt: null, firstFrameEvidence: 'unknown', stableFramesAt: null, stableFrameEvidence: null };
  }
  function markStartup(key) {
    if (startup[key] === null) { startup[key] = Date.now(); startupTimes[key] = now(); }
  }
  function startupSnapshot() {
    const duration = (from, to) => Number.isFinite(startupTimes[from]) && Number.isFinite(startupTimes[to]) ?
      Math.max(0, startupTimes[to] - startupTimes[from]) : null;
    return { ...startup, playinfoToPlayingMs: duration('firstPlayinfoAt', 'playingAt'),
      playinfoToFirstFrameMs: duration('firstPlayinfoAt', 'firstPresentedFrameAt'),
      requestToFirstByteMs: duration('firstMediaRequestAt', 'firstValidByteAt'),
      firstFrameToStableMs: duration('firstPresentedFrameAt', 'stableFramesAt') };
  }
  function resetStartup(reason) {
    startupHistory.push({ ...startupSnapshot(), finishedAt: Date.now(), outcome: reason });
    startupHistory = startupHistory.slice(-8);
    startup = newStartup(reason); startupTimes = {}; startupPaused = startupPlaybackStarted = false;
    startupHealthySince = startupSampledAt = null;
  }
  function startupPending() {
    return startup.firstMediaRequestAt !== null && !startupPlaybackStarted && !startupPaused && !player?.ended && !player?.error;
  }
  function observeStartup(time, quality) {
    if (startup.firstPresentedFrameAt === null) startup.firstFrameEvidence = !player ? 'unknown' :
      typeof player.requestVideoFrameCallback === 'function' ? 'pending-rvfc' : 'unsupported';
    // Quality counters can prove playback has begun, but cannot timestamp its first compositor submission.
    if (startup.loadedDataAt !== null && Number.isFinite(quality?.totalVideoFrames) && Number.isFinite(quality?.droppedVideoFrames) &&
      quality.droppedVideoFrames >= 0 && quality.totalVideoFrames > quality.droppedVideoFrames) startupPlaybackStarted = true;
    const healthy = active() && current.playback === 'playing' && current.frameHealth.state === 'healthy';
    if (!healthy || startupSampledAt !== null && time - startupSampledAt > 1500) startupHealthySince = null;
    startupSampledAt = time;
    if (healthy && startup.stableFramesAt === null) {
      if (startupHealthySince === null) startupHealthySince = time;
      if (time - startupHealthySince >= 2000) {
        markStartup('stableFramesAt'); startup.stableFrameEvidence = current.frameHealth.source;
      }
    }
    startup.phase = player?.error ? 'error' : player?.ended ? 'ended' : startupPaused ? 'paused' :
      player?.seeking ? startupPlaybackStarted ? 'seeking' : 'startup-seeking' : startup.stableFramesAt !== null ? 'stable' :
      startupPlaybackStarted ? healthy ? 'confirming-frames' : 'started' : 'preparing';
  }
  function observeStartupEvent(name) {
    if (name === 'play' || name === 'playing') {
      startupPaused = false; startup.pauseEvidence = 'none'; startup.playbackIntent = name + '-event'; markStartup('firstPlayIntentAt');
      if (name === 'playing') { markStartup('playingAt'); startupPlaybackStarted = true; }
    }
    // A pause event is explicit evidence of pause(), not proof of which actor called it.
    // paused=true alone also occurs while the initial media is still being prepared.
    if (name === 'pause') { startupPaused = true; startup.pauseEvidence = 'pause-event'; startup.pauseAt = Date.now(); }
    if (name === 'loadedmetadata') markStartup('loadedMetadataAt');
    if (name === 'loadeddata') markStartup('loadedDataAt');
    if (name === 'seeking') startup.seekTransitions++;
    if (['pause', 'ended', 'seeking', 'seeked', 'error'].includes(name)) startupHealthySince = null;
  }
  // Signed addresses stay in the private catalog/request map; event exports are an explicit whitelist.
  function log(type, fields = {}) {
    const row = { type: String(type).slice(0, 60), at: Number.isFinite(fields.at) ? fields.at : Date.now(), seq: ++eventSerial };
    for (const key of ['host', 'requestedHost', 'responseHost', 'fromHost', 'toHost', 'reason', 'source', 'transport', 'kind', 'outcome', 'action']) {
      if (typeof fields[key] === 'string') row[key] = fields[key].replace(/https?:\/\/\S+|\?\S+/g, '[redacted]').slice(0, 160);
    }
    for (const key of ['bytes', 'elapsedMs', 'durationMs', 'status', 'ageMs', 'buffer', 'mbps', 'readyState', 'playhead', 'rate', 'deadlineAt', 'dueInMs', 'delayMs', 'observedStallMs']) {
      if (Number.isFinite(fields[key])) row[key] = fields[key];
    }
    for (const key of ['paused', 'seeking', 'ended', 'hidden']) if (typeof fields[key] === 'boolean') row[key] = fields[key];
    if (fields.deadlineAt === null) row.deadlineAt = null;
    if (/^media-\d+$/.test(fields.id || '')) row.id = fields.id;
    events.push(row); if (events.length > 200) { events.shift(); droppedEvents++; }
    // Successful segment traffic must not evict the recovery timeline.
    const critical = !['request', 'route', 'transfer', 'progress'].includes(type) ||
      type === 'transfer' && !(fields.status >= 200 && fields.status < 300 && ['complete', 'unverified'].includes(fields.outcome));
    if (critical) {
      criticalEvents.push(row);
      if (criticalEvents.length > 800) { criticalEvents.shift(); droppedCriticalEvents++; }
    }
  }
  function notify() { for (const fn of listeners) { try { fn(); } catch {} } }
  function finishSave(id, ok, error = '') {
    const record = pendingSaves.get(id); if (!record) return;
    scope.clearTimeout(record.timer); pendingSaves.delete(id);
    if (ok) for (const [key, value] of Object.entries(record.patch)) {
      if (sameSetting(unsavedEdits[key], value)) delete unsavedEdits[key];
    }
    if (record === latestSave) {
      settingsSave = ok ? { status: 'saved' } : { status: 'error', error: error || 'storage-write-failed' };
      if (ok) reloadReasons.delete('storage-write-failed');
      else { reloadReasons.add('storage-write-failed'); log('settings-save-failed', { reason: settingsSave.error }); }
      notify();
    }
    record.resolve({ ok, error: error || 'storage-write-failed' });
  }
  function persist(patch = {}) {
    startupCache();
    unsavedEdits = { ...unsavedEdits, ...settings.patch(patch) };
    const id = 'save-' + Date.now() + '-' + (++saveSerial), record = { id, patch: clone(unsavedEdits) };
    record.promise = new Promise(resolve => { record.resolve = resolve; });
    record.timer = scope.setTimeout(() => finishSave(id, false, 'storage-ack-timeout'), SAVE_TIMEOUT_MS);
    pendingSaves.set(id, record); latestSave = record; settingsSave = { status: 'pending' };
    scope.postMessage({ __bilismoothConfig: 'save', config: clone(config), patch: record.patch, id }, scope.location.origin);
    notify();
  }
  async function flushSettings() {
    for (;;) {
      const record = latestSave; if (!record) return true;
      const result = await record.promise;
      if (record !== latestSave) continue;
      if (!result.ok) throw new Error(result.error);
      return true;
    }
  }
  const routingKeys = ['enabled', 'selection', 'mode', 'pcdnHost', 'mcdnStrategy', 'proxyHost', 'portHeuristic', 'rewriteAkamai'];
  function save(patch, authoritative = false) {
    const previous = config;
    if (!authoritative && !startupReady) earlyEdits = { ...earlyEdits, ...settings.patch(patch) };
    if (authoritative) patch = { ...patch, ...unsavedEdits, ...(!startupReady ? earlyEdits : {}) };
    const adoptRankedTarget = authoritative && !startupReady && config.selection === 'auto' && patch?.selection !== 'fixed' &&
      !earlyEdits.pcdnHost && kernel?.getState().ranking?.length > 0;
    if (adoptRankedTarget) patch = { ...patch, pcdnHost: config.pcdnHost };
    config = settings.normalize({ ...config, ...settings.patch(patch) });
    if (config.p2pGuard !== installedP2pGuard) reloadReasons.add('p2p-guard'); else reloadReasons.delete('p2p-guard');
    // Already delivered manifests cannot be un-enriched or switched back in place.
    if (observedPayload && routingKeys.some(key => config[key] !== previous[key])) reloadReasons.add('playinfo-config');
    if (authoritative && !startupReady) {
      startupReady = true;
      if (observedPayload && routingKeys.some(key => config[key] !== previous[key])) reloadReasons.add('startup-config');
    }
    if (authoritative) reloadReasons.delete('storage-read-failed');
    configuring = true;
    try { kernel?.setConfig(config); } finally { configuring = false; }
    const changed = Object.fromEntries(Object.entries(config).filter(([key, value]) => !sameSetting(previous[key], value)));
    startupCache(); if (!authoritative) persist({ ...settings.patch(patch), ...changed });
    else if (adoptRankedTarget) persist({ pcdnHost: config.pcdnHost });
    notify(); return clone(config);
  }
  function endEpisode(outcome) {
    if (!activeEpisode) return;
    accountEpisode(now());
    const finishedAt = outcome === 'recovered' && healthySince !== null ? healthySince : Date.now();
    const durationMs = finishedAt - activeEpisode.startedAt;
    const row = { ...activeEpisode, finishedAt, confirmedAt: Date.now(), durationMs, outcome };
    episodes.push(row); if (episodes.length > 60) episodes.shift();
    counters.totalStallMs += activeEpisode.observedStallMs;
    if (outcome === 'recovered') { counters.recoveries++; log('playback-recovered', { durationMs, observedStallMs: activeEpisode.observedStallMs, host: actualHost }); }
    else log('stall-ended', { durationMs, reason: outcome });
    activeEpisode = null; healthySince = null; episodeSampleAt = null; episodeSampleKind = null;
  }
  function accountEpisode(at) {
    if (activeEpisode && episodeSampleAt !== null) {
      const elapsed = Math.max(0, at - episodeSampleAt);
      // Missing JS observations are not proof of continuous picture freeze.
      if (elapsed > 1500) activeEpisode.unobservedMs += elapsed;
      else if (episodeSampleKind === 'stall') activeEpisode.observedStallMs += elapsed;
      else if (episodeSampleKind === 'seeking') activeEpisode.seekingMs += elapsed;
    }
    episodeSampleAt = at;
  }
  function observeEpisode() {
    const at = now(); accountEpisode(at);
    episodeSampleKind = player?.seeking ? 'seeking' : at < graceUntil ? 'other' : ['buffering', 'frozen'].includes(current.playback) ? 'stall' : 'other';
    if (!player || document.hidden || player.paused || player.ended || suspended) {
      endEpisode(document.hidden ? 'hidden' : 'inactive'); return;
    }
    // Player-initiated seeks are indistinguishable here from user seeks. Preserve an
    // existing incident until frames recover, without counting seeking as a stall.
    if (player.seeking) { healthySince = null; return; }
    if (at < graceUntil) { healthySince = null; return; }
    if (['buffering', 'frozen'].includes(current.playback)) {
      healthySince = null;
      if (!activeEpisode) {
        activeEpisode = { startedAt: Date.now(), kind: current.playback, fromHost: actualHost,
          observedStallMs: 0, seekingMs: 0, unobservedMs: 0, seekTransitions: 0 };
        counters.stalls++; if (current.playback === 'frozen') counters.frameStalls++;
        log(current.playback === 'frozen' ? 'frame-stalled' : 'stall', { host: actualHost, buffer: bufferSeconds(), ageMs: current.frameHealth.ageMs });
      }
    } else if (activeEpisode && current.playback === 'playing' && current.frameHealth.state === 'healthy') {
      if (healthySince === null) healthySince = Date.now();
      if (Date.now() - healthySince >= 2000) endEpisode('recovered');
    } else healthySince = null;
  }
  function onKernel(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'payload') {
      observedPayload = true;
      catalog.collect(event.original); catalog.collect(event.prepared || event.payload);
      markStartup('firstPlayinfoAt');
      log('playinfo', { source: event.source }); return;
    }
    if (event.type === 'config') {
      // Automatic ranking / rotation changes the target; it must persist without calling setConfig again.
      const previous = config;
      config = settings.normalize({ ...config, ...settings.patch(event.config) });
      if (!configuring && startupReady) persist(Object.fromEntries(Object.entries(config).filter(([key, value]) => !sameSetting(previous[key], value))));
      notify(); return;
    }
    if (event.type === 'request') {
      const track = catalog.request(event.originalUrl) || catalog.request(event.url);
      const entry = { ...event, track, previousBytes: 0, previousAt: event.startedAt ?? now(),
        lastByteAt: null, finished: false, epoch: networkEpoch, generation: mediaGeneration };
      requests.set(event.id, entry);
      while (requests.size > 256) requests.delete(requests.keys().next().value);
      if (track?.kind === 'video' || track?.kind === 'muxed') requestedHost = event.host || hostOf(event.url);
      if (track) markStartup('firstMediaRequestAt');
      log('request', { id: event.id, at: event.at, host: event.host, transport: event.transport, kind: track?.kind }); return;
    }
    if (event.type === 'progress' || event.type === 'transfer') {
      const entry = requests.get(event.id); if (!entry) return;
      const at = now(), bytes = Math.max(entry.previousBytes, Number(event.bytes) || 0), delta = bytes - entry.previousBytes;
      const responseHost = hostOf(event.responseUrl);
      const success = event.status >= 200 && event.status < 300;
      if (success && entry.track && entry.generation === mediaGeneration && entry.epoch === networkEpoch) {
        markStartup('firstResponseAt'); if (delta > 0) markStartup('firstValidByteAt');
      }
      if (delta > 0 && success && entry.generation === mediaGeneration && entry.epoch === networkEpoch) {
        counters.bytes += delta;
        if (entry.track?.kind === 'audio') { audioHost = responseHost; counters.audioBytes += delta; }
        else if (entry.track?.kind === 'video' || entry.track?.kind === 'muxed') {
          actualHost = responseHost; counters.videoBytes += delta; lastTransferAt = Date.now();
          advanceSpeedClock(at);
          if (!suspended && scope.navigator?.onLine !== false && at > entry.previousAt) {
            const start = Math.max(entry.previousAt, at - 3000);
            speedObservedFrom = speedObservedFrom === null ? start : Math.min(speedObservedFrom, start);
            speedWindows.push({ start: entry.previousAt, end: at, bytes: delta });
          }
          calculateSpeed(at);
        }
      }
      if (delta > 0) entry.lastByteAt = at;
      entry.previousBytes = bytes; entry.previousAt = at;
      if (event.type === 'transfer' && event.outcome !== 'response') {
        entry.finished = true; entry.status = event.status;
        log('transfer', { id: event.id, at: event.at, host: responseHost, responseHost,
          requestedHost: entry.host || hostOf(entry.url), transport: entry.transport, kind: entry.track?.kind,
          bytes, status: event.status, elapsedMs: event.elapsedMs, outcome: event.outcome });
      }
      if (event.outcome === 'response') { entry.status = event.status; entry.headersReceived = true; }
      return;
    }
    if (event.type === 'recovery-attempt') counters.switches++;
    log(event.type, event); notify();
  }
  function resetSpeed() {
    speedWindows = []; lastMbps = null; speedObservedAt = null; speedObservedFrom = null; speedClock = null;
    if (speedSamples.at(-1)?.mbps != null) { speedSamples.push({ at: Date.now(), mbps: null }); speedSamples = speedSamples.slice(-60); }
  }
  function advanceSpeedClock(at) {
    if (speedClock !== null && (at < speedClock || at - speedClock > 3000)) resetSpeed();
    speedClock = at;
  }
  function calculateSpeed(at) {
    advanceSpeedClock(at);
    if (!player || suspended || scope.navigator?.onLine === false) { resetSpeed(); return; }
    if (speedObservedFrom === null) { lastMbps = null; speedObservedAt = null; return; }
    speedWindows = speedWindows.filter(row => row.end > at - 3000).slice(-1024);
    const rows = speedWindows.map(row => ({ ...row, start: Math.max(row.start, at - 3000),
      bytes: row.bytes * Math.min(1, (row.end - Math.max(row.start, at - 3000)) / Math.max(1, row.end - row.start)) })).sort((a, b) => a.start - b.start);
    const elapsed = at - Math.max(speedObservedFrom, at - 3000), total = rows.reduce((sum, row) => sum + row.bytes, 0);
    // Throughput is bytes over the complete observed wall-clock window. Reusing
    // the last busy-interval rate turned ordinary segmented delivery into flat
    // plateaus followed by false gaps. A known quiet interval contributes zero;
    // before any transfer or after an observation gap the reading stays unknown.
    lastMbps = elapsed > 0 ? total * 8 / elapsed / 1000 : null;
    speedObservedAt = lastMbps === null ? null : Date.now();
  }
  kernel = scope.BiliSmoothPlaybackKernel.create({ scope, config, onEvent: onKernel,
    getPlayer: () => { bindPlayer(); return player; },
    classifyRequest: (originalUrl, url) => (catalog.request(originalUrl) || catalog.request(url))?.kind || 'unknown',
    // No refresh, callbacks or network decisions here: the sole scheduler reads a passive snapshot.
    getPlaybackEvidence: () => ({ player, sampledAt: playbackSampledAt, frameHealth: { ...current.frameHealth },
      playback: current.playback, buffer: bufferSeconds(), rate: player?.playbackRate || 1,
      mediaGeneration, startupPending: startupPending() }) });
  configuring = false;
  function resetNetwork(reason = 'manual') {
    networkTransport = connectionType();
    networkEpoch++; resetSpeed();
    // In-flight observations and the current media catalog survive network re-evaluation.
    kernel.resetNetwork(); log('network-reset', { reason }); notify(); return true;
  }
  function bufferSeconds() {
    if (!player) return 0;
    try { for (let i = 0; i < player.buffered.length; i++) if (player.currentTime >= player.buffered.start(i) - 0.05 && player.currentTime <= player.buffered.end(i)) return Math.max(0, player.buffered.end(i) - player.currentTime); } catch {}
    return 0;
  }
  function bufferWallSeconds(buffer = bufferSeconds()) {
    const rate = player?.playbackRate;
    return !player ? 0 : Number.isFinite(rate) && rate > 0 ? buffer / rate : null;
  }
  function cancelFrames() { if (frameCallback !== null) { player?.cancelVideoFrameCallback?.(frameCallback); frameCallback = null; } }
  function resetFrames() { cancelFrames(); frames.reset(now()); playbackSampledAt = null; }
  function active() { return !!player && !player.paused && !player.ended && !player.seeking && !document.hidden && !suspended; }
  function needsFrameCallback() {
    return active() || !!player && !player.ended && !player.error && !document.hidden && !suspended &&
      startup.firstPresentedFrameAt === null && !startupPaused;
  }
  function measureFrames() {
    if (!needsFrameCallback() || frameCallback !== null || !player.requestVideoFrameCallback) return;
    const video = player, generation = mediaGeneration;
    frameCallback = video.requestVideoFrameCallback((at, metadata) => {
      if (player !== video || generation !== mediaGeneration) return;
      frameCallback = null;
      if (!needsFrameCallback()) return;
      if (Number.isFinite(at) && Number.isInteger(metadata?.presentedFrames) && metadata.presentedFrames > 0 && Number.isFinite(metadata.mediaTime)) {
        markStartup('firstPresentedFrameAt'); startup.firstFrameEvidence = 'rvfc'; startupPlaybackStarted = true;
      }
      // rVFC's rendering-step timestamp can precede a sample that ran before
      // this queued callback. Feed one observation clock to the frame monitor;
      // otherwise a ~1 ms apparent rewind destroys an established baseline.
      if (active()) frames.frame({ now: now(), presentedFrames: metadata?.presentedFrames, mediaTime: metadata?.mediaTime });
      measureFrames();
    });
  }
  function choosePlayer() {
    const weight = video => {
      const rect = video.getBoundingClientRect?.(), area = rect ? rect.width * rect.height : video.videoWidth * video.videoHeight;
      return (video.closest?.('.bpx-player-container,.bilibili-player,#bilibili-player') ? 1e10 : 0) + (area > 0 ? 1e8 : 0) + (!video.paused ? 1e7 : 0) + (area || 0);
    };
    return [...document.querySelectorAll('video')].filter(video => video.isConnected !== false).sort((a, b) => weight(b) - weight(a))[0] || null;
  }
  function unbind() { resetFrames(); for (const [name, fn] of playerListeners) player?.removeEventListener(name, fn); playerListeners = []; }
  function bindPlayer() {
    const next = choosePlayer(); if (next === player) return;
    unbind(); if (player) { mediaGeneration++; resetSpeed(); endEpisode('player-change'); resetStartup('player-change'); catalog.activeVideo(null); catalog.activeAudio(null); actualHost = requestedHost = audioHost = null; }
    player = next; waiting = false; lastPosition = player?.currentTime ?? null; lastMovedAt = now();
    if (!player) return;
    for (const name of ['waiting', 'stalled', 'play', 'playing', 'pause', 'ended', 'seeking', 'seeked', 'loadedmetadata', 'loadeddata', 'ratechange', 'emptied', 'error']) {
      const fn = () => {
        // Kernel already records its own waiting/stalled/playing events.
        if (!['waiting', 'stalled', 'playing'].includes(name)) log('player-event', {
          source: name, playhead: player.currentTime, rate: player.playbackRate, readyState: player.readyState,
          paused: player.paused, seeking: player.seeking, ended: player.ended, hidden: document.hidden });
        accountEpisode(now());
        observeStartupEvent(name);
        if (name === 'loadedmetadata') { pendingMetadataTitle = null; metadataSignature = ''; }
        if (name === 'waiting' || name === 'stalled') waiting = true;
        if (['playing', 'pause', 'ended', 'seeked', 'loadeddata', 'emptied'].includes(name)) waiting = false;
        if (['pause', 'ended', 'emptied', 'error'].includes(name)) { resetFrames(); endEpisode(name); }
        if (name === 'seeking' || name === 'seeked') {
          resetFrames(); healthySince = null; graceUntil = now() + 1000; lastMovedAt = now();
          if (name === 'seeking' && activeEpisode) activeEpisode.seekTransitions++;
        }
        if (name === 'emptied') { mediaGeneration++; resetSpeed(); resetStartup('emptied'); catalog.activeVideo(null); catalog.activeAudio(null); actualHost = requestedHost = audioHost = null; }
        refresh(); observeEpisode(); notify();
      };
      player.addEventListener(name, fn, { passive: true }); playerListeners.push([name, fn]);
    }
  }
  function refresh() {
    if (suspended) return;
    bindPlayer(); const time = now();
    if (player && lastPosition !== null && player.currentTime > lastPosition + 0.005) lastMovedAt = time;
    lastPosition = player?.currentTime ?? null;
    const track = catalog.activeVideo(), width = player?.videoWidth || null, height = player?.videoHeight || null;
    const matches = track && (!track.width || track.width === width) && (!track.height || track.height === height);
    let quality; try { quality = player?.getVideoPlaybackQuality?.(); } catch {}
    const health = frames.sample({ now: time, active: active(), grace: time < graceUntil,
      playhead: player?.currentTime || 0, rate: player?.playbackRate || 1, fps: matches ? track.fps : null, quality });
    if (waiting && active() && player.readyState >= 3 && health.state === 'healthy' && time - lastMovedAt <= 1500) {
      waiting = false; log('waiting-cleared', { reason: 'frames-and-clock-advancing', readyState: player.readyState, playhead: player.currentTime });
    }
    let playback = !player || player.error || !player.readyState ? 'idle' : player.ended ? 'ended' : player.seeking ? 'seeking' : player.paused ? 'paused' : waiting || player.readyState < 3 ? 'buffering' : 'playing';
    if (playback === 'playing' && active() && (health.state === 'frozen' || health.source && health.reason === 'clock-not-advancing' && health.ageMs >= health.thresholdMs && time - lastMovedAt >= 2000)) playback = 'frozen';
    current = { present: !!player, playback, width, height, fps: matches && track.fps || null, fpsSource: matches && track.fps ? 'manifest' : null,
      duration: Number.isFinite(player?.duration) ? player.duration : null, currentTime: Number.isFinite(player?.currentTime) ? player.currentTime : null,
      frameHealth: playback === 'frozen' ? { ...health, state: 'frozen' } : health, readyState: player?.readyState ?? null,
      networkState: player?.networkState ?? null, errorCode: player?.error?.code ?? null,
      totalVideoFrames: quality?.totalVideoFrames ?? null, droppedVideoFrames: quality?.droppedVideoFrames ?? null };
    playbackSampledAt = time; observedAt = Date.now(); refreshVideoMeta(); observeStartup(time, quality);
    calculateSpeed(time);
    if (needsFrameCallback()) measureFrames(); else cancelFrames();
  }
  function refreshVideoMeta() {
    let url = '';
    try {
      const value = new URL(scope.location.href);
      if (value.protocol === 'https:' && /(^|\.)bilibili\.com$/.test(value.hostname) && /^\/(?:video\/(?:BV|av)[\w]+|bangumi\/play\/(?:ep|ss)\d+)(?:\/|$)/i.test(value.pathname)) url = value.origin + value.pathname;
    } catch {}
    const title = String(document.title || '').replace(/[_\s-]*(?:哔哩哔哩[_\s-]*)?bilibili\s*$/i, '').trim().slice(0, 240);
    if (url !== videoMeta.url) {
      const previousUrl = videoMeta.url;
      previousCoverUrl = videoMeta.coverUrl || previousCoverUrl;
      videoMeta = { title: '', url, coverUrl: '' }; metadataSignature = '';
      // A route can change before its title and cover. Keep the previous video's
      // metadata out of the new video's card while its DOM is still catching up.
      if (previousUrl && title === metadataTitle) pendingMetadataTitle = title;
    }
    if (!url) { metadataTitle = title; return; }
    if (pendingMetadataTitle !== null && title === pendingMetadataTitle) return;
    pendingMetadataTitle = null;
    let coverUrl = '';
    try {
      const raw = document.querySelector?.('meta[property="og:image"]')?.content || player?.poster || '';
      const image = new URL(raw, scope.location.href);
      if (raw && image.protocol === 'https:' && /(^|\.)(?:hdslb\.com|bilibili\.com)$/.test(image.hostname)) {
        image.search = ''; image.hash = ''; coverUrl = image.href;
      }
    } catch {}
    // Titles and covers arrive independently during navigation. Do not cache an
    // old cover under the new title or stop observing a later metadata update.
    if (coverUrl === previousCoverUrl) coverUrl = '';
    else if (coverUrl) previousCoverUrl = '';
    const signature = [url, title, mediaGeneration, coverUrl].join('|');
    if (signature === metadataSignature) return;
    videoMeta = { title, url, coverUrl }; metadataTitle = title; metadataSignature = signature;
  }
  function viewState() {
    const buffer = bufferSeconds(), rate = player?.playbackRate || 1, flags = kernel.getFlags?.() || {};
    // Read the session's existing observations only. Compact UI must not cause
    // another player scan, frame sample, rank construction or diagnostic clone.
    return { version: VERSION, media: { ...current, frameHealth: { ...current.frameHealth } }, config: clone(config),
      status: current.playback === 'playing' && current.frameHealth.state === 'healthy' ? 'smooth' : current.playback,
      observedAt, hidden: !!document.hidden, videoMeta: { ...videoMeta }, rate, buffer,
      bufferMediaSeconds: buffer, bufferWallSeconds: bufferWallSeconds(buffer),
      actualHost, requestedHost, targetHost: config.pcdnHost, audioHost, lastMbps, lastTransferAt, speedObservedAt,
      networkEpoch, mediaGeneration, startupReady, settingsSave: { ...settingsSave },
      probing: !!flags.probing, needReload: reloadReasons.size > 0 || !!flags.needReload,
      reloadReasons: [...reloadReasons], allowedHosts: [...settings.fixedHosts] };
  }
  function state() {
    refresh(); const k = kernel.getState(), rank = k.ranking || [], buffer = bufferSeconds(), rate = player?.playbackRate || 1;
    const effectiveRanking = [...new Set((Array.isArray(k.effectiveRanking) ? k.effectiveRanking : []).filter(host => settings.candidatePool.includes(host)))];
    const playbackFeedback = k.playbackFeedback?.version === 1 ? { version: 1,
      rows: (Array.isArray(k.playbackFeedback.rows) ? k.playbackFeedback.rows : []).filter(row => settings.candidatePool.includes(row?.host)).slice(0, 16).map(row => ({
        host: row.host, stableAt: Number.isFinite(row.stableAt) && row.stableAt > 0 ? row.stableAt : 0,
        timeouts: (Array.isArray(row.timeouts) ? row.timeouts : []).filter(at => Number.isFinite(at) && at > 0).slice(-16) })) } : null;
    const totals = { ...counters, totalStallMs: counters.totalStallMs + (activeEpisode?.observedStallMs || 0) };
    const ranking = [...new Set([...rank.map(row => typeof row === 'string' ? row : row.host), ...settings.candidatePool])].map(host => {
      const row = (k.probeSamples || []).find(sample => sample.host === host) || {};
      const feedback = playbackFeedback?.rows.find(item => item.host === host);
      return { host, ...row, mbps: Number.isFinite(row.mbps) ? row.mbps : null, samples: row.bytes > 0 ? 1 : 0,
        successes: row.bytes > 0 ? 1 : 0, failures: row.error ? 1 : 0, eligible: true, cooldownSec: 0, evidence: 'network-probe',
        recentVideoTimeouts: feedback?.timeouts.filter(at => Date.now() >= at && Date.now() - at < 120000).length || 0,
        lastStableAt: feedback?.stableAt || null };
    });
    return { ...viewState(), kernelVersion: 'playback-2.6.0',
      reason: current.playback === 'frozen' ? 'frame-stalled' : '', rate, buffer,
      bufferMediaSeconds: buffer, bufferWallSeconds: bufferWallSeconds(buffer),
      startup: startupSnapshot(), startupHistory: clone(startupHistory),
      actualHost, requestedHost, targetHost: config.pcdnHost, audioHost, lastMbps, lastTransferAt, speedObservedAt,
      probing: !!k.probing, probedAt: k.probedAt || 0, probeBytes: k.probeBytes || 0, rewriteCount: k.rewriteCount || 0,
      recoveryAttempts: k.recoveries || 0, ...totals, counters: totals, ranking, effectiveRanking, playbackFeedback, allowedHosts: [...settings.fixedHosts],
      networkEpoch, mediaGeneration, startupReady, settingsSave: { ...settingsSave }, needReload: reloadReasons.size > 0 || !!k.needReload, reloadReasons: [...reloadReasons],
      transaction: null, demand: { known: false, requiredMbps: null }, audioRecovery: null,
      history: [...bufferHistory], speedHistory: [...speedHistory], speedSamples: clone(speedSamples), sampledAt, events: clone(events) };
  }
  function tick() {
    if (suspended) return;
    refresh(); observeEpisode(); sampledAt = Date.now();
    speedHistory.push(lastMbps); speedHistory = speedHistory.slice(-45);
    speedSamples.push({ at: sampledAt, mbps: lastMbps }); speedSamples = speedSamples.slice(-60);
    bufferHistory.push(bufferSeconds()); bufferHistory = bufferHistory.slice(-45); notify();
    observations.push({ at: sampledAt, playhead: player?.currentTime ?? null, rate: player?.playbackRate || 1,
      playback: current.playback, frameHealth: current.frameHealth.state, readyState: player?.readyState ?? null,
      hidden: document.hidden, buffer: bufferSeconds(), bufferMediaSeconds: bufferSeconds(),
      bufferWallSeconds: bufferWallSeconds(),
      startupSequence: startup.sequence, startupPhase: startup.phase, actualHost, requestedHost, targetHost: config.pcdnHost,
      videoBytes: counters.videoBytes, audioBytes: counters.audioBytes, networkEpoch, mediaGeneration });
    if (observations.length > 600) { observations.shift(); droppedObservations++; }
  }
  function clearLogs() { events = []; criticalEvents = []; observations = []; episodes = []; droppedEvents = droppedCriticalEvents = droppedObservations = 0; }
  const api = {
    getState: state, getViewState: viewState, getConfig: () => clone(config), setConfig: save, flushSettings,
    applyRoute(host) { if (!settings.isCdnHost(host)) return false; save({ enabled: true, selection: 'fixed', pcdnHost: host, mode: config.mode === 'off' ? 'bad-only' : config.mode }); return true; },
    retry() { const result = kernel.retry(); notify(); return result !== false; }, resetNetwork,
    boost() { save({ enabled: true, mode: 'force' }); return true; },
    reload() { persist(); return true; },
    clearEvents() { clearLogs(); notify(); },
    clearData() { endEpisode('clear-data'); save(settings.defaults); resetNetwork('clear-data'); clearLogs(); for (const key of Object.keys(counters)) counters[key] = 0; notify(); },
    getDiagnostics() {
      // The current video's title and cover belong to the control UI only.
      // Keep diagnostic exports free of browsing titles and full URLs.
      const { videoMeta: uiMetadata, ...s } = state();
      const diagnosticEvents = [...new Map([...criticalEvents, ...events].map(row => [row.seq, row])).values()].sort((a, b) => a.at - b.at || a.seq - b.seq);
      return { ...s, diagnosticSchema: 2, events: clone(diagnosticEvents), observations: clone(observations),
        retention: { recentLimit: 200, criticalLimit: 800, observationLimit: 600, droppedEvents, droppedCriticalEvents, droppedObservations,
          firstEventAt: diagnosticEvents[0]?.at ?? null, lastEventAt: diagnosticEvents.at(-1)?.at ?? null },
        stallTiming: 'durationMs=incident span; totalStallMs=observed buffering/frozen intervals, excluding seeking and observation gaps',
        episodes: clone(episodes), activeEpisode: clone(activeEpisode),
        validation: 'see-release-validation',
        requests: [...requests.values()].filter(row => !row.finished && row.generation === mediaGeneration).slice(-16).map(row => ({
          ...(/^media-\d+$/.test(row.id || '') ? { id: row.id } : {}), host: row.host, transport: row.transport, kind: row.track?.kind || 'unknown', bytes: row.previousBytes,
          ageMs: Math.max(0, now() - row.startedAt), idleMs: Math.max(0, now() - (row.lastByteAt ?? row.startedAt)), networkEpoch: row.epoch })) };
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    rewriteUrl: raw => kernel.rewriteUrl ? kernel.rewriteUrl(raw) : raw
  };
  scope.BiliSmoothSession = scope.BiliSmoothRuntime = api;
  scope.addEventListener('message', event => {
    if (event.source !== scope || event.origin !== scope.location.origin) return;
    if (event.data?.__bilismoothConfig === 'config') save(event.data.config, true);
    if (event.data?.__bilismoothConfig === 'storageError') { reloadReasons.add('storage-read-failed'); log('settings-read-failed'); notify(); }
    if (event.data?.__bilismoothConfig === 'saved') finishSave(event.data.id, event.data.ok === true, event.data.error);
  });
  document.addEventListener('visibilitychange', () => { resetFrames(); endEpisode(document.hidden ? 'hidden' : 'foreground'); if (!document.hidden) { lastMovedAt = now(); refresh(); } });
  scope.addEventListener('online', () => resetNetwork('online'));
  connection?.addEventListener('change', () => {
    // This event also reports throughput/RTT estimates. Those measurements must
    // not restart probes or discard playback evidence for the current network.
    const previous = networkTransport; networkTransport = connectionType();
    if (previous && networkTransport && previous !== networkTransport) resetNetwork('connection-change');
  });
  scope.addEventListener('offline', () => { resetSpeed(); log('offline'); notify(); });
  scope.addEventListener('pagehide', () => { suspended = true; resetSpeed(); endEpisode('pagehide'); unbind(); scope.clearInterval(timer); });
  scope.addEventListener('pageshow', event => { if (event.persisted) { suspended = false; player = null; timer = scope.setInterval(tick, 1000); refresh(); } });
  function boot() { refresh(); scope.clearInterval(timer); timer = scope.setInterval(tick, 1000); scope.postMessage({ __bilismoothConfig: 'ready' }, scope.location.origin); }
  scope.postMessage({ __bilismoothConfig: 'ready' }, scope.location.origin);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})(globalThis);
