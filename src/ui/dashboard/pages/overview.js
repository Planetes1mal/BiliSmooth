// Overview: the state banner, four numbers, the 45 s speed chart, a quick server choice with the
// last speed test, and the three latest log rows. Before a video plays, only the numbers show (as —).
import * as format from '../../shared/format.js';
import { icon, wave } from '../../shared/icons.js';
import { projectPlayback, statusKeys, serverChoice, testResult, testBlocker } from '../../shared/playback.js';
import { h, text, show, figure } from '../dom.js';
import { createChart, series } from '../chart.js';
import { rows as logRows, CATEGORY_KEYS } from '../events.js';
import { serverSelect, unitOf, eventRow, modeKey } from './parts.js';

const glyphs = { smooth: wave, playing: wave, buffering: wave, frozen: icon('alert'), error: icon('alert'), blocked: icon('alert'),
  paused: icon('pause'), ended: icon('stop'), seeking: icon('refresh') };

export function createOverview(stack, app) {
  const T = key => h('span', { 'data-t': key });
  const banner = h('section.card.status', h('span.glyph'), h('div', h('b'), h('small')));
  const kpi = (key, extra = []) => h('section.card.kpi', h('span.lbl', T(key)), h('strong'), ...extra);
  const speed = kpi('speed'), buffered = kpi('buffered'), switches = kpi('switchesThisVideo', [h('span.sub')]);
  const server = h('button.card.kpi.link', { type: 'button', onclick: () => app.go('routes') }, h('span.lbl', T('currentServer'), h('span', { html: icon('right') })), h('strong'), h('span.sub'));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'chart big'); svg.setAttribute('aria-hidden', 'true');
  const ceiling = h('span.ymax');
  const chartCard = h('section.card.chart-card', h('div.card-head', h('h2', { 'data-t': 'last45' })), h('div.chart-wrap', ceiling, svg, h('div.axis', T('ago45'), T('now'))));
  const select = serverSelect(app);
  const result = h('p.result');
  const testButton = h('button.btn', { type: 'button', onclick: () => app.test() });
  testButton.innerHTML = icon('refresh'); testButton.append(T('test'));
  const all = h('button.btn.link', { type: 'button', onclick: () => app.go('routes') }, T('allServers'));
  all.insertAdjacentHTML('beforeend', icon('right'));
  const quick = h('section.card.quick', h('div.card-head', h('h2', { 'data-t': 'server' }), all), select.node, result, h('div.acts', testButton));
  const twoUp = h('div.two-up', chartCard, quick);
  const seeAll = h('button.btn.link', { type: 'button', onclick: () => app.go('logs') }, T('seeAll'));
  seeAll.insertAdjacentHTML('beforeend', icon('right'));
  const events = h('div.evs');
  const recent = h('section.card.recent', h('div.card-head', h('h2', { 'data-t': 'recent' }), seeAll), events);
  stack.append(banner, h('div.kpis', speed, buffered, server, switches), twoUp, recent);
  const chart = createChart(svg, { fill: true, dot: true, motion: app.motionOn });
  let eventsKey = '';

  function render() {
    const { t, view, connected, config, lang } = app;
    const live = connected && !!(view.media?.present || view.availability);
    show(banner, live); show(twoUp, live); show(recent, live);

    const state = projectPlayback(view, connected), keys = statusKeys(view, state);
    banner.dataset.tone = keys.tone;
    const glyph = keys.title === 'defaultOn' ? icon('dashed') : glyphs[state] || icon('dashed');
    if (banner.firstChild.dataset.glyph !== glyph) { banner.firstChild.dataset.glyph = glyph; banner.firstChild.innerHTML = glyph; }
    text(banner.querySelector('b'), t(keys.title)); text(banner.querySelector('small'), keys.detail ? t(keys.detail) : '');

    const rate = connected ? format.speed(view) : null;
    figure(speed.querySelector('strong'), rate?.value, rate?.unit);
    const seconds = connected && view.media?.present ? format.buffer(view) : null;
    figure(buffered.querySelector('strong'), seconds === null ? null : seconds.toFixed(1), t('seconds'));
    figure(server.querySelector('strong'), connected ? app.name(view.actualHost) : null);
    const sub = server.querySelector('.sub');
    text(sub, connected ? t(modeKey(config)) : ''); show(sub, connected);
    const session = connected ? view.session : null, count = Array.isArray(session?.switches) ? session.switches.length : null;
    figure(switches.querySelector('strong'), count, unitOf(t));
    const recovered = connected ? view.counters?.recoveries : null;
    const recoveredText = switches.querySelector('.sub');
    text(recoveredText, Number.isFinite(recovered) ? t(recovered === 1 ? 'recoveredOne' : 'recoveredCount', { n: recovered }) : ''); show(recoveredText, Number.isFinite(recovered));
    if (!live) return;

    chart.update(series(view.speedSamples));
    text(ceiling, t('ceiling', { n: chart.ceiling() }));
    select.render(serverChoice(config));
    const outcome = testResult(view, t, app.name), blocker = outcome ? null : testBlocker(view, t);
    result.classList.toggle('done', !!outcome && outcome.key !== 'testing');
    const resultKey = outcome ? outcome.text : blocker || '';
    if (result.dataset.key !== resultKey) {
      result.dataset.key = resultKey;
      result.innerHTML = outcome && outcome.key !== 'testing' ? icon('check') : '';
      result.append(resultKey);
    }
    testButton.disabled = app.busy('retry') || !!testBlocker(view, t);

    const latest = logRows(view.events, { t, lang, limit: 3, notable: true }), key = JSON.stringify([latest, lang]);
    if (key !== eventsKey) { eventsKey = key; events.replaceChildren(...latest.map(row => eventRow(row, t(CATEGORY_KEYS[row.category]), 'ev'))); }
  }
  return { render, translate() { eventsKey = ''; select.reset(); }, enter() { chart.redraw(); } };
}
