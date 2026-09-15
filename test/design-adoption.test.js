'use strict';

// Approved v4 acceptance tests against the real extension sources and build.
// Chrome messaging and playback telemetry are deterministic local fixtures;
// geometry, pointer input, focus, scrolling, rendering and persistence code are real.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require('playwright');
const { createEvidenceOutput, assertBuildMatches } = require('../scripts/validation-support.cjs');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const types = ['status-logo', 'logo', 'status', 'speed', 'buffer', 'combined', 'route', 'rate', 'resolution'];
const sourceFiles = ['src/core/settings.js', 'src/ui/surface.js', 'src/ui/motion-runtime.js', 'src/ui/choice.js', 'src/ui/entry-display.js', 'src/page/floating-control.js'];
const output = createEvidenceOutput({ root, suite: 'design-adoption', version });
let browser;
before(async () => { await fs.mkdir(output, { recursive: true }); browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

function telemetry(config = {}) {
  return { version, observedAt: Date.now(), startupReady: true, hidden: false,
    config: { ...require('../src/core/settings.js').normalize(), theme: 'light', ...config },
    settingsSave: { status: 'saved' }, status: 'smooth', mediaGeneration: 1,
    videoMeta: { title: '本地验收视频', url: 'https://www.bilibili.com/video/BV1adoption', coverUrl: null },
    media: { present: true, playback: 'playing', currentTime: 83, duration: 480, width: 1920, height: 1080, frameHealth: { state: 'healthy', ageMs: 20 } },
    buffer: 24.8, bufferWallSeconds: 24.8, rate: 1.5, actualHost: 'upos-sz-mirrorcosov.bilivideo.com', requestedHost: 'upos-sz-mirrorcosov.bilivideo.com', targetHost: 'upos-sz-mirrorcosov.bilivideo.com',
    lastMbps: 16, lastTransferAt: Date.now(), speedSamples: [], allowedHosts: ['upos-sz-mirrorcosov.bilivideo.com'], ranking: [], counters: {}, startup: {},
    events: Array.from({ length: 70 }, (_, i) => ({ seq: i + 1, at: Date.now() - (70 - i) * 1000, type: 'request', host: 'upos-sz-mirrorcosov.bilivideo.com' })) };
}

async function floating(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference', ...options });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await context.close(); assert.deepEqual(errors, [], 'No floating script errors'); });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html{overflow-y:scroll;scrollbar-gutter:stable}body{margin:0;min-height:1500px;background:#f6f7f8}.bpx-player-container{position:absolute;left:80px;top:140px;width:960px;height:540px;background:#18191c}.right-container{position:absolute;left:1060px;top:100px;width:220px;height:1000px;background:#e3e5e7}#outside-action{position:fixed;left:30px;top:25px}</style><button id="outside-action">页面操作</button><div class="bpx-player-container"><div class="bpx-player"><video></video></div></div><aside class="right-container">推荐视频</aside>' }));
  await page.goto('https://www.bilibili.com/video/BV1adoption');
  for (const file of sourceFiles.slice(0, -1)) await page.addScriptTag({ path: path.join(root, file) });
  await page.evaluate(value => {
    const callbacks = new Set();
    window.adoption = { state: value, calls: [], fullReads: 0, viewReads: 0, outsideClicks: 0,
      notify() { value.observedAt = Date.now(); callbacks.forEach(fn => fn()); },
      patch(patch) { value.config = BiliSmoothSettings.normalize({ ...value.config, ...patch }); this.notify(); } };
    document.getElementById('outside-action').addEventListener('click', () => adoption.outsideClicks++);
    window.BiliSmoothRuntime = {
      getConfig: () => structuredClone(value.config), getViewState() { adoption.viewReads++; return structuredClone(value); },
      getState() { adoption.fullReads++; return structuredClone(value); },
      setConfig(patch) { adoption.calls.push({ action: 'config', patch }); adoption.patch(patch); },
      async flushSettings() { adoption.calls.push({ action: 'flush' }); },
      retry: () => true, resetNetwork() {}, reload() {}, applyRoute: () => true,
      subscribe(fn) { callbacks.add(fn); return () => callbacks.delete(fn); }
    };
  }, telemetry());
  await page.addScriptTag({ path: path.join(root, sourceFiles.at(-1)) });
  const host = page.locator('#bilismooth-floating');
  await host.waitFor({ state: 'visible' });
  const ui = { page, host, context };
  await settle(ui);
  return ui;
}
async function rect(ui) { return ui.host.evaluate(node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }); }
async function settle(ui) {
  let last, stable = 0;
  for (let i = 0; i < 70; i++) {
    const next = await rect(ui);
    stable = last && ['left', 'top', 'width', 'height'].every(key => Math.abs(next[key] - last[key]) < .2) ? stable + 1 : 0;
    if (stable >= 4) return next;
    last = next; await ui.page.waitForTimeout(35);
  }
  assert.fail('Floating layout never settled');
}
async function pickPhase(ui, phase) {
  await ui.page.mouse.move(30, 20);
  await ui.page.evaluate(() => document.querySelector('#bilismooth-floating').shadowRoot.activeElement?.blur());
  if (phase === 'panel') await ui.page.evaluate(() => BiliSmoothFloating.open());
  else if (phase === 'preview') { await ui.page.evaluate(() => BiliSmoothFloating.open()); await ui.host.locator('#bs-close').click(); }
  else { await ui.page.keyboard.press('Escape'); await ui.page.keyboard.press('Escape'); }
  await settle(ui);
  assert.equal(await ui.host.getAttribute('data-phase'), phase);
}
async function startDrag(ui) {
  const phase = await ui.host.getAttribute('data-phase'), before = await rect(ui);
  const mover = ui.host.locator(phase === 'edge' ? '#bs-edge' : '#bs-move'), box = await mover.boundingBox();
  const start = { x: box.x + box.width * .5, y: box.y + Math.min(box.height * .5, 24) };
  await ui.page.mouse.move(start.x, start.y); await ui.page.mouse.down();
  // Pointerdown may interrupt an in-flight spring. Record its committed visual
  // position after that event, rather than the older frame before mouse entry.
  return { phase, before: await rect(ui), start };
}
async function moveDrag(ui, drag, left, top, steps = 8) {
  await ui.page.mouse.move(drag.start.x + left - drag.before.left, drag.start.y + top - drag.before.top, { steps });
}
async function dragTo(ui, left, top) {
  const drag = await startDrag(ui);
  try { await moveDrag(ui, drag, left, top); } finally { await ui.page.mouse.up(); }
  await settle(ui);
  assert.equal(await ui.host.getAttribute('data-phase'), drag.phase, 'Drag must not activate a click');
  return rect(ui);
}
async function bounds(ui) { return ui.page.evaluate(() => { const v = BiliSmoothSurfaceStyles.viewport(); return { left: v.left + 8, top: v.top + 8, right: v.right - 8, bottom: v.bottom - 8 }; }); }
async function safe(ui) {
  const r = await rect(ui), b = await bounds(ui);
  assert.ok(r.left >= b.left - 1 && r.top >= b.top - 1 && r.right <= b.right + 1 && r.bottom <= b.bottom + 1, JSON.stringify({ r, b }));
}

