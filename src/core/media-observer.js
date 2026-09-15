/* Passive playinfo metadata. Signed addresses are held in memory and never rewritten or persisted. */
(function (scope) {
  'use strict';
  const containerKeys = ['data', 'result', 'video_info', 'playinfo'];
  const MAX_URLS = 32, MAX_URL_LENGTH = 16384, MAX_CONTAINERS = 128, MAX_INPUT_TRACKS = 1024;
  function parsed(raw) {
    if (typeof raw !== 'string' || !raw || raw.length > MAX_URL_LENGTH) return null;
    try {
      const url = new URL(raw.startsWith('//') ? 'https:' + raw : raw);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
    } catch (_) { return null; }
  }
  function aliasesOf(raw) {
    const url = parsed(raw); if (!url) return [];
    const aliases = [raw, url.href];
    // Lookup only: a player's HTTPS upgrade still identifies the observed HTTP address.
    // The supplied address and payload remain byte-for-byte unchanged.
    if (url.protocol === 'http:') { url.protocol = 'https:'; aliases.push(url.href); }
    return aliases;
  }
  function urlsOf(item) {
    const values = [item.baseUrl, item.base_url, item.url];
    for (const key of ['backupUrl', 'backup_url']) {
      const backups = item[key];
      if (Array.isArray(backups)) values.push(...backups.slice(0, MAX_URLS));
    }
    return [...new Set(values.filter(raw => parsed(raw)))].slice(0, MAX_URLS);
  }
  function positive(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
  function frameRate(value) {
    if (typeof value === 'string' && /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(value)) {
      const [a, b] = value.split('/').map(Number); return b > 0 ? a / b : 0;
    }
    return positive(value);
  }
  function fingerprint(value) {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
    return (a >>> 0).toString(36) + '-' + (b >>> 0).toString(36);
  }
  function create(options = {}) {
    const limit = Math.max(16, Math.min(256, Math.floor(Number(options.limit)) || 128));
    const records = new Map(), aliases = new Map();
    let videoId = null, audioId = null;
    function forget(id) {
      records.delete(id);
      for (const [raw, known] of aliases) if (known === id) aliases.delete(raw);
      if (videoId === id) videoId = null;
      if (audioId === id) audioId = null;
    }
    function record(item, kind, index) {
      if (!item || typeof item !== 'object') return null;
      const urls = urlsOf(item); if (!urls.length) return null;
      const id = item.id ?? item.order ?? index;
      const resourceId = 'media-' + fingerprint([kind, id, item.codecid ?? item.codec_id ?? '', item.codecs ?? '', ...urls].join('\n'));
      const track = Object.freeze({ resourceId, kind, id, url: urls[0], urls: Object.freeze(urls), nativeUrls: Object.freeze([...urls]),
        width: positive(item.width), height: positive(item.height), fps: frameRate(item.frameRate ?? item.frame_rate),
        bandwidth: positive(item.bandwidth), codecs: String(item.codecs || ''), codecId: item.codecid ?? item.codec_id ?? null,
        duration: positive(item.length) / 1000 });
      records.delete(resourceId); records.set(resourceId, track);
      for (const raw of urls) for (const alias of aliasesOf(raw)) aliases.set(alias, resourceId);
      while (records.size > limit) {
        const oldest = [...records.keys()].find(key => key !== videoId && key !== audioId) || records.keys().next().value;
        forget(oldest);
      }
      return track;
    }
    function collect(payload) {
      if (!payload || typeof payload !== 'object') return [];
      const pending = [{ value: payload, depth: 0 }], visited = new Set(), found = new Set();
      let remaining = MAX_INPUT_TRACKS;
      function add(items, kind) {
        if (!Array.isArray(items)) return;
        for (let index = 0; index < items.length && remaining > 0; index++, remaining--) {
          const track = record(items[index], kind, index); if (track) found.add(track.resourceId);
        }
      }
      while (pending.length && visited.size < MAX_CONTAINERS) {
        const { value, depth } = pending.shift();
        if (!value || typeof value !== 'object' || visited.has(value)) continue;
        visited.add(value);
        const dash = value.dash;
        if (dash && typeof dash === 'object') {
          add(dash.video, 'video'); add(dash.audio, 'audio');
          if (dash.dolby?.audio) add(Array.isArray(dash.dolby.audio) ? dash.dolby.audio : [dash.dolby.audio], 'audio');
          if (dash.flac?.audio) add(Array.isArray(dash.flac.audio) ? dash.flac.audio : [dash.flac.audio], 'audio');
        }
        add(value.durl, 'muxed');
        if (depth < 20) for (const key of containerKeys) if (value[key] && typeof value[key] === 'object') pending.push({ value: value[key], depth: depth + 1 });
      }
      return [...found].map(id => records.get(id)).filter(Boolean);
    }
    function get(raw) {
      if (typeof raw !== 'string') return null;
      for (const alias of aliasesOf(raw)) { const track = records.get(aliases.get(alias)); if (track) return track; }
      return null;
    }
    function activeVideo(raw) {
      if (raw === null) videoId = null;
      else if (raw !== undefined) { const track = get(raw); if (track?.kind === 'video' || track?.kind === 'muxed') videoId = track.resourceId; }
      return records.get(videoId) || null;
    }
    function activeAudio(raw) {
      if (raw === null) audioId = null;
      else if (raw !== undefined) { const track = get(raw); if (track?.kind === 'audio') audioId = track.resourceId; }
      return records.get(audioId) || null;
    }
    function request(raw) { const track = get(raw); if (track?.kind === 'audio') activeAudio(raw); else if (track) activeVideo(raw); return track; }
    function clear() { records.clear(); aliases.clear(); videoId = audioId = null; }
    return { collect, get, request, activeVideo, activeAudio, tracks: () => [...records.values()], clear };
  }
  const api = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else scope.BiliSmoothCatalog = api;
})(typeof globalThis === 'object' ? globalThis : this);
