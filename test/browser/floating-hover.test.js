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
    await page.addScriptTag({ path: path.resolve(__dirname, '../..', file) });
  }
  await page.evaluate(({ config, position }) => {
    localStorage.setItem('bilismooth.panel.position.v3', JSON.stringify(position || { x: 500, y: 400, xSide: 'left', ySide: 'top' }));
    const listeners = new Set();
    const state = { config: BiliSmoothSettings.normalize({ floatingEntryType: 'logo', ...config }), media: { present: true, playback: 'paused' }, status: 'paused', mediaGeneration: 1, bufferWallSeconds: 14, lastMbps: 16, lastTransferAt: Date.now(), settingsSave: { status: 'saved' } };
    window.fixtureState = state;
    window.BiliSmoothRuntime = { getConfig: () => structuredClone(state.config), getViewState: () => structuredClone(state), getState: () => structuredClone(state), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  }, { config: options.config || {}, position: options.position });
  await page.addScriptTag({ path: path.resolve(__dirname, '../../src/page/floating-control.js') });
  const host = page.locator('#bilismooth-floating');
  await host.waitFor({ state: 'visible' });
  await page.waitForTimeout(100);
  return { page, host };
}

const bounds = host => host.evaluate(node => {
  const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height };
});

test('hover motion stops immediately for either motion preference', async t => {
  const { page, host } = await fixture(t, { config: { floatingEntryEnabled: false } });
  const before = await bounds(host), surface = host.locator('.bs-shell');
  await page.mouse.move(before.left + 40, before.top + 40);
  await page.waitForTimeout(300);
  assert.deepEqual(await bounds(host), before);
  assert.ok((await surface.boundingBox()).y < before.top, 'Hover motion is active before the preference changes');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('#bilismooth-floating').dataset.motion === 'off');
  assert.ok(Math.abs((await surface.boundingBox()).y - before.top) < .1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.mouse.move(before.left + 50, before.top + 40);
  await page.waitForTimeout(300);
  assert.ok((await surface.boundingBox()).y < before.top, 'Hover motion resumes after reduced motion is disabled');
  await page.evaluate(() => window.postMessage({ __bilismoothFloating: 'motion', value: false }, location.origin));
  await page.waitForFunction(() => document.querySelector('#bilismooth-floating').dataset.motion === 'off');
  assert.ok(Math.abs((await surface.boundingBox()).y - before.top) < .1);
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