test('new entry defaults validate and persist through the real background settings authority', async () => {
  const settings = require('../src/core/settings.js'), migration = require('../src/core/settings-migration.js');
  assert.equal(settings.defaults.floatingEntryEnabled, true);
  assert.equal(settings.defaults.floatingEntryType, 'status-logo');
  assert.equal(settings.defaults.floatingEdgeSnap, true);
  assert.equal(settings.normalize({ floatingEntryType: 'untrusted-type' }).floatingEntryType, 'status-logo');
  const store = { [migration.key]: settings.normalize({ floatingFields: ['buffer'], p2pGuard: true }) }, listeners = [];
  const chrome = { runtime: { id: 'test', getURL: file => 'chrome-extension://test/' + file, getManifest: () => ({ version }), onMessage: { addListener(fn) { listeners.push(fn); } } }, action: { onClicked: { addListener() {} } }, storage: { local: {
    async get() { return structuredClone(store); }, async set(values) { Object.assign(store, structuredClone(values)); }
  } } };
  vm.runInNewContext(await fs.readFile(path.join(root, 'src/extension/background.js'), 'utf8'), { chrome, importScripts() {}, BiliSmoothSettings: settings, BiliSmoothSettingsMigration: migration, URL, setTimeout, clearTimeout });
  const command = patch => new Promise(resolve => listeners[0]({ channel: 'bilismooth-settings', action: 'patch', patch }, { id: 'test' }, resolve));
  for (const type of types) { const response = await command({ floatingEntryType: type }); assert.equal(response.ok, true); assert.equal(response.result.floatingEntryType, type); }
  await Promise.all([command({ floatingEntryEnabled: false }), command({ floatingEdgeSnap: false })]);
  const saved = await migration.read(chrome.storage.local);
  assert.equal(saved.floatingEntryEnabled, false); assert.equal(saved.floatingEdgeSnap, false);
  assert.deepEqual(saved.floatingFields, ['buffer'], 'Entry changes leave preview fields independent');
  assert.equal(saved.p2pGuard, true, 'Entry changes preserve network preferences');
});

