// Inline icons (Tabler, MIT; see control/tabler-LICENSE.txt) and the brand mark. Stroke icons inherit currentColor.
import logo from '../icon.svg';

const paths = {
  overview: '<path d="M4 4h6v8h-6z M4 16h6v4h-6z M14 12h6v8h-6z M14 4h6v4h-6z"/>',
  servers: '<path d="M3 17a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M15 7a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M6 14v-7a3 3 0 0 1 3 -3h4 M18 10v7a3 3 0 0 1 -3 3h-4"/>',
  settings: '<path d="M12 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M4 6l8 0"/><path d="M16 6l4 0"/><path d="M6 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M4 12l2 0"/><path d="M10 12l10 0"/><path d="M15 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M4 18l11 0"/><path d="M19 18l1 0"/>',
  log: '<path d="M13 5h8"/><path d="M13 9h5"/><path d="M13 15h8"/><path d="M13 19h5"/><path d="M3 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"/><path d="M3 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4"/>',
  play: '<path d="M7 4v16l13 -8l-13 -8"/>',
  pause: '<path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12"/><path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12"/>',
  stop: '<path d="M5 7a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -10"/>',
  alert: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  info: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 8h.01 M11 12h1v4h1"/>',
  dashed: '<path d="M8.56 3.69a9 9 0 0 0 -2.92 1.95"/><path d="M3.69 8.56a9 9 0 0 0 -.69 3.44"/><path d="M3.69 15.44a9 9 0 0 0 1.95 2.92"/><path d="M8.56 20.31a9 9 0 0 0 3.44 .69"/><path d="M15.44 20.31a9 9 0 0 0 2.92 -1.95"/><path d="M20.31 15.44a9 9 0 0 0 .69 -3.44"/><path d="M20.31 8.56a9 9 0 0 0 -1.95 -2.92"/><path d="M15.44 3.69a9 9 0 0 0 -3.44 -.69"/>',
  refresh: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
  down: '<path d="M6 9l6 6l6 -6"/>', right: '<path d="M9 6l6 6l-6 6"/>', check: '<path d="M5 12l5 5l10 -10"/>',
  dots: '<path d="M5 12h.01"/><path d="M12 12h.01"/><path d="M19 12h.01"/>',
  download: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/>',
  search: '<path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/>',
  close: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>'
};
export function icon(name, className = 'ic') {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}
// The brand tile (src/ui/icon.svg, coloured by --accent and --ink) and the bare mark in currentColor.
export const brand = logo.replace(/<title>[\s\S]*?<\/title>/, '').replace('<svg', '<svg class="brand-tile" aria-hidden="true"');
export const mark = '<svg class="mk" viewBox="0 0 36 36" fill="currentColor" aria-hidden="true">' + (logo.match(/<g[^>]*>([\s\S]*?)<\/g>/)?.[1] || '') + '</svg>';
// Five bars that read as "playing".
export const wave = '<span class="wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';
