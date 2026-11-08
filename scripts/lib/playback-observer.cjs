'use strict';
const { playbackStalls } = require('./evidence.cjs');

function observe() {
  const connection = navigator.connection;
  const readConnection = () => connection ? { type: connection.type || null, effectiveType: connection.effectiveType || null,
    downlink: connection.downlink, rtt: connection.rtt, saveData: connection.saveData } : null;
  const state = window.__biliObservation = { events: [], videos: 0, firstPrimaryFrameAt: null, firstPrimaryFrameMediaTime: null,
    timeOrigin: performance.timeOrigin, initialConnection: readConnection(), connectionEvents: [] };
  connection?.addEventListener('change', () => state.connectionEvents.push({ at: performance.now(), ...readConnection() }));
  const watched = new WeakMap();
  window.__biliFramesFor = video => watched.get(video) || { videoId: null, frames: 0, lastFrameAt: null, firstFrameAt: null };
  function scan() {
    for (const video of document.querySelectorAll('video')) {
      if (watched.has(video)) continue;
      const frames = { videoId: ++state.videos, frames: 0, lastFrameAt: null, firstFrameAt: null };
      watched.set(video, frames);
      for (const event of ['play', 'playing', 'pause', 'waiting', 'stalled', 'seeking', 'seeked', 'loadedmetadata', 'loadeddata', 'error', 'ended']) {
        video.addEventListener(event, () => state.events.push({ event, videoId: frames.videoId, at: performance.now(), currentTime: video.currentTime,
          readyState: video.readyState, paused: video.paused, seeking: video.seeking, visibility: document.visibilityState,
          ...(event === 'error' ? { code: video.error?.code, message: video.error?.message } : {}) }));
      }
      function frame(now, metadata) {
        frames.frames++; frames.lastFrameAt = performance.now(); frames.lastFrameMediaTime = metadata.mediaTime;
        if (frames.firstFrameAt === null) frames.firstFrameAt = performance.now();
        if (state.firstPrimaryFrameAt === null && video === [...document.querySelectorAll('video')]
          .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]) {
          state.firstPrimaryFrameAt = performance.now(); state.firstPrimaryFrameMediaTime = metadata.mediaTime;
        }
        video.requestVideoFrameCallback(frame);
      }
      video.requestVideoFrameCallback(frame);
    }
  }
  new MutationObserver(scan).observe(document, { subtree: true, childList: true }); scan();
}
function snapshot() {
  const videos = [...document.querySelectorAll('video')];
  const video = videos.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  const frames = window.__biliFramesFor(video);
  const session = window.BiliSmoothRuntime?.getState();
  const nativeQuality = window.player?.getQuality?.();
  return { at: performance.now(), visibility: document.visibilityState, videoId: frames.videoId, frames: frames.frames, lastFrameAt: frames.lastFrameAt,
    firstFrameAt: frames.firstFrameAt, scheduler: { candidate: !!session, config: session?.config, version: session?.version,
      startupReady: session?.startupReady },
    nativeQuality: nativeQuality ? { nowQ: nativeQuality.nowQ, newQ: nativeQuality.newQ, realQ: nativeQuality.realQ } : null,
    media: video ? { currentTime: video.currentTime, duration: video.duration, paused: video.paused, seeking: video.seeking,
      readyState: video.readyState, ended: video.ended, rate: video.playbackRate, width: video.videoWidth, height: video.videoHeight,
      error: video.error?.code || null, buffered: Array.from({length: video.buffered.length}, (_, i) => [video.buffered.start(i), video.buffered.end(i)]),
      totalFrames: video.getVideoPlaybackQuality?.().totalVideoFrames, droppedFrames: video.getVideoPlaybackQuality?.().droppedVideoFrames } : null,
    quality: document.querySelector('.bpx-player-ctrl-quality-result')?.innerText?.trim() || null,
    speed: document.querySelector('.bpx-player-ctrl-playbackrate-result')?.textContent?.trim() || null };
}
function summarize(samples) {
  const stalls = playbackStalls(samples);
  const dimensions = [...new Set(samples.filter(s=>s.media?.width).map(s=>`${s.media.width}x${s.media.height}`))];
  const firstFrames = samples.map(sample => sample.firstFrameAt).filter(Number.isFinite);
  const presentedFrames = samples.reduce((total, sample, index) => total + (index > 0 && sample.videoId === samples[index - 1].videoId
    ? Math.max(0, sample.frames - samples[index - 1].frames) : 0), 0);
  return { observedMs: samples.length ? samples.at(-1).at - samples[0].at : 0,
    firstFrameFromNavigationMs: firstFrames.length ? Math.min(...firstFrames) : null, presentedFrames,
    dimensions, rates: [...new Set(samples.filter(s=>s.media).map(s=>s.media.rate))],
    activeForegroundSamples: samples.filter(s=>s.media&&!s.media.paused&&!s.media.seeking&&s.visibility==='visible').length,
    stalls, stallCount: stalls.length, totalObservedStallMs: stalls.reduce((sum,s)=>sum+s.durationMs,0),
    startClock: samples.find(s=>s.media)?.media.currentTime, endClock: samples.at(-1)?.media?.currentTime };
}

module.exports = { observe, snapshot, summarize };