for (const phase of ['edge', 'preview', 'panel']) test(phase + ' follows the pointer freely and stays at the released position', async t => {
  const ui = await floating(t); await pickPhase(ui, phase);
  const after = await dragTo(ui, 410, 360);
  assert.ok(Math.abs(after.left - 410) < 2 && Math.abs(after.top - 360) < 2, 'Manual movement may freely overlap video content');
  await safe(ui);
  await ui.page.evaluate(() => document.querySelector('#bilismooth-floating').shadowRoot.activeElement?.blur());
  await ui.page.screenshot({ path: path.join(output, 'floating-' + phase + '-final.png'), animations: 'disabled',
    clip: { x: after.left - 30, y: after.top - 30, width: after.width + 60, height: after.height + 60 } });
});

test('bottom-right panel collapse immediately preserves the same corner through all three sizes', async t => {
  const ui = await floating(t); await pickPhase(ui, 'panel');
  const b = await bounds(ui), r = await rect(ui);
  const panel = await dragTo(ui, b.right - r.width - 60, b.bottom - r.height - 60);
  await ui.host.locator('#bs-close').click(); await settle(ui);
  assert.equal(await ui.host.getAttribute('data-phase'), 'preview');
  const preview = await rect(ui);
  assert.ok(Math.abs(panel.right - preview.right) <= 2 && Math.abs(panel.bottom - preview.bottom) <= 2, 'Collapse retains dragged bottom-right corner');
  await ui.page.keyboard.press('Escape'); await settle(ui);
  assert.equal(await ui.host.getAttribute('data-phase'), 'edge');
  const edge = await rect(ui);
  assert.ok(Math.abs(panel.right - edge.right) <= 2 && Math.abs(panel.bottom - edge.bottom) <= 2);
});

test('near-edge hint does not pull the held pointer; release snaps and the next drag interrupts', async t => {
  const ui = await floating(t); await pickPhase(ui, 'panel');
  const drag = await startDrag(ui), b = await bounds(ui), target = b.right - drag.before.width - 16;
  await moveDrag(ui, drag, target, 330); await ui.page.waitForTimeout(50);
  const held = await rect(ui);
  assert.ok(Math.abs(held.left - target) <= 2, 'No magnetic movement while held');
  const hint = ui.page.locator('#bs-snap-hint, [data-snap-hint]').filter({ visible: true });
  assert.ok(await hint.count() > 0, 'Landing hint is visible before release');
  await ui.page.mouse.up(); await ui.page.waitForTimeout(35);
  const second = await startDrag(ui);
  await moveDrag(ui, second, 490, 330); await ui.page.mouse.up(); await settle(ui);
  const interrupted = await rect(ui);
  assert.ok(Math.abs(interrupted.left - 490) <= 2, 'New pointer immediately detaches interrupted snap: ' + JSON.stringify({ second, interrupted }));
  const end = await dragTo(ui, b.right - interrupted.width - 16, 330);
  assert.ok(Math.abs(end.right - b.right) <= 1, 'Release resolves to the visible viewport edge');
  await safe(ui);
});

