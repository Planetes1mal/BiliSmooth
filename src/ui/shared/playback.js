// What the UIs say about playback and the server choice, derived from the contract view.
const finite = value => typeof value === 'number' && Number.isFinite(value);

// One of: disconnected, waiting, smooth, playing, paused, buffering, frozen, seeking, ended, error, blocked.
// "smooth" needs recent, visible, healthy frame evidence (docs/architecture.md, Evidence).
export function projectPlayback(view, connected = true, now = Date.now()) {
  if (!connected || !view) return 'disconnected';
  if (view.availability) return 'blocked';
  const media = view.media || {};
  if (!media.present) return 'waiting';
  if (media.errorCode || media.playback === 'error') return 'error';
  if (media.ended || media.playback === 'ended') return 'ended';
  if (media.seeking || media.playback === 'seeking') return 'seeking';
  if (media.paused || media.playback === 'paused') return 'paused';
  if (media.playback === 'buffering') return 'buffering';
  if (media.playback === 'frozen' || media.frameHealth?.state === 'frozen') return 'frozen';
  if (media.playback !== 'playing') return 'waiting';
  const observedAt = view.observedAt || view.sampledAt, health = media.frameHealth || {};
  const fresh = finite(observedAt) && now >= observedAt - 1000 && now - observedAt <= 3000;
  return health.state === 'healthy' && fresh && !view.hidden && (!finite(health.ageMs) || health.ageMs <= Math.min(3000, health.thresholdMs || 3000)) ? 'smooth' : 'playing';
}

// Routing is active only when enabled and mode is not 'off' (routing-policy.js).
export const routingActive = config => !!config && config.enabled !== false && config.mode !== 'off';

// The server choice as one value: 'auto', 'default' (Bilibili default) or a fixed host.
export function serverChoice(config) {
  if (!routingActive(config)) return 'default';
  return config.selection === 'fixed' ? config.pcdnHost : 'auto';
}
// The settings patch for a choice. A fixed host goes through runtime.applyRoute instead.
export function choicePatch(choice, config) {
  if (choice === 'default') return { enabled: false };
  return { enabled: true, selection: 'auto', mode: config?.mode === 'off' ? 'bad-only' : config?.mode || 'bad-only' };
}

// Headline keys for the state banner, with a detail only where the headline cannot say why (availability).
// Availability and routing-off outrank playback.
export function statusKeys(view, state) {
  const reason = view?.availability?.reason;
  if (reason) return { tone: 'error', title: reason === 'payment' ? 'payment' : reason === 'region' ? 'region' : 'unavailable', detail: (reason === 'payment' ? 'payment' : reason === 'region' ? 'region' : 'unavailable') + 'Detail' };
  const tone = { smooth: 'ok', playing: 'ok', buffering: 'warn', frozen: 'error', error: 'error' }[state] || 'idle';
  if (!routingActive(view?.config) && ['smooth', 'playing'].includes(state)) return { tone: 'idle', title: 'defaultOn', detail: null };
  return { tone, title: state === 'disconnected' ? 'waiting' : state, detail: null };
}

// The last speed test in words, or null when there is nothing to report.
export function testResult(view, t, name) {
  const delivery = view?.delivery;
  if (!delivery || delivery.status === 'native') return null;
  if (delivery.status === 'testing') return { key: 'testing', text: t('testing') };
  const host = name(delivery.activeHost || view.actualHost || view.requestedHost) || '—';
  if (delivery.status === 'switched') return { key: 'switched', text: t('resultSwitched', { host }) };
  if (delivery.status === 'current-fastest') return { key: 'fastest', text: t('resultFastest', { host }) };
  return { key: 'kept', text: t('resultKept', { host }) };
}

