/* Keep an activity reading session stable while the live bridge keeps polling. */
(() => {
  'use strict';
  window.BiliSmoothLogView = Object.freeze({ create });
  function create({ viewport, list, empty, button, hint, announcement, getRows, describe, text, motionEnabled }) {
    const nodes = new Map(), animations = new Map();
    let displayed = [], latest = [], pending = 0, initialized = false, seen = false, filter = '', language = '', scrolling = null, destroyed = false;
    const visible = () => !!viewport.getClientRects().length;
    const same = (a, b) => a.length === b.length && a.every((row, i) => row.id === b[i].id && row.fingerprint === b[i].fingerprint);
    const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
    function stopScroll() { if (scrolling) cancelAnimationFrame(scrolling.frame); scrolling = null; }
    function stopAnimations() { for (const animation of animations.values()) animation.cancel(); animations.clear(); }
    function chrome() {
      button.hidden = false;
      button.disabled = !pending && viewport.scrollTop < 2;
      button.dataset.hasNew = String(pending > 0);
      button.textContent = pending ? text('newCount').replace('{n}', String(pending)) : text(viewport.scrollTop > 2 ? 'latest' : 'upToDate');
      hint.textContent = text(pending || viewport.scrollTop > 2 ? 'readingHistory' : 'followingLatest');
      announcement.textContent = pending ? text('newCount').replace('{n}', String(pending)) : '';
      empty.hidden = displayed.length > 0;
    }
    function updateRow(node, row) {
      const value = describe(row.event);
      const parts = [value.time, value.category, value.title, value.detail];
      const targets = [node.children[0], node.children[1], node.children[2].children[0], node.children[2].children[1]];
      targets.forEach((target, index) => { if (target.textContent !== parts[index]) target.textContent = parts[index]; });
      node.children[2].children[1].hidden = !value.detail;
      node.dataset.type = value.tone;
      node.dataset.logId = row.id;
    }
    function makeRow(row) {
      const node = document.createElement('li'), time = document.createElement('time'), category = document.createElement('span'), body = document.createElement('div');
      category.className = 'log-category'; body.className = 'log-message';
      body.append(document.createElement('span'), document.createElement('p'));
      node.append(time, category, body); updateRow(node, row); return node;
    }
    function firstVisible() {
      const top = viewport.getBoundingClientRect().top;
      for (const row of list.children) if (row.getBoundingClientRect().bottom > top + 1) return { node: row, offset: row.getBoundingClientRect().top - top };
      return null;
    }
    function reveal(ids) {
      if (!motionEnabled() || !visible()) return;
      const frame = viewport.getBoundingClientRect();
      for (const id of ids) {
        const node = nodes.get(id); if (!node) continue;
        const rect = node.getBoundingClientRect(); if (rect.bottom <= frame.top || rect.top >= frame.bottom) continue;
        animations.get(id)?.cancel();
        const animation = node.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' });
        animations.set(id, animation); animation.finished.then(() => { if (animations.get(id) === animation) animations.delete(id); }, () => {});
      }
    }
    function commit(rows, preserve = false, animateNew = false) {
      const anchor = preserve ? firstVisible() : null, oldTop = viewport.scrollTop, incoming = new Set(rows.map(row => row.id)), fresh = [];
      let cursor = list.firstElementChild;
      for (const row of rows) {
        let node = nodes.get(row.id);
        if (!node) { node = makeRow(row); nodes.set(row.id, node); fresh.push(row.id); }
        else updateRow(node, row);
        if (node !== cursor) list.insertBefore(node, cursor); else cursor = cursor.nextElementSibling;
      }
      for (const [id, node] of nodes) if (!incoming.has(id)) { animations.get(id)?.cancel(); animations.delete(id); node.remove(); nodes.delete(id); }
      displayed = rows;
      if (anchor?.node.isConnected) viewport.scrollTop = oldTop + anchor.node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset;
      else if (!preserve) viewport.scrollTop = 0;
      if (animateNew) reveal(fresh);
      return fresh;
    }
    function rows() {
      const occurrences = new Map();
      return getRows().map(event => {
        const fingerprint = JSON.stringify(event), base = event.seq !== undefined ? 'seq:' + event.seq : event.id !== undefined ? 'id:' + event.id : fingerprint;
        const occurrence = occurrences.get(base) || 0; occurrences.set(base, occurrence + 1);
        return { id: base + ':' + occurrence, event, fingerprint };
      });
    }
    function render({ filter: nextFilter = filter, language: nextLanguage = language, reset = false } = {}) {
      if (destroyed) return;
      if (!motionEnabled()) { stopAnimations(); if (scrolling) { stopScroll(); viewport.scrollTop = 0; } }
      const changedFilter = filter !== nextFilter, changedLanguage = language !== nextLanguage;
      filter = nextFilter; language = nextLanguage; latest = rows();
      if (reset || changedFilter) { stopScroll(); pending = 0; initialized = false; }
      if (!initialized || !seen) {
        commit(latest); initialized = true; seen = visible(); pending = 0; chrome(); return;
      }
      if (changedLanguage) { const anchor = firstVisible(), oldTop = viewport.scrollTop; for (const row of displayed) updateRow(nodes.get(row.id), row); if (anchor?.node.isConnected) viewport.scrollTop = oldTop + anchor.node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - anchor.offset; }
      if (!latest.length) { stopScroll(); commit(latest); pending = 0; chrome(); return; }
      if (!same(latest, displayed)) {
        if (!visible() || viewport.scrollTop > 2 || scrolling || pending) { const ids = new Set(displayed.map(row => row.id)); pending = latest.filter(row => !ids.has(row.id)).length; }
        else { commit(latest, false, true); pending = 0; }
      } else pending = 0;
      chrome();
    }
    function showLatest() {
      stopScroll(); latest = rows(); const fresh = commit(latest, true); pending = 0;
      viewport.focus({ preventScroll: true });
      const start = viewport.scrollTop;
      if (!motionEnabled() || start < 2) { viewport.scrollTop = 0; reveal(fresh); chrome(); render(); return; }
      const run = { frame: 0, startAt: performance.now(), duration: Math.min(620, 360 + start * .08) }; scrolling = run;
      function tick(now) {
        if (scrolling !== run) return;
        const progress = Math.min(1, (now - run.startAt) / run.duration);
        viewport.scrollTop = start * Math.pow(1 - progress, 4);
        if (progress < 1) run.frame = requestAnimationFrame(tick);
        else { scrolling = null; viewport.scrollTop = 0; reveal(fresh); chrome(); render(); }
      }
      run.frame = requestAnimationFrame(tick); chrome();
    }
    function onScroll() { if (visible()) seen = true; chrome(); }
    function onKey(event) { if (scrollKeys.has(event.key)) stopScroll(); }
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('wheel', stopScroll, { passive: true });
    viewport.addEventListener('touchstart', stopScroll, { passive: true });
    viewport.addEventListener('pointerdown', stopScroll, { passive: true });
    viewport.addEventListener('keydown', onKey);
    button.addEventListener('click', showLatest);
    return { render, showLatest, destroy() { destroyed = true; stopScroll(); stopAnimations(); viewport.removeEventListener('scroll', onScroll); viewport.removeEventListener('wheel', stopScroll); viewport.removeEventListener('touchstart', stopScroll); viewport.removeEventListener('pointerdown', stopScroll); viewport.removeEventListener('keydown', onKey); button.removeEventListener('click', showLatest); } };
  }
})();
