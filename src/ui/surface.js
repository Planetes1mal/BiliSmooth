/* Shared BiliSmooth surfaces: mist white, ink gray, and paired accent colors. */
(function (scope) {
  'use strict';
  const tokens = `
  :root,:host {
    color-scheme:light;
    --bg:#f5f7f6;--surface:#ffffff;--surface-soft:#edf2ef;--surface-hover:#e5ece8;
    --ink:#1f2925;--muted:#5b6861;--faint:#626f68;--line:#d9e1dc;
    --brand-pink:#ff6699;--brand-blue:#00aeec;--metric-blue:var(--accent-strong);--metric-icon:var(--muted);
    --accent:#d8eae3;--accent-hover:#c8e0d6;--accent-strong:#2f6d60;
    --accent-soft:#edf5f1;--on-accent:#244d44;--primary:var(--ink);--on-primary:var(--bg);
    --entry-bg:var(--accent);--entry-ink:var(--on-accent);--entry-muted:var(--on-accent);
    --entry-border:color-mix(in srgb,var(--accent-strong) 16%,var(--accent));
    --success:#386349;--success-soft:#e9f1eb;--warning:#805514;--warning-soft:#f8eedb;
    --error:#a13f3b;--error-soft:#f8e9e7;--radius:20px;--radius-control:12px;
    --shadow-entry:inset 0 1px 0 #ffffff66,0 3px 0 #213b2d0b,0 8px 20px #213b2d14;
    --shadow-entry-hover:inset 0 1px 0 #ffffff80,0 6px 0 #213b2d0c,0 14px 28px #213b2d20;
    --shadow-float:0 4px 0 #213b2d08,0 14px 34px #213b2d18;
    --shadow-float-hover:0 6px 0 #213b2d0a,0 18px 38px #213b2d23;
    --shadow-dialog:0 6px 0 #213b2d08,0 18px 48px #213b2d22;--scrim:#1f292566;
    --font:"Segoe UI Variable Text","Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    --font-mono:Consolas,"SFMono-Regular",monospace;
    --ease-out:cubic-bezier(.22,1,.36,1);--ease-spring:cubic-bezier(.2,.8,.2,1.15);
    --duration-fast:150ms;--duration-normal:220ms;--duration-enter:390ms;--duration-exit:240ms;
    --layer-header:10;--layer-floating:2147483000;--layer-toast:120;--layer-dialog:140;
  }
  :root[data-theme=dark],:host([data-theme=dark]) {
    color-scheme:dark;--bg:#191d1b;--surface:#232825;--surface-soft:#2b332e;--surface-hover:#343f38;
    --ink:#eef3f0;--muted:#acb9b1;--faint:#a4b1a9;--line:#3c4941;
    --brand-pink:#ff6699;--brand-blue:#58b1d4;
    --accent:#2d443a;--accent-hover:#375347;--accent-strong:#9cccb7;
    --accent-soft:#26382f;--on-accent:#d3e9dd;
    --success:#b1ceb7;--success-soft:#293b2e;--warning:#e5c78f;--warning-soft:#3b3324;
    --error:#ecb0a9;--error-soft:#3e2e2c;
    --shadow-entry:inset 0 1px 0 #ffffff0d,0 3px 0 #0d161122,0 8px 24px #0d161148;
    --shadow-entry-hover:inset 0 1px 0 #ffffff14,0 6px 0 #0d16112b,0 14px 30px #0d16115c;
    --shadow-float:0 4px 8px #0d16112b,0 16px 40px #0d161154;
    --shadow-float-hover:0 6px 10px #0d161133,0 20px 44px #0d16116b;
    --shadow-dialog:0 16px 48px #0d161166;--scrim:#0d161199;
  }
  :root[data-accent=peach],:host([data-accent=peach]) {--accent:#f6d7c1;--accent-hover:#edc5a8;--accent-strong:#70452e;--accent-soft:#faeee3;--on-accent:#583826}
  :root[data-accent=bili],:host([data-accent=bili]) {--accent:#d5e9ee;--accent-hover:#c4dfe7;--accent-strong:#285e73;--accent-soft:#ecf4f6;--on-accent:#234957}
  :root[data-accent=pink],:host([data-accent=pink]) {--accent:#f2dde3;--accent-hover:#e9cbd5;--accent-strong:#81475d;--accent-soft:#f8edf1;--on-accent:#683447}
  :root[data-accent=teal],:host([data-accent=teal]) {--accent:#d8eae3;--accent-hover:#c8e0d6;--accent-strong:#2f6d60;--accent-soft:#edf5f1;--on-accent:#244d44}
  :root[data-accent=emerald],:host([data-accent=emerald]) {--accent:#e0e8d8;--accent-hover:#cfdec3;--accent-strong:#48653d;--accent-soft:#f0f4eb;--on-accent:#354b2e}
  :root[data-accent=violet],:host([data-accent=violet]) {--accent:#e5dff0;--accent-hover:#d8cdea;--accent-strong:#665083;--accent-soft:#f4f0f8;--on-accent:#503e68}
  :root[data-accent=sunset],:host([data-accent=sunset]) {--accent:#f4e2c8;--accent-hover:#ebd1a9;--accent-strong:#805b28;--accent-soft:#fbf2e5;--on-accent:#62451f}
  :root[data-accent=graphite],:host([data-accent=graphite]) {--accent:#e0e7e3;--accent-hover:#d1dcd5;--accent-strong:#505f57;--accent-soft:#edf1ee;--on-accent:#344039}
  :root[data-theme=dark][data-accent=peach],:host([data-theme=dark][data-accent=peach]) {--accent:#3d322b;--accent-hover:#4b3a2f;--accent-strong:#e6bd9f;--accent-soft:#302a26;--on-accent:#f0d2ba}
  :root[data-theme=dark][data-accent=bili],:host([data-theme=dark][data-accent=bili]) {--accent:#2c373b;--accent-hover:#33454c;--accent-strong:#a9cbd7;--accent-soft:#252e31;--on-accent:#d3e5e9}
  :root[data-theme=dark][data-accent=pink],:host([data-theme=dark][data-accent=pink]) {--accent:#3c2f35;--accent-hover:#4a3840;--accent-strong:#dfb6c5;--accent-soft:#30272b;--on-accent:#efd5df}
  :root[data-theme=dark][data-accent=teal],:host([data-theme=dark][data-accent=teal]) {--accent:#2d443a;--accent-hover:#375347;--accent-strong:#9cccb7;--accent-soft:#26382f;--on-accent:#d3e9dd}
  :root[data-theme=dark][data-accent=emerald],:host([data-theme=dark][data-accent=emerald]) {--accent:#32392b;--accent-hover:#3d4733;--accent-strong:#bbcfa3;--accent-soft:#292f24;--on-accent:#dde9cb}
  :root[data-theme=dark][data-accent=violet],:host([data-theme=dark][data-accent=violet]) {--accent:#36313f;--accent-hover:#443b50;--accent-strong:#c7b9dd;--accent-soft:#2c2833;--on-accent:#e2d9ee}
  :root[data-theme=dark][data-accent=sunset],:host([data-theme=dark][data-accent=sunset]) {--accent:#3c3427;--accent-hover:#4b412d;--accent-strong:#dfc392;--accent-soft:#302b23;--on-accent:#efddbc}
  :root[data-theme=dark][data-accent=graphite],:host([data-theme=dark][data-accent=graphite]) {--accent:#354139;--accent-hover:#425047;--accent-strong:#bbcfc1;--accent-soft:#2b362f;--on-accent:#e0ece4}
  @media(prefers-reduced-motion:reduce) {:root,:host{--duration-fast:0ms;--duration-normal:0ms;--duration-enter:0ms;--duration-exit:0ms}}
  :root[data-motion=off],:host([data-motion=off]) {--duration-fast:0ms;--duration-normal:0ms;--duration-enter:0ms;--duration-exit:0ms}
  `;
  const components = `
  *,*::before,*::after {box-sizing:border-box}
  [hidden] {display:none!important}
  button,input,select,textarea {font:inherit}
  button,select {cursor:pointer}
  button {touch-action:manipulation}
  button:disabled,select:disabled,input:disabled {cursor:not-allowed}
  :focus-visible {outline:2px solid var(--accent-strong);outline-offset:3px}
  ::selection {background:var(--accent-soft);color:var(--ink)}
  .bs-icon,.icon {display:inline-block;width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;vertical-align:middle}
  .bs-button,.button,.bs-icon-button,.icon-button {
    display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;
    padding:7px 13px;border:1px solid var(--line);border-radius:var(--radius-control);
    background:var(--surface);color:var(--ink);font-size:14px;font-weight:600;line-height:20px;
    white-space:nowrap;text-decoration:none;
    transition:color var(--duration-fast),background-color var(--duration-fast),border-color var(--duration-fast),transform var(--duration-fast) var(--ease-out),box-shadow var(--duration-fast);
  }
  .bs-button:hover:not(:disabled),.button:hover:not(:disabled),.bs-icon-button:hover:not(:disabled),.icon-button:hover:not(:disabled) {color:var(--accent-strong);border-color:var(--accent);background:var(--accent-soft)}
  .bs-button:active:not(:disabled),.button:active:not(:disabled),.bs-icon-button:active:not(:disabled),.icon-button:active:not(:disabled) {transform:scale(.97)}
  .bs-button.primary,.button.primary {background:var(--primary);color:var(--on-primary);border-color:transparent;font-weight:650}
  .bs-button.primary:hover:not(:disabled),.button.primary:hover:not(:disabled) {background:var(--accent-strong);color:var(--bg);border-color:transparent}
  .bs-button.ghost,.button.ghost {border-color:transparent;background:transparent;color:var(--muted)}
  .bs-button:disabled,.button:disabled,.bs-icon-button:disabled,.icon-button:disabled {opacity:.45;transform:none}
  .bs-icon-button,.icon-button {width:40px;padding:7px}
  .bs-select {width:100%;min-height:36px;border:1px solid var(--line);border-radius:var(--radius-control);background:var(--surface);color:var(--ink);padding:7px 30px 7px 10px;font-size:14px;line-height:20px;transition:border-color var(--duration-fast),box-shadow var(--duration-fast)}
  .bs-select:hover {border-color:var(--accent)}
  .bs-switch,.toggle {display:inline-block;position:relative;width:38px;height:24px;min-height:24px;flex:none;vertical-align:middle;cursor:pointer}
  .bs-switch input,.toggle input {position:absolute;inset:0;z-index:2;opacity:0;width:38px;height:24px;margin:0;cursor:pointer}
  .bs-switch-track,.toggle-track {display:block;position:relative;width:38px;height:24px;padding:0;background:var(--faint);border-radius:24px;flex:none;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink) 12%,transparent);transition:background-color 180ms var(--ease-out),box-shadow 110ms var(--ease-out),opacity 110ms}
  .bs-switch-track::after,.toggle-track::before {content:"";position:absolute;inset:3px auto auto 3px;width:18px;height:18px;background:var(--surface);border-radius:50%;box-shadow:0 1px 2px #18191c22;transform:translateX(0) scale(1);transition:transform 180ms cubic-bezier(.2,.8,.2,1),background-color 180ms,box-shadow 110ms}
  .bs-switch input:checked+.bs-switch-track,.toggle input:checked+.toggle-track {background:var(--ink)}
  .bs-switch input:checked+.bs-switch-track::after,.toggle input:checked+.toggle-track::before {transform:translateX(14px) scale(1);background:var(--surface)}
  .bs-switch:has(input:not(:disabled)):hover .bs-switch-track,.toggle:has(input:not(:disabled)):hover .toggle-track {box-shadow:inset 0 0 0 1px var(--accent-strong),0 0 0 3px var(--accent-soft)}
  .bs-switch input:active:not(:disabled)+.bs-switch-track::after,.toggle input:active:not(:disabled)+.toggle-track::before {transform:translateX(0) scale(.87)}
  .bs-switch input:checked:active:not(:disabled)+.bs-switch-track::after,.toggle input:checked:active:not(:disabled)+.toggle-track::before {transform:translateX(14px) scale(.87)}
  .bs-switch input:focus-visible+.bs-switch-track,.toggle input:focus-visible+.toggle-track {outline:2px solid var(--accent-strong);outline-offset:3px}
  .bs-switch:has(input:disabled),.toggle:has(input:disabled) {cursor:not-allowed}
  .bs-switch input:disabled+.bs-switch-track,.toggle input:disabled+.toggle-track {opacity:.45}
  .bs-switch input[aria-busy=true]+.bs-switch-track,.toggle input[aria-busy=true]+.toggle-track {opacity:.8;box-shadow:inset 0 0 0 1px var(--accent-strong)}
  .bs-switch input[aria-busy=true]+.bs-switch-track::after,.toggle input[aria-busy=true]+.toggle-track::before {box-shadow:inset 0 0 0 2px var(--accent-strong),0 1px 2px #18191c22;animation:switch-saving 900ms ease-in-out infinite}
  @keyframes switch-saving {50%{opacity:.45}}
  @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
  :root[data-motion=off] *,:root[data-motion=off] *::before,:root[data-motion=off] *::after,:host([data-motion=off]) *,:host([data-motion=off]) *::before,:host([data-motion=off]) *::after {animation:none!important;transition:none!important;scroll-behavior:auto!important}
  `;
  const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 54 54" aria-hidden="true"><rect width="54" height="54" rx="19" fill="var(--accent,#d8eae3)"/><g transform="translate(13 13) scale(.7777778)" fill="var(--ink,#1f2925)"><path d="M11 4H31V11H14L7 18H0V15L11 4Z"/><path d="M11 14H24L31 21H18L11 14Z"/><path d="M5 25H22L29 18H36V21L25 32H5V25Z"/></g></svg>';
  function mount(root) {
    const document = root.ownerDocument || root;
    const target = root.head || root;
    if (target.querySelector('style[data-bilismooth-surface]')) return;
    const style = document.createElement('style');
    style.dataset.bilismoothSurface = 'true';
    style.textContent = tokens + components;
    target.appendChild(style);
  }

  const viewportMarkers = new WeakMap();
  function getViewportMarker(view = scope) {
    const document = view.document;
    if (!document?.documentElement) return null;
    let marker = viewportMarkers.get(document);
    if (!marker) {
      marker = document.createElement('div');
      marker.dataset.bilismoothViewport = 'true';
      marker.setAttribute('aria-hidden', 'true'); marker.inert = true;
      // A fixed box measures reserved gutters and the CSS coordinate origin.
      // Inline resets isolate measurement from page-wide element selectors.
      marker.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;margin:0!important;border:0!important;padding:0!important;box-sizing:border-box!important;visibility:hidden!important;pointer-events:none!important;';
      viewportMarkers.set(document, marker);
    }
    if (!marker.isConnected) document.documentElement.appendChild(marker);
    return marker;
  }
  function viewport(view = scope) {
    const marker = getViewportMarker(view), document = view.document, visual = view.visualViewport;
    const fallbackWidth = document?.documentElement?.clientWidth || view.innerWidth || 0;
    const fallbackHeight = document?.documentElement?.clientHeight || view.innerHeight || 0;
    const fixed = marker?.getBoundingClientRect() || { left: 0, top: 0, right: fallbackWidth, bottom: fallbackHeight, width: fallbackWidth, height: fallbackHeight };
    const computed = marker && view.getComputedStyle(marker);
    const ratio = (client, css) => client > 0 && Number.parseFloat(css) > 0 ? client / Number.parseFloat(css) : 1;
    const left = Math.max(fixed.left, visual?.offsetLeft || 0), top = Math.max(fixed.top, visual?.offsetTop || 0);
    const right = Math.max(left, Math.min(fixed.right, (visual?.offsetLeft || 0) + (visual?.width ?? fallbackWidth)));
    const bottom = Math.max(top, Math.min(fixed.bottom, (visual?.offsetTop || 0) + (visual?.height ?? fallbackHeight)));
    return { left, top, right, bottom, width: right - left, height: bottom - top,
      originX: fixed.left, originY: fixed.top, scaleX: ratio(fixed.width, computed?.width), scaleY: ratio(fixed.height, computed?.height) };
  }

  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function projectPlayback(snapshot, connected = true) {
    if (!connected || !snapshot) return 'disconnected';
    const media = snapshot.media || {};
    if (!media.present) return 'waiting';
    if (media.errorCode || media.playback === 'error') return 'error';
    if (media.ended || media.playback === 'ended') return 'ended';
    if (media.seeking || media.playback === 'seeking') return 'seeking';
    if (media.paused || media.playback === 'paused') return 'paused';
    if (media.playback === 'buffering') return 'buffering';
    if (media.playback === 'frozen' || media.frameHealth?.state === 'frozen') return 'frozen';
    if (media.playback !== 'playing') return 'waiting';
    const observedAt = snapshot.observedAt || snapshot.sampledAt, health = media.frameHealth || {};
    const fresh = finite(observedAt) && Date.now() >= observedAt - 1000 && Date.now() - observedAt <= 3000;
    return health.state === 'healthy' && fresh && !snapshot.hidden && (!finite(health.ageMs) || health.ageMs <= Math.min(3000, health.thresholdMs || 3000)) ? 'smooth' : 'playing';
  }
  const format = Object.freeze({
    buffer(snapshot) { const rate = finite(snapshot?.rate) && snapshot.rate > 0 ? snapshot.rate : 1; return finite(snapshot?.bufferWallSeconds) ? snapshot.bufferWallSeconds : finite(snapshot?.buffer) ? snapshot.buffer / rate : null; },
    speed(snapshot) {
      // A recent observed idle window is a real zero, even without a new transfer.
      const at = snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'speedObservedAt') ? snapshot.speedObservedAt : snapshot?.lastTransferAt;
      const age = Date.now() - at;
      const recent = finite(at) && age >= -1000 && age <= 3000;
      const mb = recent && finite(snapshot?.lastMbps) && snapshot.lastMbps >= 0 ? snapshot.lastMbps / 8 : null;
      return { value: mb === null ? '-' : mb > 0 && mb < 1 ? (mb * 1000).toFixed(0) : mb.toFixed(2), unit: mb > 0 && mb < 1 ? 'KB/s' : 'MB/s' };
    },
    time(value) { if (!finite(value) || value < 0) return '-'; const seconds = Math.floor(value); return (seconds >= 3600 ? Math.floor(seconds / 3600) + ':' : '') + (seconds >= 3600 ? String(Math.floor(seconds / 60) % 60).padStart(2, '0') : Math.floor(seconds / 60)) + ':' + String(seconds % 60).padStart(2, '0'); }
  });
  scope.BiliSmoothSurfaceStyles = Object.freeze({ tokens, components, logo, mount, viewport, getViewportMarker, projectPlayback, format });
  if (typeof document !== 'undefined' && document.currentScript?.dataset.bilismoothSurface === 'document') mount(document);
})(globalThis);
