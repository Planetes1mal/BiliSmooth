/* Validated BiliSmooth preferences shared by routing and the control space. */
(function (scope) {
  'use strict';
  const candidatePool = Object.freeze([
    'upos-sz-mirrorcosov.bilivideo.com', 'upos-sz-mirroraliov.bilivideo.com', 'upos-sz-mirrorhwov.bilivideo.com',
    'upos-sz-mirrorali.bilivideo.com', 'upos-tf-all-hw.bilivideo.com', 'upos-sz-mirrorhw.bilivideo.com',
    'upos-sz-mirrorcos.bilivideo.com', 'upos-tf-all-tx.bilivideo.com',
    'upos-sz-mirrorhwb.bilivideo.com'
  ]);
  const fixedHosts = Object.freeze([...candidatePool, 'upos-hz-mirrorakam.akamaized.net', 'upos-sz-mirrorakam.akamaized.net']);
  const accents = Object.freeze(['peach', 'bili', 'teal', 'emerald', 'violet', 'pink', 'sunset', 'graphite']);
  const floatingEntryTypes = Object.freeze(['status-logo', 'logo', 'status', 'speed', 'buffer', 'combined', 'route', 'rate', 'resolution']);
  const defaults = Object.freeze({ schemaVersion: 4, enabled: true, selection: 'auto', mode: 'bad-only',
    pcdnHost: candidatePool[0], candidatePool, mcdnStrategy: 'proxy-all', proxyHost: 'proxy-tf-all-ws.bilivideo.com',
    portHeuristic: true, stallRecovery: true, adaptiveRecovery: true, rewriteAkamai: false, p2pGuard: false,
    lang: 'zh', accent: 'teal', theme: 'system', floatingFields: Object.freeze(['status', 'speed', 'buffer']),
    floatingEntryEnabled: true, floatingEntryType: 'status-logo', floatingEdgeSnap: true, maxDepth: 20 });
  const cacheKey = 'bilismooth.startup.v4';
  function cleanHost(raw) {
    if (typeof raw !== 'string' || raw.length > 300) return '';
    return raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  function isCdnHost(raw) {
    const host = cleanHost(raw);
    return /^upos-[a-z0-9-]+\.bilivideo\.(?:com|cn|net)$/.test(host) || /^upos-[a-z0-9-]+\.akamaized\.net$/.test(host);
  }
  function patch(value) {
    const input = value && typeof value === 'object' ? value : {}, result = {};
    for (const key of ['enabled', 'portHeuristic', 'stallRecovery', 'adaptiveRecovery', 'rewriteAkamai', 'p2pGuard', 'floatingEntryEnabled', 'floatingEdgeSnap'])
      if (typeof input[key] === 'boolean') result[key] = input[key];
    for (const [key, values] of Object.entries({ selection: ['auto', 'fixed'], mode: ['off', 'bad-only', 'force'],
      mcdnStrategy: ['proxy-all', 'proxy-v1', 'replace'], lang: ['zh', 'en'], accent: accents, theme: ['system', 'light', 'dark'], floatingEntryType: floatingEntryTypes }))
      if (values.includes(input[key])) result[key] = input[key];
    if (isCdnHost(input.pcdnHost)) result.pcdnHost = cleanHost(input.pcdnHost);
    if (typeof input.proxyHost === 'string' && /^proxy-[a-z0-9-]+\.bilivideo\.(?:com|cn|net)$/.test(cleanHost(input.proxyHost))) result.proxyHost = cleanHost(input.proxyHost);
    if (Array.isArray(input.floatingFields)) result.floatingFields = ['status', 'speed', 'buffer'].filter(field => input.floatingFields.includes(field));
    return result;
  }
  function normalize(value) {
    const result = { ...defaults, ...patch(value), schemaVersion: 4, candidatePool: [...candidatePool], maxDepth: 20 };
    result.floatingFields = [...result.floatingFields];
    return result;
  }
  const api = { defaults, normalize, patch, candidatePool, fixedHosts, accents, floatingEntryTypes, isCdnHost, cacheKey };
  scope.BiliSmoothSettings = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
