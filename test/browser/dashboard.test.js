// The built dashboard (dist/extension/control) against a stubbed chrome API: what it sends, what it
// shows for unknown values, and how it reports failures. Run `npm run build` first.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(root, 'dist/extension');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const origin = 'http://bilismooth-dashboard.test';
const [cos, ali, hw] = ['upos-sz-mirrorcosov', 'upos-sz-mirroraliov', 'upos-sz-mirrorhwov'].map(name => name + '.bilivideo.com');
const config = { enabled: true, selection: 'auto', mode: 'bad-only', pcdnHost: cos, mcdnStrategy: 'proxy-all', portHeuristic: true, stallRecovery: true,
  rewriteAkamai: false, p2pGuard: false, lang: 'zh', accent: 'blue', theme: 'light', floatingEntryType: 'icon' };
const playing = { present: true, playback: 'playing', frameHealth: { state: 'healthy', ageMs: 16 } };
const state = { status: 'smooth', startupReady: true, hidden: false, availability: null, settingsSave: { status: 'saved' }, needReload: false, reloadReasons: [],
  media: playing, rate: 1, buffer: 30, bufferWallSeconds: 30, actualHost: cos, requestedHost: cos, lastMbps: 40, allowedHosts: [cos, ali, hw],
  delivery: { status: 'native', canTest: true, nextTestAt: 0 }, startup: { playinfoToFirstFrameMs: 900 }, counters: { stalls: 0, recoveries: 0 },
  session: { hosts: [{ host: cos, goodputBps: 40e6, ttfbMedianMs: 120, measuredAt: null }], races: [], switches: [] }, speedSamples: [], events: [] };

let browser;
before(async () => { browser = await chromium.launch({ headless: true, args: ['--mute-audio'] }); });
after(async () => { await browser?.close(); });

// Runs in the page: answers like content.js/background.js and records every message.
function install({ version, state, config, tabs }) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const fx = window.fx = { calls: [], reloads: [], config: { ...config }, failConfig: false, version, tabs };
  const reply = () => {
    const now = Date.now(), fresh = state.lastMbps === null ? {} : { speedObservedAt: now, lastTransferAt: now };
    return { ok: true, result: { ...clone(state), ...fresh, version: fx.version, observedAt: now, sampledAt: now, config: clone(fx.config) } };
  };
  const noop = { addListener() {} };
  window.chrome = {
    runtime: { id: 'fixture', getManifest: () => ({ version }), onMessage: noop,
      async sendMessage(message) {
        fx.calls.push(clone(message));
        if (message.action === 'patch') { await fx.hold; Object.assign(fx.config, message.patch); }
        return { ok: true, result: clone(fx.config) };
      } },
    tabs: { async query() { return clone(fx.tabs); }, async getCurrent() { return { id: 9 }; }, async update(id) { return { id, windowId: 1 }; },
      async reload(id) { fx.reloads.push(id); },
      async sendMessage(tabId, message) {
        fx.calls.push({ tabId, ...clone(message) });
        if (fx.silent) return undefined;
        await fx.tabHold;
        if (['config', 'applyRoute', 'reload'].includes(message.action) && fx.failConfig) return { ok: false, error: 'settings-save-failed' };
        if (message.action === 'config') Object.assign(fx.config, message.patch);
        if (message.action === 'applyRoute') Object.assign(fx.config, { enabled: true, selection: 'fixed', pcdnHost: message.patch.host });
        return reply();
      }, onRemoved: noop, onUpdated: noop, onCreated: noop },
    windows: { async update() {} },
    storage: { local: { async get() { return { bilismoothMotion: true }; }, async set() {} }, onChanged: noop }
  };
}

