// The video picker in the top bar: the connected video (cover and title) and a searchable list of
// open Bilibili tabs. Tabs in the background are marked; their frame checks pause while hidden.
import { icon } from '../shared/icons.js';
import { h, text, show } from './dom.js';

// Covers come only from Bilibili's image CDN over HTTPS, as before.
function coverOf(url) {
  try { const value = new URL(url); return value.protocol === 'https:' && /(^|\.)hdslb\.com$/.test(value.hostname) ? value.href : ''; }
  catch { return ''; }
}

export function createPicker(container, app, conn) {
  const cover = h('img', { alt: '', referrerpolicy: 'no-referrer', hidden: true });
  const title = h('span.title');
  const button = h('button.picker', { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', onclick: () => (menu.hidden ? open() : close()) }, cover, title);
  button.insertAdjacentHTML('beforeend', icon('down'));
  const search = h('input.search', { type: 'search', 'data-t-placeholder': 'searchTabs', 'data-t-label': 'searchTabs', autocomplete: 'off', oninput: () => fill() });
  const list = h('div.options', { role: 'listbox', 'data-t-label': 'chooseVideo' });
  const empty = h('p.none', { 'data-t': 'noMatches', hidden: true });
  const menu = h('div.menu.picker-menu', { hidden: true, onkeydown: keys }, search, list, empty);
  container.append(button, menu);
  cover.addEventListener('load', () => { cover.hidden = false; });
  cover.addEventListener('error', () => { cover.hidden = true; });
  let coverKey = '';

  function label(tab) { return tab.title || tab.url || '—'; }
  let listKey = '';
  function fill() {
    const query = search.value.trim().toLowerCase();
    const key = JSON.stringify([query, conn.state.tabId, app.lang, conn.state.tabs.map(tab => [tab.id, tab.title, tab.url, tab.active])]);
    if (key === listKey) return;
    listKey = key;
    const focused = document.activeElement?.closest?.('.opt')?.dataset.tab;
    const tabs = conn.state.tabs.filter(tab => !query || label(tab).toLowerCase().includes(query) || String(tab.url || '').toLowerCase().includes(query));
    list.replaceChildren(...tabs.map(tab => {
      const selected = tab.id === conn.state.tabId;
      const option = h('button.opt', { type: 'button', role: 'option', 'aria-selected': String(selected), dataset: { tab: tab.id },
        onclick: () => { close(); if (!selected) conn.selectTab(tab.id); } }, h('span.grow', label(tab)));
      if (tab.active === false) option.append(h('span.chip', app.t('backgroundTab')));
      if (selected) option.insertAdjacentHTML('beforeend', icon('check', 'ic ok'));
      return option;
    }));
    show(empty, !tabs.length);
    if (focused) list.querySelector(`.opt[data-tab="${focused}"]`)?.focus();
  }
  function open() {
    search.value = ''; listKey = ''; fill();
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    search.focus();
    addEventListener('pointerdown', outside, true);
  }
  function close(focus = false) {
    if (menu.hidden) return;
    menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    removeEventListener('pointerdown', outside, true);
    if (focus) button.focus();
  }
  function outside(event) { if (!container.contains(event.target)) close(); }
  function keys(event) {
    const options = [...list.querySelectorAll('.opt')], index = options.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); options[Math.min(options.length - 1, index + 1)]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); (index <= 0 ? search : options[index - 1]).focus(); }
    else if (event.key === 'Enter' && document.activeElement === search) { event.preventDefault(); options[0]?.click(); }
  }

  function render() {
    const tab = conn.state.tabs.find(item => item.id === conn.state.tabId), meta = app.connected ? app.view?.videoMeta : null;
    const name = meta?.title || (tab && label(tab));
    text(title, name || app.t('noVideo'));
    button.classList.toggle('none', !name);
    button.disabled = !conn.state.tabs.length;
    const src = coverOf(meta?.coverUrl);
    if (src !== coverKey) { coverKey = src; cover.hidden = true; if (src) cover.src = src; else cover.removeAttribute('src'); }
    if (!menu.hidden) fill();
  }
  return { render, close };
}
