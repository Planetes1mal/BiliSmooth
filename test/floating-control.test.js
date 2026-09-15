// Focused real-DOM regression tests. Media and network data remain local fixtures.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs/promises');
const { chromium } = require('playwright');
const { createEvidenceOutput } = require('../scripts/validation-support.cjs');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const output = createEvidenceOutput({ root, suite: 'floating-control', version });
let browser;
before(async () => { await fs.mkdir(output, { recursive: true }); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(options = {}) {
  const { rightWidth = 411, ...contextOptions } = options;
  const context = await browser.newContext({ viewport: { width: 2048, height: 991 }, ...contextOptions });
  await context.route('https://www.bilibili.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html{overflow-y:scroll;scrollbar-gutter:stable}body{margin:0;background:#f6f7f8}.bpx-player-container{position:absolute;left:200px;top:130px;width:1200px;height:675px;background:#18191c}.right-container{position:absolute;left:1424px;top:80px;width:' + rightWidth + 'px;height:1100px;background:#e3e5e7}.recommend-list-v1 a{display:block;height:100px}#outside-action{position:absolute;left:500px;top:20px}</style><button id="outside-action">页面操作</button><div class="bpx-player-container"><div class="bpx-player"><video></video></div></div><aside class="right-container"><div class="video-pod"><button>合集下一集</button></div><div class="recommend-list-v1"><a href="/video/BV2fixture">推荐视频</a></div></aside>' }));
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://www.bilibili.com/video/BV1u2bg6XECo');
  for (const file of ['src/core/settings.js', 'src/ui/surface.js', 'src/ui/entry-display.js', 'src/ui/motion-runtime.js', 'src/ui/choice.js']) await page.addScriptTag({ path: path.join(root, file) });
  await page.evaluate(() => {
    const listeners = new Set(), config = BiliSmoothSettings.normalize();
    const state = { config, media: { present: true, playback: 'playing', frameHealth: { state: 'healthy', ageMs: 25 } }, status: 'smooth', observedAt: Date.now(), mediaGeneration: 1, bufferWallSeconds: 14.2, lastMbps: 16, lastTransferAt: Date.now(), actualHost: config.pcdnHost, settingsSave: { status: 'saved' } };
    const notify = () => listeners.forEach(fn => fn());
    window.fixture = { state, calls: [], fullReads: 0, viewReads: 0, fail: false, hold: false, notify, resolve: null, outsideClicks: 0 };
    document.querySelector('#outside-action').addEventListener('click', () => { fixture.outsideClicks++; });
    localStorage.setItem('bilismooth.panel.collapsed.v2', 'false');
    window.BiliSmoothRuntime = {
      getConfig: () => structuredClone(state.config),
      getViewState: () => { fixture.viewReads++; return structuredClone(state); },
      getState: () => { fixture.fullReads++; return structuredClone(state); },
      setConfig(patch) { fixture.calls.push({ action: 'config', patch: structuredClone(patch) }); state.config = BiliSmoothSettings.normalize({ ...state.config, ...patch }); state.settingsSave = { status: 'pending' }; notify(); },
      applyRoute(host) { fixture.calls.push({ action: 'route', host }); this.setConfig({ enabled: true, selection: 'fixed', pcdnHost: host, mode: 'bad-only' }); return true; },
      async flushSettings() { fixture.calls.push({ action: 'flush' }); if (fixture.hold) await new Promise(resolve => { fixture.resolve = resolve; }); state.settingsSave = { status: fixture.fail ? 'error' : 'saved' }; notify(); if (fixture.fail) throw Error('storage-write-failed'); },
      retry() { fixture.calls.push({ action: 'retry' }); return true; }, resetNetwork() { fixture.calls.push({ action: 'reset' }); }, reload() { fixture.calls.push({ action: 'reload' }); },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
    window.addEventListener('message', event => { if (event.data?.__bilismoothFloating === 'open-control') { fixture.calls.push({ action: 'open-control' }); window.postMessage({ __bilismoothFloating: 'opened', id: event.data.id, ok: true }, location.origin); } });
  });
  await page.addScriptTag({ path: path.join(root, 'src/page/floating-control.js') });
  const host = page.locator('#bilismooth-floating');
  await host.waitFor({ state: 'visible' }); await page.waitForTimeout(100);
  return { page, context, errors, host };
}
async function openPanel(host) { await host.page().evaluate(() => BiliSmoothFloating.open()); }
async function reveal(host) { await host.page().mouse.move(500, 20); await host.hover(); await host.page().waitForFunction(() => document.querySelector('#bilismooth-floating').dataset.phase === 'preview'); await host.page().waitForTimeout(450); }
async function mutate(page, code) { await page.evaluate(code); await page.waitForTimeout(60); }
async function choose(host, value, query = '') {
  await host.locator('#bs-route').click();
  if (query) await host.locator('.bs-choice-search').fill(query);
  await host.locator('.bs-choice-option[data-value="' + value + '"]').click();
}
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
async function viewport(page) {
  const geometry = await page.evaluate(() => {
    const visual = window.visualViewport, marker = document.createElement('div');
    marker.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none'; document.documentElement.append(marker);
    const fixed = marker.getBoundingClientRect(); marker.remove();
    const left = Math.max(fixed.left, visual?.offsetLeft || 0), top = Math.max(fixed.top, visual?.offsetTop || 0);
    const right = Math.min(fixed.right, (visual?.offsetLeft || 0) + (visual?.width || innerWidth));
    const bottom = Math.min(fixed.bottom, (visual?.offsetTop || 0) + (visual?.height || innerHeight));
    return { expected: { left, top, right, bottom }, shared: BiliSmoothSurfaceStyles.viewport() };
  });
  for (const key of ['left', 'top', 'right', 'bottom']) assert.ok(Math.abs(geometry.shared[key] - geometry.expected[key]) <= .5, 'shared viewport agrees with visible client ' + key);
  return geometry.expected;
}
async function insideViewport(page, bounds, margin = 0) {
  assert.ok(bounds, 'surface is measurable');
  const view = await viewport(page);
  assert.ok(bounds.x >= view.left + margin - .5 && bounds.x + bounds.width <= view.right - margin + .5, 'entire surface fits the horizontal client area');
  assert.ok(bounds.y >= view.top + 8 - .5 && bounds.y + bounds.height <= view.bottom - 8 + .5, 'entire surface fits the vertical client area');
  return view;
}
async function readablePanel(page, host) {
  const bounds = await host.boundingBox();
  assert.equal(bounds.width, 312, 'complete panel uses the approved readable width');
  await insideViewport(page, bounds, 8);
  // Explicit user placement may cover page content. Readability is bounded by
  // the real viewport, while automatic placement still prefers free space.
  assert.equal(await host.locator('#bs-body').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  return bounds;
}

test('capsule uses lightweight state, fresh metrics and healthy-only motion without subscription-driven layout scans', async () => {
  const { page, context, host, errors } = await fixture({ rightWidth: 320 });
  try {
    assert.equal(await host.getAttribute('data-phase'), 'edge', 'legacy expanded preference is ignored');
    assert.equal((await host.boundingBox()).width, 54);
    assert.equal((await host.locator('#bs-edge').boundingBox()).width, 54, 'entry retains its accessible hit width');
    assert.equal(await host.locator('.bs-entry-face').getAttribute('data-entry-type'), 'status-logo');
    await insideViewport(page, await host.boundingBox());
    await host.screenshot({ path: path.join(output, 'edge-light.png') });
    await reveal(host);
    assert.equal((await host.boundingBox()).width, 256, 'preview uses the approved readable width');
    assert.equal(await host.locator('#bs-capsule-speed').textContent(), '2.00');
    assert.equal(await host.locator('#bs-capsule-buffer').textContent(), '14.2');
    assert.equal(await host.locator('#bs-capsule-state').textContent(), '播放顺畅');
    assert.ok(await host.locator('#bs-state-glyph .bs-status-sequence').evaluate(node => node.getAnimations().length > 0));
    const revision = await host.getAttribute('data-layout-revision'), reads = await page.evaluate(() => fixture.viewReads);
    await mutate(page, () => { for (let i = 0; i < 30; i++) fixture.notify(); });
    assert.equal(await page.evaluate(() => fixture.fullReads), 0);
    assert.equal(await page.evaluate(() => fixture.viewReads), reads + 1, 'one frame coalesces state notifications');
    assert.equal(await host.getAttribute('data-layout-revision'), revision, 'unchanged state never rescans page controls');
    await host.screenshot({ path: path.join(output, 'capsule-light.png') });
    await openPanel(host); await page.waitForTimeout(450);
    await readablePanel(page, host);
    await host.screenshot({ path: path.join(output, 'expanded-light.png') });
    await host.locator('#bs-close').click(); await page.waitForTimeout(450);
    await mutate(page, () => { fixture.state.lastMbps = 0.08; fixture.state.lastTransferAt = Date.now(); fixture.notify(); });
    assert.equal(await host.locator('#bs-capsule-speed').textContent(), '10');
    assert.equal(await host.locator('#bs-capsule-speed-unit').textContent(), 'KB/s');
    await mutate(page, () => { fixture.state.media.playback = 'paused'; fixture.notify(); });
    assert.equal(await host.getAttribute('data-state'), 'paused');
    assert.equal(await host.locator('#bs-state-glyph .bs-status-signal').getAttribute('data-playback'), 'paused', 'stale smooth summary cannot override pause');
    await mutate(page, () => { fixture.state.media.playback = 'playing'; fixture.state.observedAt = Date.now() - 4000; fixture.state.lastTransferAt = Date.now() - 4000; fixture.notify(); });
    assert.equal(await host.getAttribute('data-state'), 'playing');
    assert.equal(await host.locator('#bs-capsule-speed').textContent(), '—', 'expired samples are unknown, not zero');
    await mutate(page, () => { fixture.state.config.floatingFields = []; fixture.notify(); });
    assert.equal(await host.locator('#bs-capsule-state').isVisible(), false);
    assert.equal(await host.locator('#bs-capsule-metrics').isVisible(), false);
    assert.equal(await host.locator('#bs-state-glyph').isVisible(), true, 'state glyph remains when every optional field is off');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('automatic entry avoids page controls while expansion keeps its shared corner and outside clicks continue', async () => {
  const { page, context, host, errors } = await fixture({ reducedMotion: 'reduce' });
  try {
    const entry = await host.boundingBox();
    assert.equal(entry.width, 54);
    for (const selector of ['.bpx-player-container', '.right-container', '#outside-action']) assert.equal(intersects(entry, await page.locator(selector).boundingBox()), false, 'automatic entry avoids ' + selector);
    await reveal(host);
    const preview = await host.boundingBox();
    assert.equal(preview.width, 256);
    assert.equal(Math.round(preview.x + preview.width), Math.round(entry.x + entry.width), 'preview retains entry right anchor');
    assert.equal(Math.round(preview.y + preview.height), Math.round(entry.y + entry.height), 'preview retains entry bottom anchor');
    await openPanel(host);
    const panel = await readablePanel(page, host);
    assert.equal(Math.round(panel.x + panel.width), Math.round(entry.x + entry.width));
    assert.equal(Math.round(panel.y + panel.height), Math.round(entry.y + entry.height));
    await host.screenshot({ path: path.join(output, 'expanded-right-gutter.png') });
    await page.screenshot({ path: path.join(output, 'panel-light-context.png') });
    await page.locator('#outside-action').click();
    assert.equal(await host.getAttribute('data-expanded'), 'false');
    assert.equal(await page.evaluate(() => fixture.outsideClicks), 1, 'outside dismissal must not swallow the page action');
    await mutate(page, () => { const button = document.createElement('button'); button.id = 'corner-action'; button.textContent = '下一集'; button.style.cssText = 'position:fixed;right:0;bottom:0;width:205px;height:110px'; document.body.append(button); });
    await insideViewport(page, await host.boundingBox(), 8);
    assert.equal(Math.round((await host.boundingBox()).y + (await host.boundingBox()).height), Math.round(entry.y + entry.height), 'a new page control does not teleport an established anchor');
    await openPanel(host); await readablePanel(page, host);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});


test('preview and panel keep readable sizes as side content grows, and narrow viewports clamp complete controls', async () => {
  const { page, context, host, errors } = await fixture({ reducedMotion: 'reduce', rightWidth: 418.5 });
  try {
    await reveal(host);
    assert.equal((await host.boundingBox()).width, 256, 'side content does not compress the approved preview');
    await mutate(page, () => {
      document.querySelector('.right-container').style.width = '433px';
      fixture.state.lastMbps = 120; fixture.state.lastTransferAt = Date.now(); fixture.state.bufferWallSeconds = 1234.5; fixture.notify();
    });
    assert.equal(await host.locator('#bs-capsule-speed').evaluate(node => getComputedStyle(node).fontSize), '22px');
    assert.equal(await host.locator('#bs-capsule-state').evaluate(node => getComputedStyle(node).fontSize), '14px');
    assert.equal(await host.locator('#bs-move').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    await openPanel(host); await readablePanel(page, host);
    await host.locator('#bs-route').click();
    const menu = await host.locator('.bs-choice-layer[data-state=open]').boundingBox();
    assert.ok(menu.width >= 240 && menu.width <= (await host.boundingBox()).width);
    await insideViewport(page, menu, 8);
    await page.keyboard.press('Escape');
    assert.equal(await host.getAttribute('data-expanded'), 'true');
    await mutate(page, () => { fixture.state.config.floatingFields = []; fixture.notify(); });
    assert.equal((await host.boundingBox()).width, 312, 'preview preferences do not compress the panel');
    await page.setViewportSize({ width: 300, height: 740 });
    await page.waitForTimeout(70);
    const narrow = await host.boundingBox();
    const view = await insideViewport(page, narrow, 8);
    assert.equal(narrow.width, Math.min(312, view.right - view.left - 16), 'narrow panel uses actual paint bounds, excluding reserved scrollbar');
    assert.equal(await host.locator('#bs-body').evaluate(node => node.scrollWidth <= node.clientWidth), true);
    assert.ok((await host.locator('[data-action=dashboard]').boundingBox()).height >= 44, 'dashboard action retains its full-sized target');
    await page.setViewportSize({ width: 2048, height: 991 });
    await mutate(page, () => { fixture.state.config.floatingFields = ['status', 'speed', 'buffer']; fixture.notify(); });
    await host.locator('#bs-close').click();
    // Presentation crops use the same local fixture's original sample. They
    // demonstrate production layout, not a live playback measurement.
    await mutate(page, () => {
      document.querySelector('.right-container').style.width = '320px';
      fixture.state.lastMbps = 16; fixture.state.bufferWallSeconds = 14.2;
      fixture.state.observedAt = fixture.state.lastTransferAt = Date.now(); fixture.notify();
    });
    await host.locator('#bs-move').press('Home');
    const gallery = [];
    for (const theme of ['light', 'dark']) {
      await page.locator('#outside-action').click();
      await page.waitForFunction(() => document.querySelector('#bilismooth-floating').dataset.phase === 'edge');
      await page.evaluate(theme => {
        fixture.state.config.theme = theme; fixture.state.config.lang = 'zh';
        document.body.style.background = theme === 'dark' ? '#111318' : '#f6f7f8';
        fixture.state.observedAt = fixture.state.lastTransferAt = Date.now(); fixture.notify();
      }, theme);
      await page.waitForFunction(theme => document.querySelector('#bilismooth-floating').dataset.theme === theme, theme);
      for (const phase of ['edge', 'preview', 'panel']) {
        if (phase === 'preview') await reveal(host);
        if (phase === 'panel') await host.locator('#bs-move').click();
        assert.equal(await host.getAttribute('data-phase'), phase);
        assert.equal(await host.evaluate(node => node.shadowRoot.querySelector(':focus-visible') !== null), false, 'mouse gallery has no artificial keyboard focus ring');
        const file = 'design-' + theme + '-' + phase + '.png';
        await host.screenshot({ path: path.join(output, file) });
        gallery.push({ file, theme, phase, bounds: await host.boundingBox() });
      }
    }
    await fs.writeFile(path.join(output, 'design-samples.json'), JSON.stringify({
      fixtureOnly: true, note: 'Local deterministic sample, not a real-site playback measurement.',
      metrics: { lastMbps: 16, displaySpeed: '2.00 MB/s', bufferWallSeconds: 14.2 },
      interaction: 'Real mouse hover and click for preview/panel; no API open in gallery sequence.', gallery
    }, null, 2));
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('fullscreens hide all controls and menus; leaving always restores a collapsed capsule', async () => {
  const { page, context, host, errors } = await fixture({ reducedMotion: 'reduce' });
  try {
    await openPanel(host); await host.locator('#bs-route').click();
    await page.evaluate(() => document.querySelector('.bpx-player-container').requestFullscreen());
    await host.waitFor({ state: 'hidden' });
    assert.equal(await host.getAttribute('data-hidden-reason'), 'fullscreen');
    assert.equal(await host.locator('.bs-choice-layer[data-state=open]').count(), 0);
    assert.equal(await host.getAttribute('data-motion'), 'off');
    assert.equal(await host.evaluate(node => node.inert), true);
    await page.evaluate(() => document.exitFullscreen()); await host.waitFor({ state: 'visible' });
    assert.equal(await host.getAttribute('data-expanded'), 'false');
    for (const mode of ['modern', 'legacy', 'rect']) {
      await openPanel(host);
      await page.evaluate(mode => {
        const player = document.querySelector('.bpx-player-container'), inner = document.querySelector('.bpx-player');
        if (mode === 'modern') inner.classList.add('mode-webfullscreen');
        if (mode === 'legacy') { player.id = 'bilibili-player'; player.classList.add('mode-webscreen'); }
        if (mode === 'rect') player.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh';
      }, mode);
      await host.waitFor({ state: 'hidden' });
      await page.evaluate(() => { document.querySelector('.bpx-player').classList.remove('mode-webfullscreen'); const player = document.querySelector('.bpx-player-container'); player.classList.remove('mode-webscreen'); player.style.cssText = ''; });
      await host.waitFor({ state: 'visible' });
      assert.equal(await host.getAttribute('data-expanded'), 'false');
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('new video, remount and SPA navigation start collapsed and only supported playback paths mount', async () => {
  const { page, context, host, errors } = await fixture({ reducedMotion: 'reduce' });
  try {
    await openPanel(host);
    await mutate(page, () => { fixture.state.mediaGeneration++; fixture.notify(); });
    assert.equal(await host.getAttribute('data-expanded'), 'false');
    await openPanel(host);
    for (const route of ['/', '/dynamic', '/search', '/space/123', '/live/123']) {
      await page.evaluate(route => history.pushState({}, '', route), route);
      assert.equal(await page.locator('#bilismooth-floating').count(), 0);
    }
    for (const route of ['/video/av123', '/bangumi/play/ep123', '/bangumi/play/ss123', '/video/BV2fixture']) {
      await page.evaluate(route => history.pushState({}, '', route), route);
      await host.waitFor({ state: 'visible' });
      assert.equal(await host.getAttribute('data-expanded'), 'false');
      await openPanel(host);
    }
    await page.evaluate(() => BiliSmoothFloating.destroy());
    await page.addScriptTag({ path: path.join(root, 'src/page/floating-control.js') });
    await host.waitFor({ state: 'visible' });
    assert.equal(await host.getAttribute('data-expanded'), 'false', 'reinjection never restores expansion');
    await page.addScriptTag({ path: path.join(root, 'src/page/floating-control.js') });
    assert.equal(await page.locator('#bilismooth-floating').count(), 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('quick controls preserve save failure, shared choice keyboard behavior and actual versus planned routes', async () => {
  const { page, context, host, errors } = await fixture({ reducedMotion: 'reduce' });
  try {
    await openPanel(host);
    assert.equal(await host.locator('select').count(), 0);
    await page.evaluate(() => { fixture.hold = true; fixture.fail = true; });
    const switchGap = await host.locator('.bs-enable').evaluate(node => {
      const row = node.getBoundingClientRect(), label = node.querySelector('label').getBoundingClientRect(), input = node.querySelector('input').getBoundingClientRect();
      return { width: input.left - label.right, x: (input.left + label.right) / 2 - row.left, y: input.top + input.height / 2 - row.top };
    });
    assert.ok(switchGap.width >= 4, 'a visible noninteractive gap separates label and switch');
    await host.locator('.bs-enable').click({ position: { x: switchGap.x, y: switchGap.y } });
    assert.equal(await page.evaluate(() => fixture.calls.filter(row => row.action === 'config').length), 0, 'row whitespace is not a switch hit target');
    await host.locator('label[for=bs-enabled]').click();
    await page.waitForFunction(() => fixture.resolve !== null && !document.querySelector('#bilismooth-floating').shadowRoot.querySelector('#bs-enabled').checked);
    assert.equal(await host.locator('#bs-enabled').isChecked(), false);
    assert.equal(await host.locator('#bs-route').isDisabled(), true);
    assert.match(await host.locator('#bs-feedback').textContent(), /正在保存/);
    await page.evaluate(() => { fixture.hold = false; fixture.resolve(); });
    await host.locator('#bs-save-retry').waitFor({ state: 'visible' });
    assert.match(await host.locator('#bs-feedback').textContent(), /未能保存/);
    await page.evaluate(() => { fixture.fail = false; });
    await host.locator('#bs-save-retry').click();
    await page.waitForFunction(() => fixture.state.settingsSave.status === 'saved');
    await page.waitForFunction(() => {
      const root = document.querySelector('#bilismooth-floating').shadowRoot;
      return root.querySelector('#bs-save-retry').hidden && root.querySelector('#bs-panel').getAttribute('aria-busy') === 'false' && !root.querySelector('#bs-route').disabled;
    });
    // The saved state removes the retry row. Let ResizeObserver finish moving
    // the bottom-anchored panel before beginning a new keyboard interaction.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await page.evaluate(() => fixture.calls.filter(row => row.action === 'config').at(-1).patch), {});
    const actual = await host.locator('#bs-actual').textContent();
    await host.locator('#bs-route').focus(); await page.keyboard.press('ArrowDown');
    await host.locator('.bs-choice-search').fill('akam');
    const menu = await host.locator('.bs-choice-layer[data-state=open]').boundingBox();
    assert.ok(menu.width >= 240 && menu.width <= (await host.boundingBox()).width);
    await insideViewport(page, menu, 8);
    assert.equal(intersects(menu, await page.locator('.bpx-player-container').boundingBox()), false);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => fixture.state.config.selection === 'fixed');
    assert.equal(await host.locator('#bs-retry').isDisabled(), true);
    assert.equal(await host.locator('#bs-reset').isDisabled(), true);
    assert.equal(await host.locator('#bs-actual').textContent(), actual);
    assert.match(await host.locator('#bs-target').textContent(), /AKAM/);
    await host.locator('#bs-route').click(); await page.keyboard.press('Escape');
    assert.equal(await host.locator('.bs-choice-layer[data-state=open]').count(), 0);
    assert.equal(await host.getAttribute('data-expanded'), 'true', 'first Escape closes only the choice');
    await choose(host, 'auto'); await host.locator('#bs-reset').click(); await host.locator('#bs-retry').click();
    await host.locator('[data-action=dashboard]').click();
    await page.waitForFunction(() => fixture.calls.some(row => row.action === 'open-control'));
    assert.ok(await page.evaluate(() => fixture.calls.some(row => row.action === 'reset')));
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('drag and keyboard positioning stay free within the viewport while language, theme and reduced motion synchronize', async () => {
  const { page, context, host, errors } = await fixture();
  try {
    await host.locator('#bs-edge').focus();
    await page.waitForTimeout(450);
    const initial = await host.boundingBox();
    await page.keyboard.press('Shift+ArrowUp');
    assert.equal(Math.round((await host.boundingBox()).y), Math.round(initial.y - 32));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bilismooth.panel.position.v3')));
    const keyed = await host.boundingBox();
    assert.equal(Math.round(saved.y), Math.round(keyed.y + (saved.ySide === 'bottom' ? keyed.height : 0)), 'saved coordinate is the shared corner, not a phase top-left');
    const dragRect = await host.locator('#bs-move').boundingBox();
    await page.mouse.move(dragRect.x + 12, dragRect.y + 12); await page.mouse.down();
    await page.mouse.move(900, 500, { steps: 5 }); await page.mouse.up();
    assert.equal(intersects(await host.boundingBox(), await page.locator('.bpx-player-container').boundingBox()), true, 'manual drag freely places the floating surface over video when chosen');
    await insideViewport(page, await host.boundingBox(), 8);
    assert.equal(await host.getAttribute('data-phase'), 'preview');
    await host.locator('#bs-move').focus(); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
    assert.equal(await host.getAttribute('data-expanded'), 'true');
    assert.ok(await host.locator('#bs-body').evaluate(node => node.getAnimations().some(animation => animation.effect.getTiming().duration > 0)));
    await page.waitForTimeout(450);
    await host.locator('#bs-position').click(); await host.locator('[data-position=topRight]').click();
    assert.equal(Math.round((await host.boundingBox()).y), Math.round((await viewport(page)).top + 8));
    await mutate(page, () => { Object.assign(fixture.state.config, { theme: 'dark', lang: 'en', accent: 'pink' }); fixture.state.observedAt = Date.now(); fixture.notify(); });
    assert.equal(await host.getAttribute('data-theme'), 'dark'); assert.equal(await host.getAttribute('lang'), 'en');
    assert.equal(await host.locator('[data-action=dashboard]').textContent(), 'Open dashboard');
    await readablePanel(page, host);
    await host.screenshot({ path: path.join(output, 'expanded-dark-english.png') });
    await page.evaluate(() => window.postMessage({ __bilismoothFloating: 'motion', value: false }, location.origin));
    await page.waitForFunction(() => document.querySelector('#bilismooth-floating').dataset.motion === 'off');
    await host.locator('#bs-close').click(); await openPanel(host);
    assert.equal(await host.locator('#bs-body').evaluate(node => node.getAnimations({ subtree: true }).length), 0);
    await page.evaluate(() => window.postMessage({ __bilismoothFloating: 'motion', value: true }, location.origin));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelector('#bilismooth-floating').dataset.motion === 'off');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('edge, hover preview and pinned panel are accessible, dismissible and cancellable through real Motion', async () => {
  const { page, context, host, errors } = await fixture();
  try {
    assert.equal(await host.getAttribute('data-phase'), 'edge');
    assert.ok(await host.locator('#bs-edge .bs-entry-logo-piece-0').evaluate(node => node.getAnimations().length > 0));
    await mutate(page, () => { fixture.state.media.playback = 'paused'; fixture.notify(); });
    assert.equal(await host.locator('.bs-entry-face').getAttribute('data-entry-state'), 'paused');
    assert.equal(await host.locator('#bs-edge .bs-entry-logo-piece-0').evaluate(node => node.getAnimations().length), 0, 'paused status logo is quiet');
    await host.hover();
    await page.waitForFunction(() => document.querySelector('#bilismooth-floating').dataset.phase === 'preview');
    assert.equal(await host.getAttribute('data-phase'), 'preview');
    assert.ok(await host.locator('.bs-shell').evaluate(node => node.getAnimations().some(animation => animation.effect.getTiming().duration > 0)), 'shared Motion is actually animating the morph');
    const previewBounds = await host.boundingBox();
    await page.mouse.move(previewBounds.x + 10, previewBounds.y + 20);
    await page.waitForTimeout(230);
    assert.equal(await host.getAttribute('data-phase'), 'preview', 'moving from the tab into its revealed metrics keeps them open');
    assert.equal(await host.locator('.bs-shell').evaluate(node => getComputedStyle(node).borderRadius), '21px', 'preview keeps the approved rounded shell');
    await page.keyboard.press('Escape');
    assert.equal(await host.getAttribute('data-phase'), 'edge', 'Escape also dismisses pointer hover while focus stays on the page');
    await page.waitForTimeout(460);
    assert.equal(await host.getAttribute('data-phase'), 'edge');
    await page.mouse.move(500, 20); await host.hover();
    await page.mouse.move(500, 20); await page.waitForTimeout(500);
    assert.equal(await host.getAttribute('data-phase'), 'edge');
    await host.hover();
    await host.locator('#bs-move').click();
    await page.mouse.move(500, 20); await page.waitForTimeout(240);
    assert.equal(await host.getAttribute('data-phase'), 'panel', 'hover leave never closes a pinned panel');
    await page.locator('#outside-action').click();
    assert.equal(await host.getAttribute('data-expanded'), 'false', 'outside click dismisses the pinned panel');
    assert.equal(await page.evaluate(() => fixture.outsideClicks), 1);
    await openPanel(host);
    await page.keyboard.press('Escape');
    assert.equal(await host.getAttribute('data-phase'), 'preview');
    await page.keyboard.press('Escape');
    assert.equal(await host.getAttribute('data-phase'), 'edge');
    await page.waitForTimeout(500);
    assert.equal(await host.getAttribute('data-phase'), 'edge', 'an old completion cannot reopen content after rapid reversal');
    assert.equal(await host.locator('#bs-body').isVisible(), false);
    await page.keyboard.press('Tab'); await host.locator('#bs-edge').focus();
    assert.equal(await host.getAttribute('data-phase'), 'preview', 'keyboard focus exposes the same metrics');
    await page.keyboard.press('Enter');
    assert.equal(await host.getAttribute('data-phase'), 'panel');
    await page.waitForTimeout(450);
    await host.screenshot({ path: path.join(output, 'panel-motion-settled.png') });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('touch exposes metrics before panel and crowded page content retains readable controls', async () => {
  const { page, context, host, errors } = await fixture({ hasTouch: true, reducedMotion: 'reduce' });
  try {
    await host.locator('#bs-edge').tap();
    assert.equal(await host.getAttribute('data-phase'), 'preview');
    await host.locator('#bs-move').tap();
    assert.equal(await host.getAttribute('data-phase'), 'panel');
    await page.touchscreen.tap(500, 20);
    assert.equal(await host.getAttribute('data-expanded'), 'false', 'outside touch dismisses the pinned panel');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    assert.equal(await host.getAttribute('data-phase'), 'edge');
    await mutate(page, () => {
      const block = document.createElement('div'); block.id = 'narrow-gutter';
      const view = BiliSmoothSurfaceStyles.viewport();
      block.setAttribute('role', 'dialog'); block.style.cssText = 'position:fixed;left:0;top:0;width:' + (view.right - 60) + 'px;height:100vh';
      document.body.append(block);
    });
    assert.equal(await host.isVisible(), true);
    await page.evaluate(() => BiliSmoothFloating.open());
    assert.equal(await host.getAttribute('data-phase'), 'panel', 'explicit expansion remains available even on a crowded page');
    assert.equal(await host.isVisible(), true);
    assert.equal((await host.boundingBox()).width, 312);
    await insideViewport(page, await host.boundingBox(), 8);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await host.isVisible(), false);
    assert.equal(await host.getAttribute('data-motion'), 'off');
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