async function open(t, { overrides = {}, settings = {}, tabs, hash = 'overview', colorScheme = 'light', expect = 'connected' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await context.close(); assert.deepEqual(errors, [], 'no page errors'); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const file = path.join(dist, decodeURIComponent(url.pathname));
    const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)];
    return route.fulfill({ body: await fs.readFile(file), contentType: type });
  });
  await context.addInitScript(install, { version, state: { ...state, ...overrides }, config: { ...config, ...settings },
    tabs: tabs ?? [{ id: 41, windowId: 1, active: false, title: 'Fixture video', url: 'https://www.bilibili.com/video/BV1fixture/' }] });
  await page.goto(`${origin}/control/index.html${tabs?.length === 0 ? '' : '?tab=41'}#${hash}`);
  await page.waitForFunction(status => window.BiliSmoothView?.status() === status, expect);
  return page;
}
const sent = (page, ...actions) => page.evaluate(actions => fx.calls.filter(call => actions.includes(call.action)).map(({ action, patch, channel }) => ({ action, patch, channel })), actions);
async function waitSent(page, count, ...actions) {
  await page.waitForFunction(([count, actions]) => fx.calls.filter(call => actions.includes(call.action)).length >= count, [count, actions]);
  return sent(page, ...actions);
}

test('server choices send the documented patch or command', async t => {
  const page = await open(t, { hash: 'routes' });
  await page.locator('label.ropt[data-choice="default"]').click();
  await page.locator('label.ropt[data-choice="auto"]').click();
  await page.locator(`label.ropt[data-choice="${hw}"]`).click();
  const calls = await waitSent(page, 3, 'config', 'applyRoute');
  assert.deepEqual(calls.map(({ action, patch }) => ({ action, patch })), [
    { action: 'config', patch: { enabled: false } },
    { action: 'config', patch: { enabled: true, selection: 'auto', mode: 'bad-only' } },
    { action: 'applyRoute', patch: { host: hw } }]);
  // "When to replace" belongs to a fixed server only.
  await page.getByRole('radio', { name: '始终' }).check();
  assert.deepEqual((await waitSent(page, 4, 'config', 'applyRoute')).at(-1).patch, { mode: 'force' });
  await page.locator(`label.ropt[data-choice="auto"]`).click();
  await page.locator('.line.when').waitFor({ state: 'hidden' });
  // A server the user adds is validated, then joins the saved list without changing the choice.
  const bcache = 'cn-jxnc-cmcc-bcache-06.bilivideo.com', box = page.getByRole('textbox', { name: '自定义线路' });
  await box.fill('upos-sz-mirrorali.bilivideo.com:8082');
  await page.getByRole('button', { name: '添加' }).click();
  await page.locator('#custom-error').waitFor();
  assert.equal((await sent(page, 'config', 'applyRoute')).length, 5);
  await box.fill('CN-JXNC-CMCC-BCACHE-06.bilivideo.com');
  await page.getByRole('button', { name: '添加' }).click();
  const added = (await waitSent(page, 6, 'config', 'applyRoute')).at(-1);
  assert.deepEqual({ action: added.action, patch: added.patch }, { action: 'config', patch: { customHosts: [bcache] } });
  // It is chosen like any server; removing the fixed server returns to Automatic.
  await page.locator(`label.ropt[data-choice="${bcache}"]`).click();
  assert.deepEqual((await waitSent(page, 2, 'applyRoute')).at(-1).patch, { host: bcache });
  await page.getByRole('button', { name: '删除cn-jxnc-cmcc-bcache-06' }).click();
  assert.deepEqual((await waitSent(page, 8, 'config', 'applyRoute')).at(-1).patch, { customHosts: [], selection: 'auto', pcdnHost: cos });
  await page.locator(`label.ropt[data-choice="${bcache}"]`).waitFor({ state: 'detached' });
  assert.equal((await sent(page, 'applyRoute')).length, 2, 'removing does not choose the row');
  // The Overview quick select uses the same commands.
  await page.locator('.nav a[data-page="overview"]').click();
  await page.locator('.quick select').selectOption(ali);
  assert.deepEqual((await waitSent(page, 3, 'applyRoute')).at(-1).patch, { host: ali });
});

