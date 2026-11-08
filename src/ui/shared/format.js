// Turns contract values into display values. Unknown stays unknown: every function returns null
// (shown as —) instead of guessing, repeating an old sample or rounding to zero.
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const DASH = '—';

// Download speed from `lastMbps`, only while its 3 s window is fresh. Below 1 MB/s it reads in KB/s.
export function speed(view, now = Date.now()) {
  const at = view && Object.prototype.hasOwnProperty.call(view, 'speedObservedAt') ? view.speedObservedAt : view?.lastTransferAt;
  const age = now - at;
  if (!finite(at) || age < -1000 || age > 3000 || !finite(view?.lastMbps) || view.lastMbps < 0) return null;
  return megabytes(view.lastMbps / 8);
}
// A rate in MB/s as { value, unit }.
export function megabytes(mb) {
  if (!finite(mb) || mb < 0) return null;
  return mb > 0 && mb < 1 ? { value: (mb * 1000).toFixed(0), unit: 'KB/s', mb } : { value: mb.toFixed(2), unit: 'MB/s', mb };
}
// Playable wall-clock seconds at the current playback rate.
export function buffer(view) {
  const rate = finite(view?.rate) && view.rate > 0 ? view.rate : 1;
  const seconds = finite(view?.bufferWallSeconds) ? view.bufferWallSeconds : finite(view?.buffer) ? view.buffer / rate : null;
  return seconds === null || seconds < 0 ? null : seconds;
}
export const seconds = value => finite(value) && value >= 0 ? value.toFixed(1) : DASH;
export const wholeSeconds = value => finite(value) && value >= 0 ? String(Math.round(value)) : DASH;

// Elapsed wall time as a short age, or null when unknown.
export function age(at, t, now = Date.now()) {
  if (!finite(at) || at <= 0) return null;
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return t('justNow');
  return minutes < 60 ? t('minutesAgo', { n: minutes }) : t('hoursAgo', { n: Math.floor(minutes / 60) });
}

export function clock(at) {
  if (!finite(at)) return DASH;
  const date = new Date(at), pad = value => String(value).padStart(2, '0');
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

// Provider names for Bilibili's mirror hosts; anything else reads as its own short host.
const providers = {
  'upos-sz-mirrorcosov': ['腾讯云海外', 'Tencent overseas'], 'upos-sz-mirroraliov': ['阿里云海外', 'Alibaba overseas'],
  'upos-sz-mirrorhwov': ['华为云海外', 'Huawei overseas'], 'upos-sz-mirrorali': ['阿里云', 'Alibaba'], 'upos-sz-mirrorhw': ['华为云', 'Huawei'],
  'upos-sz-mirrorcos': ['腾讯云', 'Tencent'], 'upos-sz-mirrorhwb': ['华为云 B', 'Huawei B'], 'upos-tf-all-hw': ['华为云 TF', 'Huawei TF'],
  'upos-tf-all-tx': ['腾讯云 TF', 'Tencent TF'], 'upos-hz-mirrorakam': ['Akamai', 'Akamai']
};
export function hostLabel(host) {
  return host ? String(host).replace(/\.(?:bilivideo\.(?:com|cn|net)|akamaized\.net)$/, '') : null;
}
export function serverName(host, lang) {
  const label = hostLabel(host);
  if (!label) return null;
  const known = providers[label];
  return known ? known[lang === 'en' ? 1 : 0] : label;
}
