// Milestones of one media startup: playinfo, first request, first byte, metadata, playing,
// first presented frame and stable frames, with the phase the player is in. A new player or
// emptied media starts a new timeline and archives the old one.
export function createStartupTimeline({ now, wallNow }) {
  let sequence = 0, startup, times = {}, history = [], paused = false, playbackStarted = false, healthySince = null, sampledAt = null;
  function fresh(reason, mediaGeneration) {
    return { sequence: ++sequence, mediaGeneration, reason, startedAt: wallNow(), phase: 'preparing',
      playbackIntent: 'unknown', pauseEvidence: 'none', pauseAt: null, seekIntent: 'unknown', seekTransitions: 0,
      firstPlayIntentAt: null, firstPlayinfoAt: null, firstMediaRequestAt: null, firstResponseAt: null,
      firstValidByteAt: null, loadedMetadataAt: null, loadedDataAt: null, playingAt: null,
      firstPresentedFrameAt: null, firstFrameEvidence: 'unknown', stableFramesAt: null, stableFrameEvidence: null };
  }
  startup = fresh('session-start', 0);
  function mark(key) { if (startup[key] === null) { startup[key] = wallNow(); times[key] = now(); } }
  function snapshot() {
    const duration = (from, to) => Number.isFinite(times[from]) && Number.isFinite(times[to]) ? Math.max(0, times[to] - times[from]) : null;
    return { ...startup, playinfoToPlayingMs: duration('firstPlayinfoAt', 'playingAt'),
      playinfoToFirstFrameMs: duration('firstPlayinfoAt', 'firstPresentedFrameAt'),
      requestToFirstByteMs: duration('firstMediaRequestAt', 'firstValidByteAt'),
      firstFrameToStableMs: duration('firstPresentedFrameAt', 'stableFramesAt') };
  }
  function reset(reason, mediaGeneration) {
    history.push({ ...snapshot(), finishedAt: wallNow(), outcome: reason });
    history = history.slice(-8);
    startup = fresh(reason, mediaGeneration); times = {}; paused = playbackStarted = false;
    healthySince = sampledAt = null;
  }
  // True while media was requested but playback has not started and the user has not paused.
  function pending(player) {
    return startup.firstMediaRequestAt !== null && !playbackStarted && !paused && !player?.ended && !player?.error;
  }
  function observe(time, quality, { player, healthy, availability, frameSource }) {
    if (startup.firstPresentedFrameAt === null) startup.firstFrameEvidence = !player ? 'unknown' :
      typeof player.requestVideoFrameCallback === 'function' ? 'pending-rvfc' : 'unsupported';
    // Quality counters can prove playback has begun, but cannot timestamp its first compositor submission.
    if (startup.loadedDataAt !== null && Number.isFinite(quality?.totalVideoFrames) && Number.isFinite(quality?.droppedVideoFrames) &&
      quality.droppedVideoFrames >= 0 && quality.totalVideoFrames > quality.droppedVideoFrames) playbackStarted = true;
    if (!healthy || sampledAt !== null && time - sampledAt > 1500) healthySince = null;
    sampledAt = time;
    if (healthy && startup.stableFramesAt === null) {
      if (healthySince === null) healthySince = time;
      if (time - healthySince >= 2000) { mark('stableFramesAt'); startup.stableFrameEvidence = frameSource; }
    }
    startup.phase = availability || player?.error ? 'error' : player?.ended ? 'ended' : paused ? 'paused' :
      player?.seeking ? playbackStarted ? 'seeking' : 'startup-seeking' : startup.stableFramesAt !== null ? 'stable' :
      playbackStarted ? healthy ? 'confirming-frames' : 'started' : 'preparing';
  }
  function observeEvent(name) {
    if (name === 'play' || name === 'playing') {
      paused = false; startup.pauseEvidence = 'none'; startup.playbackIntent = name + '-event'; mark('firstPlayIntentAt');
      if (name === 'playing') { mark('playingAt'); playbackStarted = true; }
    }
    // A pause event is explicit evidence of pause(), not proof of which actor called it.
    // paused=true alone also occurs while the initial media is still being prepared.
    if (name === 'pause') { paused = true; startup.pauseEvidence = 'pause-event'; startup.pauseAt = wallNow(); }
    if (name === 'loadedmetadata') mark('loadedMetadataAt');
    if (name === 'loadeddata') mark('loadedDataAt');
    if (name === 'seeking') startup.seekTransitions++;
    if (['pause', 'ended', 'seeking', 'seeked', 'error'].includes(name)) healthySince = null;
  }
  function presentedFrame() { mark('firstPresentedFrameAt'); startup.firstFrameEvidence = 'rvfc'; playbackStarted = true; }
  return { mark, snapshot, reset, pending, observe, observeEvent, presentedFrame, history: () => history,
    current: () => startup, paused: () => paused, playbackStarted: () => playbackStarted };
}
