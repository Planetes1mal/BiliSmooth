// Pointer/viewport regressions exercise production presentation over local telemetry.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, ...options.context });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>html,body{margin:0;height:100%;background:#f5f7f6}</style><video></video>' }));
  await page.goto('https://www.bilibili.com/video/BV1motion');
  for (const file of ['src/core/settings.js', 'src/ui/surface.js', 'src/ui/entry-display.js', 'src/ui/motion-runtime.js', 'src/ui/choice.js']) {
    await page.addScriptTag({ path: path.resolve(__dirname, '..', file) });
  }
  await page.evaluate(({ config, position }) => {
    localStorage.setItem('bilismooth.panel.position.v3', JSON.stringify(position || { x: 500, y: 400, xSide: 'left', ySide: 'top' }));
    const listeners = new Set();
    const state = { config: BiliSmoothSettings.normalize({ floatingEntryType: 'logo', ...config }), media: { present: true, playback: 'paused' }, status: 'paused', mediaGeneration: 1, bufferWallSeconds: 14, lastMbps: 16, lastTransferAt: Date.now(), settingsSave: { status: 'saved' } };
    window.fixtureState = state;
    window.BiliSmoothRuntime = { getConfig: () => structuredClone(state.config), getViewState: () => structuredClone(state), getState: () => structuredClone(state), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  }, { config: options.config || {}, position: options.position });
  await page.addScriptTag({ path: path.resolve(__dirname, '../src/page/floating-control.js') });
  const host = page.locator('#bilismooth-floating');
  await host.waitFor({ state: 'visible' });
  await page.waitForTimeout(100);
  return { page, host };
}

const bounds = host => host.evaluate(node => {
  const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height };
});

test('entry hover lifts the visible control while preserving the positioning anchor', async t => {
  const { page, host } = await fixture(t);
  const before = await bounds(host);
  await page.mouse.move(before.left + before.width / 2, before.top + before.height / 2);
  await page.waitForTimeout(55);
  const current = await bounds(host), visible = await host.locator('#bs-edge').boundingBox();
  assert.deepEqual(current, before);
  assert.ok(visible.y < before.top - .25, 'The entry lifts before hover reveals the preview');
  assert.equal(await host.getAttribute('data-phase'), 'edge');
});