test('disabled snapping leaves a near-edge free position unchanged', async t => {
  const ui = await floating(t); await ui.page.evaluate(() => adoption.patch({ floatingEdgeSnap: false }));
  await pickPhase(ui, 'preview'); const b = await bounds(ui), r = await rect(ui), target = b.right - r.width - 15;
  const end = await dragTo(ui, target, 360);
  assert.ok(Math.abs(end.left - target) <= 2);
});

test('fullscreen interrupts an active drag and restores the configured minimum when leaving', async t => {
  const ui = await floating(t); await pickPhase(ui, 'panel');
  const drag = await startDrag(ui); await moveDrag(ui, drag, 460, 300);
  await ui.page.evaluate(() => document.querySelector('.bpx-player').classList.add('mode-webfullscreen'));
  await ui.host.waitFor({ state: 'hidden' }); await ui.page.mouse.up();
  assert.equal(await ui.host.getAttribute('data-motion'), 'off');
  await ui.page.evaluate(() => document.querySelector('.bpx-player').classList.remove('mode-webfullscreen'));
  await ui.host.waitFor({ state: 'visible' }); await settle(ui);
  assert.equal(await ui.host.getAttribute('data-phase'), 'edge'); await safe(ui);
});

test('preferences received during a drag reconcile the released size and minimum state', async t => {
  const ui = await floating(t);
  const drag = await startDrag(ui); await moveDrag(ui, drag, 410, 360);
  await ui.page.evaluate(() => adoption.patch({ floatingEntryType: 'combined' }));
  await ui.page.mouse.up(); await settle(ui);
  assert.equal(await ui.host.getAttribute('data-phase'), 'edge');
  assert.equal((await rect(ui)).width, 150, 'New entry metrics cannot overflow the old logo width');
  assert.equal(await ui.host.locator('.bs-entry-face').getAttribute('data-entry-type'), 'combined');
  const next = await startDrag(ui); await moveDrag(ui, next, 480, 340);
  await ui.page.evaluate(() => adoption.patch({ floatingEntryEnabled: false }));
  await ui.page.mouse.up(); await settle(ui);
  assert.equal(await ui.host.getAttribute('data-phase'), 'preview', 'The saved two-state minimum applies after drag');
  await safe(ui);
});

test('two-state mode stays preview after collapse, leave, Escape, outside click and route refresh', async t => {
  const ui = await floating(t);
  await ui.page.evaluate(() => adoption.patch({ floatingEntryEnabled: false })); await settle(ui);
  assert.equal(await ui.host.getAttribute('data-phase'), 'preview');
  for (const action of ['collapse', 'escape', 'outside', 'refresh']) {
    await ui.page.evaluate(() => BiliSmoothFloating.open()); await settle(ui);
    if (action === 'collapse') await ui.host.locator('#bs-close').click();
    if (action === 'escape') await ui.page.keyboard.press('Escape');
    if (action === 'outside') await ui.page.locator('#outside-action').click();
    if (action === 'refresh') await ui.page.evaluate(() => { history.pushState({}, '', '/video/BV2adoption'); BiliSmoothFloating.refresh(); });
    await ui.page.mouse.move(30, 20); await ui.page.waitForTimeout(650); await settle(ui);
    assert.equal(await ui.host.getAttribute('data-phase'), 'preview', action + ' preserves the minimum state');
    assert.equal(await ui.host.isVisible(), true); await safe(ui);
  }
  assert.equal(await ui.page.evaluate(() => adoption.outsideClicks), 1, 'Outside dismissal preserves the page action');
});

