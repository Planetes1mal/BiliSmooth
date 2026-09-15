/* BiliSmooth delivery plans. Protocol facts, policy intents and address rendering
 * are separate operations; none performs transport, storage or recovery. */
(function (scope) {
  'use strict';
  const Settings = scope.BiliSmoothSettings || (typeof require === 'function' ? require('./settings.js') : null);
  if (!Settings) throw Error('BiliSmoothSettings is required');
  const Query = scope.URLSearchParams || new URL('https://www.bilibili.com/').searchParams.constructor;
  // Service domains and URL fields are interoperability data.
  const namespaces = [
    { suffixes: ['bilivideo.com', 'bilivideo.cn', 'bilivideo.net'], tag: 'distribution' },
    { suffixes: ['akamaized.net'], tag: 'international' },
    { suffixes: ['szbdyd.com', 'mountaintoys.cn', 'nexusedgeio.com', 'ahdohpiechei.com'], tag: 'shared' },
    { suffixes: ['mcdn.bilivideo.com', 'mcdn.bilivideo.cn', 'mcdn.bilivideo.net'], tag: 'relay-source' },
    { suffixes: ['szbdyd.com'], tag: 'scheduler' }
  ];
  const within = (host, suffix) => host === suffix || host.endsWith('.' + suffix);
  const sharedMarker = params => Array.from(params).some(([key, value]) => key.toLowerCase() === 'os' && value.toLowerCase() === 'mcdn');
  function readAddress(input) {
    if (typeof input !== 'string' && !(input instanceof URL)) return null;
    try {
      const url = new URL(input, 'https://www.bilibili.com/');
      if (!['https:', 'http:'].includes(url.protocol)) return null;
      const host = url.hostname, labels = host.split('.'), tags = new Set();
      for (const group of namespaces) if (group.suffixes.some(suffix => within(host, suffix))) tags.add(group.tag);
      const numeric = host.startsWith('[') || labels.length === 4 && labels.every(label => /^\d+$/.test(label));
      const redirector = labels[0].startsWith('upos-') && labels[0].includes('302');
      if (numeric || redirector || host === 'upos-sz-mirror14b.bilivideo.com' || sharedMarker(url.searchParams)) tags.add('shared');
      if (tags.has('relay-source')) tags.add('shared');
      const media = /\.(m4s|mp4|flv|m3u8)$/i.test(url.pathname)
        || ['upgcxcode', 'v1/resource', 'live-bvc'].some(prefix => url.pathname.startsWith('/' + prefix + '/'));
      const authorityEnd = url.href.indexOf('/', url.href.indexOf('://') + 3);
      return { canonical: url.href, host, authority: url.host, tags, media,
        live: url.pathname.startsWith('/live-bvc/'), resourceFormat: url.pathname.startsWith('/v1/resource/'),
        unusualPort: !!url.port && !['80', '443'].includes(url.port),
        userInfo: url.username ? url.username + (url.password ? ':' + url.password : '') + '@' : '',
        resource: url.href.slice(authorityEnd), sourceHint: tags.has('scheduler') ? url.searchParams.get('xy_usource') : null };
    } catch { return null; }
  }
  function originFor(authority) {
    if (typeof authority !== 'string' || /[/?#@\s]/.test(authority)) throw Error('Invalid delivery authority');
    return new URL('https://' + authority + '/').origin;
  }
  const renderers = {
    direct: (address, authority) => {
      const origin = originFor(authority);
      return origin.slice(0, 8) + address.userInfo + origin.slice(8) + address.resource;
    },
    relay: (address, authority) => originFor(authority) + '/?' + new Query([['url', address.canonical]]).toString()
  };
  function addressForHost(raw, host) {
    const address = readAddress(raw);
    if (!address) throw Error('Invalid media address');
    return renderers.direct(address, host);
  }
  function describeAddress(address, config) {
    const tags = new Set(address?.tags || []);
    if (config.portHeuristic && address?.unusualPort) tags.add('shared');
    return { host: address?.host || '', media: !!address?.media, live: !!address?.live,
      shared: tags.has('shared'), relaySource: tags.has('relay-source'), international: tags.has('international'),
      distribution: tags.has('distribution'), scheduler: tags.has('scheduler'), unusualPort: !!address?.unusualPort };
  }
  function createPlanner(config) {
    const enabled = config.enabled && config.mode !== 'off';
    // Independently admitted intents compete by priority. A policy veto removes
    // every transforming intent without coupling their matching implementations.
    const intents = [
      { id: 'selected-route', rank: 10, format: 'direct', authority: () => config.pcdnHost,
        accepts: facts => facts.shared || facts.relaySource || config.rewriteAkamai && facts.international
          || config.mode === 'force' && (facts.distribution || facts.international) },
      { id: 'compatibility-relay', rank: 20, format: 'relay', authority: () => config.proxyHost,
        accepts: (facts, address) => facts.relaySource && (config.mcdnStrategy === 'proxy-all'
          || config.mcdnStrategy === 'proxy-v1' && address.resourceFormat) },
      { id: 'scheduler-source', rank: 30, format: 'direct', authority: (_facts, address) => {
        if (!address.sourceHint) return null;
        const hint = readAddress(address.sourceHint.includes('://') ? address.sourceHint : 'https://' + address.sourceHint);
        return hint?.host || null;
      }, accepts: facts => facts.scheduler }
    ];
    return raw => {
      const original = String(raw ?? ''), address = readAddress(raw), facts = describeAddress(address, config);
      const admissible = enabled && facts.media && !facts.live && facts.host !== config.proxyHost;
      const proposals = admissible ? intents.filter(intent => intent.accepts(facts, address))
        .map(intent => ({ ...intent, host: intent.authority(facts, address) })).filter(intent => intent.host) : [];
      const chosen = proposals.reduce((best, next) => !best || next.rank > best.rank ? next : best, null);
      if (!chosen) return { changed: false, original, url: original,
        reason: !enabled || !facts.media || facts.host === config.proxyHost ? 'ignored' : facts.live ? 'live-skip' : 'ok' };
      const url = renderers[chosen.format](address, chosen.host);
      return { changed: url !== original, original, url, reason: chosen.id, targetHost: chosen.host };
    };
  }
  function graphCopy(input) {
    if (!input || typeof input !== 'object') return input;
    const result = Array.isArray(input) ? [] : {}, copies = new Map([[input, result]]), pending = [input];
    while (pending.length) {
      const source = pending.pop(), target = copies.get(source);
      for (const key of Object.keys(source)) {
        let value = source[key];
        if (value && typeof value === 'object') {
          if (!copies.has(value)) { copies.set(value, Array.isArray(value) ? [] : {}); pending.push(value); }
          value = copies.get(value);
        }
        Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
      }
    }
    return result;
  }
  function objects(input, depthLimit) {
    const queue = [{ value: input, depth: 0 }], seen = new Set(), found = [];
    for (let at = 0; at < queue.length; at++) {
      const { value, depth } = queue[at];
      if (!value || typeof value !== 'object' || seen.has(value) || depth > depthLimit) continue;
      seen.add(value); found.push(value);
      for (const child of Object.values(value)) if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
    }
    return found;
  }
  const representations = [
    ['dash', 'video'], ['dash', 'audio'], ['dash', 'dolby', 'audio'], ['dash', 'flac', 'audio'], ['durl']
  ];
  function createPolicy(value) {
    const config = Settings.normalize(value), route = createPlanner(config), active = config.enabled && config.mode !== 'off';
    function describe(raw) { return describeAddress(readAddress(raw), config); }
    function alternatives(raw, hosts) {
      const address = readAddress(raw);
      if (!address?.media || address.live || address.tags.has('international')) return [];
      return [...new Set(hosts)].filter(host => Settings.isCdnHost(host) && host !== address.authority)
        .map(host => renderers.direct(address, host));
    }
    function prepare(input, { ranking } = {}) {
      if (!input || typeof input !== 'object') return { value: input, changed: false, rewrites: [], sampleUrl: null };
      const copy = graphCopy(input), nodes = objects(copy, config.maxDepth), rewrites = [];
      const pool = ranking?.length ? ranking : config.candidatePool;
      let changed = false, sampleUrl = null;
      for (const node of nodes) {
        for (const key of Object.keys(node)) if (typeof node[key] === 'string') {
          const result = route(node[key]);
          if (result.changed) { node[key] = result.url; rewrites.push(result); changed = true; }
          const address = readAddress(node[key]);
          if (!sampleUrl && address?.media && ['distribution', 'international', 'shared'].some(tag => address.tags.has(tag))) sampleUrl = node[key];
        }
        if (!active) continue;
        const entries = node.url_info;
        if (Array.isArray(entries) && entries.length > 1 && entries.every(entry => typeof entry?.host === 'string')) {
          const allowed = entries.filter(entry => {
            const raw = entry.host.startsWith('//') || entry.host.includes('://') ? entry.host : 'https://' + entry.host;
            return !describe(raw).shared && !sharedMarker(new Query(String(entry.extra || '').replace(/^[?&]/, '')));
          });
          if (allowed.length && allowed.length < entries.length) {
            node.url_info = allowed; changed = true;
            for (const entry of entries) if (!allowed.includes(entry)) rewrites.push({ changed: true, original: entry.host, url: allowed[0].host, reason: 'live-address-filter' });
          }
        }
      }
      if (active && config.selection === 'auto') {
        const processed = new Set();
        for (const node of nodes) for (const path of representations) {
          const group = path.reduce((parent, key) => parent?.[key], node);
          for (const item of Array.isArray(group) ? group : group && typeof group === 'object' ? [group] : []) {
            if (!item || processed.has(item)) continue; processed.add(item);
            for (const [primary, backup] of [['baseUrl', 'backupUrl'], ['base_url', 'backup_url'], ['url', 'backup_url']]) {
              if (typeof item[primary] !== 'string') continue;
              const generated = alternatives(item[primary], pool);
              if (!generated.length) continue;
              const previous = Array.isArray(item[backup]) ? item[backup] : [];
              const addresses = new Set();
              for (const list of [generated, previous]) for (const raw of list) if (addresses.size < 8) addresses.add(raw);
              const next = [...addresses];
              if (previous.length !== next.length || previous.some((raw, index) => raw !== next[index])) { item[backup] = next; changed = true; }
            }
          }
        }
      }
      return { value: changed ? copy : input, changed, rewrites, sampleUrl };
    }
    return Object.freeze({ route, prepare, describe });
  }
  const api = Object.freeze({ createPolicy, addressForHost });
  scope.BiliSmoothRoutingPolicy = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
