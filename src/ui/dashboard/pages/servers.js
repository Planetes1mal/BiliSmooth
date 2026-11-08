// Servers: one radio list (Automatic, Bilibili default, then every server with its measured speed,
// likely quality, first byte and test age; the user's own servers can be removed), adding a server, "when to replace"
// for a fixed server, Test speed, Clear speed data, and this video's tests and switches.
import settings from '../../../core/settings.js';
import * as format from '../../shared/format.js';
import { icon } from '../../shared/icons.js';
import { serverChoice, testResult, testBlocker, videoQualities, qualityFit, serverMeasurements } from '../../shared/playback.js';
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
    'aria-describedby': 'custom-error', oninput: () => invalid(null) });
  const error = h('p.field-error', { id: 'custom-error', hidden: true });
  const form = h('form.addrow', { onsubmit: event => { event.preventDefault(); addCustom(); } }, input, h('button.btn', { type: 'submit', 'data-t': 'addCustom' }));
  const mode = segmented([['bad-only', 'replaceSlow'], ['force', 'replaceAlways']], value => app.save({ mode: value }), 'replaceWhen');
  const when = h('div.line.when', h('b', { 'data-t': 'replaceWhen' }), mode.node);
  const clear = h('button.btn.danger', { type: 'button', 'data-t': 'clearData', onclick: async () => { if (await app.act('reset', 'reset')) app.toast(app.t('cleared'), 'ok'); } });
  const records = h('div.records');
  stack.append(h('section.card.servers', radios, form, error, when, h('div.list-foot', h('span'), clear)),
    h('section.card', h('div.card-head', h('h2', { 'data-t': 'history' })), records));
  const rows = new Map();
  let recordsKey = '', errorKey = null, ids = 0;

  function invalid(key) {
    errorKey = key;
    input.classList.toggle('bad', !!key); show(error, !!key);
    if (key) { input.setAttribute('aria-invalid', 'true'); text(error, app.t(key, { n: settings.customHostsMax })); }
    else input.removeAttribute('aria-invalid');
  }
  // Adding keeps the current server choice; the new server joins the list and automatic racing.
  function addCustom() {
    const host = settings.patch({ pcdnHost: input.value }).pcdnHost;
    if (!host) { invalid('badHost'); input.focus(); return; }
    if (app.addHost(host) === 'full') { invalid('customFull'); input.focus(); return; }
    input.value = '';
  }

  function hostRow(host) {
    const radio = h('input', { type: 'radio', name: 'server', value: host, onchange: () => radio.checked && app.choose(host) });
    const id = 'server-' + ++ids;
    // A button inside the row's label: it sits above the row's radio and never selects the row.
    const remove = h('button.remove', { type: 'button', hidden: true, onclick: event => { event.preventDefault(); event.stopPropagation(); app.removeHost(host); } });
    remove.innerHTML = icon('close');
    const node = h('label.ropt', { dataset: { choice: host } }, radio, h('span.radio'), h('div', h('b', { id: id + '-name' }), h('small', { id: id + '-host' }, host)),
      h('span.bar', h('i')), h('div', h('span.num.speed'), h('small.fit')), h('span.num.muted.ttfb'), h('span.tagcell', h('span.tag'), remove));
    node.dataset.id = id;
    rows.set(host, node);
    return node;
  }
  function renderRow(node, host, measured, serving, qualities, playbackRate, ceiling) {
    const { t } = app;
    text(node.querySelector('b'), app.name(host));
    const own = app.own().includes(host), remove = node.querySelector('.remove'), radio = node.querySelector('input');
    remove.hidden = !own;
    if (own) remove.setAttribute('aria-label', t('removeServer', { name: app.name(host) }));
    // The remove button's name stays out of the radio's name.
    if (own) radio.setAttribute('aria-labelledby', node.dataset.id + '-name ' + node.dataset.id + '-host'); else radio.removeAttribute('aria-labelledby');
    const mb = finite(measured?.goodputBps) ? measured.goodputBps / 8e6 : null, rate = format.megabytes(mb);
    const bar = node.querySelector('.bar');
    bar.classList.toggle('none', mb === null);
    if (mb !== null) bar.firstChild.style.width = Math.min(100, mb / ceiling * 100).toFixed(1) + '%';
    const speed = node.querySelector('.speed');
    text(speed, rate ? rate.value + ' ' + rate.unit : measured ? '—' : t('notTested'));
    speed.classList.toggle('muted', !rate);
    // Warn when the speed likely falls short of the quality being played, or of every quality.
    const fit = qualityFit(measured?.goodputBps, qualities, playbackRate), name = fit?.quality && format.qualityName(fit.quality, app.lang);
    const label = node.querySelector('.fit');
    text(label, !fit ? '—' : !fit.quality ? t('mayStutter') : name ? t('qualityFit', { q: name }) : '—');
    label.classList.toggle('warn', !!fit?.short);
    text(node.querySelector('.ttfb'), finite(measured?.ttfbMedianMs) ? t('ms', { n: Math.round(measured.ttfbMedianMs) }) : '—');
    const cell = node.querySelector('.tag'), key = serving ? 'serving|' + app.lang : 'age|' + (format.age(measured?.measuredAt, t) || '—');
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
    const measured = connected ? serverMeasurements(view.session, view.networkEpoch) : new Map();
    const speedOf = host => finite(measured.get(host)?.goodputBps) ? measured.get(host).goodputBps : null;
    const rank = host => speedOf(host) !== null ? 0 : measured.has(host) ? 1 : 2;
    const hosts = app.hosts().map((host, index) => ({ host, index })).sort((a, b) => rank(a.host) - rank(b.host) || (speedOf(b.host) || 0) - (speedOf(a.host) || 0) || a.index - b.index);
    const qualities = connected ? videoQualities(view.session) : [];
    // Bars share one stepped scale, so the fastest server never overflows and the rest stay comparable.
    const ceiling = ceilingFor(hosts.map(({ host }) => speedOf(host) === null ? null : speedOf(host) / 8e6));
    let cursor = list.firstElementChild;
    for (const { host } of hosts) {
      const node = rows.get(host) || hostRow(host);
      renderRow(node, host, measured.get(host), connected && view.actualHost === host, qualities, view?.rate, ceiling);
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
    if (errorKey) text(error, t(errorKey, { n: settings.customHostsMax }));
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
  return { render, translate() { recordsKey = ''; for (const node of rows.values()) node.querySelector('.tag').dataset.key = ''; } };
}
