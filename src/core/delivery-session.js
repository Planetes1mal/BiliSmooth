/* Per-video delivery metadata. Signed addresses stay in memory; snapshots contain hosts only. */
(function (scope) {
  'use strict';
  const Catalog = scope.BiliSmoothCatalog || (typeof require === 'function' ? require('./media-observer.js') : null);
  const Rules = scope.BiliSmoothRoutingPolicy || (typeof require === 'function' ? require('./routing-policy.js') : null);
  const Settings = scope.BiliSmoothSettings || (typeof require === 'function' ? require('./settings.js') : null);
  const upos = host => /^upos-[a-z0-9-]+\.bilivideo\.(?:com|cn|net)$/.test(host);
  function identity(raw) {
    const key = raw.split(/[?#]/)[0].split('/').at(-1), match = /^(\d+)[-_].*\.(?:m4s|mp4|flv)$/i.exec(key);
    return match ? { cid: match[1], key } : null;
  }
  function create({ pool = Settings.candidatePool } = {}) {
    const catalog = Catalog.create(), policy = Rules.createPolicy(), sessions = new Map();
    let currentCid = null;
    function collect(payload) {
      for (const track of catalog.collect(payload)) {
        const file = identity(track.url);
        if (!file) continue;
        const urls = new Map();
        for (const raw of track.nativeUrls) {
          const address = policy.describe(raw);
          if (identity(raw)?.key !== file.key || address.shared || address.live || !(upos(address.host) || address.international)) continue;
          if (!urls.has(address.host)) urls.set(address.host, raw);
        }
        if (!urls.size) continue;
        let session = sessions.get(file.cid);
        if (!session) { session = { cid: file.cid, requiredBps: 0, requestedVideo: null, representations: new Map() }; sessions.set(file.cid, session); }
        session.representations.set(file.key, { ...file, id: track.id, kind: track.kind, bandwidth: track.bandwidth,
          codecs: track.codecs, codecId: track.codecId, nativeHost: policy.describe(track.url).host, urls });
        currentCid = file.cid;
      }
      return current();
    }
    function get(raw) { const file = identity(raw); return file ? sessions.get(file.cid)?.representations.get(file.key) || null : null; }
    function current() { return sessions.get(currentCid) || null; }
    function request(raw) {
      const representation = get(raw);
      if (!representation) return null;
      currentCid = representation.cid;
      if (representation.kind === 'video') {
        const session = current(); session.requestedVideo = representation.key; session.nativeHost = representation.nativeHost;
        session.requiredBps = Math.max(session.requiredBps, representation.bandwidth);
      }
      return representation;
    }
    function addressForHost(raw, host) {
      const representation = get(raw);
      if (!representation) return null;
      if (representation.urls.has(host)) return representation.urls.get(host);
      if (!pool.includes(host) || !upos(host)) return null;
      const source = [...representation.urls].find(([issuedHost]) => upos(issuedHost));
      return source ? Rules.addressForHost(source[1], host) : null;
    }
    function snapshot() {
      const session = current();
      return session ? { cid: session.cid, requiredBps: session.requiredBps,
        representations: [...session.representations.values()].map(rep => ({ id: rep.id, kind: rep.kind, bandwidth: rep.bandwidth,
          codecs: rep.codecs, codecId: rep.codecId, issuedHosts: [...rep.urls.keys()] })) } : null;
    }
    return { collect, request, addressForHost, get, current, snapshot };
  }
  const api = Object.freeze({ create });
  scope.BiliSmoothDeliverySession = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
