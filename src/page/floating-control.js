/* Playback controls consume the session; they never schedule network work.
   SVG paths: Tabler Icons outline, MIT (c) 2020-2026 Pawel Kuna.
   tabler/tabler-icons@55f87a73f45cf1d9eaf16d7da705065483a9e4f9.
   License: src/ui/control/tabler-LICENSE.txt. */
(function (scope) {
  'use strict';
  const document = scope.document, runtime = scope.BiliSmoothRuntime, settings = scope.BiliSmoothSettings;
  const shared = scope.BiliSmoothSurfaceStyles, engine = scope.BiliSmoothMotion;
  if (!document || !runtime || !settings || !shared?.tokens || scope.BiliSmoothFloating) return;
  const positionKey = 'bilismooth.panel.position.v3';
  const presentation = scope.BiliSmoothEntryDisplay;
  const darkQuery = scope.matchMedia('(prefers-color-scheme: dark)');
  const reduceQuery = scope.matchMedia('(prefers-reduced-motion: reduce)');
  const words = {

    zh: { position: '浮窗位置', topLeft: '左上', topRight: '右上', bottomLeft: '左下', bottomRight: '右下', defaultPosition: '复位', open: '展开播放浮窗', close: '收起播放浮窗', move: 'BiliSmooth：点击展开或收起；拖动或使用方向键移动，Home 复位', helper: '播放助手', enable: '启用优化', buffer: '还能播放', speed: '视频下载', seconds: '秒', actual: '实际供片', target: '后续目标', route: '播放线路', auto: '自动选择', original: '使用原站', fixed: '固定', retry: '尝试备用线路', reset: '重新评估', dashboard: '打开仪表盘', reload: '刷新视频页', needReload: '设置已保存，刷新后完整生效。', saved: '设置已保存', saving: '正在保存…', saveFailed: '设置未能保存，请重试。', retrySave: '重试保存', openFailed: '未能打开仪表盘，请重试。', error: '操作未完成，请重试。', selected: '已选择后续请求的目标；实际供片仍以观察为准。', reassessing: '正在重新评估网络。', noAlternative: '暂无其他可用线路。', idle: '等待播放', playing: '播放中', smooth: '播放顺畅', buffering: '缓冲中', frozen: '画面停滞', paused: '已暂停', ended: '播放结束', seeking: '跳转中', disabled: '优化已关闭', unknown: '尚未观察到', fixedHint: '固定线路时不自动轮换。', inactive: '启用自动选线后可用', readFailed: '设置尚未同步，可打开仪表盘重新连接。', local: '仅本地运行 · 保持所选画质', reloadFailed: '保存未确认，未刷新视频页。' },

    en: { position: 'Panel position', topLeft: 'Top left', topRight: 'Top right', bottomLeft: 'Bottom left', bottomRight: 'Bottom right', defaultPosition: 'Reset position', open: 'Open playback controls', close: 'Collapse playback controls', move: 'BiliSmooth: click to open or collapse; drag or use arrow keys to move, Home to reset', helper: 'Playback helper', enable: 'Enable optimization', buffer: 'Playable buffer', speed: 'Video download', seconds: 's', actual: 'Observed delivery', target: 'Future target', route: 'Playback route', auto: 'Automatic', original: 'Original routing', fixed: 'Fixed', retry: 'Try another route', reset: 'Reassess network', dashboard: 'Open dashboard', reload: 'Reload video', needReload: 'Settings saved. Reload to apply them fully.', saved: 'Settings saved', saving: 'Saving…', saveFailed: 'Settings could not be saved. Please retry.', retrySave: 'Retry saving', openFailed: 'Could not open the dashboard. Please retry.', error: 'Action failed. Please retry.', selected: 'Selected a future target; delivery is shown only when observed.', reassessing: 'Reassessing the network.', noAlternative: 'No alternative route is available.', idle: 'Awaiting playback', playing: 'Playing', smooth: 'Playing smoothly', buffering: 'Buffering', frozen: 'Picture frozen', paused: 'Paused', ended: 'Ended', seeking: 'Seeking', disabled: 'Optimization disabled', unknown: 'Not observed yet', fixedHint: 'Fixed routing does not rotate automatically.', inactive: 'Available with automatic routing enabled', readFailed: 'Settings have not synchronized. Reconnect from the dashboard.', local: 'Local processing · Selected quality retained', reloadFailed: 'Save was not confirmed; the video was not reloaded.' }

  };

  Object.assign(words.zh, { buffer: '可播余量', speed: '下载速度', waiting: '等待播放', disconnected: '尚未连接', errorState: '播放错误', routeSearch: '搜索播放线路', optimize: '优化', entry: '播放助手：悬停查看指标，点击打开面板', preview: '查看播放指标', limited: '此处没有足够空间展开，请调整位置', move: '点击打开面板；拖动或方向键移动，Home 复位' });
  Object.assign(words.en, { buffer: 'Playable buffer', speed: 'Download speed', waiting: 'Awaiting playback', disconnected: 'Not connected', errorState: 'Playback error', routeSearch: 'Search playback routes', optimize: 'Optimize', entry: 'Playback helper: hover for metrics, click for controls', preview: 'Show playback metrics', limited: 'Not enough room here. Move the tab to expand.', move: 'Click for controls; drag or use arrow keys to move, Home to reset' });
  Object.assign(words.zh,{actual:'当前请求',target:'后续请求目标',retry:'切换备用',entry:'BiliSmooth：拖动调整位置，悬停查看预览',detailSmooth:'画帧连续 · 缓冲充足',detailBuffering:'等待数据 · 正在补充',detailFrozen:'画帧中断 · 等待恢复',detailPaused:'播放暂停 · 监测保留',detailWaiting:'等待有效播放数据',detailPlaying:'正在播放 · 等待画帧确认',detailSeeking:'正在跳转 · 等待新画帧',detailEnded:'视频已播放完毕',detailError:'播放器报告错误'});
  Object.assign(words.en,{actual:'Current request',target:'Future request target',retry:'Try backup',entry:'BiliSmooth: drag to move, hover to preview',detailSmooth:'Frames advancing · Buffer ready',detailBuffering:'Waiting for data · Filling buffer',detailFrozen:'Frames interrupted · Awaiting recovery',detailPaused:'Paused · Monitoring retained',detailWaiting:'Waiting for playback evidence',detailPlaying:'Playing · Awaiting frame evidence',detailSeeking:'Seeking · Waiting for new frames',detailEnded:'Playback has ended',detailError:'Player reported an error'});
  const glyphs = {
    download: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/>',
    clock: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 7v5l3 3"/>',
    play: '<path d="M7 4v16l13 -8l-13 -8"/>',
    pause: '<path d="M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12"/><path d="M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12"/>',
    alert: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    info: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 8h.01 M11 12h1v4h1"/>',
    loader: '<path d="M12 3a9 9 0 1 0 9 9"/>',
    close: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
    down: '<path d="M14 6l-6 6l6 6"/>',
    move: '<path d="M18 9l3 3l-3 3 M15 12h6 M6 9l-3 3l3 3 M3 12h6 M9 18l3 3l3 -3 M12 15v6 M15 6l-3 -3l-3 3 M12 3v6"/>'
  };
  const icon = name => '<svg class="bs-icon" viewBox="0 0 24 24" aria-hidden="true">' + glyphs[name] + '</svg>';
  const layout = `
    :host{all:initial;position:fixed;inset:auto;box-sizing:border-box;margin:0;padding:0;z-index:var(--layer-floating);isolation:isolate;color:var(--ink);font:500 14px/1.5 var(--font);color-scheme:light;overflow:visible;touch-action:none}
    :host([data-theme=dark]){color-scheme:dark}*,*::before,*::after{box-sizing:border-box}[hidden],:host([hidden]){display:none!important}button,input{font:inherit}button:focus-visible,input:focus-visible{outline:2px solid var(--accent-strong);outline-offset:3px}
    .bs-hover-layer{position:relative;min-width:0;transform-origin:center;transition:transform 260ms cubic-bezier(.18,.9,.28,1)}
    :host([data-hover=entry]) .bs-hover-layer,:host([data-hover=preview]) .bs-hover-layer{transform:translateY(var(--bs-hover-y,0px)) rotate(var(--bs-hover-rotate,0deg))}
    .bs-edge,.bs-shell{transition:box-shadow 260ms,border-radius 260ms}.bs-entry-logo{transition:transform 260ms cubic-bezier(.18,.9,.28,1)}
    :host([data-hover=entry]) .bs-edge{border-radius:21px;box-shadow:inset 0 0 0 1px var(--entry-border),var(--shadow-entry-hover,var(--shadow-entry))}
    :host([data-hover=entry]) .bs-entry-logo{transform:rotate(calc(0deg - var(--bs-hover-rotate,0deg))) scale(1.06)}
    :host([data-hover=preview]) .bs-shell{box-shadow:var(--shadow-float-hover,var(--shadow-float))}
    :host([data-hover-reset=true]) :is(.bs-hover-layer,.bs-edge,.bs-shell,.bs-entry-logo){transition:none!important}
    .bs-icon{width:17px;height:17px;stroke-width:1.8;flex:none}.bs-shell{position:absolute;inset:0;pointer-events:none;transform-origin:0 0;border:1px solid var(--line);border-radius:23px;background:var(--surface);box-shadow:var(--shadow-float)}
    :host([data-phase=edge]) .bs-shell{display:none}:host([data-phase=preview]) .bs-shell{border-radius:21px}
    .bs-header,.bs-panel{position:relative}.bs-header{display:flex;align-items:center;gap:8px;min-width:0;padding:15px 16px;border-bottom:1px solid var(--line)}
    :host([data-phase=edge]) .bs-header,:host([data-phase=preview]) .bs-header{padding:0;border:0}
    .bs-logo{display:flex;width:25px;height:25px;flex:none}.bs-logo svg{width:100%;height:100%}.bs-brand{font-size:14px;font-weight:700;letter-spacing:-.4px}.bs-heading{display:flex;align-items:center;gap:10px;min-width:0}
    .bs-edge{position:relative;display:inline-flex;align-items:center;justify-content:center;width:max-content;max-width:100%;padding:0;border:0;border-radius:19px;background:var(--entry-bg);color:var(--entry-ink);cursor:grab;touch-action:none;user-select:none;box-shadow:inset 0 0 0 1px var(--entry-border),var(--shadow-entry)}
    .bs-edge:active{transform:none}.bs-entry-display{display:inline-flex;max-width:100%}
    .bs-move{display:grid;gap:14px;flex:1;min-width:0;padding:0;border:0;border-radius:12px;background:transparent;color:var(--ink);text-align:left;cursor:grab;touch-action:none;user-select:none}
    :host([data-phase=preview]) .bs-move{padding:18px 18px 16px;min-height:90px}:host([data-phase=preview]) .bs-heading>.bs-logo,:host([data-phase=preview]) .bs-brand,:host([data-phase=preview]) .bs-drag-dots{display:none}
    .bs-state-wrap{display:flex;align-items:center;gap:13px;min-width:0;flex:1}.bs-state-copy{display:grid;gap:2px;min-width:0}.bs-state-label{font-size:14px;line-height:20px;font-weight:650;overflow-wrap:anywhere}.bs-state-detail{font-size:12px;line-height:17px;color:var(--muted);font-weight:500}
    .bs-state-symbol{--bs-status-width:48px;--bs-status-height:27px;display:flex;align-items:center;justify-content:center;width:48px;height:27px;flex:none;color:var(--success)}.bs-drag-dots{display:inline-block;color:var(--muted);letter-spacing:1px;font-size:15px;margin-left:2px}
    .bs-capsule-metrics{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}.bs-capsule-metric{display:flex;align-items:baseline;gap:4px;min-width:0}.bs-capsule-metric+.bs-capsule-metric{border-left:1px solid var(--line);padding-left:12px}.bs-capsule-metric strong{font-size:22px;line-height:28px;font-weight:650;letter-spacing:-.6px;font-variant-numeric:tabular-nums}.bs-unit{font-size:12px;font-weight:500;color:var(--muted);white-space:nowrap;letter-spacing:0}
    :host([data-phase=panel]) .bs-state-wrap,:host([data-phase=panel]) .bs-capsule-metrics{display:none}.bs-close{flex:none;width:31px;min-height:31px;padding:7px;border:0;border-radius:10px;background:var(--surface-soft);color:var(--ink)}.bs-close:hover:not(:disabled){background:var(--surface-hover)}#bs-position{width:26px;min-height:31px;padding:5px;background:transparent;color:var(--muted)}
    .bs-retract{display:flex;transform:rotate(-90deg)}
    .bs-panel{padding:15px 18px 18px;max-height:calc(var(--bs-max-height) - 62px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--muted) var(--surface-soft);scroll-padding:8px;border-radius:0 0 23px 23px}
    .bs-status-row{display:flex;align-items:center;gap:14px;padding:18px 16px;border-radius:15px;background:var(--accent-soft);min-height:80px}.bs-status-row .bs-state-symbol{--bs-status-width:64px;width:64px}.bs-status-copy{display:grid;gap:3px;min-width:0}.bs-status{font-size:16px;line-height:23px;font-weight:650}.bs-status-row .bs-state-detail{font-size:12px}
    .bs-enable{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:15px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.bs-enable label{font-size:13px;color:var(--ink);cursor:pointer}.bs-enable>.bs-switch{flex:none}
    .bs-metrics{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:15px;margin:18px 0}.bs-metric{min-width:0}.bs-metric+.bs-metric{padding-left:15px;border-left:1px solid var(--line)}.bs-metric-label{font-size:12px;line-height:18px;color:var(--muted)}.bs-metric-value{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 5px;margin-top:3px;min-width:0}.bs-metric-value strong{font-size:29px;line-height:37px;font-weight:650;letter-spacing:-.8px;color:var(--ink);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .bs-routes{display:flex;flex-direction:column;gap:7px;margin:15px 0 12px}.bs-routes>div{display:flex;justify-content:space-between;gap:10px;min-width:0}.bs-routes dt{font-size:12px;color:var(--muted)}.bs-routes dd{margin:0;font-size:12px;font-weight:600;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:65%}.bs-routes .bs-target-row{display:none}
    .bs-route-label{display:grid;gap:6px;color:var(--muted);font-size:12px}.bs-route-trigger{width:100%;min-width:0}.bs-route-label .bs-choice{border-radius:11px;min-height:40px;font-size:14px;background:var(--surface);border:1px solid var(--line)}
    .bs-actions{display:grid;gap:8px;grid-template-columns:minmax(0,1fr) minmax(0,1fr);margin-top:12px}.bs-actions .bs-button{min-width:0;white-space:normal;min-height:40px;padding:8px 7px;border-radius:11px;font-size:14px;font-weight:650}
    .bs-feedback{font-size:12px;color:var(--muted);line-height:1.6;margin:10px 0 0;overflow-wrap:anywhere}.bs-feedback:empty{display:none}.bs-feedback[data-tone=error]{color:var(--error)}.bs-notice{border-top:1px solid var(--line);padding-top:10px;margin-top:12px;color:var(--muted);font-size:12px}.bs-notice p{margin:0 0 8px}.bs-notice .bs-button{width:100%;font-size:14px}
    .bs-footer{margin-top:16px}.bs-footer .bs-button{width:100%;min-height:45px;padding:10px 12px;background:var(--surface-soft);border:1px solid var(--line);border-radius:12px;color:var(--ink);font-size:14px;font-weight:650}.bs-footer .bs-button:hover:not(:disabled){background:var(--surface-hover)}.bs-save-retry{margin-top:8px}.bs-placement{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 0 12px;margin-bottom:12px;border-bottom:1px solid var(--line)}.bs-placement .bs-button{min-height:36px;padding:5px;font-size:14px;white-space:normal}.bs-placement .bs-button:last-child{grid-column:1/-1}
    :host([data-dragging=true]){user-select:none}:host([data-dragging=true]) .bs-edge,:host([data-dragging=true]) .bs-move{cursor:grabbing}:host([data-dragging=true]) .bs-shell{box-shadow:0 8px 0 color-mix(in srgb,var(--ink) 4%,transparent),0 22px 48px color-mix(in srgb,var(--ink) 18%,transparent)}
    :host([data-motion=off]) *{transition:none!important;animation:none!important}@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
  `;
  // Known regions supplement native controls. This is a best-effort map of the
  // supported video templates, not a whole-site guarantee.
  const playerSelector = '.bpx-player-container,.bpx-player,#bilibili-player,.bilibili-player,video';
  const criticalSelector = playerSelector + ',.danmaku-box,.video-toolbar-container,.video-toolbar-left,.video-toolbar-right,.bili-header,[role=dialog],[aria-modal=true]';
  const protectedSelector = criticalSelector + ',.right-container,.recommend-list-v1,.video-pod,.multi-page-v1';
  const interactiveSelector = 'a[href],button,input,select,textarea,[role=button],[role=link],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
  let host, shadow, choice, choiceOptions, mounted = false, suspended = false, expanded = false, busy = false, motion = true;
  let phase = 'edge', hoverTimer = null, pointerInside = false, hoverPointer = false, morphing = false, previewDismissed = false, touchEntry = false, transitionSerial = 0;
  let current = {}, frame = null, layoutFrame = null, animation = null, unsubscribe = null, drag = null;
  let openingSerial = 0, feedbackKind = '', route = '', generation = null, wasFullscreen = false;
  let sharedAnchor = null, manualPosition = false, snapped = { x: null, y: null }, positionAnimation = null;
  let entryDisplay, previewSignal, panelSignal, snapHint, snapTarget = null, suppressFocus = false, suppressClickUntil = 0, presentationSignature = '', deferredLayout = false, deferredPhase = null, lastEntryEnabled = null;
  let preference = 'bottomRight', lastPlacement = null, protectRects = [], criticalRects = [], observedRegions = new Set();
  let domObserver, playerObserver, resizeObserver, hostSize = '', layoutRevision = 0;
  const cleanups = [], opening = new Map();
  try {
    const saved = JSON.parse(scope.localStorage.getItem(positionKey) || 'null');
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y) && ['left','right'].includes(saved.xSide) && ['top','bottom'].includes(saved.ySide)) {
      sharedAnchor = { x:saved.x, y:saved.y, xSide:saved.xSide, ySide:saved.ySide }; manualPosition = true;
      snapped = { x:['left','right'].includes(saved.snapX)?saved.snapX:null, y:['top','bottom'].includes(saved.snapY)?saved.snapY:null };
    } else if (['topLeft','topRight','bottomLeft','bottomRight'].includes(saved?.anchor)) preference=saved.anchor;
  } catch { /* Placement is optional local presentation state. */ }
  const $ = id => shadow?.getElementById(id);
  const t = key => words[current.config?.lang === 'en' ? 'en' : 'zh'][key] || key;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const shortHost = value => value ? String(value).replace(/^upos-(?:sz-|hz-)?(?:mirror)?/, '').replace(/\.(?:bilivideo\.(?:com|cn|net)|akamaized\.net)$/, '').toUpperCase() : t('unknown');
  const snapshot = () => typeof runtime.getViewState === 'function' ? runtime.getViewState() : runtime.getState();
  const routeKey = () => /^(?:www\.)?bilibili\.com$/i.test(scope.location.hostname) && /^\/(?:video\/(?:BV[a-z0-9]+|av\d+)|bangumi\/play\/(?:ep|ss)\d+)\/?$/i.test(scope.location.pathname) ? scope.location.pathname : '';
  function listen(target, name, callback, options) {
    target.addEventListener(name, callback, options);
    cleanups.push(() => target.removeEventListener(name, callback, options));
  }
  function persistPlacement() {
    try { scope.localStorage.setItem(positionKey, JSON.stringify(manualPosition && sharedAnchor ? { ...sharedAnchor, snapX:snapped.x, snapY:snapped.y } : {anchor:preference})); } catch {}
  }
  function minimumPhase() { return current.config?.floatingEntryEnabled === false ? 'preview' : 'edge'; }
  function captureAnchor(rect, chooseSides = false, bounds = shared.viewport(scope)) {
    const xSide = chooseSides || !sharedAnchor ? rect.x + rect.width / 2 < bounds.left + bounds.width / 2 ? 'left' : 'right' : sharedAnchor.xSide;
    const ySide = chooseSides || !sharedAnchor ? rect.y + rect.height / 2 < bounds.top + bounds.height / 2 ? 'top' : 'bottom' : sharedAnchor.ySide;
    sharedAnchor = { xSide, ySide, x:rect.x+(xSide==='right'?rect.width:0), y:rect.y+(ySide==='bottom'?rect.height:0) };
    host.dataset.anchor = xSide+'-'+ySide;
  }
  function within(point,width,height,bounds=shared.viewport(scope)) {
    return { x:Math.max(bounds.left+8,Math.min(point.x,bounds.right-width-8)), y:Math.max(bounds.top+8,Math.min(point.y,bounds.bottom-height-8)), width,height };
  }
  function hideSnapHint() { if(snapHint){snapHint.hidden=true;snapHint.style.display='none';} snapTarget=null; if(host)host.dataset.snapReady='false'; }
  function snapCandidate(rect,bounds=shared.viewport(scope)) {
    if(current.config?.floatingEdgeSnap===false)return null;
    const distances={left:Math.abs(rect.x-bounds.left-8),right:Math.abs(bounds.right-8-rect.x-rect.width),top:Math.abs(rect.y-bounds.top-8),bottom:Math.abs(bounds.bottom-8-rect.y-rect.height)};
    const x=Math.min(distances.left,distances.right)<=24?(distances.left<=distances.right?'left':'right'):null;
    const y=Math.min(distances.top,distances.bottom)<=24?(distances.top<=distances.bottom?'top':'bottom'):null;
    if(!x&&!y)return null;
    return {xSide:x,ySide:y,x:x==='left'?bounds.left+8:x==='right'?bounds.right-8-rect.width:rect.x,y:y==='top'?bounds.top+8:y==='bottom'?bounds.bottom-8-rect.height:rect.y,width:rect.width,height:rect.height};
  }
  function showSnapHint(rect) {
    const bounds=shared.viewport(scope),next=snapCandidate(rect,bounds);if(!next){hideSnapHint();return;}
    snapTarget=next;const color=scope.getComputedStyle(host).getPropertyValue('--accent-strong').trim();
    Object.assign(snapHint.style,{left:(next.x-bounds.originX)/bounds.scaleX+'px',top:(next.y-bounds.originY)/bounds.scaleY+'px',width:next.width/bounds.scaleX+'px',height:next.height/bounds.scaleY+'px',borderRadius:phase==='panel'?'23px':phase==='preview'?'21px':'19px',color});
    snapHint.hidden=false;snapHint.style.display='block';host.dataset.snapReady='true';
  }
  function stopPositionAnimation(commit = true) {
    if(!positionAnimation)return;
    const rect=host.getBoundingClientRect();positionAnimation.cancel?.();positionAnimation=null;host.style.transform='';
    if(commit){const next=within(rect,rect.width,rect.height);showAt(next);captureAnchor(next);snapped={x:null,y:null};}
  }
  function settlePosition() {
    const rect=host.getBoundingClientRect(),next=snapCandidate(rect),bounds=shared.viewport(scope);captureAnchor(rect,true,bounds);manualPosition=true;
    snapped={x:next?.xSide||null,y:next?.ySide||null};hideSnapHint();
    if(next){if(next.xSide)sharedAnchor.xSide=next.xSide;if(next.ySide)sharedAnchor.ySide=next.ySide;captureAnchor(next);showAt(next);
      const dx=(rect.x-next.x)/bounds.scaleX,dy=(rect.y-next.y)/bounds.scaleY;
      if(host.dataset.motion==='on'&&engine?.animate&&(Math.abs(dx)+Math.abs(dy)>.5)){
        const active=engine.animate(host,{transform:['translate('+dx+'px,'+dy+'px)','translate(0px,0px)']},{type:engine.spring,stiffness:540,damping:47,mass:.72});positionAnimation=active;
        active.then(()=>{if(positionAnimation===active){positionAnimation=null;host.style.transform='';syncHover();}});
      }
    }
    persistPlacement();
  }
  function closeMenus() {
    choice?.close(false);
    if ($('bs-placement')) $('bs-placement').hidden = true;
    $('bs-position')?.setAttribute('aria-expanded', 'false');
  }
  function fullscreen() {
    if (document.fullscreenElement) return true;
    if (document.querySelector('.bpx-player.mode-webfullscreen,#bilibili-player.mode-webscreen,.bpx-player.mode-fullscreen')) return true;
    // Only a known visible fixed player covering the viewport enables fallback.
    for (const node of document.querySelectorAll('.bpx-player-container,.bpx-player,#bilibili-player')) {
      const rect = node.getBoundingClientRect();
      if (rect.width < scope.innerWidth - 4 || rect.height < scope.innerHeight - 4 || Math.abs(rect.left) > 2 || Math.abs(rect.top) > 2) continue;
      const style = scope.getComputedStyle(node);
      if (style.position === 'fixed' && style.visibility !== 'hidden' && style.display !== 'none') return true;
    }
    return false;
  }
  function stopTransition() {
    transitionSerial++;
    morphing = false;
    // Geometry is sampled before reversing. Canceling avoids commitStyles on
    // a just-hidden phase and leaves no completed-animation styles behind.
    animation?.forEach(control => control.cancel?.()); animation = null;
    for (const node of [shadow?.querySelector('.bs-shell'), $('bs-body'), shadow?.querySelector('.bs-header')]) {
      if (node) { node.style.transform = ''; node.style.opacity = ''; }
    }
  }
  function clearHover() {
    if (hoverTimer !== null) scope.clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  function clearVisualHover(immediate = false) {
    if (!host) return;
    host.dataset.hoverReset = String(immediate); host.dataset.hover = 'none';
  }
  function syncHover() {
    if (!host) return;
    if (drag || positionAnimation || morphing || host.dataset.motion !== 'on' || phase === 'panel') { clearVisualHover(true); return; }
    if (!hoverPointer || !pointerInside) { if (host.dataset.hover !== 'none') clearVisualHover(); return; }
    // Only the inner visual layer moves. Placement, drag samples and corner anchors
    // continue to use the untransformed host, including at viewport edges and zoom.
    const rect = host.getBoundingClientRect(), bounds = shared.viewport(scope);
    const top = Math.max(0, rect.top - bounds.top - 8), lift = Math.min(3 * bounds.scaleY, top);
    let rotation = 0;
    if (phase === 'edge') {
      const width = rect.width / bounds.scaleX, height = rect.height / bounds.scaleY;
      const horizontal = Math.max(0, Math.min(rect.left - bounds.left - 8, bounds.right - rect.right - 8));
      const vertical = Math.max(0, Math.min(top - lift, bounds.bottom - rect.bottom - 8 + lift));
      let low = 0, high = 3;
      for (let i = 0; i < 10; i++) {
        const degrees = (low + high) / 2, radians = degrees * Math.PI / 180;
        const extraX = (width * Math.cos(radians) + height * Math.sin(radians) - width) / 2 * bounds.scaleX;
        const extraY = (height * Math.cos(radians) + width * Math.sin(radians) - height) / 2 * bounds.scaleY;
        if (extraX <= horizontal && extraY <= vertical) low = degrees; else high = degrees;
      }
      rotation = low;
    }
    host.style.setProperty('--bs-hover-y', -lift / bounds.scaleY + 'px');
    host.style.setProperty('--bs-hover-rotate', -rotation + 'deg');
    host.dataset.hoverReset = 'false'; host.dataset.hover = phase === 'edge' ? 'entry' : 'preview';
  }
  function syncMotion() {
    if (!host) return;
    const on = motion && !reduceQuery.matches && !document.hidden && !suspended && !host.hidden;
    host.dataset.motion = on ? 'on' : 'off';
    if (!on) { hoverPointer = false; stopTransition(); stopPositionAnimation(false); }
    choice?.syncMotion(); syncHover();
    const options={snapshot:current,connected:true,lang:current.config?.lang,motion:on};
    entryDisplay?.update({...options,type:current.config?.floatingEntryType||'status-logo'});previewSignal?.update(options);panelSignal?.update(options);
  }
  function conceal(reason) {
    if (!host) return;
    clearHover(); closeMenus(); stopTransition(); stopPositionAnimation(false); hideSnapHint(); if(drag)finishDrag(null,true); host.hidden = true; host.inert = true;
    host.dataset.visible = 'false'; host.dataset.hiddenReason = reason; syncMotion();
  }
  function showAt(at) {
    const bounds = shared.viewport(scope);
    if (choiceOptions) {
      const menuWidth = Math.max(128, at.width - 16);
      if (choiceOptions.maxWidth !== menuWidth || lastPlacement && (lastPlacement.x !== at.x || lastPlacement.y !== at.y)) choice?.close(false);
      // The shared choice reads this instance's limit when positioning its popup.
      choiceOptions.maxWidth = menuWidth;
    }
    host.dataset.edge = at.x + at.width / 2 >= bounds.left + bounds.width / 2 ? 'right' : 'left';
    host.style.left = (at.x - bounds.originX) / bounds.scaleX + 'px';
    host.style.top = (at.y - bounds.originY) / bounds.scaleY + 'px';
    host.style.visibility = ''; host.style.pointerEvents = '';
    host.hidden = false; host.inert = false; host.dataset.visible = 'true'; host.dataset.hiddenReason = '';
    lastPlacement = at; drawShell(bounds); syncMotion();
  }
  function drawShell() { /* Opaque rounded surfaces share one position anchor. */ }
  function visibleRect(node) {
    if (node === host || host?.contains(node) || node.closest?.('[hidden]')) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= scope.innerWidth || rect.top >= scope.innerHeight) return null;
    const style = scope.getComputedStyle(node);
    return style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0' ? null : rect;
  }
  function collectProtection() {
    const regions = [...document.querySelectorAll(protectedSelector)].filter(node => node !== host);
    const visibleRegions = regions.map(node => [node, visibleRect(node)]).filter(([, rect]) => rect);
    protectRects = visibleRegions.map(([, rect]) => rect);
    criticalRects = visibleRegions.filter(([node]) => node.matches(criticalSelector)).map(([, rect]) => rect);
    const visibleControls = [];
    for (const node of document.querySelectorAll(interactiveSelector)) {
      if (visibleRegions.some(([region]) => region === node || region.contains(node))) continue;
      const rect = visibleRect(node); if (rect) { protectRects.push(rect); criticalRects.push(rect); visibleControls.push(node); }
    }
    if (resizeObserver) {
      const next = new Set([...regions, ...visibleControls]);
      for (const node of observedRegions) if (!next.has(node)) resizeObserver.unobserve(node);
      for (const node of next) if (!observedRegions.has(node)) resizeObserver.observe(node);
      observedRegions = next;
    }
    if (playerObserver) {
      playerObserver.disconnect();
      const targets = new Set();
      for (const node of document.querySelectorAll(playerSelector)) {
        for (let parent = node; parent && parent !== document; parent = parent.parentElement) targets.add(parent);
      }
      for (const node of targets) playerObserver.observe(node, { attributes: true, attributeFilter: ['class', 'style'] });
    }
    host.dataset.layoutRevision = String(++layoutRevision);
  }
  function safe(at,width,height,bounds=shared.viewport(scope)) {
    if(at.x<bounds.left+8-.5||at.y<bounds.top+8-.5||at.x+width>bounds.right-8+.5||at.y+height>bounds.bottom-8+.5)return false;
    return !protectRects.some(rect=>at.x<rect.right+8&&at.x+width>rect.left-8&&at.y<rect.bottom+8&&at.y+height>rect.top-8);
  }
  function anchor(name,width,height,bounds=shared.viewport(scope)) {
    return { x:name.endsWith('Right')?bounds.right-width-8:bounds.left+8,y:name.startsWith('bottom')?bounds.bottom-height-8:bounds.top+8,width,height };
  }
  function fields() {
    const value = current.config?.floatingFields;
    return Array.isArray(value) ? value.filter(name => ['status', 'speed', 'buffer'].includes(name)) : ['status', 'speed', 'buffer'];
  }
  function place(scan = true) {
    if(!mounted||suspended||!host)return;
    if(!routeKey()){syncLifecycle();return;}
    const full=fullscreen();
    if((full||document.hidden)&&drag)finishDrag(null,true);
    if(full||wasFullscreen){if(phase!==minimumPhase())setExpanded(false,{animate:false,relayout:false});wasFullscreen=full;}
    if(full){conceal('fullscreen');return;}if(document.hidden){conceal('document-hidden');return;}
    if(drag){deferredLayout=true;return;}deferredLayout=false;
    stopPositionAnimation(true);
    const bounds=shared.viewport(scope),maxHeight=Math.max(0,bounds.height-16),maxWidth=Math.max(0,bounds.width-16);
    if(maxWidth<44||maxHeight<44){conceal('viewport-too-small');return;}
    if(scan)collectProtection();
    host.style.setProperty('--bs-max-height',maxHeight/bounds.scaleY+'px');host.style.maxHeight=maxHeight/bounds.scaleY+'px';host.hidden=false;
    const desired=phase==='edge'?($('bs-entry-display').firstElementChild?.offsetWidth||54):phase==='preview'?256:312;
    host.style.width=Math.min(desired,maxWidth/bounds.scaleX)+'px';
    const measured=host.getBoundingClientRect(),width=measured.width,height=Math.min(measured.height,maxHeight);
    let at;
    if(sharedAnchor){
      if(snapped.x)sharedAnchor.x=snapped.x==='left'?bounds.left+8:bounds.right-8;
      if(snapped.y)sharedAnchor.y=snapped.y==='top'?bounds.top+8:bounds.bottom-8;
      at=within({x:sharedAnchor.x-(sharedAnchor.xSide==='right'?width:0),y:sharedAnchor.y-(sharedAnchor.ySide==='bottom'?height:0)},width,height,bounds);
    }else{
      const names=[...new Set([preference,'topRight','bottomLeft','topLeft'])];
      at=names.map(name=>anchor(name,width,height,bounds)).find(candidate=>safe(candidate,width,height,bounds));
      // Default placement avoids known controls when space permits. An explicit
      // user position and a state change never jump to an unrelated corner.
      if(!at)at=anchor(preference,width,height,bounds);
    }
    showAt(at);captureAnchor(at,!sharedAnchor,bounds);
  }
  function queueLayout() {
    if (layoutFrame !== null || suspended) return;
    layoutFrame = scope.requestAnimationFrame(() => {
      layoutFrame = null; syncLifecycle();
      if (mounted) { clearVisualHover(true); place(true); }
    });
  }
  function finishFold() {
    if (!host) return;
    expanded = phase === 'panel';
    host.dataset.phase = phase; host.dataset.expanded = String(expanded);
    $('bs-edge').hidden = phase !== 'edge'; $('bs-move').hidden = phase === 'edge';
    $('bs-body').hidden = !expanded; $('bs-body').inert = !expanded;
    $('bs-close').hidden = !expanded; $('bs-position').hidden = !expanded;
    $('bs-edge').setAttribute('aria-expanded', String(phase !== 'edge'));
    $('bs-move').setAttribute('aria-expanded', String(expanded));
  }
  function setPhase(next,{animate=true,focus=false,relayout=true}={}) {
    if(!mounted||drag||next!=='edge'&&fullscreen())return;
    if(next==='edge')next=minimumPhase();clearHover();hideSnapHint();
    if(phase===next){if(focus&&!host.hidden){suppressFocus=true;(next==='edge'?$('bs-edge'):$('bs-move')).focus({preventScroll:true});suppressFocus=false;}return;}
    const old=(phase==='edge'?$('bs-edge'):shadow.querySelector('.bs-shell')).getBoundingClientRect(),oldPhase=phase,hadFocus=!!shadow.activeElement;
    clearVisualHover(true);stopPositionAnimation(true);
    if(!sharedAnchor&&!host.hidden)captureAnchor(host.getBoundingClientRect(),true);
    stopTransition();closeMenus();phase=next;morphing=animate&&!host.hidden&&host.dataset.motion==='on'&&!!engine?.animate;finishFold();render();if(relayout)place(false);
    if(animate&&!host.hidden&&host.dataset.motion==='on'&&engine?.animate){
      const rect=host.getBoundingClientRect(),serial=++transitionSerial,bounds=shared.viewport(scope),shrinking=({edge:0,preview:1,panel:2}[next]<{edge:0,preview:1,panel:2}[oldPhase]);
      const shell=shadow.querySelector('.bs-shell'),origin=sharedAnchor.xSide+' '+sharedAnchor.ySide;
      const from='translate('+(old.left-rect.left)/bounds.scaleX+'px,'+(old.top-rect.top)/bounds.scaleY+'px) scale('+old.width/rect.width+','+old.height/rect.height+')';
      const geometry=engine.animate(shell,{transform:[from,'none']},{type:engine.spring,bounce:0,duration:shrinking?.24:.4});
      const header=shadow.querySelector('.bs-header');header.style.transformOrigin=origin;
      const content=engine.animate(header,{opacity:[.58,1],transform:[shrinking?'scale(1.035)':'scale(.94)','scale(1)']},{type:engine.spring,bounce:.07,duration:shrinking?.24:.39});
      animation=[geometry,content];if(expanded)animation.push(engine.animate($('bs-body'),{opacity:[.25,1],transform:['translateY(5px)','none']},{type:engine.spring,bounce:0,duration:.3}));
      geometry.then(()=>{if(serial===transitionSerial){stopTransition();syncHover();}});
    }else{morphing=false;syncHover();}
    if((focus||hadFocus)&&!host.hidden){suppressFocus=true;(phase==='edge'?$('bs-edge'):$('bs-move')).focus({preventScroll:true});suppressFocus=false;}
  }
  function setExpanded(value, options = {}) {
    if (!value) previewDismissed = pointerInside || !!shadow?.activeElement;
    setPhase(value ? 'panel' : 'edge', options);
  }
  function preview() {
    clearHover();
    if (phase === 'edge' && !previewDismissed && !drag) setPhase('preview');
  }
  function scheduleRetraction() {
    clearHover();
    if (minimumPhase() === 'preview' || phase !== 'preview' || pointerInside || shadow.activeElement || drag) return;
    hoverTimer = scope.setTimeout(() => {
      hoverTimer = null;
      if (phase === 'preview' && !pointerInside && !shadow.activeElement) setPhase('edge');
    }, 180);
  }
  function setText(node, value) { if (node.textContent !== value) node.textContent = value; }
  function feedback(message, error = false, kind = 'action') {
    feedbackKind = kind; setText($('bs-feedback'), message); $('bs-feedback').dataset.tone = error ? 'error' : 'neutral';
  }
  function playbackState() {
    const project = scope.BiliSmoothSurface?.projectPlayback || shared.projectPlayback;
    if (project) return project(current, true);
    // Older isolated view harness compatibility; this does not detect stalls.
    const media = current.media || {};
    if (!media.present) return 'waiting';
    if (media.errorCode) return 'error';
    if (['paused', 'ended', 'seeking', 'buffering', 'frozen'].includes(media.playback)) return media.playback;
    const age = Date.now() - current.observedAt;
    return media.playback === 'playing' && media.frameHealth?.state === 'healthy' && finite(age) && age >= 0 && age <= 3000 ? 'smooth' : media.playback === 'playing' ? 'playing' : 'waiting';
  }
  function render() {
    if (suspended || document.hidden) { syncMotion(); return; }
    if (routeKey() !== route) { syncLifecycle(); return; }
    if (!mounted) return;
    current = snapshot(); current.config ||= runtime.getConfig();
    const entryEnabled=current.config.floatingEntryEnabled!==false,returnedToThreeStates=lastEntryEnabled===false&&entryEnabled;lastEntryEnabled=entryEnabled;
    if(returnedToThreeStates&&phase==='preview'){if(drag)deferredPhase='edge';else{setPhase('edge',{animate:false});return;}}
    if (phase === 'edge' && minimumPhase() === 'preview') { if(drag)deferredPhase='preview';else setPhase('preview', {animate:false}); return; }
    const nextSignature=JSON.stringify([current.config.floatingEntryType,fields(),current.config.lang]);
    if(presentationSignature && nextSignature!==presentationSignature)queueLayout();presentationSignature=nextSignature;
    if(current.config.floatingEdgeSnap===false){snapped={x:null,y:null};hideSnapHint();}
    if (generation !== null && current.mediaGeneration != null && generation !== current.mediaGeneration) {
      generation = current.mediaGeneration; setExpanded(false, { animate: false });
    } else if (current.mediaGeneration != null) generation = current.mediaGeneration;
    const config = current.config, media = current.media || {}, selected = fields(), state = playbackState();
    host.dataset.theme = config.theme === 'dark' || config.theme !== 'light' && darkQuery.matches ? 'dark' : 'light';
    host.dataset.accent = config.accent || settings.defaults.accent; host.lang = config.lang === 'en' ? 'en' : 'zh-CN';
    host.dataset.state = state;
    shadow.querySelectorAll('[data-text]').forEach(node => { setText(node, t(node.dataset.text)); });
    const label = t(state === 'error' ? 'errorState' : state);
    for (const id of ['bs-capsule-state', 'bs-status']) setText($(id), label);
    const displayOptions={snapshot:current,connected:true,lang:config.lang,motion:motion&&!reduceQuery.matches&&!document.hidden};
    entryDisplay?.update({...displayOptions,type:config.floatingEntryType||'status-logo'});previewSignal?.update(displayOptions);panelSignal?.update(displayOptions);
    const detail={smooth:'detailSmooth',buffering:'detailBuffering',frozen:'detailFrozen',paused:'detailPaused',waiting:'detailWaiting',playing:'detailPlaying',seeking:'detailSeeking',ended:'detailEnded',error:'detailError'};
    for(const id of ['bs-preview-detail','bs-panel-detail'])setText($(id),t(detail[state]||'detailWaiting'));
    $('bs-capsule-state').hidden = !selected.includes('status');
    $('bs-capsule-speed-field').hidden = !selected.includes('speed');
    $('bs-capsule-buffer-field').hidden = !selected.includes('buffer');
    $('bs-capsule-metrics').hidden = !selected.some(name => name !== 'status');
    const buffer = shared.format?.buffer ? shared.format.buffer(current) : finite(current.bufferWallSeconds) ? current.bufferWallSeconds : finite(current.buffer) && finite(current.rate) && current.rate > 0 ? current.buffer / current.rate : null;
    const speed = media.present ? shared.format.speed(current) : { value: '-', unit: 'MB/s' };
    const playable = media.present && finite(buffer) && buffer >= 0 ? buffer.toFixed(1) : '—';
    for (const id of ['bs-speed', 'bs-capsule-speed']) $(id).textContent = speed.value === '-' ? '—' : speed.value;
    for (const id of ['bs-speed-unit', 'bs-capsule-speed-unit']) $(id).textContent = speed.unit;
    for (const id of ['bs-buffer', 'bs-capsule-buffer']) $(id).textContent = playable;
    $('bs-capsule-speed-field').title = t('speed'); $('bs-capsule-buffer-field').title = t('buffer');
    $('bs-move').setAttribute('aria-label', 'BiliSmooth · ' + label + ' · ' + t('move'));
    $('bs-move').title = t('move');
    $('bs-edge').setAttribute('aria-label', t('entry')); $('bs-edge').title = t('entry');
    $('bs-close').setAttribute('aria-label', t('close')); $('bs-position').setAttribute('aria-label', t('position')); $('bs-position').title = t('position');
    syncMotion();
    if (!expanded) return;
    const active = config.enabled && config.mode !== 'off', automatic = active && config.selection === 'auto';
    $('bs-enabled').checked = config.enabled === true;
    $('bs-actual').textContent = shortHost(current.actualHost); $('bs-actual').title = current.actualHost || '';
    $('bs-target').textContent = active ? shortHost(config.pcdnHost) : t('original'); $('bs-target').title = active ? config.pcdnHost || '' : '';
    const hosts = [...new Set([...(settings.fixedHosts || []), ...(current.allowedHosts || []), config.pcdnHost].filter(value => settings.isCdnHost(value)))];
    const signature = JSON.stringify([hosts, config.lang]);
    if ($('bs-route').dataset.key !== signature) {
      choice?.setLabels({ label: t('route'), placeholder: t('routeSearch'), emptyText: t('unknown') });
      choice?.setOptions([{ value: 'auto', label: t('auto') }, { value: 'original', label: t('original') }, ...hosts.map(value => ({ value: 'host:' + value, label: t('fixed') + ' · ' + shortHost(value), description: value }))]);
      $('bs-route').dataset.key = signature;
    }
    choice?.setValue(config.mode === 'off' ? 'original' : config.selection === 'fixed' ? 'host:' + config.pcdnHost : 'auto');
    const saving = current.settingsSave?.status === 'pending', failed = current.settingsSave?.status === 'error';
    $('bs-panel').setAttribute('aria-busy', String(busy || saving));
    $('bs-enabled').setAttribute('aria-busy', String(saving));
    for (const node of shadow.querySelectorAll('[data-action],#bs-enabled')) node.disabled = busy;
    choice?.setDisabled(busy); $('bs-route').disabled = busy || !choice;
    $('bs-retry').disabled = busy || !automatic; $('bs-reset').disabled = busy || !automatic;
    $('bs-retry').title = $('bs-reset').title = automatic ? '' : t('inactive');
    $('bs-reload-notice').hidden = !current.needReload || saving || failed;
    $('bs-save-retry').hidden = !failed;
    if (saving) feedback(t('saving'), false, 'save');
    else if (failed) feedback(t('saveFailed'), true, 'save');
    else if (current.reloadReasons?.includes('storage-read-failed')) feedback(t('readFailed'), true, 'read');
    else if (feedbackKind === 'save') feedback(t('saved'));
    else if (feedbackKind === 'read') feedback('');
  }
  function queueRender() {
    if (suspended || frame !== null) return;
    frame = scope.requestAnimationFrame(() => { frame = null; render(); });
  }
  function openDashboard() {
    const id = 'floating-' + Date.now() + '-' + (++openingSerial);
    return new Promise((resolve, reject) => {
      const timer = scope.setTimeout(() => { opening.delete(id); reject(new Error('open-control-timeout')); }, 6500);
      opening.set(id, { resolve, reject, timer });
      scope.postMessage({ __bilismoothFloating: 'open-control', id }, scope.location.origin);
    });
  }
  async function action(name, value) {
    if (busy) return false;
    busy = true; render();
    try {
      let message = 'saved';
      if (name === 'config') { runtime.setConfig(value); await runtime.flushSettings(); }
      else if (name === 'route') {
        const config = runtime.getConfig();
        if (value === 'auto') runtime.setConfig({ enabled: true, selection: 'auto', mode: config.mode === 'off' ? 'bad-only' : config.mode });
        else if (value === 'original') runtime.setConfig({ mode: 'off' });
        else if (!(value?.startsWith('host:') && runtime.applyRoute(value.slice(5)))) throw new Error('invalid-route');
        await runtime.flushSettings(); message = 'selected';
      } else if (name === 'retry') {
        const attempted = runtime.retry(); if (attempted) await runtime.flushSettings(); message = attempted ? 'selected' : 'noAlternative';
      } else if (name === 'reset') { runtime.resetNetwork(); message = 'reassessing'; }
      else if (name === 'save-retry') { runtime.setConfig({}); await runtime.flushSettings(); }
      else if (name === 'dashboard') { await openDashboard(); message = null; }
      else if (name === 'reload') { runtime.reload(); await runtime.flushSettings(); scope.location.reload(); message = null; }
      feedback(message ? t(message) : ''); return true;
    } catch {
      feedback(t(name === 'dashboard' ? 'openFailed' : name === 'reload' ? 'reloadFailed' : snapshot().settingsSave?.status === 'error' ? 'saveFailed' : 'error'), true);
      return false;
    } finally { busy = false; render(); }
  }
  function togglePositionMenu(value, focus = false) {
    if (value) choice?.close(false);
    $('bs-placement').hidden = !value; $('bs-position').setAttribute('aria-expanded', String(!!value)); place(false, true);
    if (focus && !host.hidden) (value ? $('bs-placement').querySelector('button') : $('bs-position')).focus({ preventScroll: true });
  }
  function moveToPreset(value) {
    stopPositionAnimation(false);preference=value==='defaultPosition'?'bottomRight':value;
    sharedAnchor=null;manualPosition=false;snapped={x:null,y:null};lastPlacement=null;togglePositionMenu(false);place(false);persistPlacement();
    if(!host.hidden)$('bs-position').focus({preventScroll:true});
  }
  function moveTo(point) {
    if(!host||host.hidden)return false;
    const rect=host.getBoundingClientRect(),next=within(point,rect.width,rect.height);manualPosition=true;snapped={x:null,y:null};showAt(next);captureAnchor(next);return true;
  }
  function finishDrag(event,cancel=false) {
    if(!drag||(event&&event.pointerId!==drag.id))return;
    const ended=drag;drag=null;host.dataset.dragging='false';hoverPointer=!cancel&&ended.pointerType==='mouse'&&pointerInside;
    if(ended.mover.hasPointerCapture(ended.id))ended.mover.releasePointerCapture(ended.id);
    const nextPhase=deferredPhase;deferredPhase=null;
    if(!cancel&&nextPhase)setPhase(nextPhase,{animate:false});
    if(!cancel&&deferredLayout)place(false);
    if(ended.moved){suppressClickUntil=performance.now()+450;touchEntry=false;previewDismissed=true;if(cancel){captureAnchor(host.getBoundingClientRect(),true);hideSnapHint();persistPlacement();}else settlePosition();}
    else hideSnapHint();
    syncHover();
  }
  function createSurface() {
    host=document.createElement('div');host.id='bilismooth-floating';host.setAttribute('aria-label','BiliSmooth');host.hidden=true;
    shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=[
      '<style>'+shared.tokens+shared.components+(presentation?.css||'')+layout+'</style><div class="bs-hover-layer"><div class="bs-shell" aria-hidden="true"></div>',
      '<header class="bs-header"><button id="bs-edge" class="bs-edge" type="button" aria-expanded="false" aria-controls="bs-move"><span id="bs-entry-display" class="bs-entry-display"></span></button>',
      '<button id="bs-move" class="bs-move" type="button" aria-expanded="false" aria-controls="bs-body"><span class="bs-heading"><span class="bs-logo" aria-hidden="true">'+shared.logo+'</span><span class="bs-brand">BiliSmooth</span><span class="bs-drag-dots" aria-hidden="true">⠿</span><span class="bs-state-wrap"><span id="bs-state-glyph" class="bs-state-symbol" aria-hidden="true"></span><span class="bs-state-copy"><span id="bs-capsule-state" class="bs-state-label" role="status" aria-live="polite" aria-atomic="true"></span><span id="bs-preview-detail" class="bs-state-detail"></span></span></span></span>',
      '<span id="bs-capsule-metrics" class="bs-capsule-metrics"><span id="bs-capsule-speed-field" class="bs-capsule-metric"><strong id="bs-capsule-speed">—</strong><span id="bs-capsule-speed-unit" class="bs-unit">MB/s</span></span><span id="bs-capsule-buffer-field" class="bs-capsule-metric"><strong id="bs-capsule-buffer">—</strong><span class="bs-unit" data-text="seconds"></span></span></span></button>',
      '<button id="bs-position" class="bs-icon-button bs-close" type="button" aria-controls="bs-placement" aria-expanded="false" hidden>'+icon('move')+'</button><button id="bs-close" class="bs-icon-button bs-close" type="button" hidden><span class="bs-retract">'+icon('down')+'</span></button></header>',
      '<section id="bs-body" class="bs-panel" hidden inert><div id="bs-placement" class="bs-placement" hidden>'+['topLeft','topRight','bottomLeft','bottomRight','defaultPosition'].map(value=>'<button class="bs-button" type="button" data-position="'+value+'" data-text="'+value+'"></button>').join('')+'</div>',
      '<div id="bs-panel"><div class="bs-status-row"><span id="bs-panel-glyph" class="bs-state-symbol" aria-hidden="true"></span><span class="bs-status-copy"><strong id="bs-status" class="bs-status" role="status" aria-live="polite" aria-atomic="true"></strong><span id="bs-panel-detail" class="bs-state-detail"></span></span></div>',
      '<div class="bs-metrics"><div class="bs-metric"><span class="bs-metric-label" data-text="speed"></span><span class="bs-metric-value"><strong id="bs-speed">—</strong><span id="bs-speed-unit" class="bs-unit">MB/s</span></span></div><div class="bs-metric"><span class="bs-metric-label" data-text="buffer"></span><span class="bs-metric-value"><strong id="bs-buffer">—</strong><span class="bs-unit" data-text="seconds"></span></span></div></div>',
      '<div class="bs-enable"><label id="bs-enabled-label" for="bs-enabled" data-text="enable"></label><span class="bs-switch"><input id="bs-enabled" type="checkbox" role="switch" aria-labelledby="bs-enabled-label"><span class="bs-switch-track" aria-hidden="true"></span></span></div>',
      '<dl class="bs-routes"><div><dt data-text="actual"></dt><dd id="bs-actual">—</dd></div><div class="bs-target-row"><dt data-text="target"></dt><dd id="bs-target">—</dd></div></dl>',
      '<div class="bs-route-label"><span id="bs-route-label" data-text="target"></span><button id="bs-route" type="button" class="bs-button bs-route-trigger" aria-labelledby="bs-route-label"></button></div>',
      '<div class="bs-actions"><button id="bs-reset" class="bs-button" type="button" data-action="reset" data-text="reset"></button><button id="bs-retry" class="bs-button primary" type="button" data-action="retry" data-text="retry"></button></div>',
      '<div id="bs-reload-notice" class="bs-notice" hidden><p data-text="needReload"></p><button class="bs-button" type="button" data-action="reload" data-text="reload"></button></div><p id="bs-feedback" class="bs-feedback" role="status" aria-live="polite"></p><button id="bs-save-retry" class="bs-button bs-save-retry" type="button" data-action="save-retry" data-text="retrySave" hidden></button>',
      '<footer class="bs-footer"><button class="bs-button" type="button" data-action="dashboard" data-text="dashboard"></button></footer></div></section></div>'
    ].join('');
    const brandMark=shadow.querySelector('.bs-heading>.bs-logo');
    if(presentation?.logo)brandMark.replaceChildren(presentation.logo(document));
    entryDisplay=presentation?.create($('bs-entry-display'),{snapshot:current,type:current.config?.floatingEntryType||'status-logo'});
    if(!entryDisplay)$('bs-entry-display').innerHTML='<span style="display:flex;width:54px;height:54px;padding:13px">'+shared.logo+'</span>';
    previewSignal=presentation?.createStatus($('bs-state-glyph'),{snapshot:current,labels:false});panelSignal=presentation?.createStatus($('bs-panel-glyph'),{snapshot:current,labels:false});
    snapHint=document.createElement('div');snapHint.id='bs-snap-hint';snapHint.dataset.snapHint='';snapHint.hidden=true;snapHint.setAttribute('aria-hidden','true');snapHint.inert=true;
    snapHint.style.cssText='all:initial;display:none;position:fixed;pointer-events:none;box-sizing:border-box;z-index:2147482999;border:1px dashed currentColor;background:color-mix(in srgb,currentColor 8%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,currentColor 5%,transparent);opacity:.45;';document.documentElement.appendChild(snapHint);
    choiceOptions = {
      root: shadow, trigger: $('bs-route'), options: [], value: '', searchable: true, maxWidth: 196, label: t('route'), placeholder: t('routeSearch'),
      onCommit: async value => await action('route', value)
    };
    choice = scope.BiliSmoothChoice?.create(choiceOptions);
    listen(shadow,'pointerdown',()=>{suppressClickUntil=0;},true);
    listen(shadow,'click',event=>{if(event.detail!==0&&performance.now()<suppressClickUntil){suppressClickUntil=0;event.preventDefault();event.stopImmediatePropagation();}},true);
    listen($('bs-edge'),'click',event=>{previewDismissed=false;setPhase(touchEntry||event.pointerType==='touch'?'preview':'panel',{focus:true});touchEntry=false;});
    listen($('bs-move'),'click',()=>setPhase(expanded?'preview':'panel'));
    listen($('bs-close'),'click',()=>setPhase('preview',{focus:true}));
    listen(host,'pointerenter',event=>{if(event.pointerType!=='mouse'){hoverPointer=false;clearVisualHover(true);return;}pointerInside=true;hoverPointer=true;syncHover();previewDismissed=false;clearHover();if(phase==='edge'&&!drag)hoverTimer=scope.setTimeout(()=>{if(!drag)preview();},140);});
    listen(host,'pointerleave',event=>{if(event.pointerType==='touch')return;pointerInside=false;hoverPointer=false;clearVisualHover();clearHover();if(!drag){previewDismissed=false;scheduleRetraction();}});
    listen(host,'pointermove',event=>{if(event.pointerType==='mouse'&&!event.buttons&&!drag&&!positionAnimation&&performance.now()>=suppressClickUntil){hoverPointer=true;syncHover();}});
    listen(shadow,'focusin',event=>{clearHover();if(event.target===$('bs-edge')&&!touchEntry&&!previewDismissed&&!suppressFocus&&!drag){preview();if(phase==='preview')$('bs-move').focus({preventScroll:true});}});
    listen(shadow,'focusout',()=>scope.queueMicrotask(()=>{if(!shadow.activeElement&&!drag){previewDismissed=false;scheduleRetraction();}}));
    listen(shadow,'click',event=>event.stopPropagation());
    listen($('bs-position'),'click',()=>togglePositionMenu($('bs-placement').hidden,true));
    for(const node of shadow.querySelectorAll('[data-position]'))listen(node,'click',()=>moveToPreset(node.dataset.position));
    listen(shadow,'keydown',event=>{
      event.stopPropagation();if(event.key!=='Escape'||event.defaultPrevented||choice?.isOpen)return;event.preventDefault();
      if(drag){finishDrag(null,true);return;}
      if(!$('bs-placement').hidden)togglePositionMenu(false,true);
      else if(phase==='panel')setPhase('preview',{focus:true});else{previewDismissed=true;setPhase(minimumPhase(),{focus:true});}
    });
    listen($('bs-enabled'),'change',()=>{void action('config',{enabled:$('bs-enabled').checked});});
    for(const node of shadow.querySelectorAll('[data-action]'))listen(node,'click',()=>{void action(node.dataset.action);});
    for(const mover of [$('bs-edge'),$('bs-move')]){
      listen(mover,'pointerdown',event=>{
        if(event.button!==0||!event.isPrimary||drag)return;
        touchEntry=event.pointerType==='touch'&&phase==='edge';hoverPointer=false;clearVisualHover(true);clearHover();stopPositionAnimation(true);stopTransition();closeMenus();
        const rect=host.getBoundingClientRect();drag={id:event.pointerId,pointerType:event.pointerType,mover,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,moved:false};host.dataset.dragging='pending';
        if(event.pointerType==='mouse')event.preventDefault();event.stopPropagation();
      });
      listen(mover,'lostpointercapture',event=>{if(drag?.id===event.pointerId)finishDrag(event,true);});
      listen(mover,'keydown',event=>{
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();hoverPointer=false;clearVisualHover(true);clearHover();stopPositionAnimation(true);
        if(event.key==='Home'){sharedAnchor=null;manualPosition=false;snapped={x:null,y:null};preference='bottomRight';lastPlacement=null;place(false);}
        else{const rect=host.getBoundingClientRect(),step=event.shiftKey?32:8;moveTo({x:rect.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),y:rect.y+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0)});captureAnchor(host.getBoundingClientRect(),true);}
        persistPlacement();
      });
    }
    listen(document,'pointermove',event=>{
      if(!drag||drag.id!==event.pointerId)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(!drag.moved&&Math.hypot(dx,dy)<5)return;
      if(!drag.moved){drag.moved=true;drag.mover.setPointerCapture(event.pointerId);host.dataset.dragging='true';}
      event.preventDefault();moveTo({x:drag.left+dx,y:drag.top+dy});showSnapHint(host.getBoundingClientRect());
    },{passive:false});
    listen(document,'pointerup',event=>finishDrag(event));listen(document,'pointercancel',event=>finishDrag(event,true));
    resizeObserver = typeof scope.ResizeObserver === 'function' ? new scope.ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        if (entry.target !== host) { changed = true; continue; }
        const next = Math.round(entry.contentRect.width) + ':' + Math.round(entry.contentRect.height);
        if (next !== hostSize) { hostSize = next; changed = true; }
      }
      if (changed) queueLayout();
    }) : null;
    resizeObserver?.observe(host); resizeObserver?.observe(shared.getViewportMarker(scope));
    playerObserver = new scope.MutationObserver(queueLayout);
  }
  function syncLifecycle() {
    if (suspended) return;
    const next = routeKey();
    if (!next) {
      if (mounted) {
        setExpanded(false, { animate: false, relayout: false }); conceal('unsupported-page');
        mounted = false; unsubscribe?.(); unsubscribe = null; host.remove();
        playerObserver?.disconnect(); resizeObserver?.disconnect(); observedRegions.clear();
      }
      route = ''; generation = null; lastPlacement = null; return;
    }
    const changed = route !== next; route = next;
    if (!host) createSurface();
    if (!mounted) {
      mounted = true; current.config=runtime.getConfig();phase=minimumPhase();expanded=false; finishFold(); document.documentElement.appendChild(host);
      resizeObserver?.observe(host); resizeObserver?.observe(shared.getViewportMarker(scope)); unsubscribe = runtime.subscribe(queueRender);
    }
    if (changed) {
      generation = null; lastPlacement = null; setExpanded(false, { animate: false, relayout: false });
      render(); queueLayout();
    }
  }
  const api = {
    resetPosition() {
      if(drag)finishDrag(null,true);stopPositionAnimation(false);hideSnapHint();sharedAnchor=null;manualPosition=false;snapped={x:null,y:null};preference='bottomRight';lastPlacement=null;
      persistPlacement();if(mounted)place(true);return true;
    },
    open() { syncLifecycle(); if (mounted) { place(true); if (!host.hidden) setExpanded(true, { focus: true }); } },
    collapse() { setPhase(phase==='panel'?'preview':minimumPhase(), { focus:true }); },
    refresh() { syncLifecycle(); queueRender(); queueLayout(); },
    destroy() {
      suspended = true; mounted = false; unsubscribe?.(); clearHover(); clearVisualHover(true); stopTransition(); choice?.destroy();
      if (frame !== null) scope.cancelAnimationFrame(frame);
      if (layoutFrame !== null) scope.cancelAnimationFrame(layoutFrame);
      domObserver?.disconnect(); playerObserver?.disconnect(); resizeObserver?.disconnect();
      for (const remove of cleanups.splice(0)) remove();
      for (const pending of opening.values()) { scope.clearTimeout(pending.timer); pending.reject(new Error('surface-closed')); }
      opening.clear(); stopPositionAnimation(false);hideSnapHint();snapHint?.remove();entryDisplay?.destroy();previewSignal?.destroy();panelSignal?.destroy();host?.remove();
      if (scope.BiliSmoothFloating === api) delete scope.BiliSmoothFloating;
    }
  };
  scope.BiliSmoothFloating = api;
  listen(document, 'keydown', event => {
    if (event.key !== 'Escape' || !mounted || host.hidden || phase === 'edge' || shadow.activeElement || choice?.isOpen) return;
    event.preventDefault(); event.stopPropagation();
    if (phase === 'panel') setPhase('preview');
    else { previewDismissed = true; setPhase('edge'); }
  }, true);
  listen(document, 'fullscreenchange', () => { syncLifecycle(); if (mounted) place(true); });
  listen(document, 'pointerdown', event => {
    if (mounted && !drag && phase !== minimumPhase() && !event.composedPath().includes(host)) {
      pointerInside = false; previewDismissed = true;
      setPhase('edge');
    }
  }, true);
  listen(scope, 'resize', queueLayout);
  if (scope.visualViewport) {
    listen(scope.visualViewport, 'resize', queueLayout);
    listen(scope.visualViewport, 'scroll', queueLayout);
  }
  listen(scope, 'scroll', queueLayout, { passive: true, capture: true });
  listen(darkQuery, 'change', queueRender); listen(reduceQuery, 'change', syncMotion);
  listen(document, 'visibilitychange', () => {
    if (document.hidden) conceal('document-hidden');
    else { syncLifecycle(); queueRender(); queueLayout(); }
  });
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
    if (message?.__bilismoothFloating === 'motion') { motion = message.value !== false; syncMotion(); }
    if (message?.__bilismoothFloating === 'opened') {
      const pending = opening.get(message.id); if (!pending) return;
      scope.clearTimeout(pending.timer); opening.delete(message.id);
      message.ok ? pending.resolve() : pending.reject(new Error('open-control-failed'));
    }
  });
  listen(scope, 'pagehide', () => {
    suspended = true; conceal('page-hidden'); unsubscribe?.(); unsubscribe = null;
    if (frame !== null) scope.cancelAnimationFrame(frame); frame = null;
    if (layoutFrame !== null) scope.cancelAnimationFrame(layoutFrame); layoutFrame = null;
  });
  listen(scope, 'pageshow', event => {
    if (!event.persisted) return;
    suspended = false; if (mounted) { unsubscribe = runtime.subscribe(queueRender); setExpanded(false, { animate: false, relayout: false }); }
    syncLifecycle(); queueRender(); queueLayout();
  });
  function boot() {
    if (domObserver) return;
    domObserver = new scope.MutationObserver(records => {
      if (routeKey() !== route) { syncLifecycle(); queueLayout(); return; }
      if (!mounted) return;
      for (const record of records) {
        if (record.target === host || host.contains(record.target)) continue;
        if (record.type === 'attributes') {
          if (observedRegions.has(record.target) || record.target.matches(protectedSelector + ',' + interactiveSelector)) { queueLayout(); return; }
          continue;
        }
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (nodes.some(node => node.nodeType === 1 && node !== host && (node.matches(protectedSelector + ',' + interactiveSelector) || node.querySelector(protectedSelector + ',' + interactiveSelector)))) { queueLayout(); return; }
      }
    });
    domObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
    syncLifecycle(); queueLayout();
    scope.postMessage({ __bilismoothFloating: 'ready' }, scope.location.origin);
  }
  if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', boot, { once: true }); else boot();
})(globalThis);
