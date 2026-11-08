// Servers: one radio list (Automatic, Bilibili default, then every server with its measured speed,
// first byte and test age), a custom upos host, "when to replace" for a fixed server, Test speed,
// Clear speed data, and this video's tests and switches.
import settings from '../../../core/settings.js';
import * as format from '../../shared/format.js';
import { icon } from '../../shared/icons.js';
import { serverChoice, testResult, testBlocker } from '../../shared/playback.js';
import { h, text, show } from '../dom.js';
import { ceilingFor } from '../chart.js';
import { T, segmented } from './parts.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);

export function createServers(section, app) {
  const stack = section.querySelector('.stack'), head = section.querySelector('.head');
  const result = h('span.result');
  const testButton = h('button.btn.primary', { type: 'button', onclick: () => app.test() });
  testButton.innerHTML = icon('refresh'); testButton.append(T('test'));
  head.append(h('div.headacts', result, testButton));

  const option = (value, nameNode) => {
    const input = h('input', { type: 'radio', name: 'server', value, onchange: () => input.checked && app.choose(value) });
    return h('label.ropt.wide', { dataset: { choice: value } }, input, h('span.radio'), h('div', h('b', nameNode)), h('span'));
  };
  const auto = option('auto', T('automatic'));
  const fallback = option('default', T('biliDefault'));
  const header = h('div.ropt.th', { 'aria-hidden': 'true' }, h('span'), T('server'), h('span'), T('speed'), T('firstByte'), h('span.age', { 'data-t': 'tested' }));
  const list = h('div.hostrows');
  const radios = h('div.radios', { role: 'radiogroup', 'data-t-label': 'servers' }, auto, fallback, h('p.grouplabel', { 'data-t': 'fixedGroup' }), header, list);

  const input = h('input.input', { type: 'text', spellcheck: 'false', autocomplete: 'off', 'data-t-placeholder': 'customPlaceholder', 'data-t-label': 'customServer',
    'aria-describedby': 'custom-error', oninput: () => invalid(false) });
  const error = h('p.field-error', { id: 'custom-error', 'data-t': 'badHost', hidden: true });
  const form = h('form.addrow', { onsubmit: event => { event.preventDefault(); addCustom(); } }, input, h('button.btn', { type: 'submit', 'data-t': 'addCustom' }));
  const mode = segmented([['bad-only', 'replaceSlow'], ['force', 'replaceAlways']], value => app.save({ mode: value }), 'replaceWhen');
  const when = h('div.line.when', h('b', { 'data-t': 'replaceWhen' }), mode.node);
  const clear = h('button.btn.danger', { type: 'button', 'data-t': 'clearData', onclick: async () => { if (await app.act('reset', 'reset')) app.toast(app.t('cleared'), 'ok'); } });
  const records = h('div.records');
  stack.append(h('section.card.servers', radios, form, error, when, h('div.list-foot', h('span'), clear)),
    h('section.card', h('div.card-head', h('h2', { 'data-t': 'history' })), records));
  const rows = new Map();
  let recordsKey = '';

  function invalid(on) {
    input.classList.toggle('bad', on); show(error, on);
    if (on) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }
  function addCustom() {
    if (!settings.isCdnHost(input.value)) { invalid(true); input.focus(); return; }
    const host = settings.patch({ pcdnHost: input.value }).pcdnHost;
    input.value = '';
    app.choose(host);
  }

  function hostRow(host) {
    const radio = h('input', { type: 'radio', name: 'server', value: host, onchange: () => radio.checked && app.choose(host) });
    const node = h('label.ropt', { dataset: { choice: host } }, radio, h('span.radio'), h('div', h('b'), h('small', host)),
      h('span.bar', h('i')), h('span.num.speed'), h('span.num.muted.ttfb'), h('span.tagcell'));
    rows.set(host, node);
    return node;
  }
  function renderRow(node, host, measured, serving, slowBelow, ceiling) {
    const { t } = app;
    text(node.querySelector('b'), app.name(host));
    const mb = finite(measured?.goodputBps) ? measured.goodputBps / 8e6 : null, rate = format.megabytes(mb);
    const bar = node.querySelector('.bar');
    bar.classList.toggle('none', mb === null);
    if (mb !== null) {
      bar.firstChild.style.width = Math.min(100, mb / ceiling * 100).toFixed(1) + '%';
      bar.firstChild.classList.toggle('slow', finite(slowBelow) && mb * 8e6 < slowBelow);
    }
    const speed = node.querySelector('.speed');
    text(speed, rate ? rate.value + ' ' + rate.unit : measured ? '—' : t('notTested'));
    speed.classList.toggle('muted', !rate);
    text(node.querySelector('.ttfb'), finite(measured?.ttfbMedianMs) ? t('ms', { n: Math.round(measured.ttfbMedianMs) }) : '—');
    const cell = node.querySelector('.tagcell'), key = serving ? 'serving|' + app.lang : 'age|' + (format.age(measured?.measuredAt, t) || '—');
    if (cell.dataset.key !== key) {
      cell.dataset.key = key;
      cell.replaceChildren(serving ? h('span.serving', t('serving')) : h('span.age', key.slice(4)));
    }
  }

  function render() {
    const { t, view, connected, config } = app;
    const choice = serverChoice(config);
    const outcome = connected ? testResult(view, t, app.name) : null, blocker = connected ? testBlocker(view, t) : null;
    const resultKey = outcome ? outcome.text : blocker || '';
    if (result.dataset.key !== resultKey) {
      result.dataset.key = resultKey;
      result.innerHTML = outcome && outcome.key !== 'testing' ? icon('check') : '';
      result.append(resultKey);
    }
    testButton.disabled = !connected || app.busy('retry') || !!blocker;

    // Measured servers first (fastest on top), then measured without a trusted speed, then untested in list order.
    const measured = new Map((connected && Array.isArray(view.session?.hosts) ? view.session.hosts : []).map(row => [row.host, row]));
    const speedOf = host => finite(measured.get(host)?.goodputBps) ? measured.get(host).goodputBps : null;
    const rank = host => speedOf(host) !== null ? 0 : measured.has(host) ? 1 : 2;
    const hosts = app.hosts().map((host, index) => ({ host, index })).sort((a, b) => rank(a.host) - rank(b.host) || (speedOf(b.host) || 0) - (speedOf(a.host) || 0) || a.index - b.index);
    const slowBelow = connected && finite(view.session?.requiredBps) && view.session.requiredBps > 0 ? view.session.requiredBps * (finite(view.rate) ? view.rate : 1) : null;
    // Bars share one stepped scale, so the fastest server never overflows and the rest stay comparable.
    const ceiling = ceilingFor(hosts.map(({ host }) => speedOf(host) === null ? null : speedOf(host) / 8e6));
    let cursor = list.firstElementChild;
    for (const { host } of hosts) {
      const node = rows.get(host) || hostRow(host);
      renderRow(node, host, measured.get(host), connected && view.actualHost === host, slowBelow, ceiling);
      if (node !== cursor) list.insertBefore(node, cursor); else cursor = cursor.nextElementSibling;
    }
    for (const [host, node] of rows) if (!hosts.some(item => item.host === host)) { node.remove(); rows.delete(host); }
    for (const node of radios.querySelectorAll('.ropt[data-choice]')) {
      const on = node.dataset.choice === choice;
      node.classList.toggle('sel', on);
      const radio = node.querySelector('input');
      if (radio.checked !== on) radio.checked = on;
    }
    // Changing servers cannot help a blocked video; the floating control says the same.
    const blocked = connected && !!view.availability;
    radios.inert = form.inert = when.inert = blocked;
    show(when, choice !== 'auto' && choice !== 'default');
    mode.set(config.mode === 'force' ? 'force' : 'bad-only');
    clear.disabled = !connected || app.busy('reset');

    const session = connected ? view.session : null;
    const history = [...(session?.races || []).map(row => ({ kind: 'race', ...row })), ...(session?.switches || []).map(row => ({ kind: 'switch', ...row }))]
      .filter(row => finite(row.at)).sort((a, b) => b.at - a.at);
    const key = JSON.stringify([history, app.lang]);
    if (key === recordsKey) return;
    recordsKey = key;
    const join = list => list.filter(Boolean).join(app.lang === 'en' ? ', ' : '、');
    const verdicts = { switched: 'outcomeSwitched', fragment: 'outcomeSwitched', 'current-fastest': 'outcomeFastest', 'below-margin': 'outcomeKept', 'no-completion': 'outcomeNone' };
    records.replaceChildren(...(history.length ? history.map(row => {
      const race = row.kind === 'race';
      const hostsText = race ? join([row.currentHost, ...(row.contenders || [])].map(app.name)) : `${app.name(row.fromHost) || '—'} → ${app.name(row.toHost) || '—'}`;
      const out = race ? (row.verdict ? t(verdicts[row.verdict] || 'outcomeKept') : t('testing')) : t(row.scope === 'fragment' ? 'scopeFragment' : 'scopeVideo');
      return h('div.rec', h('time', format.clock(row.at)), h('span', h('span.what', t(race ? 'historyTest' : 'historySwitch')), hostsText), h('span.out', out));
    }) : [h('p.empty', t('historyEmpty'))]));
  }
  return { render, translate() { recordsKey = ''; for (const node of rows.values()) node.querySelector('.tagcell').dataset.key = ''; } };
}
