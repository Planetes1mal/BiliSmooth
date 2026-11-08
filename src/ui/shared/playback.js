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
