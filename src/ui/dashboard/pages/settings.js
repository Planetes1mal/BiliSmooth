// Settings: the floating control (collapsed display, position), playback, appearance, compatibility
// and Restore defaults. Every change saves at once.
import settings from '../../../core/settings.js';
import * as format from '../../shared/format.js';
import { icon, mark } from '../../shared/icons.js';
import { projectPlayback, serverChoice, statusKeys } from '../../shared/playback.js';
import { h, text } from '../dom.js';
import { T, segmented, toggle, line } from './parts.js';

const accentKeys = { blue: 'accentBlue', teal: 'accentTeal', green: 'accentGreen', orange: 'accentOrange', pink: 'accentPink', graphite: 'accentGraphite' };
const entryKeys = { icon: 'entryIcon', buffer: 'entryBuffer', speed: 'entrySpeed', combined: 'entryCombined' };
// The preview dot takes the real entry's tone, so Bilibili default reads idle here too.
const dotClass = { ok: '', warn: 'warn', error: 'err', idle: 'idle' };
// The two-column width; dashboard.css uses the same media query.
const WIDE = '(min-width: 1440px)';

export function createSettings(stack, app) {
  const save = key => value => app.save({ [key]: value });
  const card = (key, ...children) => h('section.card', h('h2', { 'data-t': key }), ...children);

  // Floating control: the four collapsed displays, each previewing the current numbers.
  const tiles = settings.floatingEntryTypes.map(type => {
    const input = h('input', { type: 'radio', name: 'entry', value: type, onchange: () => input.checked && app.save({ floatingEntryType: type }) });
    const pill = h('span.fc-entry' + (type === 'icon' ? '.round' : ''), { 'aria-hidden': 'true' });
    const tile = h('label.etile', input, pill, T(entryKeys[type]));
    tile.insertAdjacentHTML('beforeend', icon('check', 'ic okmark'));
    return { type, input, pill, tile };
  });
  const position = h('button.btn', { type: 'button', 'data-t': 'resetPosition', onclick: async () => { if (await app.act('position', 'resetFloatingPosition')) app.toast(app.t('positionReset'), 'ok'); } });
  const floating = card('floating', h('div.rows', h('div.line.label', h('b', { 'data-t': 'collapsedShows' }))),
    h('div.etiles', { role: 'radiogroup', 'data-t-label': 'collapsedShows' }, tiles.map(item => item.tile)), h('div.rows', line('position', position)));

  const stall = toggle('stallSwitch', save('stallRecovery'));
  const stallRow = line('stallSwitch', stall, 'automaticOnly');
  const playback = card('playback', h('div.rows', stallRow));

  const theme = segmented([['system', 'system'], ['light', 'light'], ['dark', 'dark']], save('theme'), 'theme');
  const accentName = h('span.swatch-name');
  const accents = h('div.swatches', { role: 'radiogroup', 'data-t-label': 'accent' });
  const accentInputs = settings.accents.map(accent => {
    const input = h('input', { type: 'radio', name: 'accent', value: accent, 'data-t-label': accentKeys[accent], onchange: () => input.checked && app.save({ accent }) });
    accents.append(h('label.sw', { style: `--c:var(--swatch-${accent})` }, input));
    return input;
  });
  accents.append(accentName);
  const language = segmented([['zh', { text: '中文' }], ['en', { text: 'English' }]], save('lang'), 'language');
  const motion = toggle('animations', value => app.setMotion(value));
  const appearance = card('appearance', h('div.rows', line('theme', theme.node), line('accent', accents), line('language', language.node), line('animations', motion)));

  const mcdn = segmented([['proxy-all', 'relayAll'], ['proxy-v1', 'byFormat'], ['replace', 'swapHost']], save('mcdnStrategy'), 'mcdn');
  const ports = toggle('ports', save('portHeuristic')), akamai = toggle('akamai', save('rewriteAkamai')), p2p = toggle('p2p', save('p2pGuard'));
  const akamaiRow = line('akamai', akamai, 'fixedOnly');
  const summary = h('summary', h('h2', T('advanced'), ' ', h('span.muted', { 'data-t': 'compatibility' })));
  summary.insertAdjacentHTML('beforeend', icon('down', 'ic chevron'));
  const advanced = h('details.card.advanced', { open: true }, summary,
    h('div.rows', line('mcdn', mcdn.node), line('ports', ports), akamaiRow, line('p2p', p2p, 'afterReload')));

  const restore = h('button.btn.danger', { type: 'button', 'data-t': 'restoreDefaults', onclick: restoreDefaults });
  const reset = h('section.card.reset-card', h('div', h('b', { 'data-t': 'restoreDefaults' }), h('p', { 'data-t': 'restoreDetail' })), restore);

  // Wide windows show two columns: how things look on the left; playback and what Restore defaults resets on
  // the right. The cards move rather than reorder visually, so reading and Tab order follow what is seen.
  const wide = matchMedia(WIDE), left = h('div.col'), right = h('div.col');
  function arrange() {
    const focused = stack.contains(document.activeElement) ? document.activeElement : null;
    if (wide.matches) { left.append(floating, appearance); right.append(playback, advanced, reset); stack.replaceChildren(left, right); }
    else stack.replaceChildren(floating, playback, appearance, advanced, reset);
    focused?.focus({ preventScroll: true });
  }
  arrange();
  wide.addEventListener('change', arrange);

  // Server and playback settings return to defaults; appearance, the collapsed display and the log stay.
  async function restoreDefaults() {
    if (!await app.confirm({ title: 'restoreQuestion', detail: 'restoreDetail', accept: 'restore' })) return;
    const { theme, lang, accent, floatingEntryType } = app.config;
    app.save({ ...settings.defaults, theme, lang, accent, floatingEntryType }, { done: 'restored' });
  }

  function entryNumbers() {
    const { view, connected, t } = app;
    const speed = connected ? format.speed(view) : null, buffer = connected && view.media?.present ? format.buffer(view) : null;
    const short = speed ? (speed.unit === 'MB/s' ? speed.mb.toFixed(1) : speed.value) : null;
    return { speed: short, speedUnit: speed?.unit || 'MB/s', buffer: buffer === null ? null : String(Math.round(buffer)), seconds: t('seconds') };
  }
  function renderPill(item, values, tone) {
    const key = JSON.stringify([values, tone]);
    if (item.pill.dataset.key === key) return;
    item.pill.dataset.key = key;
    const dot = `<i class="dot${tone ? ' ' + tone : ''}"></i>`;
    const pair = (value, unit) => `${value ?? '—'}<small>${unit}</small>`;
    item.pill.innerHTML = item.type === 'icon' ? mark + dot
      : dot + (item.type === 'buffer' ? pair(values.buffer, values.seconds)
        : item.type === 'speed' ? pair(values.speed, values.speedUnit)
          : pair(values.speed, values.speedUnit) + '<span class="gap"></span>' + pair(values.buffer, values.seconds));
  }

  function render() {
    const { config, connected, view } = app;
    const state = projectPlayback(view, connected), tone = dotClass[statusKeys(view, state).tone] ?? 'idle', values = entryNumbers();
    for (const item of tiles) {
      const on = config.floatingEntryType === item.type;
      if (item.input.checked !== on) item.input.checked = on;
      item.tile.classList.toggle('on', on);
      renderPill(item, values, tone);
    }
    position.disabled = !connected || app.busy('position');
    stall.checked = config.stallRecovery !== false;
    stallRow.classList.toggle('off', serverChoice(config) !== 'auto');
    theme.set(config.theme);
    for (const input of accentInputs) input.checked = input.value === config.accent;
    text(accentName, app.t(accentKeys[config.accent] || 'accentBlue'));
    language.set(config.lang === 'en' ? 'en' : 'zh');
    motion.checked = app.motion;
    mcdn.set(config.mcdnStrategy);
    ports.checked = !!config.portHeuristic; akamai.checked = !!config.rewriteAkamai; p2p.checked = !!config.p2pGuard;
    const choice = serverChoice(config);
    akamaiRow.classList.toggle('off', choice === 'auto' || choice === 'default');
  }
  return { render, translate() { for (const item of tiles) item.pill.dataset.key = ''; } };
}