test('nine live entry modes use current telemetry independently of preview field selection', async t => {
  const ui = await floating(t, { reducedMotion: 'reduce' });
  await ui.page.evaluate(() => adoption.patch({ floatingFields: [] }));
  for (const type of types) {
    await ui.page.evaluate(type => adoption.patch({ floatingEntryType: type }), type); await settle(ui);
    const face = ui.host.locator('#bs-edge .bs-entry-face');
    assert.equal(await face.getAttribute('data-entry-type'), type);
    assert.equal(await face.getAttribute('data-entry-state'), 'smooth');
    if (type === 'speed') assert.match(await face.innerText(), /2[.,]00\s*MB\/s/);
    if (type === 'buffer') assert.match(await face.innerText(), /24[.,]8/);
    if (type === 'rate') assert.match(await face.innerText(), /1[.,]5/);
    if (type === 'resolution') assert.match(await face.innerText(), /1080/);
    await safe(ui);
  }
  await ui.page.evaluate(() => { adoption.patch({ floatingEntryType: 'status-logo' }); adoption.state.media.playback = 'paused'; adoption.notify(); });
  await ui.page.waitForTimeout(70);
  assert.equal(await ui.host.locator('#bs-edge .bs-entry-face').getAttribute('data-entry-state'), 'paused');
  assert.equal(await ui.host.locator('#bs-edge .bs-entry-face').evaluate(node => node.getAnimations({ subtree: true }).filter(a => a.playState === 'running').length), 0);
  const before = await ui.page.evaluate(() => adoption.viewReads);
  await ui.page.evaluate(() => { for (let i = 0; i < 30; i++) adoption.notify(); }); await ui.page.waitForTimeout(50);
  assert.equal(await ui.page.evaluate(() => adoption.fullReads), 0);
  assert.ok((await ui.page.evaluate(() => adoption.viewReads)) - before <= 2, 'Rendering remains frame-coalesced');
});

test('observed idle zero, explicit unknown and legacy speed evidence agree across entry, preview, panel and dashboard', async t => {
  const ui = await floating(t, { reducedMotion: 'reduce' }), dashboardUI = await dashboard(t);
  await ui.page.evaluate(() => adoption.patch({ floatingEntryType: 'speed' }));
  for (const mode of ['observed-zero', 'explicit-unknown', 'legacy-transfer']) {
    const update = mode => {
      const state = adoption.state;
      state.lastMbps = mode === 'observed-zero' ? 0 : 8;
      state.lastTransferAt = Date.now() - (mode === 'observed-zero' ? 60000 : 0);
      if (mode === 'legacy-transfer') delete state.speedObservedAt;
      else state.speedObservedAt = mode === 'observed-zero' ? Date.now() : null;
      state.observedAt = Date.now();
      if (typeof adoption.notify === 'function') adoption.notify();
      else BiliSmoothView.renderSnapshot(structuredClone(state), true);
    };
    await ui.page.evaluate(update, mode); await dashboardUI.page.evaluate(update, mode);
    await ui.page.waitForTimeout(60);
    const values = [await ui.host.locator('#bs-edge .bs-entry-number').textContent(), await ui.host.locator('#bs-capsule-speed').textContent(), await ui.host.locator('#bs-speed').textContent(), await dashboardUI.page.locator('#speed-value').textContent()];
    if (mode === 'explicit-unknown') assert.ok(values.every(value => /^(?:—|-)$/.test(value)), 'Explicit unknown cannot fall back to a fresh old transfer: ' + values);
    else assert.deepEqual(values, Array(4).fill(mode === 'observed-zero' ? '0.00' : '1.00'), mode);
    assert.equal(await dashboardUI.page.locator('#speed-value').getAttribute('title') === '', mode !== 'explicit-unknown', 'Observed zero is a valid sample; explicit unknown has no valid evidence');
  }
});

