// Log: this session's numbers, filters, Export diagnostics, Clear, and the list (newest first).
// While the reader is scrolled into older rows, new rows wait behind an "N new records" button.
import { h, text, show, figure } from '../dom.js';
import { icon } from '../../shared/icons.js';
import { rows as logRows, CATEGORY_KEYS } from '../events.js';
import { T, segmented, unitOf, eventRow } from './parts.js';

const LIMIT = 200;

export function createLog(section, app) {
  const stack = section.querySelector('.stack'), head = section.querySelector('.head');
  const kept = h('span.aside.muted');
  head.append(kept);
  const stat = key => h('div', h('span', { 'data-t': key }), h('strong'));
  const firstFrame = stat('firstFrame'), stalls = stat('stalls'), recovered = stat('recovered'), switches = stat('switches');
  let filter = 'all';
  const filters = segmented([['all', 'filterAll'], ['playback', 'filterPlayback'], ['servers', 'filterServers'], ['problems', 'filterProblems']],
    value => { filter = value; reset(); app.render(); }, 'log');
  const exportButton = h('button.btn', { type: 'button', onclick: () => app.exportDiagnostics() });
  exportButton.innerHTML = icon('download'); exportButton.append(T('exportDiagnostics'));
  const clear = h('button.btn.danger', { type: 'button', 'data-t': 'clear', onclick: () => app.clearLog() });
  const viewport = h('div.rows', { role: 'list', tabindex: '0', 'data-t-label': 'log' });
  const follow = h('button.btn.tonal', { type: 'button', onclick: showLatest });
  const empty = h('div.emptybox', { hidden: true, html: icon('log') }, h('b', { 'data-t': 'noRecords' }));
  stack.append(h('section.card.stats', firstFrame, stalls, recovered, switches),
    h('div.logtools', filters.node, h('span.grow'), exportButton, clear),
    h('section.card.loglist', viewport, empty, h('div.follow', follow)));
  filters.set('all');

  const nodes = new Map();
  let shown = [], waiting = 0, language = null, fresh = true;
  const reset = () => { fresh = true; };

  function commit(list, animate) {
    const incoming = new Set(list.map(row => row.id)), added = [];
    let cursor = viewport.firstElementChild;
    for (const row of list) {
      let node = nodes.get(row.id);
      if (!node) { node = eventRow(row, app.t(CATEGORY_KEYS[row.category]), 'ent'); nodes.set(row.id, node); added.push(node); }
      if (node !== cursor) viewport.insertBefore(node, cursor); else cursor = cursor.nextElementSibling;
    }
    for (const [id, node] of nodes) if (!incoming.has(id)) { node.remove(); nodes.delete(id); }
    shown = list; waiting = 0;
    const engine = globalThis.BiliSmoothMotion;
    if (animate && engine && app.motionOn()) for (const node of added) engine.animate(node, { opacity: [0, 1], transform: ['translateY(-4px)', 'none'] }, { duration: 0.24, ease: [0.22, 1, 0.36, 1] });
  }
  function showLatest() {
    commit(latest(), true);
    viewport.scrollTo({ top: 0, behavior: app.motionOn() ? 'smooth' : 'auto' });
    viewport.focus({ preventScroll: true });
    app.render();
  }
  const latest = () => logRows(app.connected ? app.view.events : [], { filter, t: app.t, lang: app.lang, limit: LIMIT });

  function render() {
    const { t, view, connected } = app;
    text(kept, t('keepsLatest', { n: LIMIT }));
    const startup = connected ? view.startup : null, ms = startup?.playinfoToFirstFrameMs;
    figure(firstFrame.querySelector('strong'), Number.isFinite(ms) ? (ms / 1000).toFixed(2) : null, t('seconds'));
    const unit = unitOf(t), counters = connected ? view.counters : null;
    figure(stalls.querySelector('strong'), Number.isFinite(counters?.stalls) ? counters.stalls : null, unit);
    figure(recovered.querySelector('strong'), Number.isFinite(counters?.recoveries) ? counters.recoveries : null, unit);
    figure(switches.querySelector('strong'), connected && Array.isArray(view.session?.switches) ? view.session.switches.length : null, unit);
    exportButton.disabled = !connected || app.busy('export');
    clear.disabled = !connected || app.busy('clear');

    const list = latest();
    if (language !== app.lang) { language = app.lang; for (const node of nodes.values()) node.remove(); nodes.clear(); fresh = true; }
    const same = list.length === shown.length && list.every((row, index) => row.id === shown[index].id);
    if (fresh || !list.length) { commit(list, false); fresh = false; }
    else if (!same) {
      const known = new Set(shown.map(row => row.id));
      if (viewport.scrollTop > 2) waiting = list.filter(row => !known.has(row.id)).length;
      else commit(list, true);
    }
    show(empty, !shown.length); show(viewport, !!shown.length);
    show(follow.parentNode, waiting > 0);
    text(follow, t('newRecords', { n: waiting }));
  }
  return { render, enter: reset, translate: reset };
}
