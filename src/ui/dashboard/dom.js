// Small DOM helpers shared by the dashboard pages.
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// h('div.card', { onclick }, child, 'text') builds an element; class names follow the tag after dots.
export function h(spec, props, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { children.unshift(props); props = null; }
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key in node && key !== 'list' && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  append(node, children);
  return node;
}
function append(node, children) {
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : String(child));
}

// Sets text only when it changed, so screen readers and selections are not disturbed every second.
export function text(node, value) {
  const next = value === null || value === undefined ? '' : String(value);
  if (node && node.textContent !== next) node.textContent = next;
}
export function show(node, visible) { if (node && node.hidden === !!visible) node.hidden = !visible; }
export function toggle(node, name, on) { node?.classList.toggle(name, !!on); }

// A value and its unit as two nodes: <strong>4.82 <small>MB/s</small></strong>.
export function figure(node, value, unit) {
  const known = value !== null && value !== undefined && value !== '—';
  node.classList.toggle('muted', !known);
  const key = known ? value + '\u0000' + (unit || '') : '—';
  if (node.dataset.key === key) return;
  node.dataset.key = key;
  node.replaceChildren(known ? String(value) : '—');
  if (known && unit) node.append(' ', h('small', unit));
}
