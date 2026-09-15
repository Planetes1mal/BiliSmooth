/* Shared, telemetry-backed entry faces and playback signals. No demonstration data. */
(function (scope) {
  'use strict';
  const shared = scope.BiliSmoothSurfaceStyles;
  const types = Object.freeze(['status-logo', 'logo', 'status', 'speed', 'buffer', 'combined', 'route', 'rate', 'resolution']);
  const paths = Object.freeze(['M11 4H31V11H14L7 18H0V15L11 4Z', 'M11 14H24L31 21H18L11 14Z', 'M5 25H22L29 18H36V21L25 32H5V25Z']);
  const labels = Object.freeze({
    smooth: ['播放顺畅', 'Smooth'], playing: ['播放中', 'Playing'], buffering: ['缓冲中', 'Buffering'],
    frozen: ['画面卡顿', 'Stalled'], paused: ['已暂停', 'Paused'], waiting: ['待检测', 'Waiting'],
    disconnected: ['未连接', 'Offline'], seeking: ['跳转中', 'Seeking'], ended: ['已结束', 'Ended'], error: ['播放错误', 'Error']
  });
  const css = `
  .bs-entry-face{--entry-width:54px;--entry-tone:var(--entry-ink);display:flex;position:relative;align-items:center;justify-content:center;gap:8px;width:var(--entry-width);height:54px;box-sizing:border-box;color:var(--entry-tone);flex:none;font-family:var(--font);font-variant-numeric:tabular-nums;line-height:1.15;pointer-events:none}
  .bs-entry-face *,.bs-status-signal *{box-sizing:border-box}
  .bs-entry-face[data-entry-type=status]{--entry-width:82px;flex-direction:column;gap:4px}
  .bs-entry-face:is([data-entry-type=speed],[data-entry-type=buffer]){--entry-width:86px}
  .bs-entry-face[data-entry-type=combined]{--entry-width:150px;gap:12px}
  .bs-entry-face[data-entry-type=route]{--entry-width:120px}
  .bs-entry-face[data-entry-type=rate]{--entry-width:96px}
  .bs-entry-face[data-entry-type=resolution]{--entry-width:96px}
  .bs-entry-logo{display:block;width:28px;height:28px;overflow:visible;fill:currentColor;flex:none}
  .bs-entry-logo-flow,.bs-entry-logo-piece{transform-box:fill-box;transform-origin:center}
  [data-entry-type=status-logo][data-entry-state=smooth]{--entry-tone:var(--success)}
  [data-entry-type=status-logo][data-entry-state=smooth] .bs-entry-logo-piece-0{animation:bs-entry-flow-top 1.8s cubic-bezier(.45,0,.25,1) infinite}
  [data-entry-type=status-logo][data-entry-state=smooth] .bs-entry-logo-piece-2{animation:bs-entry-flow-bottom 1.8s cubic-bezier(.45,0,.25,1) infinite}
  [data-entry-type=status-logo]:is([data-entry-state=buffering],[data-entry-state=seeking]){--entry-tone:var(--warning)}
  [data-entry-type=status-logo]:is([data-entry-state=buffering],[data-entry-state=seeking]) .bs-entry-logo-piece-0{animation:bs-entry-open-top 1.5s cubic-bezier(.4,0,.25,1) infinite}
  [data-entry-type=status-logo]:is([data-entry-state=buffering],[data-entry-state=seeking]) .bs-entry-logo-piece-2{animation:bs-entry-open-bottom 1.5s cubic-bezier(.4,0,.25,1) infinite}
  [data-entry-type=status-logo]:is([data-entry-state=frozen],[data-entry-state=error]){--entry-tone:var(--error)}
  [data-entry-type=status-logo][data-entry-state=frozen] .bs-entry-logo-flow{animation:bs-entry-resist 2.2s cubic-bezier(.2,.75,.3,1) infinite}
  [data-entry-type=status-logo]:is([data-entry-state=frozen],[data-entry-state=error]) .bs-entry-logo-piece-1{transform:translateX(4px)}
  .bs-entry-logo-pause{display:none}
  [data-entry-type=status-logo][data-entry-state=paused] .bs-entry-logo-piece-1{display:none}
  [data-entry-type=status-logo][data-entry-state=paused] .bs-entry-logo-pause{display:block}
  [data-entry-type=status-logo]:is([data-entry-state=ended],[data-entry-state=playing],[data-entry-state=waiting],[data-entry-state=disconnected]){--entry-tone:var(--entry-muted)}
  [data-entry-type=status-logo]:is([data-entry-state=waiting],[data-entry-state=disconnected],[data-entry-state=playing]) .bs-entry-logo{fill:none;stroke:currentColor;stroke-width:1.8;stroke-dasharray:3 1.5}
  .bs-entry-metric{display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0;max-width:100%;gap:4px;padding:0 5px}
  .bs-entry-number{display:block;max-width:100%;font-size:19px;font-weight:670;letter-spacing:-.65px;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .bs-entry-unit,.bs-entry-status-label{font-size:12px;font-weight:600;letter-spacing:.02em;line-height:1.15;white-space:nowrap;color:var(--entry-muted)}
  .bs-entry-metric-route{width:100%;padding-inline:10px}
  .bs-entry-metric-route .bs-entry-number{font-size:12px;letter-spacing:0;font-weight:650}
  .bs-entry-metric-resolution .bs-entry-number{font-size:18px}
  [data-entry-type=combined] .bs-entry-metric{width:57px;padding:0}
  [data-entry-type=combined] .bs-entry-number{font-size:17px}
  .bs-entry-divider{height:22px;width:1px;flex:none;background:currentColor;opacity:.18}
  .bs-entry-face .bs-status-signal{--bs-status-width:50px;--bs-status-height:21px}
  .bs-entry-face .bs-status-frame{height:10px}
  .bs-status-signal{--bs-status-color:var(--muted);display:inline-block;position:relative;width:var(--bs-status-width,64px);height:var(--bs-status-height,32px);flex:0 0 auto;overflow:hidden;vertical-align:middle;color:var(--bs-status-color);isolation:isolate;pointer-events:none}
  .bs-status-path{position:absolute;inset:50% 4px auto;height:1px;margin-top:-.5px;background:currentColor;opacity:.24}
  .bs-status-track{position:absolute;inset:0 4px;overflow:hidden}
  .bs-status-sequence{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));align-items:center;width:200%;height:100%}
  .bs-status-frame{display:block;height:12px;margin-inline:1px 3px;border:1px solid currentColor;border-radius:2px;background:currentColor;opacity:1}
  .bs-status-gate{position:absolute;display:none;top:calc(50% - 9px);left:49%;width:2px;height:18px;background:currentColor;border-radius:1px}
  .bs-status-signal[data-playback=smooth]{--bs-status-color:var(--success)}
  .bs-status-signal[data-playback=smooth] .bs-status-sequence{animation:bs-status-flow 1.8s linear infinite}
  .bs-status-signal[data-playback=smooth] .bs-status-frame:nth-child(5n + 1){opacity:.85}
  .bs-status-signal[data-playback=smooth] .bs-status-frame:nth-child(5n + 2){opacity:.9}
  .bs-status-signal[data-playback=smooth] .bs-status-frame:nth-child(5n + 3){opacity:.95}
  .bs-status-signal[data-playback=smooth] .bs-status-frame:nth-child(5n + 4){opacity:1}
  .bs-status-signal:is([data-playback=buffering],[data-playback=seeking]){--bs-status-color:var(--warning)}
  .bs-status-signal:is([data-playback=buffering],[data-playback=seeking]) .bs-status-sequence{animation:bs-status-queue 2.9s cubic-bezier(.12,.75,.2,1) infinite}
  .bs-status-signal:is([data-playback=buffering],[data-playback=seeking]) .bs-status-frame:is(:nth-child(5n + 4),:nth-child(5n)){background:transparent;opacity:.38}
  .bs-status-signal:is([data-playback=buffering],[data-playback=seeking]) .bs-status-path{background:repeating-linear-gradient(to right,currentColor 0 3px,transparent 3px 6px);opacity:.32}
  .bs-status-signal:is([data-playback=frozen],[data-playback=error]){--bs-status-color:var(--error)}
  .bs-status-signal[data-playback=frozen] .bs-status-frame:is(:nth-child(1),:nth-child(2)){animation:bs-status-obstruction 3.4s ease-in-out infinite;opacity:.9}
  .bs-status-signal:is([data-playback=frozen],[data-playback=error]) .bs-status-frame:nth-child(5n + 3){visibility:hidden}
  .bs-status-signal:is([data-playback=frozen],[data-playback=error]) .bs-status-frame:is(:nth-child(5n + 4),:nth-child(5n)){background:transparent;height:9px;opacity:.32}
  .bs-status-signal:is([data-playback=frozen],[data-playback=error]) .bs-status-path{background:linear-gradient(to right,currentColor 0 35%,transparent 35% 66%,currentColor 66% 100%)}
  .bs-status-signal:is([data-playback=frozen],[data-playback=error]) .bs-status-gate{display:block;opacity:.8}
  .bs-status-signal:is([data-playback=paused],[data-playback=ended]) .bs-status-frame{height:6px;border-radius:1px;opacity:1}
  .bs-status-signal:is([data-playback=paused],[data-playback=ended]) .bs-status-path{opacity:.16}
  .bs-status-signal:is([data-playback=waiting],[data-playback=disconnected]) .bs-status-frame{background:transparent;border-style:dashed;border-radius:2px;opacity:1}
  .bs-status-signal:is([data-playback=waiting],[data-playback=disconnected]) .bs-status-path{background:repeating-linear-gradient(to right,currentColor 0 2px,transparent 2px 5px);opacity:.2}
  .bs-status-signal[data-playback=playing] .bs-status-frame{background:transparent;opacity:1}
  .bs-entry-face .bs-status-signal:is([data-playback=paused],[data-playback=ended],[data-playback=waiting],[data-playback=disconnected],[data-playback=playing]){--bs-status-color:var(--entry-muted)}
  @keyframes bs-entry-flow-top{0%,100%{transform:translateX(-3px)}50%{transform:translateX(3px)}}
  @keyframes bs-entry-flow-bottom{0%,100%{transform:translateX(3px)}50%{transform:translateX(-3px)}}
  @keyframes bs-entry-open-top{0%,20%,100%{transform:translateY(0)}50%,72%{transform:translateY(-4.5px)}}
  @keyframes bs-entry-open-bottom{0%,20%,100%{transform:translateY(0)}50%,72%{transform:translateY(4.5px)}}
  @keyframes bs-entry-resist{0%,24%,100%{transform:translateX(0)}5%,15%{transform:translateX(3px)}10%,20%{transform:translateX(-2px)}}
  @keyframes bs-status-flow{from{transform:translateX(0)}to{transform:translateX(-50%)}}
  @keyframes bs-status-queue{0%,12%{transform:translateX(0)}36%,73%{transform:translateX(3px)}88%,100%{transform:translateX(0)}}
  @keyframes bs-status-obstruction{0%,70%,100%{transform:translateX(0)}76%,82%{transform:translateX(1.4px)}90%{transform:translateX(0)}}
  .bs-entry-face[data-entry-motion=off] *,.bs-status-signal[data-motion=off] *{animation:none!important;transition:none!important;transform:none!important}
  @media(prefers-reduced-motion:reduce){.bs-entry-face *,.bs-status-signal *{animation:none!important;transition:none!important;transform:none!important}}
  `;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const localized = (pair, lang) => pair[lang === 'en' || lang?.startsWith('en-') ? 1 : 0];
  const label = (state, lang) => localized(labels[state] || labels.waiting, lang);
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  function node(document, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function logo(document = scope.document) {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36'); svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('bs-entry-logo');
    const group = document.createElementNS(namespace, 'g'); group.classList.add('bs-entry-logo-flow');
    paths.forEach((d, index) => {
      const path = document.createElementNS(namespace, 'path'); path.setAttribute('d', d);
      path.classList.add('bs-entry-logo-piece', 'bs-entry-logo-piece-' + index); group.append(path);
    });
    const pause = document.createElementNS(namespace, 'path'); pause.classList.add('bs-entry-logo-pause');
    pause.setAttribute('d', 'M12 13H16V23H12Z M21 13H25V23H21Z'); group.append(pause);
    svg.append(group); return svg;
  }
  function signal(document) {
    const element = node(document, 'span', 'bs-status-signal');
    const track = node(document, 'span', 'bs-status-track'), sequence = node(document, 'span', 'bs-status-sequence');
    for (let index = 0; index < 10; index++) sequence.append(node(document, 'i', 'bs-status-frame'));
    track.append(sequence); element.append(node(document, 'span', 'bs-status-path'), track, node(document, 'span', 'bs-status-gate'));
    return element;
  }
  function metric(document, kind) {
    const field = node(document, 'span', 'bs-entry-metric bs-entry-metric-' + kind);
    const value = node(document, 'strong', 'bs-entry-number', '—'), unit = node(document, 'small', 'bs-entry-unit');
    field.append(value, unit); return { field, value, unit };
  }
  function mount(root) {
    const document = root.ownerDocument || root, target = root.head || root;
    if (target.querySelector('style[data-bilismooth-entry]')) return;
    const style = document.createElement('style'); style.dataset.bilismoothEntry = 'true'; style.textContent = css; target.append(style);
  }
  function createDisplay(host, initial, statusOnly) {
    const document = host.ownerDocument, view = document.defaultView || scope;
    const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)');
    let options = { type: 'status-logo', lang: 'zh', snapshot: null, connected: true, motion: true, ...initial };
    let item, destroyed = false, inView = true;
    function build(type) {
      const face = statusOnly ? signal(document) : node(document, 'span', 'bs-entry-face');
      face.setAttribute('role', 'img');
      item = { face, type };
      if (statusOnly) item.signal = face;
      else if (type === 'logo' || type === 'status-logo') face.append(logo(document));
      else if (type === 'status') {
        item.signal = signal(document); item.status = node(document, 'small', 'bs-entry-status-label');
        face.append(item.signal, item.status);
      } else if (type === 'combined') {
        item.speed = metric(document, 'speed'); item.buffer = metric(document, 'buffer');
        face.append(item.speed.field, node(document, 'span', 'bs-entry-divider'), item.buffer.field);
      } else { item.metric = metric(document, type); face.append(item.metric.field); }
      for (const child of face.children) child.setAttribute('aria-hidden', 'true');
      host.replaceChildren(face);
    }
    function update(next = {}) {
      if (destroyed) return;
      options = { ...options, ...next };
      const { snapshot, connected, lang } = options;
      const type = types.includes(options.type) ? options.type : 'status-logo';
      if (!item || item.type !== type) build(type);
      const playback = shared.projectPlayback(snapshot, connected), available = connected && !!snapshot?.media?.present;
      const motion = options.motion !== false && !document.hidden && !snapshot?.hidden && !reduced?.matches && inView;
      const statusLabel = label(playback, lang);
      let description = statusLabel;
      if (item.signal) { item.signal.dataset.playback = playback; item.signal.dataset.motion = motion ? 'on' : 'off'; }
      if (statusOnly) { item.face.setAttribute('aria-label', statusLabel); return; }
      item.face.dataset.entryType = type; item.face.dataset.entryState = playback; item.face.dataset.entryMotion = motion ? 'on' : 'off';
      if (item.status) setText(item.status, statusLabel);
      const readSpeed = available && finite(snapshot?.lastMbps) && snapshot.lastMbps >= 0 ? shared.format.speed(snapshot) : { value: '-', unit: 'MB/s' };
      const speed = [readSpeed.value === '-' ? '—' : readSpeed.value, readSpeed.unit];
      const rawBuffer = available ? shared.format.buffer(snapshot) : null;
      const buffer = [finite(rawBuffer) && rawBuffer >= 0 ? rawBuffer.toFixed(1) : '—', localized(['秒可播', 's playable'], lang)];
      const put = (target, values) => { setText(target.value, values[0]); setText(target.unit, values[1]); };
      if (type === 'combined') { put(item.speed, speed); put(item.buffer, buffer); description = speed.join(' ') + ', ' + buffer.join(' '); }
      else if (item.metric) {
        let values, fullRoute;
        if (type === 'speed') values = speed;
        else if (type === 'buffer') values = buffer;
        else if (type === 'route') {
          fullRoute = available && typeof snapshot.actualHost === 'string' && snapshot.actualHost.trim() || '—';
          const name = fullRoute.replace(/^upos-(?:sz-|hz-)?(?:mirror)?/i, '').replace(/\.(?:bilivideo\.(?:com|cn|net)|akamaized\.net)$/i, '').toUpperCase();
          values = [name || fullRoute, localized(['当前线路', 'Current route'], lang)];
        }
        else if (type === 'rate') values = [available && finite(snapshot.rate) && snapshot.rate > 0 ? Number(snapshot.rate.toFixed(2)) + '×' : '—', localized(['播放倍速', 'Playback rate'], lang)];
        else values = [available && finite(snapshot.media.height) && snapshot.media.height > 0 ? Math.round(snapshot.media.height) + 'p' : '—', localized(['视频分辨率', 'Resolution'], lang)];
        put(item.metric, values); description = values.join(' ');
        if (type === 'route') { item.metric.value.title = fullRoute; description = fullRoute + ' ' + values[1]; }
      } else if (type === 'logo') description = 'BiliSmooth';
      item.face.setAttribute('aria-label', description);
    }
    const visibilityChanged = () => update();
    document.addEventListener('visibilitychange', visibilityChanged);
    reduced?.addEventListener('change', visibilityChanged);
    const observer = view.IntersectionObserver ? new view.IntersectionObserver(entries => {
      const visible = entries[0]?.isIntersecting !== false;
      if (visible !== inView) { inView = visible; update(); }
    }) : null;
    observer?.observe(host);
    update();
    return Object.freeze({ update, destroy() {
      if (destroyed) return;
      destroyed = true; observer?.disconnect(); document.removeEventListener('visibilitychange', visibilityChanged);
      reduced?.removeEventListener('change', visibilityChanged); item?.face.remove();
    } });
  }
  scope.BiliSmoothEntryDisplay = Object.freeze({ css, types, mount, logo,
    create: (host, options = {}) => createDisplay(host, options, false),
    createStatus: (host, options = {}) => createDisplay(host, options, true)
  });
})(globalThis);
