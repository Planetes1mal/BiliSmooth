// Turns the kernel's request, progress and transfer events into the session's byte counters,
// actual hosts, speed windows and startup milestones. Only the current media generation and
// network epoch count.
export function createTransferAccounting({ now, wallNow, catalog, speed, startup, log, hostOf, context }) {
  const requests = new Map();
  const counters = { switches: 0, bytes: 0, videoBytes: 0, audioBytes: 0 };
  let actualHost = null, requestedHost = null, audioHost = null, lastTransferAt = 0;
  function onRequest(event) {
    const track = catalog.request(event.originalUrl) || catalog.request(event.url), { mediaGeneration, networkEpoch } = context();
    const entry = { ...event, track, previousBytes: 0, previousAt: event.startedAt ?? now(), lastByteAt: null, finished: false, epoch: networkEpoch, generation: mediaGeneration };
    requests.set(event.id, entry);
    while (requests.size > 256) requests.delete(requests.keys().next().value);
    if (track?.kind === 'video' || track?.kind === 'muxed') requestedHost = event.host || hostOf(event.url);
    if (track) startup.mark('firstMediaRequestAt');
    log('request', { id: event.id, at: event.at, host: event.host, transport: event.transport, kind: track?.kind });
  }
  function onTransfer(event) {
    const entry = requests.get(event.id); if (!entry) return;
    const { mediaGeneration, networkEpoch, recording, observing } = context();
    const at = now(), bytes = Math.max(entry.previousBytes, Number(event.bytes) || 0), delta = bytes - entry.previousBytes;
    const responseHost = hostOf(event.responseUrl), success = event.status >= 200 && event.status < 300;
    const current = entry.generation === mediaGeneration && entry.epoch === networkEpoch;
    if (success && entry.track && current) { startup.mark('firstResponseAt'); if (delta > 0) startup.mark('firstValidByteAt'); }
    if (delta > 0 && success && current) {
      counters.bytes += delta;
      if (entry.track?.kind === 'audio') { audioHost = responseHost; counters.audioBytes += delta; }
      else if (entry.track?.kind === 'video' || entry.track?.kind === 'muxed') {
        actualHost = responseHost; counters.videoBytes += delta; lastTransferAt = wallNow();
        if (recording && at > entry.previousAt) speed.record(entry.previousAt, at, delta);
        speed.calculate(at, observing);
      }
    }
    if (delta > 0) entry.lastByteAt = at;
    entry.previousBytes = bytes; entry.previousAt = at;
    if (event.type === 'transfer' && event.outcome !== 'response') {
      entry.finished = true; entry.status = event.status;
      log('transfer', { id: event.id, at: event.at, host: responseHost, responseHost, requestedHost: entry.host || hostOf(entry.url),
        transport: entry.transport, kind: entry.track?.kind, bytes, status: event.status, elapsedMs: event.elapsedMs,
        firstByteMs: event.firstByteMs, completedAt: event.completedAt, outcome: event.outcome });
    }
    if (event.outcome === 'response') { entry.status = event.status; entry.headersReceived = true; }
  }
  function pending(mediaGeneration) {
    return [...requests.values()].filter(row => !row.finished && row.generation === mediaGeneration).slice(-16).map(row => ({
      ...(/^media-\d+$/.test(row.id || '') ? { id: row.id } : {}), host: row.host, transport: row.transport, kind: row.track?.kind || 'unknown', bytes: row.previousBytes,
      ageMs: Math.max(0, now() - row.startedAt), idleMs: Math.max(0, now() - (row.lastByteAt ?? row.startedAt)), networkEpoch: row.epoch }));
  }
  return { onRequest, onTransfer, pending, noteSwitch() { counters.switches++; },
    hosts: () => ({ actualHost, requestedHost, audioHost }), lastTransferAt: () => lastTransferAt,
    resetHosts() { actualHost = requestedHost = audioHost = null; },
    counters: () => ({ ...counters }), resetCounters() { for (const key of Object.keys(counters)) counters[key] = 0; lastTransferAt = 0; } };
}
