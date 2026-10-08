'use strict';
module.exports = function emitter(value = {}, { event = false, targetOnly = true } = {}) {
  const listeners = new Map(), capture = options => options === true || options?.capture === true;
  value.addEventListener = (type, fn, options) => {
    if (!listeners.has(type)) listeners.set(type, []);
    const rows = listeners.get(type), useCapture = capture(options);
    if (!rows.some(row => row.fn === fn && row.capture === useCapture)) rows.push({ fn, capture: useCapture, once: !!options?.once });
  };
  value.removeEventListener = (type, fn, options) => {
    const rows = listeners.get(type) || [], index = rows.findIndex(row => row.fn === fn && row.capture === capture(options));
    if (index >= 0) rows.splice(index, 1);
  };
  value.emit = (type, data = {}) => {
    const rows = listeners.get(type) || [];
    // Chromium XHR is target-only: capture does not reorder its listeners.
    const ordered = targetOnly ? [...rows] : [...rows].sort((a, b) => Number(b.capture) - Number(a.capture));
    for (const row of ordered) {
      if (!rows.includes(row)) continue;
      if (row.once) rows.splice(rows.indexOf(row), 1);
      row.fn(event ? { type, target: value, currentTarget: value, ...data } : data);
    }
  };
  value.count = type => listeners.get(type)?.length || 0;
  return value;
};
