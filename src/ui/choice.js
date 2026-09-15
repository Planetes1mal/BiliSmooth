/* Shared, framework-free choices. All content stays in its document or ShadowRoot. */
(function (scope) {
  'use strict';
  let nextId = 0;
  const instances = new Set();
  const styles = `
  .bs-choice{display:inline-flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-width:0;min-height:36px;padding:7px 11px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:500 13px/20px var(--font);text-align:left;cursor:pointer;transition:border-color 110ms,background-color 110ms,transform 110ms}
  .bs-choice:hover:not(:disabled),.bs-choice[aria-expanded=true]{border-color:var(--accent);background:var(--surface-soft)}
  .bs-choice:active:not(:disabled){transform:scale(.99)}.bs-choice:focus-visible{outline:2px solid var(--accent-strong);outline-offset:3px}.bs-choice:disabled{opacity:.5;cursor:not-allowed}.bs-choice-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bs-choice-arrow{width:7px;height:7px;flex:none;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(45deg);margin:-4px 2px 0;transition:transform 150ms}.bs-choice[aria-expanded=true] .bs-choice-arrow{transform:translateY(3px) rotate(225deg)}
  .bs-choice[aria-busy=true] .bs-choice-arrow{border-radius:50%;width:12px;height:12px;border:2px solid var(--line);border-top-color:var(--accent);animation:bs-choice-wait 800ms linear infinite}
  .bs-choice-layer{position:fixed;inset:auto;margin:0;padding:5px;z-index:2147483600;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:13px/20px var(--font);box-shadow:var(--shadow-float);overflow:hidden;box-sizing:border-box;max-width:calc(100vw - 16px)}
  .bs-choice-search{display:block;width:100%;min-width:0;min-height:36px;padding:8px 10px;margin:0 0 4px;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--ink);font:13px/20px var(--font);outline-offset:-2px}
  .bs-choice-list{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;max-height:280px;outline:none}.bs-choice-option{position:relative;padding:8px 30px 8px 10px;min-height:36px;border-radius:5px;cursor:pointer;outline:none;overflow-wrap:anywhere;scroll-margin:4px;transition:background-color 110ms,color 110ms}.bs-choice-option[data-active=true]{background:var(--surface-hover)}.bs-choice-option:active:not([aria-disabled=true]){background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent)}.bs-choice-option[aria-selected=true]{color:var(--accent-strong);background:var(--accent-soft)}.bs-choice-option[aria-selected=true]::after{content:'✓';position:absolute;right:10px;top:8px;font-size:14px;font-weight:600}.bs-choice-option[aria-disabled=true]{opacity:.45;cursor:not-allowed}.bs-choice-option strong{display:block;font-size:13px;font-weight:500}.bs-choice-option small{display:block;color:var(--muted);font-size:12px;line-height:18px;margin-top:2px}.bs-choice-group{padding:8px 10px 4px;font-size:12px;color:var(--muted)}.bs-choice-empty{padding:16px 10px;color:var(--muted);font-size:13px}.bs-choice-announcement{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
  @keyframes bs-choice-wait{to{transform:rotate(360deg)}}
  @media(pointer:coarse){.bs-choice,.bs-choice-option,.bs-choice-search{min-height:44px}}
  @media(prefers-reduced-motion:reduce){.bs-choice,.bs-choice *,.bs-choice-layer *{animation:none!important;transition:none!important}}
  `;
  function mount(root) {
    const document = root.ownerDocument || root, target = root.head || root;
    if (target.querySelector('style[data-bilismooth-choice]')) return;
    const style = document.createElement('style'); style.dataset.bilismoothChoice = 'true'; style.textContent = styles; target.append(style);
  }
  function create(config) {
    const trigger = config.trigger, root = config.root || trigger.getRootNode(), document = trigger.ownerDocument;
    const view = document.defaultView, editable = trigger.tagName === 'INPUT', reducedQuery = view.matchMedia('(prefers-reduced-motion:reduce)');
    if (!trigger) throw new TypeError('A choice needs a trigger');
    mount(root);
    let options = [], filtered = [], active = -1, value = String(config.value ?? ''), open = false, pending = false, disabled = false, composing = false, destroyed = false, query = '', optionsKey = '', serial = 0, animationSerial = 0, animation = null, typeahead = '', typeTimer;
    const id = 'bs-choice-' + (++nextId), layer = document.createElement('div'), list = document.createElement('div'), status = document.createElement('span');
    layer.className = 'bs-choice-layer'; layer.hidden = true; layer.id = id; layer.setAttribute('popover', 'manual');
    list.className = 'bs-choice-list'; list.id = id + '-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', config.label || '');
    status.className = 'bs-choice-announcement'; status.setAttribute('role', 'status');
    let search = editable ? trigger : null, labelNode = null;
    if (config.searchable && !editable) { search = document.createElement('input'); search.className = 'bs-choice-search'; search.type = 'search'; search.autocomplete = 'off'; search.spellcheck = false; search.setAttribute('aria-label', config.label || ''); search.placeholder = config.placeholder || ''; layer.append(search); }
    if (!editable) { trigger.type = 'button'; trigger.classList.add('bs-choice'); labelNode = document.createElement('span'); labelNode.className = 'bs-choice-label'; const arrow = document.createElement('span'); arrow.className = 'bs-choice-arrow'; arrow.setAttribute('aria-hidden', 'true'); trigger.replaceChildren(labelNode, arrow); }
    const focusNode = search || trigger;
    focusNode.setAttribute('role', 'combobox'); focusNode.setAttribute('aria-controls', list.id); focusNode.setAttribute('aria-expanded', 'false'); focusNode.setAttribute('aria-haspopup', 'listbox');
    if (search) focusNode.setAttribute('aria-autocomplete', 'list');
    trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); if (config.label) trigger.setAttribute('aria-label', config.label);
    layer.append(list, status); (root.body || root).append(layer);
    const disposers = [];
    function listen(node, name, handler, opts) { node.addEventListener(name, handler, opts); disposers.push(() => node.removeEventListener(name, handler, opts)); }
    function reduced() { const host = root.host || document.documentElement; return host.dataset.motion === 'off' || reducedQuery.matches; }
    function paint() { if (!editable) { labelNode.textContent = options.find(row => row.value === value)?.label || value || config.placeholder || ''; trigger.value = value; } else if (!open && root.activeElement !== trigger) trigger.value = value; trigger.setAttribute('aria-busy', String(pending)); trigger.disabled = disabled || pending; }
    function setValue(next) { value = String(next ?? ''); paint(); if (open) for (const node of list.querySelectorAll('[role=option]')) node.setAttribute('aria-selected', String(node.dataset.value === value)); }
    function setOptions(rows) { const next = (rows || []).map(row => typeof row === 'string' ? { value: row, label: row } : { ...row, value: String(row.value), label: String(row.label ?? row.value) }); const key = JSON.stringify(next); if (key === optionsKey) return; optionsKey = key; options = next; paint(); if (open) render(true); }
    function setActive(index, reveal = true) { active = index; const nodes = [...list.querySelectorAll('[role=option]')]; nodes.forEach((node, i) => node.dataset.active = String(i === index)); if (nodes[index]) { focusNode.setAttribute('aria-activedescendant', nodes[index].id); if (reveal) nodes[index].scrollIntoView({ block: 'nearest' }); } else focusNode.removeAttribute('aria-activedescendant'); }
    function render(preserveScroll = false) {
      const scrollTop = list.scrollTop, activeValue = filtered[active]?.value, term = query.trim().toLocaleLowerCase();
      filtered = options.filter(row => !term || (row.label + ' ' + row.value + ' ' + (row.description || '')).toLocaleLowerCase().includes(term));
      list.replaceChildren(); let lastGroup = null;
      filtered.forEach((row, index) => { if (row.group && row.group !== lastGroup) { const heading = document.createElement('div'); heading.className = 'bs-choice-group'; heading.textContent = row.group; heading.setAttribute('role', 'presentation'); list.append(heading); lastGroup = row.group; } const node = document.createElement('div'); node.className = 'bs-choice-option'; node.id = id + '-' + index; node.dataset.value = row.value; node.setAttribute('role', 'option'); node.setAttribute('aria-selected', String(row.value === value)); node.setAttribute('aria-disabled', String(!!row.disabled)); const title = document.createElement('strong'); title.textContent = row.label; node.append(title); if (row.description) { const detail = document.createElement('small'); detail.textContent = row.description; node.append(detail); } node.addEventListener('pointermove', () => { if (!row.disabled) setActive(index); }); node.addEventListener('pointerdown', event => event.preventDefault()); node.addEventListener('click', () => { if (!row.disabled) commit(row.value); }); list.append(node); });
      if (!filtered.length) { const empty = document.createElement('div'); empty.className = 'bs-choice-empty'; empty.textContent = config.emptyText || 'No matching options'; list.append(empty); }
      const index = filtered.findIndex(row => row.value === activeValue && !row.disabled), selected = filtered.findIndex(row => row.value === value && !row.disabled);
      setActive(index >= 0 ? index : selected >= 0 ? selected : filtered.findIndex(row => !row.disabled), !preserveScroll); position(); if (preserveScroll) list.scrollTop = scrollTop;
    }
    function position() {
      if (!open || !trigger.isConnected) return;
      const rect = trigger.getBoundingClientRect(), bounds = scope.BiliSmoothSurfaceStyles.viewport(view);
      const { scaleX, scaleY, originX, originY } = bounds, insetX = 8 * scaleX, insetY = 8 * scaleY, gap = 6 * scaleY;
      const targetWidth = Math.max(0, Math.min(bounds.width - 2 * insetX, Number(config.maxWidth) || Infinity, Math.max(rect.width, (config.searchable ? 260 : 180) * scaleX)));
      layer.style.width = layer.style.maxWidth = targetWidth / scaleX + 'px';
      const below = bounds.bottom - insetY - rect.bottom - gap, above = rect.top - bounds.top - insetY - gap;
      const side = below >= Math.min(layer.scrollHeight * scaleY, 230 * scaleY) || below >= above ? 'bottom' : 'top';
      const available = Math.max(0, Math.min(bounds.height - 2 * insetY, Math.max(72 * scaleY, side === 'bottom' ? below : above)));
      layer.style.maxHeight = available / scaleY + 'px';
      list.style.maxHeight = Math.min(280, Math.max(0, available / scaleY - (search && !editable ? 49 : 12))) + 'px';
      const measured = layer.getBoundingClientRect();
      const left = Math.max(bounds.left + insetX, Math.min(rect.left, bounds.right - measured.width - insetX));
      const desiredTop = side === 'bottom' ? rect.bottom + gap : rect.top - measured.height - gap;
      const top = Math.max(bounds.top + insetY, Math.min(desiredTop, bounds.bottom - measured.height - insetY));
      layer.style.left = (left - originX) / scaleX + 'px';
      layer.style.top = (top - originY) / scaleY + 'px'; layer.dataset.side = side;
    }
    const closedTransform = () => 'translateY(' + (layer.dataset.side === 'top' ? 3 : -3) + 'px)';
    function hideLayer() { try { layer.hidePopover?.(); } catch {} layer.hidden = true; }
    function settleLayer() {
      ++animationSerial; animation?.cancel(); animation = null;
      layer.style.opacity = open ? '1' : '0';
      layer.style.transform = open ? 'translateY(0px)' : closedTransform();
      if (!open) hideLayer();
    }
    function syncMotion() { if (!destroyed && (reduced() || document.hidden)) settleLayer(); }
    function animateLayer(enter, finish) {
      const request = ++animationSerial, computed = view.getComputedStyle(layer);
      const fromOpacity = Number(computed.opacity), fromTransform = computed.transform === 'none' ? 'translateY(0px)' : computed.transform;
      animation?.stop(); animation = null;
      const target = enter ? 'translateY(0px)' : closedTransform();
      if (reduced() || document.hidden || !scope.BiliSmoothMotion) { layer.style.opacity = enter ? '1' : '0'; layer.style.transform = target; finish?.(); return; }
      animation = scope.BiliSmoothMotion.animate(layer, { opacity: [fromOpacity, enter ? 1 : 0], transform: [fromTransform, target] }, { duration: enter ? .15 : .11, ease: [.2, .8, .2, 1] });
      animation.then(() => { if (request !== animationSerial || destroyed) return; animation = null; finish?.(); });
    }
    function show() {
      if (open || pending || disabled || destroyed) return;
      for (const item of instances) if (item !== api) item.close(false);
      const wasVisible = !layer.hidden;
      open = true; query = editable ? trigger.value : ''; if (search && !editable) search.value = ''; layer.hidden = false; layer.dataset.state = 'open'; layer.removeAttribute('aria-hidden'); layer.style.pointerEvents = '';
      try { layer.showPopover?.(); } catch { /* The same popover may be reversing its exit. */ }
      trigger.setAttribute('aria-expanded', 'true'); focusNode.setAttribute('aria-expanded', 'true'); render();
      if (!wasVisible) { layer.style.opacity = '0'; layer.style.transform = 'translateY(' + (layer.dataset.side === 'top' ? 3 : -3) + 'px)'; }
      search?.focus({ preventScroll: true }); animateLayer(true);
    }
    function close(restoreFocus = false, immediate = false) {
      if (!open && layer.hidden) return; open = false; layer.dataset.state = 'closed'; layer.setAttribute('aria-hidden', 'true');
      trigger.setAttribute('aria-expanded', 'false'); focusNode.setAttribute('aria-expanded', 'false'); focusNode.removeAttribute('aria-activedescendant'); layer.style.pointerEvents = 'none';
      if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
      if (immediate) settleLayer(); else animateLayer(false, hideLayer);
    }
    async function commit(next) {
      if (pending || disabled || destroyed) return;
      const request = ++serial; close(true); if (editable) trigger.value = next; pending = true; paint();
      try { const result = await config.onCommit?.(next); if (result === false) throw Error('choice-not-saved'); if (request !== serial || destroyed) return; value = next; if (editable) trigger.value = next; }
      catch (error) { if (request !== serial || destroyed) return; if (editable && !config.allowCustom) trigger.value = value; trigger.dispatchEvent(new view.CustomEvent('choice-error', { detail: error, bubbles: true, composed: true })); }
      finally { if (request === serial && !destroyed) { pending = false; paint(); } }
    }
    function move(direction) { if (!open) show(); if (!filtered.some(row => !row.disabled)) return; let index = active; for (let i = 0; i < filtered.length; i++) { index = (index + direction + filtered.length) % filtered.length; if (!filtered[index].disabled) { setActive(index); break; } } }
    function keydown(event) {
      if (composing || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); return; }
      if (event.key === 'Tab') { close(false); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const wasOpen = open; if (!open) show(); if (wasOpen) move(event.key === 'ArrowDown' ? 1 : -1); return; }
      if (event.key === 'Enter' || event.key === ' ' && !search) { if (editable && !open) return; event.preventDefault(); if (!open) show(); else if (filtered[active] && !filtered[active].disabled) commit(filtered[active].value); else if (editable && config.allowCustom) close(false); return; }
      if (!search && open && (event.key === 'Home' || event.key === 'End')) { event.preventDefault(); const enabled = filtered.map((row, index) => !row.disabled ? index : -1).filter(index => index >= 0); setActive(event.key === 'Home' ? enabled[0] : enabled.at(-1)); return; }
      if (!search && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); show(); clearTimeout(typeTimer); typeahead += event.key.toLocaleLowerCase(); const index = filtered.findIndex(row => !row.disabled && row.label.toLocaleLowerCase().startsWith(typeahead)); if (index >= 0) setActive(index); typeTimer = view.setTimeout(() => typeahead = '', 600); }
    }
    listen(trigger, 'click', () => open && !editable ? close(false) : show());
    listen(trigger, 'keydown', keydown);
    if (search) { if (search !== trigger) listen(search, 'keydown', keydown); listen(search, 'compositionstart', () => composing = true); listen(search, 'compositionend', () => { composing = false; query = search.value; if (!open) show(); render(); }); listen(search, 'input', () => { query = search.value; if (!open) show(); if (!composing) { active = -1; render(); } }); }
    listen(document, 'pointerdown', event => { if (open && !event.composedPath().includes(layer) && !event.composedPath().includes(trigger)) close(false); }, true);
    listen(document, 'focusin', event => { if (open && !event.composedPath().includes(layer) && !event.composedPath().includes(trigger)) close(false); });
    listen(view, 'resize', position); listen(document, 'scroll', event => { if (open && !event.composedPath().includes(layer)) position(); }, true);
    listen(document, 'visibilitychange', () => { if (document.hidden) close(false, true); }); listen(document, 'fullscreenchange', () => close(false, true));
    listen(reducedQuery, 'change', syncMotion);
    if (view.visualViewport) { listen(view.visualViewport, 'resize', position); listen(view.visualViewport, 'scroll', position); }
    if (view.ResizeObserver) {
      const observer = new view.ResizeObserver(position);
      observer.observe(scope.BiliSmoothSurfaceStyles.getViewportMarker(view));
      disposers.push(() => observer.disconnect());
    }
    const api = { setValue, setOptions, syncMotion, setDisabled(value) { disabled = !!value; if (disabled) close(false); paint(); }, setLabels(labels) { if (Object.entries(labels).every(([key, value]) => config[key] === value)) return; Object.assign(config, labels); if (labels.label) { trigger.setAttribute('aria-label', labels.label); list.setAttribute('aria-label', labels.label); search?.setAttribute('aria-label', labels.label); } if (search && !editable) search.placeholder = config.placeholder || ''; paint(); if (open) render(true); }, close, open: show, get value() { return value; }, get isOpen() { return open; }, destroy() { if (destroyed) return; destroyed = true; serial++; close(false, true); settleLayer(); clearTimeout(typeTimer); disposers.forEach(dispose => dispose()); layer.remove(); instances.delete(api); } };
    instances.add(api); setOptions(config.options || []); setValue(value); return api;
  }
  scope.BiliSmoothChoice = Object.freeze({ create, mount, styles, syncMotion: () => { for (const instance of instances) instance.syncMotion(); }, closeAll: () => { for (const instance of instances) instance.close(false); } });
})(globalThis);