test('unknown values read as — and untested servers stay untested', async t => {
  const page = await open(t, { overrides: { lastMbps: null, buffer: null, bufferWallSeconds: null, actualHost: null, session: null, counters: {}, startup: {} } });
  assert.deepEqual((await page.locator('.kpi strong').allTextContents()).map(value => value.trim()), ['—', '—', '—', '—']);
  assert.equal((await page.locator('#live-speed').textContent()).trim(), '—');
  await page.locator('.nav a[data-page="routes"]').click();
  assert.deepEqual(await page.locator('.hostrows .speed').allTextContents(), ['未测速', '未测速', '未测速']);
  assert.deepEqual(await page.locator('.hostrows .ttfb').allTextContents(), ['—', '—', '—']);
  await page.locator('.nav a[data-page="logs"]').click();
  assert.deepEqual((await page.locator('.stats strong').allTextContents()).map(value => value.trim()), ['—', '—', '—']);
});

test('theme, accent and language apply at once and are saved', async t => {
  const page = await open(t, { hash: 'settings', colorScheme: 'dark', settings: { theme: 'system' } });
  const root = page.locator('html');
  assert.equal(await root.getAttribute('data-theme'), 'dark', 'system follows the color scheme');
  await page.getByRole('radio', { name: '浅色' }).check();
  assert.equal(await root.getAttribute('data-theme'), 'light');
  await page.getByRole('radio', { name: '粉' }).check();
  assert.equal(await root.getAttribute('data-accent'), 'pink');
  await page.getByRole('radio', { name: 'English' }).check();
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  assert.equal(await page.locator('.nav a[data-page="routes"]').textContent(), 'Servers');
  assert.deepEqual((await waitSent(page, 3, 'config')).map(call => call.patch), [{ theme: 'light' }, { accent: 'pink' }, { lang: 'en' }]);
});

test('starting on the fastest tested server saves at once and applies with Automatic only', async t => {
  const page = await open(t, { hash: 'settings' }), name = '开播时用测得最快的线路';
  assert.equal(await page.getByRole('switch', { name }).isChecked(), true, 'on for a record saved before the switch existed');
  await page.getByRole('switch', { name }).click();
  assert.deepEqual((await waitSent(page, 1, 'config')).map(call => call.patch), [{ startOnBest: false }]);
  const fixed = await open(t, { hash: 'settings', settings: { selection: 'fixed', pcdnHost: hw } });
  assert.equal(await fixed.locator('.line').filter({ has: fixed.getByRole('switch', { name }) }).getAttribute('class'), 'line off');
});

test('the floating control switch saves, dims the rest of its card and survives Restore defaults', async t => {
  const page = await open(t, { hash: 'settings' });
  const shown = page.getByRole('switch', { name: '在视频页显示浮窗' });
  assert.equal(await shown.isChecked(), true);
  await shown.click();
  assert.deepEqual((await waitSent(page, 1, 'config')).map(call => call.patch), [{ showFloating: false }]);
  await page.locator('.etiles.off').waitFor();
  await page.getByRole('button', { name: '恢复默认设置' }).click();
  await page.locator('dialog[open] button[value=ok]').click();
  assert.equal((await waitSent(page, 2, 'config')).at(-1).patch.showFloating, false);
});

test('a failed save is shown, rolled back and retried', async t => {
  const page = await open(t, { hash: 'settings' });
  const ports = page.getByRole('switch', { name: '识别带端口的地址' });
  await page.evaluate(() => { fx.failConfig = true; });
  await ports.click();
  const notice = page.locator('#notice');
  await notice.getByText('设置没有保存').waitFor();
  await page.waitForFunction(() => document.querySelector('input[data-t-label="ports"]').checked, null);
  await page.evaluate(() => { fx.failConfig = false; });
  await notice.getByRole('button', { name: '重试' }).click();
  await notice.waitFor({ state: 'hidden' });
  assert.equal(await ports.isChecked(), false);
  assert.deepEqual((await sent(page, 'config')).map(call => call.patch), [{ portHeuristic: false }, { portHeuristic: false }]);
});

