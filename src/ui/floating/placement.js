// Where the floating control may sit: the visual viewport (zoom and pinch aware), the page regions it must
// not cover on first placement, edge snapping and the four corner presets. Ported from the previous control,
// whose numbers were tuned on real player layouts.
export const INSET = 8, SNAP_DISTANCE = 24;
export const playerSelector = '.bpx-player-container,.bpx-player,#bilibili-player,.bilibili-player,video';
const criticalSelector = playerSelector + ',.danmaku-box,.video-toolbar-container,.video-toolbar-left,.video-toolbar-right,.bili-header,[role=dialog],[aria-modal=true]';
export const protectedSelector = criticalSelector + ',.right-container,.recommend-list-v1,.video-pod,.multi-page-v1';
export const interactiveSelector = 'a[href],button,input,select,textarea,[role=button],[role=link],[contenteditable=true],[tabindex]:not([tabindex="-1"])';

const markers = new WeakMap();
// A fixed, invisible element covering the layout viewport; its rect and computed size reveal page zoom.
export function viewportMarker(scope) {
  const document = scope.document;
  if (!document?.documentElement) return null;
  let marker = markers.get(document);
  if (!marker) {
    marker = document.createElement('div');
    marker.dataset.bilismoothViewport = 'true';
    marker.setAttribute('aria-hidden', 'true');
    marker.inert = true;
    marker.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;margin:0!important;border:0!important;padding:0!important;box-sizing:border-box!important;visibility:hidden!important;pointer-events:none!important;';
    markers.set(document, marker);
  }
  if (!marker.isConnected) document.documentElement.appendChild(marker);
  return marker;
}
export function viewport(scope) {
  const marker = viewportMarker(scope), document = scope.document, visual = scope.visualViewport;
  const fallbackWidth = document?.documentElement?.clientWidth || scope.innerWidth || 0, fallbackHeight = document?.documentElement?.clientHeight || scope.innerHeight || 0;
  const fixed = marker?.getBoundingClientRect() || { left: 0, top: 0, right: fallbackWidth, bottom: fallbackHeight, width: fallbackWidth, height: fallbackHeight };
  const computed = marker && scope.getComputedStyle(marker);
  const ratio = (client, css) => client > 0 && Number.parseFloat(css) > 0 ? client / Number.parseFloat(css) : 1;
  const left = Math.max(fixed.left, visual?.offsetLeft || 0), top = Math.max(fixed.top, visual?.offsetTop || 0);
  const right = Math.max(left, Math.min(fixed.right, (visual?.offsetLeft || 0) + (visual?.width ?? fallbackWidth)));
  const bottom = Math.max(top, Math.min(fixed.bottom, (visual?.offsetTop || 0) + (visual?.height ?? fallbackHeight)));
  return { left, top, right, bottom, width: right - left, height: bottom - top, originX: fixed.left, originY: fixed.top,
    scaleX: ratio(fixed.width, computed?.width), scaleY: ratio(fixed.height, computed?.height) };
}

// Clamp a rectangle into the viewport with the standard inset.
export function within(point, width, height, bounds) {
  return { x: Math.max(bounds.left + INSET, Math.min(point.x, bounds.right - width - INSET)),
    y: Math.max(bounds.top + INSET, Math.min(point.y, bounds.bottom - height - INSET)), width, height };
}
export function corner(name, width, height, bounds) {
  return { x: name.endsWith('Right') ? bounds.right - width - INSET : bounds.left + INSET,
    y: name.startsWith('bottom') ? bounds.bottom - height - INSET : bounds.top + INSET, width, height };
}
// The nearest edges within SNAP_DISTANCE, as a target rectangle, or null.
export function snapCandidate(rect, bounds) {
  const distances = { left: Math.abs(rect.x - bounds.left - INSET), right: Math.abs(bounds.right - INSET - rect.x - rect.width),
    top: Math.abs(rect.y - bounds.top - INSET), bottom: Math.abs(bounds.bottom - INSET - rect.y - rect.height) };
  const x = Math.min(distances.left, distances.right) <= SNAP_DISTANCE ? distances.left <= distances.right ? 'left' : 'right' : null;
  const y = Math.min(distances.top, distances.bottom) <= SNAP_DISTANCE ? distances.top <= distances.bottom ? 'top' : 'bottom' : null;
  if (!x && !y) return null;
  return { xSide: x, ySide: y, width: rect.width, height: rect.height,
    x: x === 'left' ? bounds.left + INSET : x === 'right' ? bounds.right - INSET - rect.width : rect.x,
    y: y === 'top' ? bounds.top + INSET : y === 'bottom' ? bounds.bottom - INSET - rect.height : rect.y };
}