async function dashboard(t) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 1000 }, reducedMotion: 'no-preference' });
  const errors = [], external = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); assert.deepEqual(external, []); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://bilismooth-adoption.test') { external.push(url.href); return route.abort(); }
    const file = url.pathname === '/settings.js' ? 'src/core/settings.js' : url.pathname.startsWith('/icons/') ? 'src/extension' + url.pathname : 'src/ui' + url.pathname;
    const ext = path.extname(file), bytes = await fs.readFile(path.join(root, file));
    const body = ext === '.html' ? bytes.toString().replace('name="bilismooth-version" content=""', 'name="bilismooth-version" content="' + version + '"') : bytes;
    await route.fulfill({ body, contentType: ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css' : ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : 'application/javascript' });
  });
  await context.addInitScript(value => {
    window.adoption = { state: value, config: structuredClone(value.config), commands: [], failSave: false };
    const copy = x => structuredClone(x), noop = { addListener() {} };
    const patch = message => {
      if (adoption.failSave) return { ok: false, error: 'settings-save-failed' };
      adoption.config = { ...adoption.config, ...message.patch }; adoption.state.config = copy(adoption.config);
      return { ok: true, result: copy(adoption.state) };
    };
    window.chrome = {
      runtime: { id: 'fixture', getManifest: () => ({ version: value.version }), onMessage: noop,
        async sendMessage(message) { adoption.commands.push(copy(message)); if (message.action === 'patch') { const result = patch(message); return result.ok ? { ok: true, result: copy(adoption.config) } : result; } return { ok: true, result: copy(adoption.config) }; } },
      storage: { local: { async get() { return { bilismoothMotion: true }; }, async set() {} }, onChanged: noop }, windows: { async update() {} },
      tabs: { onRemoved: noop, onUpdated: noop, onCreated: noop, async query() { return [{ id: 41, windowId: 1, title: '本地验收视频', url: 'https://www.bilibili.com/video/BV1adoption' }]; }, async update() {}, async reload() {},
        async sendMessage(id, message) { adoption.commands.push(copy(message)); if (message.action === 'config') return patch(message); if (message.action === 'clearEvents') adoption.state.events = []; adoption.state.observedAt = adoption.state.lastTransferAt = Date.now(); return { ok: true, result: copy(adoption.state) }; } }
    };
  }, telemetry());
  const page = await context.newPage(); page.setDefaultTimeout(5000);
  await page.goto('http://bilismooth-adoption.test/control/index.html?tab=41');
  await page.waitForFunction(() => BiliSmoothView?.getSnapshot()?.media?.present);
  return { page, context, show: name => page.locator('nav [data-page="' + name + '"]').click(), refresh: () => page.evaluate(() => BiliSmoothLive.refresh(true)) };
}

test('dashboard offers nine live previews and persists entry preferences without touching preview fields', async t => {
  const ui = await dashboard(t); await ui.show('settings');
  assert.equal(await ui.page.locator('input[data-config=floatingEntryType]').count(), 9);
  for (const type of types) {
    const card = ui.page.locator('.entry-option').filter({ has: ui.page.locator('input[data-config=floatingEntryType][value="' + type + '"]') });
    assert.equal(await card.locator('.bs-entry-face').getAttribute('data-entry-type'), type);
    await card.click();
    await ui.page.waitForFunction(type => adoption.config.floatingEntryType === type, type);
    assert.equal(await card.locator('input').isChecked(), true);
  }
  await ui.page.locator('#switch-floatingEntryEnabled').uncheck();
  await ui.page.waitForFunction(() => adoption.config.floatingEntryEnabled === false);
  await ui.page.locator('#switch-floatingEdgeSnap').uncheck();
  await ui.page.waitForFunction(() => adoption.config.floatingEdgeSnap === false);
  assert.deepEqual(await ui.page.evaluate(() => adoption.config.floatingFields), ['status', 'speed', 'buffer']);
  for (const key of ['p2pGuard', 'mcdnStrategy', 'portHeuristic', 'rewriteAkamai']) assert.ok(await ui.page.locator('[data-config="' + key + '"]').count(), key + ' remains configurable');
  await ui.page.evaluate(() => adoption.failSave = true);
  await ui.page.locator('#switch-floatingEntryEnabled').click();
  await ui.page.waitForFunction(() => document.querySelector('#switch-floatingEntryEnabled').getAttribute('aria-busy') !== 'true');
  assert.equal(await ui.page.locator('#switch-floatingEntryEnabled').isChecked(), false, 'Failed persistence rolls back the visible switch');
  assert.equal(await ui.page.locator('#save-error').isVisible(), true);
});

