// Dashboard entry: wires the connection to the frame (sidebar, top bar, notice, toast, dialog) and
// the four pages. Every render reads the latest tab state; settings edits show at once and save in order.
import settings from '../../core/settings.js';
import { translator } from '../shared/strings.js';
import * as format from '../shared/format.js';
import { icon, mark } from '../shared/icons.js';
import { $, $$, h, text, show, figure } from './dom.js';
import { createConnection } from './connection.js';
import { createChart, series } from './chart.js';
import { createPicker } from './picker.js';
import { createOverview } from './pages/overview.js';
import { createServers } from './pages/servers.js';
import { createSettings } from './pages/settings.js';
import { createLog } from './pages/log.js';

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)'), darkScheme = matchMedia('(prefers-color-scheme: dark)');
const PAGES = ['overview', 'routes', 'settings', 'logs'];
const buildVersion = $('meta[name="bilismooth-version"]')?.content || '';

let lang = null, t = translator('zh'), page = null, failedEdit = null, renderQueued = false, toastTimer = null, serial = 0, queue = Promise.resolve();
const pending = new Map(), busy = new Set();
const conn = createConnection({ buildVersion, onChange: queueRender, onSelect: () => { failedEdit = null; } });

// What pages read. `config` already includes edits that are still saving.
const app = {
  get t() { return t; }, get lang() { return lang; }, get page() { return page; },
  get connected() { return conn.connected(); }, get view() { return conn.state.snapshot; }, get status() { return conn.state.status; },
  get config() { let config = conn.state.config; for (const patch of pending.values()) config = { ...config, ...patch }; return config; },
  get motion() { return conn.state.motion; },
  busy: key => busy.has(key),
  motionOn: () => conn.state.motion && !reduced.matches && !document.hidden,
  name: host => format.serverName(host, lang),
  // Every server the user can pin: the allowed list plus a custom host already in use.
  hosts() {
    const list = [...(conn.state.snapshot?.allowedHosts || settings.fixedHosts)];
    const config = app.config;
    if (config.selection === 'fixed' && settings.isCdnHost(config.pcdnHost) && !list.includes(config.pcdnHost)) list.push(config.pcdnHost);
    return list;
  },
  save, choose, act, go, toast, confirm, test, render: queueRender,
  setMotion: async value => { try { await conn.setMotion(value); toast(t('saved'), 'ok'); } catch { toast(t('saveFailed'), 'bad'); } queueRender(); },
  exportDiagnostics, clearLog
};

