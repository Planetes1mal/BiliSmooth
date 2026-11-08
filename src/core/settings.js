// Validated BiliSmooth preferences shared by routing, the content scripts and the UI.
export const candidatePool = Object.freeze([
  'upos-sz-mirrorcosov.bilivideo.com', 'upos-sz-mirroraliov.bilivideo.com', 'upos-sz-mirrorhwov.bilivideo.com',
  'upos-sz-mirrorali.bilivideo.com', 'upos-tf-all-hw.bilivideo.com', 'upos-sz-mirrorhw.bilivideo.com',
  'upos-sz-mirrorcos.bilivideo.com', 'upos-tf-all-tx.bilivideo.com',
  'upos-sz-mirrorhwb.bilivideo.com'
]);
export const fixedHosts = candidatePool;
// Servers the user adds: a short saved list. Each can be the fixed server and joins automatic racing.
export const customHostsMax = 8;
export const accents = Object.freeze(['blue', 'teal', 'green', 'orange', 'pink', 'graphite']);
export const floatingEntryTypes = Object.freeze(['icon', 'buffer', 'speed', 'combined']);
// Visual choices from earlier versions that still have a close equivalent; the rest fall back to the default.
const legacyAccents = Object.freeze({ bili: 'blue', emerald: 'green', sunset: 'orange', peach: 'orange' });
const legacyEntryTypes = Object.freeze({ 'status-logo': 'icon', logo: 'icon', status: 'icon' });
// Schema 5 marks a record written after teal stopped being the default accent (see settings-migration.js).
export const SCHEMA_VERSION = 5;
export const defaults = Object.freeze({ schemaVersion: SCHEMA_VERSION, enabled: true, selection: 'auto', mode: 'bad-only',
  pcdnHost: candidatePool[0], candidatePool, customHosts: Object.freeze([]), mcdnStrategy: 'proxy-all', proxyHost: 'proxy-tf-all-ws.bilivideo.com',
  portHeuristic: true, stallRecovery: true, startOnBest: true, rewriteAkamai: false, p2pGuard: false,
  lang: 'zh', accent: 'blue', theme: 'system', floatingEntryType: 'icon', showFloating: true, maxDepth: 20 });
export const cacheKey = 'bilismooth.startup.v4';

function cleanHost(raw) {
  if (typeof raw !== 'string' || raw.length > 300) return '';
  return raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
}
// A UPOS mirror or a mainland bcache edge under bilivideo, without port or path. Hosts that routing-policy.js
// treats as shared never qualify: UPOS redirectors (`302` in the first label), mirror14b, MCDN relays, P2P,
// numeric and Akamai hosts.
const uposHost = /^upos-[a-z0-9-]+\.bilivideo\.(?:com|cn|net)$/;
const bcacheHost = /^cn-[a-z]{2,12}-[a-z]{2,12}-bcache-\d{1,3}\.bilivideo\.(?:com|cn|net)$/;
const sharedUpos = host => host.split('.')[0].includes('302') || host === 'upos-sz-mirror14b.bilivideo.com';
export function isCdnHost(raw) {
  const host = cleanHost(raw);
  return bcacheHost.test(host) || uposHost.test(host) && !sharedUpos(host);
}
// Valid, distinct hosts that are not built in, in the order given; at most customHostsMax.
function customList(list) {
  const result = [];
  for (const raw of list.slice(0, 64)) {
    const host = cleanHost(raw);
    if (result.length < customHostsMax && isCdnHost(host) && !candidatePool.includes(host) && !result.includes(host)) result.push(host);
  }
  return result;
}
// Keeps only valid known fields of a partial settings object.
export function patch(value) {
  const raw = value && typeof value === 'object' ? value : {}, result = {};
  const input = { ...raw, accent: legacyAccents[raw.accent] || raw.accent, floatingEntryType: legacyEntryTypes[raw.floatingEntryType] || raw.floatingEntryType };
  for (const key of ['enabled', 'portHeuristic', 'stallRecovery', 'startOnBest', 'rewriteAkamai', 'p2pGuard', 'showFloating'])
    if (typeof input[key] === 'boolean') result[key] = input[key];
  for (const [key, values] of Object.entries({ selection: ['auto', 'fixed'], mode: ['off', 'bad-only', 'force'],
    mcdnStrategy: ['proxy-all', 'proxy-v1', 'replace'], lang: ['zh', 'en'], accent: accents, theme: ['system', 'light', 'dark'], floatingEntryType: floatingEntryTypes }))
    if (values.includes(input[key])) result[key] = input[key];
  if (isCdnHost(input.pcdnHost)) result.pcdnHost = cleanHost(input.pcdnHost);
  if (Array.isArray(input.customHosts)) result.customHosts = customList(input.customHosts);
  if (typeof input.proxyHost === 'string' && /^proxy-[a-z0-9-]+\.bilivideo\.(?:com|cn|net)$/.test(cleanHost(input.proxyHost))) result.proxyHost = cleanHost(input.proxyHost);
  return result;
}
// A complete settings object: defaults plus the valid fields of the input.
export function normalize(value) {
  const valid = patch(value);
  const result = { ...defaults, ...valid, schemaVersion: SCHEMA_VERSION, candidatePool: [...candidatePool], customHosts: valid.customHosts || [], maxDepth: 20 };
  // A fixed route on a host that can no longer be fixed (Akamai, a shared UPOS host) becomes automatic.
  const fixedHost = cleanHost(value?.pcdnHost);
  if (value?.selection === 'fixed' && (/\.akamaized\.net$/.test(fixedHost) || uposHost.test(fixedHost) && sharedUpos(fixedHost))) result.selection = 'auto';
  return result;
}
const settings = Object.freeze({ defaults, normalize, patch, candidatePool, fixedHosts, customHostsMax, accents, floatingEntryTypes, isCdnHost, cacheKey });
export default settings;