// Web full screen and native full screen both hide the control.
export function fullscreen(scope) {
  const document = scope.document;
  if (document.fullscreenElement) return true;
  if (document.querySelector('.bpx-player.mode-webfullscreen,#bilibili-player.mode-webscreen,.bpx-player.mode-fullscreen')) return true;
  for (const node of document.querySelectorAll('.bpx-player-container,.bpx-player,#bilibili-player')) {
    const rect = node.getBoundingClientRect();
    if (rect.width < scope.innerWidth - 4 || rect.height < scope.innerHeight - 4 || Math.abs(rect.left) > 2 || Math.abs(rect.top) > 2) continue;
    const style = scope.getComputedStyle(node);
    if (style.position === 'fixed' && style.visibility !== 'hidden' && style.display !== 'none') return true;
  }
  return false;
}

// Page regions the first placement avoids: the player, toolbars, header, dialogs, the right column and visible controls.
export function createProtection(scope, host, onChange) {
  const document = scope.document;
  let rects = [], observed = new Set();
  const resizeObserver = typeof scope.ResizeObserver === 'function' ? new scope.ResizeObserver(onChange) : null;
  const playerObserver = new scope.MutationObserver(onChange);
  function visibleRect(node) {
    if (node === host || host.contains(node) || node.closest?.('[hidden]')) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= scope.innerWidth || rect.top >= scope.innerHeight) return null;
    const style = scope.getComputedStyle(node);
    return style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0' ? null : rect;
  }
  function scan() {
    const regions = [...document.querySelectorAll(protectedSelector)].filter(node => node !== host);
    const visibleRegions = regions.map(node => [node, visibleRect(node)]).filter(([, rect]) => rect);
    rects = visibleRegions.map(([, rect]) => rect);
    const controls = [];
    for (const node of document.querySelectorAll(interactiveSelector)) {
      if (visibleRegions.some(([region]) => region === node || region.contains(node))) continue;
      const rect = visibleRect(node);
      if (rect) { rects.push(rect); controls.push(node); }
    }
    if (resizeObserver) {
      const next = new Set([...regions, ...controls]);
      for (const node of observed) if (!next.has(node)) resizeObserver.unobserve(node);
      for (const node of next) if (!observed.has(node)) resizeObserver.observe(node);
      observed = next;
    }
    playerObserver.disconnect();
    const targets = new Set();
    for (const node of document.querySelectorAll(playerSelector)) for (let parent = node; parent && parent !== document; parent = parent.parentElement) targets.add(parent);
    for (const node of targets) playerObserver.observe(node, { attributes: true, attributeFilter: ['class', 'style'] });
  }
  function safe(at, width, height, bounds) {
    if (at.x < bounds.left + INSET - 0.5 || at.y < bounds.top + INSET - 0.5 || at.x + width > bounds.right - INSET + 0.5 || at.y + height > bounds.bottom - INSET + 0.5) return false;
    return !rects.some(rect => at.x < rect.right + INSET && at.x + width > rect.left - INSET && at.y < rect.bottom + INSET && at.y + height > rect.top - INSET);
  }
  // Area of protected regions and controls the rectangle actually covers, for choosing when no corner is clear.
  function covered(at, width, height) {
    return rects.reduce((sum, rect) => sum + Math.max(0, Math.min(at.x + width, rect.right) - Math.max(at.x, rect.left)) * Math.max(0, Math.min(at.y + height, rect.bottom) - Math.max(at.y, rect.top)), 0);
  }
  return {
    scan, safe, covered, observes: node => observed.has(node),
    observeHost(marker) { resizeObserver?.observe(host); if (marker) resizeObserver?.observe(marker); },
    disconnect() { resizeObserver?.disconnect(); playerObserver.disconnect(); observed.clear(); }
  };
}