// Why "Test speed" cannot run now, or null when it can.
export function testBlocker(view, t, now = Date.now()) {
  const delivery = view?.delivery;
  if (view?.availability) return t(statusKeys(view, 'blocked').detail);
  if (serverChoice(view?.config) !== 'auto') return t('testAutoOnly');
  if (delivery?.status === 'testing') return t('testing');
  const wait = Math.ceil(((delivery?.nextTestAt || 0) - now) / 1000);
  if (wait > 0) return t('cooldown', { n: wait });
  return delivery?.canTest ? null : t('testUnavailable');
}

// A measured speed must reach a quality's bit rate × playback rate × this margin before it is called likely enough:
// above the kernel's 1.3× stuck margin, with room for audio and bit-rate peaks. A race reads at most 768 KiB, so
// the result is an estimate, never a promise.
export const QUALITY_HEADROOM = 1.5;

// The current video's DASH qualities, best first: one row { id, height, bandwidth, current } per Bilibili quality
// number. A quality takes the bit rate of the codec the player requested last, or its highest bit rate when that
// codec does not offer it or nothing was requested yet. Empty when unknown.
export function videoQualities(session) {
  const files = (Array.isArray(session?.representations) ? session.representations : [])
    .filter(rep => rep?.kind === 'video' && finite(rep.id) && finite(rep.bandwidth) && rep.bandwidth > 0);
  const codec = files.find(rep => rep.requested)?.codecId ?? null, rows = new Map();
  for (const rep of files) {
    const known = rows.get(rep.id), same = codec !== null && rep.codecId === codec;
    if (!known || same && !known.same || same === known.same && rep.bandwidth > known.bandwidth) rows.set(rep.id, { rep, same });
  }
  return [...rows.values()].map(({ rep }) => ({ id: rep.id, height: finite(rep.height) && rep.height > 0 ? rep.height : null,
    bandwidth: rep.bandwidth, current: files.some(file => file.requested && file.id === rep.id) })).sort((a, b) => b.id - a.id);
}

// What a measured speed is likely enough for at this playback rate: { quality, short }, where quality is the best
// row it covers with headroom (null: likely to stutter even at the lowest) and short says it does not cover the
// quality being played. Null when the speed or the qualities are unknown.
export function qualityFit(goodputBps, qualities, rate) {
  if (!finite(goodputBps) || goodputBps < 0 || !Array.isArray(qualities) || !qualities.length) return null;
  const need = (finite(rate) && rate > 0 ? rate : 1) * QUALITY_HEADROOM, covers = row => goodputBps >= row.bandwidth * need;
  const quality = qualities.find(covers) || null, current = qualities.find(row => row.current);
  return { quality, short: !quality || !!current && !covers(current) };
}

// Per-server measurements for the Servers page, keyed by host. A server that served playback keeps its playback
// measurement; a server measured only by a speed test takes its newest completed video sample of the current network
// epoch: the whole request, first byte included, over at most 768 KiB, so it is a rough reading.
export function serverMeasurements(session, networkEpoch) {
  const rows = new Map((Array.isArray(session?.hosts) ? session.hosts : []).filter(row => row?.host).map(row => [row.host, row]));
  const tested = new Map();
  for (const race of Array.isArray(session?.races) ? session.races : []) {
    if (race?.track === 'audio' || !finite(race?.at) || finite(networkEpoch) && finite(race.networkEpoch) && race.networkEpoch !== networkEpoch) continue;
    for (const sample of Array.isArray(race.samples) ? race.samples : []) {
      if (!sample?.ok || !sample.host || rows.has(sample.host) || !finite(sample.bytes) || !finite(sample.elapsedMs) || sample.elapsedMs <= 0) continue;
      if (tested.get(sample.host)?.measuredAt >= race.at) continue;
      tested.set(sample.host, { host: sample.host, goodputBps: sample.bytes * 8000 / sample.elapsedMs,
        ttfbMedianMs: finite(sample.firstByteMs) ? sample.firstByteMs : null, measuredAt: race.at });
    }
  }
  for (const [host, row] of tested) rows.set(host, row);
  return rows;
}
