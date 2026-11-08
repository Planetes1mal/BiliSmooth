// Bounded diagnostic retention: recent events, the critical timeline that segment traffic
// cannot evict, and periodic state observations. Rows are a whitelist of fields; signed
// addresses never enter.
const RECENT_LIMIT = 200, CRITICAL_LIMIT = 800, OBSERVATION_LIMIT = 600;
const stringKeys = ['host', 'requestedHost', 'responseHost', 'fromHost', 'toHost', 'reason', 'source', 'transport', 'kind', 'outcome', 'action', 'phase'];
const numberKeys = ['bytes', 'elapsedMs', 'durationMs', 'status', 'ageMs', 'buffer', 'mbps', 'readyState', 'playhead', 'rate', 'deadlineAt', 'dueInMs', 'delayMs', 'observedStallMs', 'firstByteMs', 'completedAt'];
const booleanKeys = ['paused', 'seeking', 'ended', 'hidden'];
const routine = type => ['request', 'route', 'transfer', 'progress'].includes(type);

export function createEventLog({ wallNow }) {
  let events = [], criticalEvents = [], observations = [], serial = 0;
  let droppedEvents = 0, droppedCriticalEvents = 0, droppedObservations = 0;
  function log(type, fields = {}) {
    const row = { type: String(type).slice(0, 60), at: Number.isFinite(fields.at) ? fields.at : wallNow(), seq: ++serial };
    for (const key of stringKeys) if (typeof fields[key] === 'string') row[key] = fields[key].replace(/https?:\/\/\S+|\?\S+/g, '[redacted]').slice(0, 160);
    for (const key of numberKeys) if (Number.isFinite(fields[key])) row[key] = fields[key];
    for (const key of booleanKeys) if (typeof fields[key] === 'boolean') row[key] = fields[key];
    if (fields.deadlineAt === null) row.deadlineAt = null;
    if (/^media-\d+$/.test(fields.id || '')) row.id = fields.id;
    events.push(row); if (events.length > RECENT_LIMIT) { events.shift(); droppedEvents++; }
    // Successful segment traffic must not evict the recovery timeline.
    const critical = !routine(type) || type === 'transfer' && !(fields.status >= 200 && fields.status < 300 && ['complete', 'unverified'].includes(fields.outcome));
    if (critical) { criticalEvents.push(row); if (criticalEvents.length > CRITICAL_LIMIT) { criticalEvents.shift(); droppedCriticalEvents++; } }
    return row;
  }
  function observe(row) { observations.push(row); if (observations.length > OBSERVATION_LIMIT) { observations.shift(); droppedObservations++; } }
  function clear() { events = []; criticalEvents = []; observations = []; droppedEvents = droppedCriticalEvents = droppedObservations = 0; }
  function diagnosticEvents() {
    return [...new Map([...criticalEvents, ...events].map(row => [row.seq, row])).values()].sort((a, b) => a.at - b.at || a.seq - b.seq);
  }
  function retention(rows) {
    return { recentLimit: RECENT_LIMIT, criticalLimit: CRITICAL_LIMIT, observationLimit: OBSERVATION_LIMIT, droppedEvents, droppedCriticalEvents, droppedObservations,
      firstEventAt: rows[0]?.at ?? null, lastEventAt: rows.at(-1)?.at ?? null };
  }
  return { log, observe, clear, recent: () => events, observations: () => observations, diagnosticEvents, retention };
}
