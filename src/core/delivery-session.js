// Per-video delivery metadata: representations, issued hosts and demand. Signed addresses stay in memory; snapshots contain hosts only.
import { create as createCatalog } from './media-observer.js';
import { createPolicy, addressForHost as renderAddress } from './routing-policy.js';
import settings from './settings.js';

const upos = host => /^upos-[a-z0-9-]+\.bilivideo\.(?:com|cn|net)$/.test(host);
function identity(raw) {
  const key = raw.split(/[?#]/)[0].split('/').at(-1), match = /^(\d+)[-_].*\.(?:m4s|mp4|flv)$/i.exec(key);
  return match ? { cid: match[1], key } : null;
}
// pool: the hosts a signed UPOS address may be rendered on (built-in and user-added), or a function returning them.
export function create({ pool = settings.candidatePool } = {}) {
  const catalog = createCatalog(), policy = createPolicy(), sessions = new Map(), hosts = typeof pool === 'function' ? pool : () => pool;
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
      session.representations.set(file.key, { ...file, id: track.id, kind: track.kind, bandwidth: track.bandwidth, height: track.height,
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
    if (!hosts().includes(host) || !settings.isCdnHost(host)) return null;
    const source = [...representation.urls].find(([issuedHost]) => upos(issuedHost));
    return source ? renderAddress(source[1], host) : null;
  }
  // Every host the representation of `raw` can be fetched from: issued addresses first, then the pool.
  function candidates(raw) {
    const representation = get(raw);
    return representation ? [...new Set([...representation.urls.keys(), ...hosts()])].filter(host => addressForHost(raw, host)) : [];
  }
  function snapshot() {
    const session = current();
    return session ? { cid: session.cid, requiredBps: session.requiredBps,
      representations: [...session.representations.values()].map(rep => ({ id: rep.id, kind: rep.kind, bandwidth: rep.bandwidth, height: rep.height,
        codecs: rep.codecs, codecId: rep.codecId, requested: rep.key === session.requestedVideo, issuedHosts: [...rep.urls.keys()] })) } : null;
  }
  return { collect, request, addressForHost, candidates, get, current, snapshot };
}
const deliverySession = Object.freeze({ create });
export default deliverySession;