test('log history retains keyed rows and position, counts only incoming records, then follows latest at top', async t => {
  const ui = await dashboard(t); await ui.show('logs');
  const box = ui.page.locator('#log-scroll'); await box.locator('li').first().waitFor();
  await box.evaluate(node => { node.scrollTop = 260; node.dispatchEvent(new Event('scroll')); window.oldLogNode = node.querySelectorAll('li')[5]; });
  const before = await box.evaluate(node => ({ top: node.scrollTop, first: node.querySelector('li').textContent }));
  await ui.page.evaluate(() => { adoption.state.events.push({ seq: 71, at: Date.now(), type: 'recovery-attempt' }, { seq: 72, at: Date.now() + 1, type: 'recovery-confirmed' }); });
  await ui.refresh();
  assert.equal(await box.evaluate(node => node.scrollTop), before.top);
  assert.equal(await box.locator('li').first().textContent(), before.first);
  assert.equal(await ui.page.evaluate(() => oldLogNode.isConnected), true);
  assert.match(await ui.page.locator('#follow-logs').textContent(), /2/);
  assert.equal(await box.evaluate(node => getComputedStyle(node).overflowY), 'auto');
  const b = await box.boundingBox(); assert.ok(b.height <= 500, 'Internal log viewport stays bounded');
  await ui.page.locator('#follow-logs').click();
  await ui.page.waitForFunction(() => document.querySelector('#log-scroll').scrollTop <= 1 && document.querySelector('#follow-logs').disabled);
  assert.equal(await ui.page.locator('#follow-logs').getAttribute('data-has-new'), 'false');
  assert.equal(await ui.page.locator('#follow-logs').isDisabled(), true, 'Settled footer shows the up-to-date state');
  assert.equal(await ui.page.evaluate(() => oldLogNode.isConnected), true, 'Existing rows survive follow-to-latest');
  const label = await ui.page.locator('label[for=log-filter]').boundingBox(), menu = await ui.page.locator('#log-filter').boundingBox();
  assert.ok(menu.x - (label.x + label.width) >= 12, 'Filter label has deliberate breathing room');
});

test('log follow motion is interrupted by wheel input and hidden-tab updates preserve history', async t => {
  const ui = await dashboard(t); await ui.show('logs');
  const box = ui.page.locator('#log-scroll'); await box.locator('li').first().waitFor();
  await box.evaluate(node => { node.scrollTop = 900; node.dispatchEvent(new Event('scroll')); });
  await ui.show('overview');
  await ui.page.evaluate(() => adoption.state.events.push({ seq: 71, at: Date.now(), type: 'recovery-confirmed' })); await ui.refresh();
  await ui.show('logs'); assert.ok(await box.evaluate(node => node.scrollTop) >= 899);
  await ui.page.locator('#follow-logs').click(); await ui.page.waitForTimeout(60);
  await box.hover(); await ui.page.mouse.wheel(0, 120); await ui.page.waitForTimeout(750);
  assert.ok(await box.evaluate(node => node.scrollTop) > 40, 'User scroll interrupts the programmatic follow');
});

test('dashboard adopts warm composition without duplicate overview animations and remains usable on narrow screens', async t => {
  const ui = await dashboard(t);
  assert.equal(await ui.page.locator('.state-metric, .sig-status-rail, .bs-dashboard-state').count(), 0);
  await ui.page.screenshot({ path: path.join(output, 'overview-light.png'), fullPage: true, animations: 'disabled' });
  for (const width of [1366, 736, 360]) {
    await ui.page.setViewportSize({ width, height: 1000 });
    for (const tab of ['overview', 'settings', 'logs']) {
      await ui.show(tab);
      assert.ok(await ui.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), tab + ' overflows at ' + width);
      if (width === 360) await ui.page.screenshot({ path: path.join(output, tab + '-narrow.png'), fullPage: true, animations: 'disabled' });
    }
  }
});

