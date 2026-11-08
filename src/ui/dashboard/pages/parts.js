// Controls the pages share: segmented choices, switches, setting rows, the server select and log rows.
import { clock } from '../../shared/format.js';
import { icon } from '../../shared/icons.js';
import { serverChoice } from '../../shared/playback.js';
import { h } from '../dom.js';

export const T = key => h('span', { 'data-t': key });
// The unit after a count ("次" in Chinese, nothing in English).
export const unitOf = t => t('times', { n: '' }).trim();
export const modeKey = config => ({ auto: 'automatic', default: 'biliDefault' })[serverChoice(config)] || 'fixedGroup';

let groups = 0;
// Native radios styled as one segmented control. options: [[value, key or { text }]].
export function segmented(options, onPick, label) {
  const name = 'seg' + ++groups;
  const node = h('div.seg', { role: 'radiogroup', 'data-t-label': label });
  const inputs = options.map(([value, caption]) => {
    const input = h('input', { type: 'radio', name, value, onchange: () => input.checked && onPick(value) });
    node.append(h('label', input, typeof caption === 'string' ? T(caption) : h('span', caption.text)));
    return input;
  });
  return { node, set(value) { for (const input of inputs) input.checked = input.value === value; }, inputs };
}
// A checkbox drawn as a switch.
export function toggle(label, onPick) {
  const input = h('input.switch', { type: 'checkbox', role: 'switch', 'data-t-label': label, onchange: () => onPick(input.checked) });
  return input;
}
// A settings row: name (and a short qualifier) on the left, the control on the right.
export function line(key, control, detail) {
  const words = detail ? h('div', h('b', { 'data-t': key }), h('small', { 'data-t': detail })) : h('b', { 'data-t': key });
  return h('div.line', words, control);
}

// The server choice as a native select: Automatic, Bilibili default, then each server.
export function serverSelect(app) {
  const select = h('select', { 'data-t-label': 'server', onchange: () => app.choose(select.value) });
  const node = h('span.select', select);
  node.insertAdjacentHTML('beforeend', icon('down'));
  let key = '';
  function render(value, disabled = false) {
    select.disabled = disabled;
    const hosts = app.hosts(), next = JSON.stringify([hosts, app.lang]);
    if (next !== key) {
      key = next;
      const group = h('optgroup', { label: app.t('fixedGroup') }, hosts.map(host => h('option', { value: host }, app.name(host))));
      select.replaceChildren(h('option', { value: 'auto' }, app.t('automatic')), h('option', { value: 'default' }, app.t('biliDefault')), group);
    }
    if (select.value !== value) select.value = value;
  }
  return { node, render, reset() { key = ''; } };
}

// One log row; `kind` is 'ev' (Overview) or 'ent' (Log).
export function eventRow(row, category, kind) {
  const chip = { playback: '.p', problem: '.e' }[row.category] || '';
  return h('div.' + kind + (row.category === 'problem' ? '.bad' : ''), { role: 'listitem', dataset: { id: row.id } },
    h('time', clock(row.at)), h('span.cat' + chip, category), h('b.ti', row.title), h('span.de', row.detail));
}