test('preview hover settles three pixels above its anchor and stops immediately for either motion preference', async t => {
  const { page, host } = await fixture(t, { config: { floatingEntryEnabled: false } });
  const before = await bounds(host), surface = host.locator('.bs-shell');
  await page.mouse.move(before.left + 40, before.top + 40);
  await page.waitForTimeout(300);
  assert.deepEqual(await bounds(host), before);
  assert.ok(Math.abs((await surface.boundingBox()).y - (before.top - 3)) < .1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('#bilismooth-floating').dataset.motion === 'off');
  assert.ok(Math.abs((await surface.boundingBox()).y - before.top) < .1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.mouse.move(before.left + 50, before.top + 40);
  await page.waitForTimeout(300);
  assert.ok((await surface.boundingBox()).y < before.top - 2.8);
  await page.evaluate(() => window.postMessage({ __bilismoothFloating: 'motion', value: false }, location.origin));
  await page.waitForFunction(() => document.querySelector('#bilismooth-floating').dataset.motion === 'off');
  assert.ok(Math.abs((await surface.boundingBox()).y - before.top) < .1);
});

test('hover reduces its movement at viewport edges and never moves the safe border outside', async t => {
  for (const position of [{ x: 8, y: 8, xSide: 'left', ySide: 'top' }, { x: 1192, y: 892, xSide: 'right', ySide: 'bottom' }]) {
    const { page, host } = await fixture(t, { position });
    const before = await bounds(host);
    await page.mouse.move(before.left + before.width / 2, before.top + before.height / 2);
    await page.waitForTimeout(50);
    const visible = await host.locator('#bs-edge').boundingBox();
    assert.deepEqual(await bounds(host), before);
    assert.ok(visible.x >= 7.9 && visible.y >= 7.9);
    assert.ok(visible.x + visible.width <= 1192.1 && visible.y + visible.height <= 892.1);
  }
});

test('dragging clears hover before taking pointer coordinates and touch does not acquire hover', async t => {
  const { page, host } = await fixture(t, { config: { floatingEntryEnabled: false }, context: { hasTouch: true } });
  const before = await bounds(host);
  await page.mouse.move(before.left + 40, before.top + 40);
  await page.waitForTimeout(300);
  await page.mouse.down();
  assert.ok(Math.abs((await host.locator('.bs-shell').boundingBox()).y - before.top) < .1);
  await page.mouse.move(before.left + 80, before.top + 70, { steps: 4 });
  await page.mouse.up();
  const moved = await bounds(host);
  assert.ok(Math.abs(moved.left - before.left - 40) < .2);
  assert.ok(Math.abs(moved.top - before.top - 30) < .2);
  await page.mouse.move(20, 20);
  await page.touchscreen.tap(moved.left + 30, moved.top + 30);
  assert.equal(await host.getAttribute('data-hover'), 'none');
});

test('larger floating labels and controls fit a 320 pixel viewport', async t => {
  const { page, host } = await fixture(t, { config: { lang: 'en' }, context: { viewport: { width: 320, height: 740 } } });
  await page.evaluate(() => BiliSmoothFloating.open());
  await page.waitForTimeout(500);
  const issues = await host.evaluate(node => {
    const frame = node.getBoundingClientRect(), problems = [];
    for (const element of node.shadowRoot.querySelectorAll('.bs-actions .bs-button,.bs-footer .bs-button,.bs-route-trigger,.bs-unit,.bs-state-detail,.bs-metric-label')) {
      const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
      const font = parseFloat(getComputedStyle(element).fontSize);
      if (font < (element.tagName === 'BUTTON' ? 14 : 12)) problems.push('Small type: ' + element.className);
      if (rect.left < frame.left - 1 || rect.right > frame.right + 1) problems.push('Overflow: ' + element.className);
    }
    if (frame.left < 7.9 || frame.right > innerWidth - 7.9) problems.push('Panel outside viewport');
    return problems;
  });
  assert.deepEqual(issues, []);
});

test('hover resumes after a snap completes and hiding the document clears it', async t => {
  const { page, host } = await fixture(t, { config: { floatingEntryEnabled: false } });
  const before = await bounds(host);
  await page.mouse.move(before.left + 40, before.top + 40);
  await page.mouse.down();
  const targetLeft = 1200 - before.width - 20;
  await page.mouse.move(targetLeft + 40, before.top + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => {
    const host = document.querySelector('#bilismooth-floating');
    return !host.getAnimations().some(animation => animation.playState === 'running') && host.dataset.hover === 'preview';
  });
  await page.waitForTimeout(280);
  const settled = await bounds(host);
  assert.ok(Math.abs(settled.left + settled.width - 1192) < .1);
  assert.ok(Math.abs((await host.locator('.bs-shell').boundingBox()).y - settled.top + 3) < .1);
  await page.evaluate(() => {
    window.testHidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => testHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await host.getAttribute('data-hover'), 'none');
  await page.evaluate(() => { testHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await host.waitFor({ state: 'visible' });
  assert.equal(await host.getAttribute('data-hover'), 'none');
  await page.mouse.move(settled.left + 50, settled.top + 40);
  await page.waitForFunction(() => document.querySelector('#bilismooth-floating').dataset.hover === 'preview');
});

for (const phase of ['edge', 'preview']) test(`opening from a hovered ${phase} starts at its current visible bounds`, async t => {
  const { page, host } = await fixture(t, { config: { floatingEntryEnabled: phase === 'edge' } });
  const anchor = await bounds(host);
  await page.mouse.move(anchor.left + 30, anchor.top + 30);
  await page.waitForTimeout(phase === 'edge' ? 55 : 300);
  const frames = await host.evaluate((node, phase) => {
    const root = node.shadowRoot, visible = phase === 'edge' ? root.querySelector('#bs-edge') : root.querySelector('.bs-shell');
    const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
    const before = rect(visible);
    if (phase === 'edge') root.querySelector('#bs-edge').focus(); else BiliSmoothFloating.open();
    return { before, first: rect(root.querySelector('.bs-shell')) };
  }, phase);
  for (const coordinate of ['left', 'top', 'width', 'height']) {
    assert.ok(Math.abs(frames.before[coordinate] - frames.first[coordinate]) < .25, coordinate + ': ' + JSON.stringify(frames));
  }
});
