// The floating control on Bilibili video pages: a collapsed entry, a hover preview and a panel, in one
// shadow root. It reads BiliSmoothRuntime (src/page/ui-contract.js) and BiliSmoothSettings, and nothing else
// from the core. Placement, dragging and visibility rules are ported from the previous control.
import tokens from '../shared/tokens.css';
import css from './floating.css';
import { translator } from '../shared/strings.js';
import * as format from '../shared/format.js';
import { projectPlayback, serverChoice, choicePatch, statusKeys, testResult, testBlocker } from '../shared/playback.js';
import { icon, brand, mark, wave } from '../shared/icons.js';
import { viewport, viewportMarker, within, corner, snapCandidate, fullscreen, createProtection, protectedSelector, interactiveSelector, INSET } from './placement.js';

const POSITION_KEY = 'bilismooth.panel.position.v3';
const ORDER = { edge: 0, preview: 1, panel: 2 };
const CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const SETTLE_MS = 5000;
const WIDTH = { preview: 256, panel: 312 };

function boot(scope) {
  const document = scope.document, runtime = scope.BiliSmoothRuntime, settings = scope.BiliSmoothSettings, engine = scope.BiliSmoothMotion;
  if (!document || !runtime || !settings || scope.BiliSmoothFloating) return;
  const darkQuery = scope.matchMedia('(prefers-color-scheme: dark)'), reduceQuery = scope.matchMedia('(prefers-reduced-motion: reduce)');
  const cleanups = [], opening = new Map();
  let host, shadow, protection, snapHint, domObserver;
  let mounted = false, suspended = false, phase = 'edge', view = {}, t = translator('zh'), motionPreference = true;
  let hoverTimer = null, pointerInside = false, previewDismissed = false, touchEntry = false, suppressFocus = false, suppressClickUntil = 0;
  let drag = null, deferredLayout = false, positionAnimation = null, morph = null, morphSerial = 0;
  let anchor = null, snapped = { x: null, y: null }, preference = 'bottomRight', lastPlacement = null, settle = null;
  let menu = null, busy = false, feedback = { text: '', tone: '', kind: '' }, route = '', generation = null, wasFullscreen = false, testSeen = false;
  let renderFrame = null, layoutFrame = null, hostSize = '', unsubscribe = null, openingSerial = 0, signature = '';
  // Settings → Floating control → Show on video pages; off leaves the control unmounted until it is turned on again.
  let allowed = runtime.getConfig().showFloating !== false;

  try {
    const saved = JSON.parse(scope.localStorage.getItem(POSITION_KEY) || 'null');
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y) && ['left', 'right'].includes(saved.xSide) && ['top', 'bottom'].includes(saved.ySide)) {
      anchor = { x: saved.x, y: saved.y, xSide: saved.xSide, ySide: saved.ySide };
      snapped = { x: ['left', 'right'].includes(saved.snapX) ? saved.snapX : null, y: ['top', 'bottom'].includes(saved.snapY) ? saved.snapY : null };
    } else if (CORNERS.includes(saved?.anchor)) preference = saved.anchor;
  } catch { /* An unreadable position falls back to the default corner. */ }

  const $ = id => shadow?.getElementById(id);
  const listen = (target, name, callback, options) => { target.addEventListener(name, callback, options); cleanups.push(() => target.removeEventListener(name, callback, options)); };
  const motionOn = () => host?.dataset.motion === 'on' && !!engine?.animate;
  const setText = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
  const setHtml = (node, value) => { if (node && node.dataset.html !== value) { node.innerHTML = value; node.dataset.html = value; } };

  // Only video, bangumi and list playback paths get a control, with or without a language prefix (/en/, /zh-Hans/),
  // and only while the setting allows it.
  function routeKey() {
    if (!allowed || !/^(?:www\.)?bilibili\.com$/i.test(scope.location.hostname)) return '';
    const path = scope.location.pathname;
    if (/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?(?:video\/(?:BV[a-z0-9]+|av\d+)|bangumi\/play\/(?:ep|ss)\d+)\/?$/i.test(path)) return path;
    if (!/^\/(?:[a-z]{2}(?:-[A-Za-z]{2,4})?\/)?list\/(?:watchlater|ml\d+)\/?$/i.test(path)) return '';
    const query = new URL(scope.location.href).searchParams, video = query.get('bvid') || query.get('oid');
    return video ? path + '?' + video : '';
  }
  function persistPlacement() {
    try { scope.localStorage.setItem(POSITION_KEY, JSON.stringify(anchor ? { ...anchor, snapX: snapped.x, snapY: snapped.y } : { anchor: preference })); } catch { /* Storage may be blocked. */ }
  }
  function captureAnchor(rect, chooseSides = false, bounds = viewport(scope)) {
    const xSide = chooseSides || !anchor ? (rect.x + rect.width / 2 < bounds.left + bounds.width / 2 ? 'left' : 'right') : anchor.xSide;
    const ySide = chooseSides || !anchor ? (rect.y + rect.height / 2 < bounds.top + bounds.height / 2 ? 'top' : 'bottom') : anchor.ySide;
    anchor = { xSide, ySide, x: rect.x + (xSide === 'right' ? rect.width : 0), y: rect.y + (ySide === 'bottom' ? rect.height : 0) };
    host.dataset.anchor = xSide + '-' + ySide;
  }

  // ——— Markup ———
  function create() {
    host = document.createElement('div');
    host.id = 'bilismooth-floating';
    host.hidden = true;
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${tokens}${css}</style>
      <button id="entry" class="entry" type="button" aria-expanded="false"></button>
      <div id="preview" class="surface preview" role="button" tabindex="0" aria-expanded="false" hidden>
        <div class="state" id="preview-state"><span class="glyph"></span><div><b></b><small></small></div></div>
        <div id="preview-rows"><div class="kv"><span data-t="speed"></span><strong id="preview-speed"></strong></div>
          <div class="kv"><span data-t="buffered"></span><strong id="preview-buffer"></strong></div>
          <div class="kv"><span data-t="server"></span><strong id="preview-server"></strong></div></div>
        <p class="copy" id="preview-copy" hidden></p>
      </div>
      <section id="panel" class="surface panel" hidden>
        <header id="grip" class="grip">${brand}<b>BiliSmooth</b>
          <button id="more" class="ibtn" type="button" aria-haspopup="menu" aria-expanded="false">${icon('dots')}</button>
          <button id="collapse" class="ibtn" type="button">${icon('down')}</button></header>
        <div id="server-menu" class="menu servers" role="menu" hidden></div>
        <div id="more-menu" class="menu more" role="menu" hidden>
          <div class="group" data-t="moveTo"></div>
          <div class="corners">${CORNERS.map(name => `<button class="opt" type="button" role="menuitem" data-corner="${name}" data-t="${name}"></button>`).join('')}</div>
          <button class="opt" type="button" role="menuitem" data-corner="reset" data-t="resetPosition"></button>
          <button class="opt" type="button" role="menuitem" data-action="clear" data-t="clearData"></button>
        </div>
        <div class="body">
          <div class="state" id="panel-state"><span class="glyph"></span><div><b role="status" aria-live="polite"></b><small></small></div></div>
          <div class="metrics"><div class="metric"><p data-t="speed"></p><div class="val"><strong id="speed"></strong><span id="speed-unit"></span></div></div>
            <div class="metric"><p data-t="buffered"></p><div class="val"><strong id="buffer"></strong><span data-t="seconds"></span></div></div></div>
          <div class="field"><span id="server-label" data-t="server"></span>
            <button id="server" class="select" type="button" aria-haspopup="menu" aria-expanded="false" aria-labelledby="server-label server-value"><span id="server-value"></span>${icon('down')}</button></div>
          <div class="serving" id="serving"><span data-t="serving"></span><strong id="serving-name"></strong></div>
          <p class="host-line" id="serving-host"></p>
          <div class="notice warn" id="reload-notice" hidden><p data-t="applyReloadDetail"></p><button class="btn primary" type="button" data-action="reload" data-t="reload"></button></div>
          <div class="notice error" id="save-notice" hidden><p data-t="saveFailedDetail"></p><button class="btn primary" type="button" data-action="save-retry" data-t="retry"></button></div>
          <div class="actions"><button id="test" class="btn" type="button" data-action="test">${icon('refresh')}<span data-t="test"></span></button>
            <button class="btn" type="button" data-action="dashboard" data-t="dashboard"></button></div>
          <p class="feedback" id="feedback" role="status" aria-live="polite"></p>
        </div>
      </section>`;
    snapHint = document.createElement('div');
    snapHint.dataset.bilismoothSnapHint = '';
    snapHint.setAttribute('aria-hidden', 'true');
    snapHint.inert = true;
    snapHint.style.cssText = 'all:initial;display:none;position:fixed;pointer-events:none;box-sizing:border-box;z-index:2147482999;border:1.5px dashed currentColor;border-radius:8px;background:color-mix(in srgb,currentColor 8%,transparent);opacity:.6;';
    document.documentElement.appendChild(snapHint);
    protection = createProtection(scope, host, onObserved);
    wire();
  }

  // ——— Rendering ———
  function stateIcon(tone, state) {
    if (state === 'paused') return icon('pause');
    if (state === 'ended') return icon('stop');
    if (tone === 'error') return icon('alert');
    if (tone === 'idle') return icon('dashed');
    return wave;
  }
  function entryMarkup(type, state, tone) {
    const dot = `<i class="dot"></i>`, speed = format.speed(view), seconds = format.buffer(view);
    const blocked = state === 'blocked', unknownMetrics = blocked || !view.media?.present;
    if (type === 'icon') return { round: true, html: mark + (state === 'paused' ? '' : dot) };
    if (blocked) return { html: dot + `<span class="word">${t(statusKeys(view, state).title)}</span>` };
    if (state === 'ended') return { html: icon('stop') + `<span class="word">${t('ended')}</span>` };
    const lead = state === 'paused' ? icon('pause') : dot;
    const speedText = unknownMetrics || !speed ? format.DASH : speed.unit === 'MB/s' ? speed.mb.toFixed(1) : speed.value;
    const speedPart = `${speedText}<small>${speed?.unit || 'MB/s'}</small>`;
    const bufferPart = `${unknownMetrics || seconds === null ? format.DASH : Math.round(seconds)}<small>${t('seconds')}</small>`;
    if (type === 'speed') return { html: lead + speedPart };
    if (type === 'combined') return { html: lead + speedPart + '<span class="gap"></span>' + bufferPart };
    return { html: lead + bufferPart };
  }
  function renderState(node, keys, state) {
    node.dataset.tone = keys.tone;
    setHtml(node.querySelector('.glyph'), stateIcon(keys.tone, state));
    setText(node.querySelector('b'), t(keys.title));
    setText(node.querySelector('small'), keys.detail ? t(keys.detail) : '');
  }
  function serverLabel(choice) {
    return choice === 'auto' ? t('automatic') : choice === 'default' ? t('biliDefault') : format.serverName(choice, view.config?.lang) || format.DASH;
  }
  function hosts() {
    const config = view.config || {};
    return [...new Set([...(settings.fixedHosts || []), ...(view.allowedHosts || []), config.pcdnHost].filter(value => settings.isCdnHost(value)))];
  }
  function renderMenu(choice) {
    const lang = view.config?.lang;
    const option = (value, label, detail = '') => `<button class="opt" type="button" role="menuitemradio" aria-checked="${choice === value}" data-choice="${value}"><span class="radio"></span><span class="grow">${label}${detail ? `<small>${detail}</small>` : ''}</span></button>`;
    setHtml($('server-menu'), option('auto', t('automatic')) + option('default', t('biliDefault')) + `<div class="group">${t('fixedGroup')}</div>` +
      hosts().map(host => option(host, format.serverName(host, lang), format.hostLabel(host))).join(''));
  }
  function render() {
    // Concealed (full screen, small viewport): nothing to draw until the control shows again.
    if (!mounted || suspended || document.hidden || (host.hidden && host.dataset.hiddenReason)) { syncMotion(); return; }
    if (routeKey() !== route) { syncLifecycle(); return; }
    view = runtime.getViewState();
    view.config ||= runtime.getConfig();
    const config = view.config;
    t = translator(config.lang);
    if (generation !== null && view.mediaGeneration != null && generation !== view.mediaGeneration) { generation = view.mediaGeneration; setPhase('edge', { animate: false }); clearTestFeedback(); }
    else if (view.mediaGeneration != null) generation = view.mediaGeneration;
    host.dataset.theme = config.theme === 'dark' || (config.theme !== 'light' && darkQuery.matches) ? 'dark' : 'light';
    host.dataset.accent = settings.accents?.includes(config.accent) ? config.accent : 'blue';
    host.lang = config.lang === 'en' ? 'en' : 'zh-CN';
    const state = projectPlayback(view, true), keys = statusKeys(view, state), blocked = state === 'blocked';
    host.dataset.state = state;
    for (const node of shadow.querySelectorAll('[data-t]')) setText(node, t(node.dataset.t));

    // Entry
    const entry = entryMarkup(settings.floatingEntryTypes?.includes(config.floatingEntryType) ? config.floatingEntryType : 'icon', state, keys.tone);
    $('entry').classList.toggle('round', !!entry.round);
    $('entry').dataset.tone = keys.tone;
    setHtml($('entry'), entry.html);
    $('entry').setAttribute('aria-label', 'BiliSmooth · ' + t(keys.title) + ' · ' + t('entryLabel'));
    $('entry').title = t('moveHint');
    // A changed entry width moves the control; lay out again.
    const nextSignature = JSON.stringify([config.floatingEntryType, config.lang, $('entry').textContent.length]);
    if (signature && nextSignature !== signature && phase === 'edge') queueLayout();
    signature = nextSignature;

    // Preview
    renderState($('preview-state'), keys, state);
    const speed = format.speed(view), seconds = format.buffer(view), present = view.media?.present && !blocked;
    setText($('preview-speed'), present && speed ? speed.value + ' ' + speed.unit : format.DASH);
    setText($('preview-buffer'), present && seconds !== null ? format.seconds(seconds) + ' ' + t('seconds') : format.DASH);
    setText($('preview-server'), format.serverName(view.actualHost || view.requestedHost, config.lang) || format.DASH);
    $('preview-rows').hidden = blocked;
    $('preview-copy').hidden = !blocked;
    $('preview').setAttribute('aria-label', 'BiliSmooth · ' + t(keys.title));

    // Panel
    renderState($('panel-state'), keys, state);
    setText($('speed'), present && speed ? speed.value : format.DASH);
    setText($('speed-unit'), speed?.unit || 'MB/s');
    setText($('buffer'), present && seconds !== null ? format.seconds(seconds) : format.DASH);
    const choice = serverChoice(config);
    setText($('server-value'), serverLabel(choice));
    $('server').disabled = busy || blocked;
    if (menu === 'server') renderMenu(choice);
    const serving = view.actualHost;
    setText($('serving-name'), format.serverName(serving, config.lang) || format.DASH);
    setText($('serving-host'), serving || '');
    $('serving-host').hidden = !serving;
    const saving = view.settingsSave?.status === 'pending', failed = view.settingsSave?.status === 'error';
    $('reload-notice').hidden = !view.needReload || saving || failed;
    $('save-notice').hidden = !failed;
    const blocker = testBlocker(view, t);
    $('test').disabled = busy || !!blocker;
    $('test').title = blocker || '';
    $('test').classList.toggle('primary', !blocker && ['frozen', 'buffering'].includes(state));
    for (const node of shadow.querySelectorAll('.body [data-action]')) if (node !== $('test')) node.disabled = busy;
    $('more').setAttribute('aria-label', t('more')); $('more').title = t('more');
    $('collapse').setAttribute('aria-label', t('collapse')); $('collapse').title = t('collapse');
    $('panel').setAttribute('aria-label', t('panelLabel'));
    $('grip').title = t('moveHint');
    for (const node of shadow.querySelectorAll('[data-corner]')) node.setAttribute('aria-current', String(!anchor && node.dataset.corner === preference));

    // Feedback: an action's result, the speed test the user started, or a settings read failure. A test result is
    // taken only after that test was seen running, then kept as it is, so a later automatic test never shows as it.
    if (feedback.kind === 'test') {
      const result = testResult(view, t, value => format.serverName(value, config.lang));
      if (result?.key === 'testing') testSeen = true;
      else if (result && testSeen) setFeedback(result.text, 'ok', 'test-done');
    }
    const readFailed = view.reloadReasons?.includes('storage-read-failed');
    if (!feedback.text && readFailed) setFeedback(t('readFailedPanel'), 'error', 'read');
    else if (feedback.kind === 'read' && !readFailed) setFeedback('', '', '');
    syncMotion();
  }
  function clearTestFeedback() { if (feedback.kind === 'test' || feedback.kind === 'test-done') setFeedback('', '', ''); }
  function setFeedback(text, tone = '', kind = 'action') {
    feedback = { text, tone, kind };
    const node = $('feedback');
    setText(node, text);
    node.dataset.tone = tone;
  }
  function queueRender() {
    if (suspended || renderFrame !== null) return;
    renderFrame = scope.requestAnimationFrame(() => { renderFrame = null; render(); });
  }

  // ——— Motion and visibility ———
  function syncMotion() {
    if (!host) return;
    const on = motionPreference && !reduceQuery.matches && !document.hidden && !suspended && !host.hidden;
    host.dataset.motion = on ? 'on' : 'off';
    if (!on) { stopMorph(); stopPositionAnimation(false); }
  }
  function stopMorph() {
    morphSerial++;
    morph?.forEach(control => control.cancel?.());
    morph = null;
    for (const node of [$('entry'), $('preview'), $('panel')]) if (node) { node.style.transform = ''; node.style.opacity = ''; }
  }
  function stopPositionAnimation(commit = true) {
    if (!positionAnimation) return;
    const rect = host.getBoundingClientRect();
    positionAnimation.cancel?.();
    positionAnimation = null;
    host.style.transform = '';
    if (commit) { const next = within(rect, rect.width, rect.height, viewport(scope)); showAt(next); captureAnchor(next); snapped = { x: null, y: null }; }
  }
  function conceal(reason) {
    if (!host) return;
    clearHover();
    closeMenu();
    stopMorph();
    stopPositionAnimation(false);
    hideSnapHint();
    if (drag) finishDrag(null, true);
    host.hidden = true;
    host.inert = true;
    host.dataset.visible = 'false';
    host.dataset.hiddenReason = reason;
    syncMotion();
  }
  function showAt(at) {
    const bounds = viewport(scope);
    if (lastPlacement && (lastPlacement.x !== at.x || lastPlacement.y !== at.y) && menu === 'server') closeMenu();
    host.dataset.edge = at.x + at.width / 2 >= bounds.left + bounds.width / 2 ? 'right' : 'left';
    host.style.left = (at.x - bounds.originX) / bounds.scaleX + 'px';
    host.style.top = (at.y - bounds.originY) / bounds.scaleY + 'px';
    host.hidden = false;
    host.inert = false;
    host.dataset.visible = 'true';
    host.dataset.hiddenReason = '';
    lastPlacement = at;
    syncMotion();
  }

  // ——— Snapping ———
  function hideSnapHint() {
    if (snapHint) snapHint.style.display = 'none';
    if (host) host.dataset.snapReady = 'false';
  }
  function showSnapHint(rect) {
    const bounds = viewport(scope), next = snapCandidate(rect, bounds);
    if (!next) { hideSnapHint(); return; }
    Object.assign(snapHint.style, { left: (next.x - bounds.originX) / bounds.scaleX + 'px', top: (next.y - bounds.originY) / bounds.scaleY + 'px',
      width: next.width / bounds.scaleX + 'px', height: next.height / bounds.scaleY + 'px', borderRadius: phase === 'edge' ? '20px' : '8px',
      color: scope.getComputedStyle(host).getPropertyValue('--accent-strong').trim(), display: 'block' });
    host.dataset.snapReady = 'true';
  }
  function settlePosition() {
    const rect = host.getBoundingClientRect(), bounds = viewport(scope), next = snapCandidate(rect, bounds);
    captureAnchor(rect, true, bounds);
    snapped = { x: next?.xSide || null, y: next?.ySide || null };
    hideSnapHint();
    if (next) {
      if (next.xSide) anchor.xSide = next.xSide;
      if (next.ySide) anchor.ySide = next.ySide;
      captureAnchor(next);
      showAt(next);
      const dx = (rect.x - next.x) / bounds.scaleX, dy = (rect.y - next.y) / bounds.scaleY;
      if (motionOn() && Math.abs(dx) + Math.abs(dy) > 0.5) {
        const active = engine.animate(host, { transform: [`translate(${dx}px,${dy}px)`, 'translate(0px,0px)'] }, { type: engine.spring, stiffness: 540, damping: 47, mass: 0.72 });
        positionAnimation = active;
        active.then(() => { if (positionAnimation === active) { positionAnimation = null; host.style.transform = ''; } });
      }
    }
    persistPlacement();
  }

  // ——— Layout ———
  function visible() { return phase === 'edge' ? $('entry') : phase === 'preview' ? $('preview') : $('panel'); }
  function place(scan = true) {
    if (!mounted || suspended || !host) return;
    if (!routeKey()) { syncLifecycle(); return; }
    const full = fullscreen(scope);
    if ((full || document.hidden) && drag) finishDrag(null, true);
    if (full || wasFullscreen) { if (phase !== 'edge') setPhase('edge', { animate: false, relayout: false }); wasFullscreen = full; }
    if (full) { conceal('fullscreen'); return; }
    if (document.hidden) { conceal('document-hidden'); return; }
    if (drag) { deferredLayout = true; return; }
    deferredLayout = false;
    stopPositionAnimation(true);
    const bounds = viewport(scope), maxHeight = Math.max(0, bounds.height - 2 * INSET), maxWidth = Math.max(0, bounds.width - 2 * INSET);
    if (maxWidth < 44 || maxHeight < 44) { conceal('viewport-too-small'); return; }
    // Page regions matter only while a corner is being chosen or the placement settles.
    if (scan && (!anchor || settling())) protection.scan();
    const wasConcealed = host.hidden && !!host.dataset.hiddenReason;
    host.style.setProperty('--max-height', maxHeight / bounds.scaleY + 'px');
    host.hidden = false;
    if (WIDTH[phase]) visible().style.width = Math.min(WIDTH[phase], maxWidth / bounds.scaleX) + 'px';
    const measured = host.getBoundingClientRect(), width = measured.width, height = Math.min(measured.height, maxHeight);
    let at = null, chosen = !anchor;
    if (anchor) {
      if (snapped.x) anchor.x = snapped.x === 'left' ? bounds.left + INSET : bounds.right - INSET;
      if (snapped.y) anchor.y = snapped.y === 'top' ? bounds.top + INSET : bounds.bottom - INSET;
      at = within({ x: anchor.x - (anchor.xSide === 'right' ? width : 0), y: anchor.y - (anchor.ySide === 'bottom' ? height : 0) }, width, height, bounds);
      // The page keeps rendering after the first placement (the header arrives late): while the control settles,
      // collapsed and untouched, a region that grows under it sends it to another corner.
      if (settling() && phase === 'edge' && !pointerInside && !protection.safe(at, width, height, bounds)) chosen = true;
      else if (!settling()) settle = null;
    }
    if (chosen) {
      if (!anchor) settle = { until: scope.performance.now() + SETTLE_MS, x: scope.scrollX, y: scope.scrollY };
      at = chooseCorner(width, height, bounds);
    }
    showAt(at);
    captureAnchor(at, chosen, bounds);
    if (wasConcealed) queueRender();
    host.dataset.layoutRevision = String((Number(host.dataset.layoutRevision) || 0) + 1);
  }
  // The preferred corner, then the others; when none is clear, the one that covers the least.
  function chooseCorner(width, height, bounds) {
    const candidates = [...new Set([preference, 'topRight', 'bottomLeft', 'topLeft', 'bottomRight'])].map(name => corner(name, width, height, bounds));
    return candidates.find(candidate => protection.safe(candidate, width, height, bounds))
      || candidates.reduce((best, candidate) => protection.covered(candidate, width, height) < protection.covered(best, width, height) ? candidate : best);
  }
  // Settling ends after SETTLE_MS, on the first scroll, or as soon as the user touches the control.
  function settling() { return !!settle && scope.performance.now() < settle.until && scope.scrollX === settle.x && scope.scrollY === settle.y; }
  function queueLayout() {
    if (layoutFrame !== null || suspended) return;
    layoutFrame = scope.requestAnimationFrame(() => { layoutFrame = null; syncLifecycle(); if (mounted) place(true); });
  }
  function onObserved(entries) {
    let changed = false;
    for (const entry of entries || []) {
      if (entry.target !== host) { changed = true; continue; }
      const next = Math.round(entry.contentRect.width) + ':' + Math.round(entry.contentRect.height);
      if (next !== hostSize) { hostSize = next; changed = true; }
    }
    if (changed) queueLayout();
  }

  // ——— Phases ———
  function clearHover() { if (hoverTimer !== null) scope.clearTimeout(hoverTimer); hoverTimer = null; }
  function setPhase(next, { animate = true, focus = false, relayout = true } = {}) {
    if (next !== 'edge') settle = null;
    if (!mounted || drag || (next !== 'edge' && fullscreen(scope))) return;
    clearHover();
    hideSnapHint();
    const focusTarget = () => next === 'edge' ? $('entry') : next === 'preview' ? $('preview') : $('grip').querySelector('#collapse');
    if (phase === next) {
      if (focus && !host.hidden) { suppressFocus = true; focusTarget().focus({ preventScroll: true }); suppressFocus = false; }
      return;
    }
    const old = visible().getBoundingClientRect(), oldPhase = phase, hadFocus = !!shadow.activeElement?.matches(':focus-visible');
    stopPositionAnimation(true);
    if (!anchor && !host.hidden) captureAnchor(host.getBoundingClientRect(), true);
    stopMorph();
    closeMenu();
    phase = next;
    host.dataset.phase = phase;
    $('entry').hidden = phase !== 'edge';
    $('preview').hidden = phase !== 'preview';
    $('panel').hidden = phase !== 'panel';
    $('panel').inert = phase !== 'panel';
    $('entry').setAttribute('aria-expanded', String(phase !== 'edge'));
    $('preview').setAttribute('aria-expanded', String(phase === 'panel'));
    render();
    if (relayout) place(false);
    if (animate && !host.hidden && motionOn() && old.width > 0) {
      const element = visible(), rect = element.getBoundingClientRect(), bounds = viewport(scope), serial = ++morphSerial;
      const shrinking = ORDER[next] < ORDER[oldPhase];
      element.style.transformOrigin = '0 0';
      const from = `translate(${(old.left - rect.left) / bounds.scaleX}px,${(old.top - rect.top) / bounds.scaleY}px) scale(${old.width / rect.width},${old.height / rect.height})`;
      const geometry = engine.animate(element, { transform: [from, 'none'], opacity: [0.55, 1] }, { type: engine.spring, bounce: 0, duration: shrinking ? 0.24 : 0.4 });
      morph = [geometry];
      geometry.then(() => { if (serial === morphSerial) { morph = null; element.style.transform = ''; element.style.opacity = ''; } });
    }
    if ((focus || hadFocus) && !host.hidden) { suppressFocus = true; focusTarget().focus({ preventScroll: true }); suppressFocus = false; }
  }
  function collapse() {
    previewDismissed = pointerInside || !!shadow?.activeElement;
    setPhase('edge');
  }
  function scheduleRetraction() {
    clearHover();
    if (phase !== 'preview' || pointerInside || shadow.activeElement || drag) return;
    hoverTimer = scope.setTimeout(() => { hoverTimer = null; if (phase === 'preview' && !pointerInside && !shadow.activeElement) setPhase('edge'); }, 180);
  }

  // ——— Menus ———
  function openMenu(name, focus = false) {
    closeMenu();
    menu = name;
    const node = name === 'server' ? $('server-menu') : $('more-menu'), trigger = name === 'server' ? $('server') : $('more');
    if (name === 'server') renderMenu(serverChoice(view.config));
    node.hidden = false;
    if (name === 'server') placeServerMenu(node);
    trigger.setAttribute('aria-expanded', 'true');
    if (motionOn()) engine.animate(node, { opacity: [0, 1], transform: ['translateY(-4px)', 'none'] }, { duration: 0.14 });
    if (focus) (node.querySelector('[aria-checked=true],[aria-current=true]') || node.querySelector('.opt'))?.focus({ preventScroll: true });
  }
  // The list opens below the select, or above it when the viewport has more room there.
  function placeServerMenu(node) {
    const bounds = viewport(scope), panel = $('panel').getBoundingClientRect(), select = $('server').getBoundingClientRect();
    const below = bounds.bottom - select.bottom - INSET, above = select.top - bounds.top - INSET, down = below >= 240 || below >= above;
    node.style.left = (select.left - panel.left) / bounds.scaleX + 'px';
    node.style.width = select.width / bounds.scaleX + 'px';
    node.style.maxHeight = Math.max(120, Math.min(320, (down ? below : above) - 4)) / bounds.scaleY + 'px';
    node.style.top = down ? (select.bottom - panel.top + 4) / bounds.scaleY + 'px' : 'auto';
    node.style.bottom = down ? 'auto' : (panel.bottom - select.top + 4) / bounds.scaleY + 'px';
  }
  function closeMenu(focusTrigger = false) {
    if (!menu || !shadow) return;
    const trigger = menu === 'server' ? $('server') : $('more');
    $('server-menu').hidden = true; $('more-menu').hidden = true;
    $('server').setAttribute('aria-expanded', 'false'); $('more').setAttribute('aria-expanded', 'false');
    menu = null;
    if (focusTrigger) trigger.focus({ preventScroll: true });
  }
  function moveToCorner(name) {
    stopPositionAnimation(false);
    preference = name === 'reset' ? 'bottomRight' : name;
    anchor = null;
    snapped = { x: null, y: null };
    lastPlacement = null;
    closeMenu();
    place(true);
    settle = null;
    persistPlacement();
    if (!host.hidden) $('more').focus({ preventScroll: true });
  }

  // ——— Actions ———
  function openDashboard() {
    const id = 'floating-' + Date.now() + '-' + ++openingSerial;
    return new Promise((resolve, reject) => {
      const timer = scope.setTimeout(() => { opening.delete(id); reject(new Error('open-control-timeout')); }, 6500);
      opening.set(id, { resolve, reject, timer });
      scope.postMessage({ __bilismoothFloating: 'open-control', id }, scope.location.origin);
    });
  }
  async function act(name, value) {
    if (busy) return false;
    busy = true;
    if (name !== 'test') setFeedback('', '', '');
    render();
    try {
      if (name === 'choose') {
        if (value === 'auto' || value === 'default') runtime.setConfig(choicePatch(value, runtime.getConfig()));
        else if (!runtime.applyRoute(value)) throw new Error('invalid-route');
        await runtime.flushSettings();
      } else if (name === 'test') {
        testSeen = false;
        if (runtime.retry()) setFeedback(t('testing'), '', 'test');
        else setFeedback(t('testUnavailable'), '', 'action');
      } else if (name === 'clear') {
        runtime.resetNetwork();
        setFeedback(t('cleared'), 'ok');
      } else if (name === 'save-retry') {
        runtime.setConfig({});
        await runtime.flushSettings();
      } else if (name === 'dashboard') {
        await openDashboard();
      } else if (name === 'reload') {
        runtime.reload();
        await runtime.flushSettings();
        scope.location.reload();
      }
      return true;
    } catch (error) {
      if (name === 'dashboard') setFeedback(t(error?.message === 'background-unreachable' ? 'backgroundUnavailable' : 'openFailed'), 'error');
      else if (name === 'reload') setFeedback(t('reloadFailed'), 'error');
      else if (runtime.getViewState().settingsSave?.status !== 'error') setFeedback(t('actionFailed'), 'error');
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  // ——— Dragging ———
  function moveTo(point) {
    if (!host || host.hidden) return false;
    const rect = host.getBoundingClientRect(), next = within(point, rect.width, rect.height, viewport(scope));
    snapped = { x: null, y: null };
    showAt(next);
    captureAnchor(next);
    return true;
  }
  function finishDrag(event, cancel = false) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const ended = drag;
    drag = null;
    host.dataset.dragging = 'false';
    if (ended.mover.hasPointerCapture?.(ended.id)) ended.mover.releasePointerCapture(ended.id);
    if (!cancel && deferredLayout) place(false);
    if (ended.moved) {
      suppressClickUntil = scope.performance.now() + 450;
      touchEntry = false;
      previewDismissed = true;
      if (cancel) { captureAnchor(host.getBoundingClientRect(), true); hideSnapHint(); persistPlacement(); }
      else settlePosition();
    } else hideSnapHint();
  }
  function startDrag(event, mover) {
    if (event.button !== 0 || !event.isPrimary || drag) return;
    if (event.composedPath().some(node => node instanceof scope.Element && node !== mover && node.matches?.('button') && mover.contains(node))) return;
    touchEntry = event.pointerType === 'touch' && phase === 'edge';
    clearHover();
    stopPositionAnimation(true);
    stopMorph();
    closeMenu();
    const rect = host.getBoundingClientRect();
    drag = { id: event.pointerId, pointerType: event.pointerType, mover, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    settle = null;
    host.dataset.dragging = 'pending';
    if (event.pointerType === 'mouse') event.preventDefault();
    event.stopPropagation();
  }
  function keyboardMove(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    clearHover();
    stopPositionAnimation(true);
    if (event.key === 'Home') { anchor = null; snapped = { x: null, y: null }; preference = 'bottomRight'; lastPlacement = null; place(true); settle = null; }
    else {
      const rect = host.getBoundingClientRect(), step = event.shiftKey ? 32 : 8;
      moveTo({ x: rect.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: rect.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) });
      captureAnchor(host.getBoundingClientRect(), true);
      settle = null;
    }
    persistPlacement();
  }

  // ——— Events ———
  function wire() {
    listen(shadow, 'pointerdown', event => {
      suppressClickUntil = 0;
      if (menu && !event.composedPath().some(node => node === $('server-menu') || node === $('more-menu') || node === $('server') || node === $('more'))) closeMenu();
    }, true);
    listen(shadow, 'click', event => {
      if (event.detail !== 0 && scope.performance.now() < suppressClickUntil) { suppressClickUntil = 0; event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    listen(shadow, 'click', event => event.stopPropagation());
    listen($('entry'), 'click', event => {
      previewDismissed = false;
      setPhase(touchEntry || event.pointerType === 'touch' ? 'preview' : 'panel', { focus: event.detail === 0 });
      touchEntry = false;
    });
    listen($('preview'), 'click', event => setPhase('panel', { focus: event.detail === 0 }));
    listen($('preview'), 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPhase('panel', { focus: true }); } });
    listen($('collapse'), 'click', event => setPhase('preview', { focus: event.detail === 0 }));
    listen($('more'), 'click', event => menu === 'more' ? closeMenu() : openMenu('more', event.detail === 0));
    listen($('server'), 'click', event => menu === 'server' ? closeMenu() : openMenu('server', event.detail === 0));
    listen($('server-menu'), 'click', event => {
      const option = event.target.closest('[data-choice]');
      if (!option) return;
      closeMenu(true);
      void act('choose', option.dataset.choice);
    });
    listen($('more-menu'), 'click', event => {
      const target = event.target.closest('[data-corner],[data-action]');
      if (!target) return;
      if (target.dataset.corner) moveToCorner(target.dataset.corner);
      else { closeMenu(true); void act(target.dataset.action); }
    });
    for (const list of [$('server-menu'), $('more-menu')]) listen(list, 'keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const options = [...list.querySelectorAll('.opt')], index = options.indexOf(shadow.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next]?.focus({ preventScroll: true });
    });
    for (const node of shadow.querySelectorAll('.body [data-action]')) listen(node, 'click', () => void act(node.dataset.action));
    listen(host, 'pointerenter', event => {
      if (event.pointerType !== 'mouse') return;
      pointerInside = true;
      settle = null;
      previewDismissed = false;
      clearHover();
      if (phase === 'edge' && !drag) hoverTimer = scope.setTimeout(() => { if (!drag && phase === 'edge' && !previewDismissed) setPhase('preview'); }, 140);
    });
    listen(host, 'pointerleave', event => {
      if (event.pointerType === 'touch') return;
      pointerInside = false;
      clearHover();
      if (!drag) { previewDismissed = false; scheduleRetraction(); }
    });
    listen(shadow, 'focusin', event => {
      clearHover();
      if (event.target === $('entry') && !touchEntry && !previewDismissed && !suppressFocus && !drag) setPhase('preview', { focus: true });
    });
    listen(shadow, 'focusout', () => scope.queueMicrotask(() => { if (!shadow.activeElement && !drag) { previewDismissed = false; scheduleRetraction(); } }));
    listen(shadow, 'keydown', event => {
      event.stopPropagation();
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (drag) { finishDrag(null, true); return; }
      if (menu) closeMenu(true);
      else if (phase === 'panel') setPhase('preview', { focus: true });
      else { previewDismissed = true; setPhase('edge', { focus: true }); }
    });
    for (const mover of [$('entry'), $('preview'), $('grip')]) {
      listen(mover, 'pointerdown', event => startDrag(event, mover));
      listen(mover, 'lostpointercapture', event => { if (drag?.id === event.pointerId) finishDrag(event, true); });
    }
    for (const mover of [$('entry'), $('preview')]) listen(mover, 'keydown', keyboardMove);
    listen(document, 'pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      if (!drag.moved) { drag.moved = true; drag.mover.setPointerCapture?.(event.pointerId); host.dataset.dragging = 'true'; }
      event.preventDefault();
      moveTo({ x: drag.left + dx, y: drag.top + dy });
      showSnapHint(host.getBoundingClientRect());
    }, { passive: false });
    listen(document, 'pointerup', event => finishDrag(event));
    listen(document, 'pointercancel', event => finishDrag(event, true));
  }

  // ——— Lifecycle ———
  function syncLifecycle() {
    if (suspended) return;
    const next = routeKey();
    if (!next) {
      if (mounted) {
        setPhase('edge', { animate: false, relayout: false });
        conceal('unsupported-page');
        mounted = false;
        unsubscribe?.(); unsubscribe = null;
        host.remove();
        protection.disconnect();
      }
      route = ''; generation = null; lastPlacement = null;
      return;
    }
    const changed = route !== next;
    route = next;
    if (!host) create();
    if (!mounted) {
      mounted = true;
      phase = 'edge';
      host.dataset.phase = 'edge';
      document.documentElement.appendChild(host);
      protection.observeHost(viewportMarker(scope));
      unsubscribe = runtime.subscribe(queueRender);
    }
    if (changed) {
      generation = null; lastPlacement = null;
      clearTestFeedback();
      setPhase('edge', { animate: false, relayout: false });
      render();
      queueLayout();
    }
  }

  const api = {
    resetPosition() {
      if (drag) finishDrag(null, true);
      stopPositionAnimation(false);
      hideSnapHint();
      anchor = null; snapped = { x: null, y: null }; preference = 'bottomRight'; lastPlacement = null;
      persistPlacement();
      if (mounted) place(true);
      settle = null;
      return true;
    },
    open() { syncLifecycle(); if (mounted) { place(true); if (!host.hidden) setPhase('panel', { focus: true }); } },
    collapse() { setPhase(phase === 'panel' ? 'preview' : 'edge', { focus: true }); },
    refresh() { syncLifecycle(); queueRender(); queueLayout(); },
    destroy() {
      suspended = true; mounted = false;
      unsubscribe?.();
      clearHover(); stopMorph();
      if (renderFrame !== null) scope.cancelAnimationFrame(renderFrame);
      if (layoutFrame !== null) scope.cancelAnimationFrame(layoutFrame);
      domObserver?.disconnect(); protection?.disconnect();
      for (const remove of cleanups.splice(0)) remove();
      for (const pending of opening.values()) { scope.clearTimeout(pending.timer); pending.reject(new Error('surface-closed')); }
      opening.clear();
      stopPositionAnimation(false);
      snapHint?.remove();
      host?.remove();
      if (scope.BiliSmoothFloating === api) delete scope.BiliSmoothFloating;
    }
  };
  scope.BiliSmoothFloating = api;

  listen(document, 'keydown', event => {
    if (event.key !== 'Escape' || !mounted || host.hidden || phase === 'edge' || shadow.activeElement) return;
    event.preventDefault(); event.stopPropagation();
    if (menu) closeMenu();
    else if (phase === 'panel') setPhase('preview');
    else { previewDismissed = true; setPhase('edge'); }
  }, true);
  listen(document, 'fullscreenchange', () => { syncLifecycle(); if (mounted) place(true); });
  listen(document, 'pointerdown', event => {
    if (mounted && !drag && phase !== 'edge' && !event.composedPath().includes(host)) { pointerInside = false; previewDismissed = true; setPhase('edge'); }
  }, true);
  // The setting can change while the page is open (from the dashboard or another tab): unmount or mount at once.
  cleanups.push(runtime.subscribe(() => {
    const next = runtime.getConfig().showFloating !== false;
    if (next === allowed) return;
    allowed = next;
    syncLifecycle(); queueLayout();
  }));
  listen(scope, 'resize', queueLayout);
  if (scope.visualViewport) { listen(scope.visualViewport, 'resize', queueLayout); listen(scope.visualViewport, 'scroll', queueLayout); }
  // Scrolling moves page regions under a fixed control; that matters only before the first placement.
  listen(scope, 'scroll', () => { if (!anchor) queueLayout(); }, { passive: true, capture: true });
  listen(darkQuery, 'change', queueRender);
  listen(reduceQuery, 'change', syncMotion);
  listen(document, 'visibilitychange', () => { if (document.hidden) conceal('document-hidden'); else { syncLifecycle(); queueRender(); queueLayout(); } });
  listen(scope, 'popstate', () => { syncLifecycle(); queueLayout(); });
  listen(scope, 'hashchange', () => { syncLifecycle(); queueLayout(); });
  for (const method of ['pushState', 'replaceState']) {
    const original = scope.history[method];
    const wrapped = function (...args) { const result = original.apply(this, args); syncLifecycle(); queueLayout(); return result; };
    scope.history[method] = wrapped;
    cleanups.push(() => { if (scope.history[method] === wrapped) scope.history[method] = original; });
  }
  listen(scope, 'message', event => {
    if (event.source !== scope || event.origin !== scope.location.origin) return;
    const message = event.data;
    if (message?.__bilismoothFloating === 'motion') { motionPreference = message.value !== false; syncMotion(); }
    if (message?.__bilismoothFloating === 'opened') {
      const pending = opening.get(message.id);
      if (!pending) return;
      scope.clearTimeout(pending.timer);
      opening.delete(message.id);
      message.ok ? pending.resolve() : pending.reject(new Error(message.error === 'background-unreachable' ? message.error : 'open-control-failed'));
    }
  });
  listen(scope, 'pagehide', () => {
    suspended = true;
    conceal('page-hidden');
    unsubscribe?.(); unsubscribe = null;
    if (renderFrame !== null) scope.cancelAnimationFrame(renderFrame);
    renderFrame = null;
    if (layoutFrame !== null) scope.cancelAnimationFrame(layoutFrame);
    layoutFrame = null;
  });
  listen(scope, 'pageshow', event => {
    if (!event.persisted) return;
    suspended = false;
    if (mounted) { unsubscribe = runtime.subscribe(queueRender); setPhase('edge', { animate: false, relayout: false }); }
    syncLifecycle(); queueRender(); queueLayout();
  });

  // Relayout when page regions or controls that placement avoids appear, move or change.
  function start() {
    if (domObserver) return;
    const watched = protectedSelector + ',' + interactiveSelector;
    domObserver = new scope.MutationObserver(records => {
      if (routeKey() !== route) { syncLifecycle(); queueLayout(); return; }
      if (!mounted) return;
      for (const record of records) {
        if (record.target === host || host.contains(record.target)) continue;
        if (record.type === 'attributes') {
          if (protection.observes(record.target) || record.target.matches?.(watched)) { queueLayout(); return; }
          continue;
        }
        // New regions and controls matter only while a corner is chosen or the placement settles.
        if ((!anchor || settling()) && [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1 && node !== host && node !== snapHint && (node.matches(watched) || node.querySelector(watched)))) { queueLayout(); return; }
      }
    });
    domObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
    syncLifecycle();
    queueLayout();
    scope.postMessage({ __bilismoothFloating: 'ready' }, scope.location.origin);
  }
  if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', start, { once: true });
  else start();
}

boot(globalThis);
