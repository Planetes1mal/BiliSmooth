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
// A rate in MB/s as { value, unit }. Under 1 MB/s it reads in KB/s, with a decimal below 10 KB/s so a slow but
// moving download never reads as 0; a rate that would round to 1000 KB/s reads as 1.00 MB/s.
export function megabytes(mb) {
  if (!finite(mb) || mb < 0) return null;
  const kb = mb * 1000;
  if (mb === 0 || kb >= 999.5) return { value: mb.toFixed(2), unit: 'MB/s', mb };
  return { value: kb < 0.05 ? '<0.1' : kb < 10 ? kb.toFixed(1) : kb.toFixed(0), unit: 'KB/s', mb };
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

// Bilibili's short names for its video quality numbers; an unknown number reads by its height, or null.
const qualities = { 127: '8K', 126: ['杜比视界', 'Dolby Vision'], 125: 'HDR', 120: '4K', 116: '1080P60', 112: '1080P+', 80: '1080P',
  74: '720P60', 64: '720P', 32: '480P', 16: '360P', 6: '240P' };
export function qualityName(row, lang) {
  const known = qualities[row?.id];
  if (known) return Array.isArray(known) ? known[lang === 'en' ? 1 : 0] : known;
  const height = row?.height;
  return finite(height) && height > 0 ? height >= 4320 ? '8K' : height >= 2160 ? '4K' : Math.round(height) + 'P' : null;
}
