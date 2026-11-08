// Title, canonical page URL and public cover of the current video, read from the page itself.
// Titles and covers arrive independently during navigation; the previous video's metadata is
// never shown under the new video.
export function createVideoMeta({ scope, document }) {
  let meta = { title: '', url: '', coverUrl: '' }, signature = '', knownTitle = '', pendingTitle = null, previousCover = '';
  function pageUrl() {
    try {
      const value = new URL(scope.location.href);
      if (value.protocol === 'https:' && /(^|\.)bilibili\.com$/.test(value.hostname) && /^\/(?:video\/(?:BV|av)[\w]+|bangumi\/play\/(?:ep|ss)\d+)(?:\/|$)/i.test(value.pathname)) return value.origin + value.pathname;
      if (value.protocol === 'https:' && /^(?:www\.)?bilibili\.com$/i.test(value.hostname) && /^\/list\/(?:watchlater|ml\d+)\/?$/i.test(value.pathname)) {
        const bvid = value.searchParams.get('bvid'), oid = value.searchParams.get('oid');
        const id = /^BV[a-z0-9]+$/i.test(bvid || '') ? bvid : /^\d+$/.test(oid || '') ? 'av' + oid : '';
        if (id) return value.origin + '/video/' + id + '/';
      }
    } catch {}
    return '';
  }
  function coverOf(player) {
    try {
      const raw = document.querySelector?.('meta[property="og:image"]')?.content || player?.poster || '';
      const image = new URL(raw, scope.location.href);
      if (raw && image.protocol === 'https:' && /(^|\.)(?:hdslb\.com|bilibili\.com)$/.test(image.hostname)) { image.search = ''; image.hash = ''; return image.href; }
    } catch {}
    return '';
  }
  function refresh(player, mediaGeneration) {
    const url = pageUrl();
    const title = String(document.title || '').replace(/[_\s-]*(?:哔哩哔哩[_\s-]*)?bilibili\s*$/i, '').trim().slice(0, 240);
    if (url !== meta.url) {
      const previousUrl = meta.url;
      previousCover = meta.coverUrl || previousCover;
      meta = { title: '', url, coverUrl: '' }; signature = '';
      // A route can change before its title and cover. Keep the previous video's
      // metadata out of the new video's card while its DOM is still catching up.
      if (previousUrl && title === knownTitle) pendingTitle = title;
    }
    if (!url) { knownTitle = title; return; }
    if (pendingTitle !== null && title === pendingTitle) return;
    pendingTitle = null;
    let coverUrl = coverOf(player);
    if (coverUrl === previousCover) coverUrl = '';
    else if (coverUrl) previousCover = '';
    const next = [url, title, mediaGeneration, coverUrl].join('|');
    if (next === signature) return;
    meta = { title, url, coverUrl }; knownTitle = title; signature = next;
  }
  function onLoadedMetadata() { pendingTitle = null; signature = ''; }
  return { refresh, onLoadedMetadata, current: () => ({ ...meta }) };
}
