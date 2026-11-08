// Binds the page's main <video>, samples its state once per second and on player events, and
// classifies playback (idle, buffering, playing, frozen, paused, seeking, ended, error) from the
// element, the frame monitor and the page's availability notices. Drives the startup timeline,
// stall episodes, speed meter and video metadata; never touches the network.
import { create as createFrameMonitor } from './frame-monitor.js';

const playerEvents = ['waiting', 'stalled', 'play', 'playing', 'pause', 'ended', 'seeking', 'seeked', 'loadedmetadata', 'loadeddata', 'ratechange', 'emptied', 'error'];

export function createPlayerObserver({ scope, document, now, wallNow, catalog, startup, episodes, speed, meta, transfers, log, notify }) {
  const frames = createFrameMonitor();
  let player = null, listeners = [], frameCallback = null, waiting = false, suspended = false;
  let lastPosition = null, lastMovedAt = now(), graceUntil = 0, mediaGeneration = 0;
  let current = { present: false, playback: 'idle', frameHealth: { state: 'unknown' } }, availability = null;
  let sampledAt = null, observedAt = 0;

  const hostsOf = () => transfers.hosts().actualHost;
  function bufferSeconds() {
    if (!player) return 0;
    try { for (let i = 0; i < player.buffered.length; i++) if (player.currentTime >= player.buffered.start(i) - 0.05 && player.currentTime <= player.buffered.end(i)) return Math.max(0, player.buffered.end(i) - player.currentTime); } catch {}
    return 0;
  }
  function bufferWallSeconds(buffer = bufferSeconds()) {
    const rate = player?.playbackRate;
    return !player ? 0 : Number.isFinite(rate) && rate > 0 ? buffer / rate : null;
  }
  const active = () => !!player && !player.paused && !player.ended && !player.seeking && !document.hidden && !suspended;
  function cancelFrames() { if (frameCallback !== null) { player?.cancelVideoFrameCallback?.(frameCallback); frameCallback = null; } }
  function resetFrames() { cancelFrames(); frames.reset(now()); sampledAt = null; }
  function needsFrameCallback() {
    return active() || !!player && !player.ended && !player.error && !document.hidden && !suspended &&
      startup.current().firstPresentedFrameAt === null && !startup.paused();
  }
  function measureFrames() {
    if (!needsFrameCallback() || frameCallback !== null || !player.requestVideoFrameCallback) return;
    const video = player, generation = mediaGeneration;
    frameCallback = video.requestVideoFrameCallback((at, metadata) => {
      if (player !== video || generation !== mediaGeneration) return;
      frameCallback = null;
      if (!needsFrameCallback()) return;
      if (Number.isFinite(at) && Number.isInteger(metadata?.presentedFrames) && metadata.presentedFrames > 0 && Number.isFinite(metadata.mediaTime)) startup.presentedFrame();
      // rVFC's rendering-step timestamp can precede a sample that ran before this queued callback.
      // Feed one observation clock to the frame monitor; otherwise a ~1 ms apparent rewind destroys a baseline.
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
  // A new generation: the media source of the current video changed or a new player took over.
  function newGeneration(reason) {
    mediaGeneration++; speed.reset(); startup.reset(reason, mediaGeneration);
    catalog.activeVideo(null); catalog.activeAudio(null); transfers.resetHosts();
  }
  function unbind() { resetFrames(); for (const [name, fn] of listeners) player?.removeEventListener(name, fn); listeners = []; }
  function onPlayerEvent(name) {
    // The kernel already records its own waiting/stalled/playing events.
    if (!['waiting', 'stalled', 'playing'].includes(name)) log('player-event', {
      source: name, playhead: player.currentTime, rate: player.playbackRate, readyState: player.readyState,
      paused: player.paused, seeking: player.seeking, ended: player.ended, hidden: document.hidden });
    episodes.account(now());
    startup.observeEvent(name);
    if (name === 'loadedmetadata') meta.onLoadedMetadata();
    if (name === 'waiting' || name === 'stalled') waiting = true;
    if (['playing', 'pause', 'ended', 'seeked', 'loadeddata', 'emptied'].includes(name)) waiting = false;
    if (['pause', 'ended', 'emptied', 'error'].includes(name)) { resetFrames(); episodes.end(name, hostsOf()); }
    if (name === 'seeking' || name === 'seeked') {
      resetFrames(); episodes.clearHealthy(); graceUntil = now() + 1000; lastMovedAt = now();
      if (name === 'seeking') episodes.noteSeek();
    }
    if (name === 'emptied') newGeneration('emptied');
    refresh(); observeEpisode(); notify();
  }
  function bind() {
    const next = choosePlayer(); if (next === player) return;
    unbind(); if (player) { episodes.end('player-change', hostsOf()); newGeneration('player-change'); }
    player = next; waiting = false; lastPosition = player?.currentTime ?? null; lastMovedAt = now();
    if (!player) return;
    for (const name of playerEvents) {
      const fn = () => onPlayerEvent(name);
      player.addEventListener(name, fn, { passive: true }); listeners.push([name, fn]);
    }
  }
  // Region locks, paid-only videos and removed videos are read from the page, never requested.
  function readAvailability() {
    const block = document.getElementById?.('big-block-panel'), bounds = block?.getBoundingClientRect();
    if (bounds?.width > 0 && bounds.height > 0 && /所在的地区无法观看|限定中国大陆地区播放/.test(block.textContent || '')) return { reason: 'region' };
    const video = scope.__INITIAL_STATE__?.videoData;
    if ((!player || !player.readyState) && video?.is_upower_exclusive === true && video.is_upower_play === false && video.is_upower_preview === false) return { reason: 'payment' };
    const error = scope.__INITIAL_STATE__?.error;
    return (!player || !player.readyState) && (error?.trueCode === -404 || error?.code === 404) ? { reason: 'unavailable', code: -404 } : null;
  }
  function observeEpisode() {
    episodes.observe({ player, hidden: document.hidden, suspended, inGrace: now() < graceUntil, playback: current.playback,
      frameHealth: current.frameHealth, actualHost: hostsOf(), buffer: bufferSeconds() });
  }
  function refresh() {
    if (suspended) return;
    bind(); const time = now();
    availability = readAvailability();
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
    // Resuming a saved position before the first frame is a media wait, not a user seek.
    const startupSeek = player?.seeking && !startup.playbackStarted() && !startup.paused();
    let playback = availability ? 'error' : !player || player.error || !player.readyState ? 'idle' : player.ended ? 'ended' : startupSeek ? 'buffering' : player.seeking ? 'seeking' : player.paused ? 'paused' : waiting || player.readyState < 3 ? 'buffering' : 'playing';
    if (playback === 'playing' && active() && (health.state === 'frozen' || health.source && health.reason === 'clock-not-advancing' && health.ageMs >= health.thresholdMs && time - lastMovedAt >= 2000)) playback = 'frozen';
    current = { present: !!player, playback, width, height, fps: matches && track.fps || null, fpsSource: matches && track.fps ? 'manifest' : null,
      duration: Number.isFinite(player?.duration) ? player.duration : null, currentTime: Number.isFinite(player?.currentTime) ? player.currentTime : null,
      frameHealth: playback === 'frozen' ? { ...health, state: 'frozen' } : health, readyState: player?.readyState ?? null,
      networkState: player?.networkState ?? null, errorCode: player?.error?.code ?? null,
      totalVideoFrames: quality?.totalVideoFrames ?? null, droppedVideoFrames: quality?.droppedVideoFrames ?? null };
    sampledAt = time; observedAt = wallNow(); meta.refresh(player, mediaGeneration);
    startup.observe(time, quality, { player, healthy: active() && playback === 'playing' && current.frameHealth.state === 'healthy', availability, frameSource: current.frameHealth.source });
    speed.calculate(time, !!player && !suspended && scope.navigator?.onLine !== false);
    if (needsFrameCallback()) measureFrames(); else cancelFrames();
  }
  function onVisibilityChange() {
    resetFrames(); episodes.end(document.hidden ? 'hidden' : 'foreground', hostsOf());
    if (!document.hidden) { lastMovedAt = now(); refresh(); }
  }
  function suspend() { suspended = true; speed.reset(); episodes.end('pagehide', hostsOf()); unbind(); }
  function resume() { suspended = false; player = null; refresh(); }
  // The kernel reads this snapshot; no refresh, callbacks or network decisions happen here.
  function evidence() {
    bind();
    return { player, sampledAt, frameHealth: { ...current.frameHealth }, playback: current.playback, buffer: bufferSeconds(),
      rate: player?.playbackRate || 1, mediaGeneration, startupPending: startup.pending(player) };
  }
  return { bind, refresh, observeEpisode, onVisibilityChange, suspend, resume, evidence, active, bufferSeconds, bufferWallSeconds,
    player: () => player, current: () => current, availability: () => availability, generation: () => mediaGeneration,
    suspended: () => suspended, sampledAt: () => sampledAt, observedAt: () => observedAt, inGrace: () => now() < graceUntil };
}
