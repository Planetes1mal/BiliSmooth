// Validated BiliSmooth preferences shared by routing, the content scripts and the UI.
export const candidatePool = Object.freeze([
  'upos-sz-mirrorcosov.bilivideo.com', 'upos-sz-mirroraliov.bilivideo.com', 'upos-sz-mirrorhwov.bilivideo.com',
  'upos-sz-mirrorali.bilivideo.com', 'upos-tf-all-hw.bilivideo.com', 'upos-sz-mirrorhw.bilivideo.com',
  'upos-sz-mirrorcos.bilivideo.com', 'upos-tf-all-tx.bilivideo.com',
  'upos-sz-mirrorhwb.bilivideo.com'
]);
export const fixedHosts = candidatePool;
export const accents = Object.freeze(['blue', 'teal', 'green', 'orange', 'pink', 'graphite']);
export const floatingEntryTypes = Object.freeze(['icon', 'buffer', 'speed', 'combined']);
// Visual choices from earlier versions that still have a close equivalent; the rest fall back to the default.
const legacyAccents = Object.freeze({ bili: 'blue', emerald: 'green', sunset: 'orange', peach: 'orange' });
const legacyEntryTypes = Object.freeze({ 'status-logo': 'icon', logo: 'icon', status: 'icon' });
// Schema 5 marks a record written after teal stopped being the default accent (see settings-migration.js).
export const SCHEMA_VERSION = 5;
export const defaults = Object.freeze({ schemaVersion: SCHEMA_VERSION, enabled: true, selection: 'auto', mode: 'bad-only',
  pcdnHost: candidatePool[0], candidatePool, mcdnStrategy: 'proxy-all', proxyHost: 'proxy-tf-all-ws.bilivideo.com',
  portHeuristic: true, stallRecovery: true, rewriteAkamai: false, p2pGuard: false,
  lang: 'zh', accent: 'blue', theme: 'system', floatingEntryType: 'icon', maxDepth: 20 });
export const cacheKey = 'bilismooth.startup.v4';

function cleanHost(raw) {
  if (typeof raw !== 'string' || raw.length > 300) return '';
  return raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
}
export function isCdnHost(raw) {
  const host = cleanHost(raw);
  return /^upos-[a-z0-9-]+\.bilivideo\.(?:com|cn|net)$/.test(host);
}
// Keeps only valid known fields of a partial settings object.
export function patch(value) {
  const raw = value && typeof value === 'object' ? value : {}, result = {};
  const input = { ...raw, accent: legacyAccents[raw.accent] || raw.accent, floatingEntryType: legacyEntryTypes[raw.floatingEntryType] || raw.floatingEntryType };
  for (const key of ['enabled', 'portHeuristic', 'stallRecovery', 'rewriteAkamai', 'p2pGuard'])
    if (typeof input[key] === 'boolean') result[key] = input[key];
  for (const [key, values] of Object.entries({ selection: ['auto', 'fixed'], mode: ['off', 'bad-only', 'force'],
    mcdnStrategy: ['proxy-all', 'proxy-v1', 'replace'], lang: ['zh', 'en'], accent: accents, theme: ['system', 'light', 'dark'], floatingEntryType: floatingEntryTypes }))
    if (values.includes(input[key])) result[key] = input[key];
  if (isCdnHost(input.pcdnHost)) result.pcdnHost = cleanHost(input.pcdnHost);
  if (typeof input.proxyHost === 'string' && /^proxy-[a-z0-9-]+\.bilivideo\.(?:com|cn|net)$/.test(cleanHost(input.proxyHost))) result.proxyHost = cleanHost(input.proxyHost);
  return result;
}
// A complete settings object: defaults plus the valid fields of the input.
export function normalize(value) {
  const result = { ...defaults, ...patch(value), schemaVersion: SCHEMA_VERSION, candidatePool: [...candidatePool], maxDepth: 20 };
  if (value?.selection === 'fixed' && /\.akamaized\.net$/.test(cleanHost(value.pcdnHost))) result.selection = 'auto';
  return result;
}
const settings = Object.freeze({ defaults, normalize, patch, candidatePool, fixedHosts, accents, floatingEntryTypes, isCdnHost, cacheKey });
export default settings;
