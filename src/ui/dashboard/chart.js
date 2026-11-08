// The 45 s download-speed chart: one slot per second, a monotone cubic line (no overshoot), unknown
// slots bridged by a dashed link (never drawn as zero), a dot on the latest value and a stepped ceiling.
// When motion is on, the line slides left one step per new sample; otherwise it only redraws.
export const CEILING = 8;   // MB/s at the top of a speed chart or bar until a value needs more room
// The ceiling grows in steps (8, 16, 32 … MB/s) so a fast server is never clipped and small noise is never magnified.
export function ceilingFor(values) {
  const peak = Math.max(0, ...(values || []).filter(value => typeof value === 'number' && Number.isFinite(value)));
  let ceiling = CEILING;
  while (peak > ceiling) ceiling *= 2;
  return ceiling;
}
export const SPAN = 45;     // seconds shown; SPAN + 1 slots

const finite = value => typeof value === 'number' && Number.isFinite(value);
const fixed = value => value.toFixed(1);

// speedSamples [{ at, mbps }] (megabits per second, null = unknown) as MB/s per slot, oldest first.
// The newest sample anchors the right edge; an old anchor (no recent sample) falls back to `now`.
export function series(samples, now = Date.now()) {
  const rows = (Array.isArray(samples) ? samples : []).filter(row => finite(row?.at) && row.at <= now + 2000).sort((a, b) => a.at - b.at);
  let anchor = rows.length ? rows[rows.length - 1].at : null;
  if (anchor === null || now - anchor > 3000) anchor = now;
  const values = new Array(SPAN + 1).fill(null);
  for (const row of rows) {
    const slot = SPAN - Math.round((anchor - row.at) / 1000);
    if (slot >= 0 && slot <= SPAN) values[slot] = finite(row.mbps) && row.mbps >= 0 ? row.mbps / 8 : null;
  }
  return { values, anchor };
}

// Monotone cubic Hermite (Fritsch–Carlson) through points sorted by x, as an SVG path.
export function monotone(points) {
  const n = points.length;
  if (!n) return '';
  if (n === 1) return `M${fixed(points[0][0])} ${fixed(points[0][1])} h0.01`;
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((points[i + 1][1] - points[i][1]) / (points[i + 1][0] - points[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  let path = `M${fixed(points[0][0])} ${fixed(points[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1], dx = (x1 - x0) / 3;
    path += ` C${fixed(x0 + dx)} ${fixed(y0 + m[i] * dx)} ${fixed(x1 - dx)} ${fixed(y1 - m[i + 1] * dx)} ${fixed(x1)} ${fixed(y1)}`;
  }
  return path;
}

// Path data for values (MB/s or null) laid out `step` px apart in a box of `height` px.
export function paths(values, { step, height, max = CEILING, top = 5, fill = false }) {
  const y = value => (height - 2) - (Math.min(value, max) / max) * (height - top - 2);
  const runs = [];
  let run = [];
  values.forEach((value, index) => {
    if (finite(value)) run.push([index * step, y(Math.max(0, value))]);
    else if (run.length) { runs.push(run); run = []; }
  });
  if (run.length) runs.push(run);
  let line = '', area = '', gap = '';
  runs.forEach((points, index) => {
    const path = monotone(points);
    line += path + ' ';
    if (fill && points.length > 1) area += `${path} L${fixed(points[points.length - 1][0])} ${height} L${fixed(points[0][0])} ${height} Z `;
    if (index > 0) {
      const [a, b] = [runs[index - 1][runs[index - 1].length - 1], points[0]];
      gap += `M${fixed(a[0])} ${fixed(a[1])} L${fixed(b[0])} ${fixed(b[1])} `;
    }
  });
  const last = runs.length ? runs[runs.length - 1][runs[runs.length - 1].length - 1] : null;
  return { line: line.trim(), area: area.trim(), gap: gap.trim(), end: last };
}

// A live chart in an <svg>. `update(series(...))` on every state; `motion()` says whether travel is allowed.
export function createChart(svg, { fill = false, dot = true, motion = () => false } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const group = document.createElementNS(ns, 'g');
  const make = (name, className) => { const node = document.createElementNS(ns, name); node.setAttribute('class', className); group.append(node); return node; };
  const area = fill ? make('path', 'area') : null, gap = make('path', 'gap'), line = make('path', 'line'), end = dot ? make('circle', 'end') : null;
  gap.setAttribute('vector-effect', 'non-scaling-stroke'); line.setAttribute('vector-effect', 'non-scaling-stroke');
  end?.setAttribute('r', '3.5');
  svg.append(group);
  let values = [], anchor = null, sliding = null, width = 0, height = 0, max = CEILING;

  function measure() {
    width = Math.round(svg.clientWidth); height = Math.round(svg.clientHeight);
    if (!width || !height) return false;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    return true;
  }
  const stepOf = () => (width - (dot ? 6 : 0)) / SPAN;
  function draw(list) {
    const result = paths(list, { step: stepOf(), height, fill, top: dot ? 5 : 2, max });
    area?.setAttribute('d', result.area);
    gap.setAttribute('d', result.gap);
    line.setAttribute('d', result.line);
    if (end) {
      end.toggleAttribute('hidden', !result.end);
      if (result.end) { end.setAttribute('cx', fixed(result.end[0])); end.setAttribute('cy', fixed(result.end[1])); }
    }
  }
  function stop() {
    if (!sliding) return;
    const current = sliding; sliding = null;
    try { current.stop(); } catch {}
    group.style.transform = '';
  }
  function update(next) {
    // Renders that bring no new sample leave a running slide alone.
    if (next.anchor === anchor && next.values.length === values.length && next.values.every((value, index) => value === values[index])) return;
    const shift = anchor === null ? 0 : Math.round((next.anchor - anchor) / 1000), previous = values;
    values = next.values; anchor = next.anchor; max = ceilingFor(values);
    stop();
    if (!measure()) return;
    const engine = globalThis.BiliSmoothMotion;
    if (!engine || !motion() || shift < 1 || shift > 3 || previous.length !== values.length) { draw(values); return; }
    // Old leftmost slots followed by the new window: sliding left by `shift` steps lands exactly on draw(values).
    draw(previous.slice(0, shift).concat(values));
    const animation = engine.animate(group, { transform: ['translateX(0px)', `translateX(${-stepOf() * shift}px)`] }, { duration: 1, ease: 'linear' });
    sliding = animation;
    Promise.resolve(animation.finished).then(() => { if (sliding === animation) { sliding = null; group.style.transform = ''; draw(values); } }, () => {});
  }
  function redraw() { stop(); if (measure()) draw(values); }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(redraw) : null;
  observer?.observe(svg);
  return { update, redraw, stop, ceiling: () => max };
}
