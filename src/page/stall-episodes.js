// Stall incidents of the current playback: when buffering or a frozen picture started, how much
// of it was observed, seeking and unobserved time, and whether healthy frames ended it.
export function createStallEpisodes({ now, wallNow, log }) {
  let episodes = [], active = null, healthySince = null, sampleAt = null, sampleKind = null;
  const counters = { stalls: 0, frameStalls: 0, recoveries: 0, totalStallMs: 0 };
  function account(at) {
    if (active && sampleAt !== null) {
      const elapsed = Math.max(0, at - sampleAt);
      // Missing JS observations are not proof of continuous picture freeze.
      if (elapsed > 1500) active.unobservedMs += elapsed;
      else if (sampleKind === 'stall') active.observedStallMs += elapsed;
      else if (sampleKind === 'seeking') active.seekingMs += elapsed;
    }
    sampleAt = at;
  }
  function end(outcome, actualHost) {
    if (!active) return;
    account(now());
    const finishedAt = outcome === 'recovered' && healthySince !== null ? healthySince : wallNow();
    const durationMs = finishedAt - active.startedAt;
    episodes.push({ ...active, finishedAt, confirmedAt: wallNow(), durationMs, outcome }); if (episodes.length > 60) episodes.shift();
    counters.totalStallMs += active.observedStallMs;
    if (outcome === 'recovered') { counters.recoveries++; log('playback-recovered', { durationMs, observedStallMs: active.observedStallMs, host: actualHost }); }
    else log('stall-ended', { durationMs, reason: outcome });
    active = null; healthySince = null; sampleAt = null; sampleKind = null;
  }
  // One observation per tick and per player event.
  function observe({ player, hidden, suspended, inGrace, playback, frameHealth, actualHost, buffer }) {
    const at = now(); account(at);
    sampleKind = player?.seeking ? 'seeking' : inGrace ? 'other' : ['buffering', 'frozen'].includes(playback) ? 'stall' : 'other';
    if (!player || hidden || player.paused || player.ended || suspended) { end(hidden ? 'hidden' : 'inactive', actualHost); return; }
    // Player-initiated seeks are indistinguishable here from user seeks. Preserve an
    // existing incident until frames recover, without counting seeking as a stall.
    if (player.seeking || inGrace) { healthySince = null; return; }
    if (['buffering', 'frozen'].includes(playback)) {
      healthySince = null;
      if (!active) {
        active = { startedAt: wallNow(), kind: playback, fromHost: actualHost, observedStallMs: 0, seekingMs: 0, unobservedMs: 0, seekTransitions: 0 };
        counters.stalls++; if (playback === 'frozen') counters.frameStalls++;
        log(playback === 'frozen' ? 'frame-stalled' : 'stall', { host: actualHost, buffer, ageMs: frameHealth.ageMs });
      }
    } else if (active && playback === 'playing' && frameHealth.state === 'healthy') {
      if (healthySince === null) healthySince = wallNow();
      if (wallNow() - healthySince >= 2000) end('recovered', actualHost);
    } else healthySince = null;
  }
  return { account, observe, end, noteSeek() { if (active) active.seekTransitions++; }, clearHealthy() { healthySince = null; },
    counters: () => ({ ...counters, totalStallMs: counters.totalStallMs + (active?.observedStallMs || 0) }),
    resetCounters() { for (const key of Object.keys(counters)) counters[key] = 0; },
    episodes: () => episodes, active: () => active, clear() { episodes = []; } };
}