test('a background save that ends after the tab answers again keeps the tab state', async t => {
  const page = await open(t, { hash: 'settings' });
  await page.evaluate(() => { fx.silent = true; return BiliSmoothLive.refresh(true); });
  await page.waitForFunction(() => BiliSmoothView.status() === 'no-response');
  // A poll is already waiting on the tab when the setting changes; the tab answers before the background does.
  await page.evaluate(() => {
    fx.silent = false; fx.tabHold = new Promise(resolve => { fx.answer = resolve; }); fx.hold = new Promise(resolve => { fx.release = resolve; });
    BiliSmoothLive.refresh(true);
  });
  await page.waitForTimeout(100);
  await page.getByRole('radio', { name: '深色' }).check();
  await page.evaluate(() => { fx.tabHold = null; fx.answer(); });
  await page.waitForFunction(() => BiliSmoothView.status() === 'connected');
  await page.evaluate(() => fx.release());
  await page.waitForFunction(() => fx.config.theme === 'dark');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => typeof BiliSmoothView.getSnapshot()?.media), 'object', 'the snapshot is still the tab state');
});

test('custom hosts, blocked videos and the entry preview read as in the floating control', async t => {
  const custom = 'upos-sz-mirrorcustom.bilivideo.com';
  const page = await open(t, { hash: 'routes', settings: { selection: 'auto', pcdnHost: custom } });
  await page.locator(`label.ropt[data-choice="${custom}"]`).waitFor();
  // The saved list is full at eight servers.
  const own = Array.from({ length: 8 }, (_, index) => `upos-sz-mirror${index}x.bilivideo.com`);
  const full = await open(t, { hash: 'routes', settings: { customHosts: own } });
  assert.equal(await full.locator('.hostrows .remove:not([hidden])').count(), 8);
  await full.getByRole('textbox', { name: '自定义线路' }).fill('cn-hk-eq-bcache-01.bilivideo.com');
  await full.getByRole('button', { name: '添加' }).click();
  assert.equal((await full.locator('#custom-error').textContent()).trim(), '最多添加 8 条自定义线路。');
  assert.equal((await sent(full, 'config')).length, 0);
  const blocked = await open(t, { hash: 'routes', overrides: { availability: { reason: 'region' } } });
  assert.equal(await blocked.locator('.radios').evaluate(node => node.inert), true);
  const off = await open(t, { hash: 'settings', settings: { enabled: false } });
  assert.equal(await off.locator('.etile .dot').first().getAttribute('class'), 'dot idle');
});

test('a reload whose save fails says the video was not reloaded', async t => {
  const page = await open(t, { overrides: { needReload: true, reloadReasons: ['playinfo-config'] } });
  await page.evaluate(() => { fx.failConfig = true; });
  await page.locator('#notice').getByRole('button', { name: '刷新视频页' }).click();
  await page.getByText('设置没有确认保存，视频页没有刷新。').waitFor();
});

test('an outdated tab asks for a reload; without a tab settings go to the background', async t => {
  const stale = await open(t);
  await stale.evaluate(() => { fx.version = '0.0.0'; });
  await stale.evaluate(() => BiliSmoothLive.refresh(true));
  await stale.locator('#notice').getByText('需要刷新视频页').waitFor();
  await stale.locator('#notice').getByRole('button', { name: '刷新视频页' }).click();
  assert.deepEqual(await stale.evaluate(() => fx.reloads), [41]);

  const empty = await open(t, { tabs: [], hash: 'settings', expect: 'no-tab' });
  await empty.locator('#notice').getByText('没有打开的 B站视频').waitFor();
  await empty.getByRole('radio', { name: '深色' }).check();
  const [patch] = await waitSent(empty, 1, 'patch');
  assert.deepEqual(patch, { action: 'patch', patch: { theme: 'dark' }, channel: 'bilismooth-settings' });
});

test('diagnostics download as a file; clearing the log waits for confirmation', async t => {
  const page = await open(t, { hash: 'logs' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出诊断' }).click();
  assert.match((await download).suggestedFilename(), /^bilismooth-diagnostics-\d{4}-\d\d-\d\dT[\d-]+Z\.json$/);
  await page.locator('.logtools').getByRole('button', { name: '清空' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: '取消' }).click();
  assert.equal((await sent(page, 'clearEvents')).length, 0);
  await page.locator('.logtools').getByRole('button', { name: '清空' }).click();
  await page.locator('dialog[open] button[value=ok]').click();
  await waitSent(page, 1, 'clearEvents');
});