test('installed MV3 extension propagates and reloads the new preferences through its real content bridge', async () => {
  const directory = await fs.mkdtemp(path.join(output, 'mv3-'));
  const extension = path.join(root, 'dist/extension');
  let context;
  const errors = [];
  try {
    context = await chromium.launchPersistentContext(path.join(directory, 'profile'), { channel: 'chromium', headless: true,
      viewport: { width: 1440, height: 1000 }, args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension] });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.protocol === 'chrome-extension:') return route.continue();
      if (url.hostname !== 'www.bilibili.com') return route.abort();
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>MV3 design adoption fixture</title><style>body{margin:0;background:#f6f7f8;min-height:1300px}.bpx-player-container{position:absolute;left:100px;top:120px;width:900px;height:506px;background:#18191c}video{width:100%;height:100%}</style><div class="bpx-player-container"><video></video></div>' });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).hostname;
    const video = await context.newPage();
    await video.goto('https://www.bilibili.com/video/BV1mv3adoption');
    await video.waitForFunction(() => window.BiliSmoothSession?.getState().startupReady && window.BiliSmoothFloating);
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.bilibili.com/video/BV1mv3adoption' }))[0].id);
    const control = await context.newPage();
    await control.goto('chrome-extension://' + extensionId + '/control/index.html?tab=' + tabId);
    await control.waitForFunction(() => BiliSmoothView?.getSnapshot()?.config?.floatingEntryType === 'status-logo');
    await control.locator('nav [data-page=settings]').click();
    for (const type of types) {
      await control.locator('.entry-option').filter({ has: control.locator('input[data-config=floatingEntryType][value="' + type + '"]') }).click();
      await video.waitForFunction(type => BiliSmoothSession.getConfig().floatingEntryType === type, type);
    }
    await control.locator('#switch-floatingEntryEnabled').uncheck();
    await video.waitForFunction(() => !BiliSmoothSession.getConfig().floatingEntryEnabled);
    await control.locator('#switch-floatingEdgeSnap').uncheck();
    await video.waitForFunction(() => !BiliSmoothSession.getConfig().floatingEdgeSnap);
    const stored = await worker.evaluate(async () => (await chrome.storage.local.get('bilismooth.config.v4'))['bilismooth.config.v4']);
    assert.equal(stored.floatingEntryType, 'resolution');
    assert.equal(stored.floatingEntryEnabled, false); assert.equal(stored.floatingEdgeSnap, false);
    await video.bringToFront();
    const floatingUI = { page: video, host: video.locator('#bilismooth-floating') };
    await settle(floatingUI);
    await dragTo(floatingUI, 420, 300);
    const dragged = await rect(floatingUI);
    await control.bringToFront();
    await control.locator('[data-command=resetFloatingPosition]').click();
    await video.waitForFunction(() => JSON.parse(localStorage.getItem('bilismooth.panel.position.v3') || '{}').anchor === 'bottomRight');
    await video.bringToFront(); await settle(floatingUI);
    const reset = await rect(floatingUI), view = await bounds(floatingUI);
    assert.ok(Math.abs(reset.left - dragged.left) > 20 || Math.abs(reset.top - dragged.top) > 20, 'Selected-tab dashboard command moves the real floating surface');
    assert.ok(Math.abs(reset.right - view.right) <= 2 && Math.abs(reset.bottom - view.bottom) <= 2, 'Reset restores the default bottom-right anchor');
    await video.bringToFront(); await video.reload();
    await video.waitForFunction(() => BiliSmoothSession?.getState().startupReady && window.BiliSmoothFloating);
    const config = await video.evaluate(() => BiliSmoothSession.getConfig());
    assert.equal(config.floatingEntryType, 'resolution');
    assert.equal(config.floatingEntryEnabled, false); assert.equal(config.floatingEdgeSnap, false);
    await video.waitForFunction(() => document.querySelector('#bilismooth-floating')?.dataset.phase === 'preview');
    assert.deepEqual(errors, []);
  } finally {
    await context?.close();
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.resolve(output) + path.sep)) throw Error('Refusing profile cleanup outside acceptance output');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('installable candidate contains the exact accepted production source revision', async () => {
  const verified = await assertBuildMatches(root);
  assert.equal(verified.version, version, 'Build version matches the current package');
});