// ---------- saving ----------
const routePatch = host => ({ enabled: true, selection: 'fixed', pcdnHost: host, mode: app.config.mode === 'off' ? 'bad-only' : app.config.mode });
function save(patch, { action = 'config', done = 'saved' } = {}) {
  const id = ++serial;
  pending.set(id, action === 'applyRoute' ? routePatch(patch.host) : settings.patch(patch));
  failedEdit = null; queueRender();
  const run = queue.then(async () => {
    try { await conn.command(action, patch); toast(t(done), 'ok'); return true; }
    catch (error) { if (error?.message !== 'selection-changed') failedEdit = { action, patch }; return false; }
    finally { pending.delete(id); queueRender(); }
  });
  queue = run.catch(() => {});
  return run;
}
// Automatic, Bilibili default or a fixed host (docs: server choice semantics).
function choose(choice) {
  if (choice === 'auto') return save({ enabled: true, selection: 'auto', mode: app.config.mode === 'off' ? 'bad-only' : app.config.mode });
  if (choice === 'default') return save({ enabled: false });
  if (settings.isCdnHost(choice)) return save({ host: choice }, { action: 'applyRoute' });
}
// The dashboard's own failed edit, or an empty patch: the video page then sends its failed edit again.
function retrySave() {
  if (failedEdit) return save(failedEdit.patch, { action: failedEdit.action });
  return save({});
}
// A one-off command from a button; the key keeps the button busy while it runs.
async function act(key, action, patch, failed = 'actionFailed') {
  if (busy.has(key)) return null;
  busy.add(key); queueRender();
  try { return await conn.command(action, patch); }
  catch (error) { if (error?.message !== 'selection-changed') toast(t(failed), 'bad'); return null; }
  finally { busy.delete(key); queueRender(); }
}
async function test() {
  const result = await act('retry', 'retry');
  if (result && result.retryAttempted === false) toast(t('testUnavailable'));
}
async function reloadWithSettings() {
  // The save before the reload can fail; the tab then stays as it is.
  const result = await act('reload', 'reload', undefined, 'reloadFailed');
  if (result?.retryAttempted) conn.expectReload(); else if (result) toast(t('reloadFailed'), 'bad');
}
async function exportDiagnostics() {
  const result = await act('export', 'diagnostics');
  if (!result) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  h('a', { href: url, download: `bilismooth-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(t('exported'), 'ok');
}
async function clearLog() {
  if (!await confirm({ title: 'clearQuestion', detail: 'clearDetail', accept: 'clear' })) return;
  if (await act('clear', 'clearEvents')) toast(t('logCleared'), 'ok');
}

// ---------- frame ----------
function go(name, focus = true) {
  if (!PAGES.includes(name)) name = 'overview';
  const changed = page !== name;
  page = name;
  for (const section of $$('.page')) show(section, section.dataset.page === name);
  for (const link of $$('.nav a')) { if (link.dataset.page === name) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }
  if (location.hash !== '#' + name) history.replaceState(null, '', location.pathname + location.search + '#' + name);
  const section = $(`.page[data-page="${name}"]`);
  $('.head', section).after($('#notice'));
  if (changed) { pages[name].enter?.(); scrollTo(0, 0); }
  render();
  if (focus) $('h1', section).focus({ preventScroll: true });
}

function toast(message, tone = '') {
  const node = $('#toast');
  clearTimeout(toastTimer);
  node.replaceChildren();
  if (tone === 'ok') node.insertAdjacentHTML('afterbegin', icon('check'));
  if (tone === 'bad') node.insertAdjacentHTML('afterbegin', icon('alert'));
  node.append(h('span', message));
  node.dataset.tone = tone;
  node.hidden = false;
  requestAnimationFrame(() => node.classList.add('in'));
  toastTimer = setTimeout(() => { node.classList.remove('in'); toastTimer = setTimeout(() => { node.hidden = true; }, 200); }, tone === 'ok' ? 1600 : 4000);
}

function confirm({ title, detail, accept }) {
  const dialog = $('#confirm'), ok = $('button[value=ok]', dialog), cancel = $('button[value=cancel]', dialog);
  text($('#confirm-title'), t(title)); text($('#confirm-detail'), t(detail)); text(ok, t(accept));
  return new Promise(resolve => {
    const finish = value => { dialog.removeEventListener('close', onClose); ok.onclick = cancel.onclick = null; if (dialog.open) dialog.close(); resolve(value); };
    const onClose = () => finish(false);
    ok.onclick = () => finish(true); cancel.onclick = () => finish(false);
    dialog.addEventListener('close', onClose);
    dialog.showModal(); cancel.focus();
  });
}

// One notice at a time, most urgent first.
function notice() {
  const s = conn.state, view = s.snapshot;
  if (s.readFailed || view?.reloadReasons?.includes('storage-read-failed'))
    return { tone: 'err', icon: 'alert', title: 'readFailed', detail: 'readFailedDetail', action: ['reconnect', false, () => conn.refresh(true)] };
  if (failedEdit || (view?.settingsSave?.status === 'error' && !pending.size))
    return { tone: 'err', icon: 'alert', title: 'saveFailed', detail: 'saveFailedDetail', action: ['retry', true, retrySave] };
  if (s.status === 'connecting') return { icon: 'refresh', title: 'connecting' };
  if (s.status === 'no-tab') return s.tabs.length ? { icon: 'info', title: 'chooseVideo' } : { icon: 'info', title: 'noTab', detail: 'noTabDetail' };
  if (s.status === 'stale') return { tone: 'warn', icon: 'alert', title: 'stale', detail: 'staleDetail', action: ['reload', true, () => conn.reloadVideo()] };
  if (s.status === 'no-response') return { tone: 'warn', icon: 'alert', title: 'noResponse', detail: 'noResponseDetail', action: ['retry', false, () => conn.refresh(true)] };
  const reason = view?.availability?.reason;
  // The Overview banner already says why the video cannot play.
  if (reason && page !== 'overview') {
    const key = ['region', 'payment'].includes(reason) ? reason : 'unavailable';
    return { tone: 'err', icon: 'alert', title: key, detail: key + 'Detail' };
  }
  if (view?.needReload && view.startupReady !== false && view.settingsSave?.status !== 'pending' && !pending.size)
    return { tone: 'warn', icon: 'refresh', title: 'applyReload', action: ['reload', true, reloadWithSettings, 'reload'] };
  if (view && !view.media?.present && !reason) return { icon: 'info', title: 'waitVideo' };
  return null;
}
function renderNotice() {
  const node = $('#notice'), value = notice();
  show(node, !!value);
  if (!value) return;
  const key = [value.tone, value.icon, value.title, value.detail, value.action?.[0], value.action?.[1], lang].join('|');
  node.className = 'notice' + (value.tone ? ' ' + value.tone : '');
  if (node.dataset.key !== key) {
    node.dataset.key = key;
    $('.nic', node).innerHTML = icon(value.icon);
    text($('b', node), t(value.title));
    const detail = $('p', node); text(detail, value.detail ? t(value.detail) : ''); show(detail, !!value.detail);
    $('button', node)?.remove();
    if (value.action) {
      const [label, primary, run, busyKey] = value.action;
      node.append(h('button.btn' + (primary ? '.primary' : ''), { type: 'button', onclick: run, dataset: { busy: busyKey || '' } }, t(label)));
    }
  }
  const button = $('button', node);
  if (button) button.disabled = !!button.dataset.busy && busy.has(button.dataset.busy);
}

function applyAppearance(config) {
  root.dataset.theme = config.theme === 'dark' || config.theme === 'light' ? config.theme : darkScheme.matches ? 'dark' : 'light';
  root.dataset.accent = settings.accents.includes(config.accent) ? config.accent : 'blue';
  root.dataset.motion = conn.state.motion && !reduced.matches ? 'on' : 'off';
  const next = config.lang === 'en' ? 'en' : 'zh';
  if (next !== lang) { lang = next; t = translator(lang); root.lang = lang === 'en' ? 'en' : 'zh-CN'; translate(); }
}
function translate() {
  for (const node of $$('[data-t]')) text(node, t(node.dataset.t));
  for (const node of $$('[data-t-label]')) node.setAttribute('aria-label', t(node.dataset.tLabel));
  for (const node of $$('[data-t-placeholder]')) node.setAttribute('placeholder', t(node.dataset.tPlaceholder));
  text($('#version'), t('version', { v: buildVersion || globalThis.chrome?.runtime?.getManifest?.().version || '' }));
  $('#notice').dataset.key = '';
  for (const view of Object.values(pages)) view.translate?.();
}

const liveChart = createChart($('#live-chart'), { dot: true, motion: () => app.motionOn() });
function renderFrame() {
  const view = conn.state.snapshot, connected = conn.connected();
  const speed = connected ? format.speed(view) : null;
  figure($('#live-speed'), speed?.value, speed?.unit);
  const samples = connected ? series(view.speedSamples) : null;
  show($('#live-chart'), !!samples?.values.some(value => value !== null));
  if (samples) liveChart.update(samples);
  show($('#back'), !!conn.state.tabId);
  picker.render();
  renderNotice();
}

function render() {
  renderQueued = false;
  applyAppearance(app.config);
  renderFrame();
  pages[page]?.render();
}
function queueRender() { if (!renderQueued) { renderQueued = true; queueMicrotask(render); } }

// ---------- boot ----------
for (const node of $$('[data-icon]')) node.outerHTML = node.dataset.icon === 'mark' ? `<span class="tile">${mark}</span>` : icon(node.dataset.icon);
const picker = createPicker($('#picker'), app, conn);
const pages = {
  overview: createOverview($('.page[data-page="overview"] .stack'), app),
  routes: createServers($('.page[data-page="routes"]'), app),
  settings: createSettings($('.page[data-page="settings"] .stack'), app),
  logs: createLog($('.page[data-page="logs"]'), app)
};
for (const link of $$('.nav a')) link.addEventListener('click', event => { event.preventDefault(); go(link.dataset.page); });
$('.skip').addEventListener('click', event => { event.preventDefault(); $('#main').focus(); });
$('#back').addEventListener('click', () => conn.focusVideo());
addEventListener('hashchange', () => go(location.hash.slice(1), false));
darkScheme.addEventListener('change', queueRender);
reduced.addEventListener('change', queueRender);
document.addEventListener('visibilitychange', queueRender);
applyAppearance(app.config);
go(location.hash.slice(1), false);
conn.start().then(() => { if (conn.state.loadFailed) toast(t('loadFailed'), 'bad'); });

// Read-only hooks for local checks and store captures (scripts/checks, scripts/store).
globalThis.BiliSmoothView = Object.freeze({ getSnapshot: () => conn.state.snapshot, getConfig: () => app.config, status: () => conn.state.status });
globalThis.BiliSmoothLive = Object.freeze({ command: conn.command, refresh: conn.refresh, selectTab: conn.selectTab });
