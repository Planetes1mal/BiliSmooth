// Local fixture for the dashboard's layout and controls: the built page (dist/extension/control) with a
// stubbed chrome API and deterministic telemetry. Screenshots of every page in light/Chinese and
// dark/English at 1280×800, plus layout checks at 900 px. This is not playback evidence.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createEvidenceOutput, assertBuildMatches } = require('../lib/evidence.cjs');

const root = path.resolve(__dirname, '../..');
const version = require('../../package.json').version;
const origin = 'http://bilismooth-control.test';
const PAGES = ['overview', 'routes', 'settings', 'logs'];
const HOSTS = ['upos-sz-mirrorcosov', 'upos-sz-mirroraliov', 'upos-sz-mirrorhwov', 'upos-sz-mirrorali', 'upos-tf-all-hw', 'upos-sz-mirrorhw',
  'upos-sz-mirrorcos', 'upos-tf-all-tx', 'upos-sz-mirrorhwb'].map(name => name + '.bilivideo.com');

// Runs in the page before the dashboard: a chrome API that answers like the content script and background.
function installStub({ version, hosts, scenario, config }) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const [cos, ali, hw] = hosts;
  const fixture = window.fixture = { scenario, config: { ...config }, calls: [], listeners: [], motion: true,
    tabs: scenario === 'disconnected' ? [] : [
      { id: 41, windowId: 1, active: false, title: '本地样例视频 · BV1fixture', url: 'https://www.bilibili.com/video/BV1fixture/' },
      { id: 42, windowId: 1, active: true, title: '第二个视频', url: 'https://www.bilibili.com/video/BV2fixture/' }] };
  const wave = second => Math.max(0, 4.8 + Math.sin(second / 3.1) * 0.7 + Math.sin(second / 1.7) * 0.25);
  function state() {
    const now = Date.now(), second = Math.floor(now / 1000);
    const speedSamples = Array.from({ length: 46 }, (_, i) => ({ at: now - (45 - i) * 1000, mbps: i > 16 && i < 21 ? null : wave(second - 45 + i) * 8 }));
    const at = ago => now - ago * 1000;
    return { version, observedAt: now, sampledAt: now, hidden: false, startupReady: true, status: 'smooth', availability: null,
      videoMeta: { title: '本地样例视频 · BV1fixture', url: 'https://www.bilibili.com/video/BV1fixture/', coverUrl: '' },
      config: clone(fixture.config), settingsSave: { status: 'saved' }, needReload: false, reloadReasons: [],
      media: { present: true, playback: 'playing', width: 1920, height: 1080, fps: 30, currentTime: 93, duration: 480, frameHealth: { state: 'healthy', ageMs: 16, thresholdMs: 3000 } },
      rate: 1, buffer: 38.4, bufferWallSeconds: 38.4, actualHost: cos, requestedHost: cos, targetHost: cos,
      lastMbps: speedSamples.at(-1).mbps, speedObservedAt: now, lastTransferAt: now,
      delivery: { status: 'current-fastest', nativeHost: hw, activeHost: cos, nextTestAt: 0, canTest: true, comparedHosts: 3 },
      allowedHosts: hosts, startup: { phase: 'stable', playinfoToFirstFrameMs: 1420, firstFrameEvidence: 'rvfc' },
      counters: { stalls: 2, frameStalls: 1, recoveries: 1, switches: 1, totalStallMs: 8700 }, recoveryAttempts: 2,
      session: { cid: 1, requiredBps: 12e6, switchCount: 1,
        hosts: [{ host: hw, goodputBps: 1.62 * 8e6, ttfbMedianMs: 388, measuredAt: at(180) }, { host: cos, goodputBps: 5.12 * 8e6, ttfbMedianMs: 182, measuredAt: at(4) },
          { host: ali, goodputBps: 4.4 * 8e6, ttfbMedianMs: 214, measuredAt: at(40) }],
        representations: [[120, 12e6, true], [80, 3e6, false], [64, 1.5e6, false]].map(([id, bandwidth, requested]) => ({ id, kind: 'video', bandwidth, height: 0, codecId: 12, requested })),
        races: [{ at: at(61), currentHost: cos, contenders: [ali, hw], verdict: 'current-fastest' }],
        switches: [{ at: at(138), fromHost: hw, toHost: cos, scope: 'video' }, { at: at(149), fromHost: hw, toHost: ali, scope: 'fragment' }] },
      speedSamples,
      events: [
        { seq: 1, at: at(160), type: 'transfer', host: hw, bytes: 1.0e6, elapsedMs: 214, status: 206, outcome: 'complete' },
        { seq: 2, at: at(158), type: 'player-event', source: 'playing' },
        { seq: 3, at: at(150), type: 'transfer', host: hw, status: 403, outcome: 'http-error', elapsedMs: 120 },
        { seq: 4, at: at(138), type: 'switch', fromHost: hw, toHost: cos },
        { seq: 5, at: at(70), type: 'transfer', host: hw, outcome: 'timeout', elapsedMs: 1990 },
        { seq: 6, at: at(68), type: 'synthetic-timeout', phase: 'triggered', host: hw },
        { seq: 7, at: at(66), type: 'stall', host: cos },
        { seq: 8, at: at(61), type: 'race', reason: 'finished', host: cos, bytes: 1.5e6 },
        { seq: 9, at: at(60), type: 'playback-recovered', host: cos, durationMs: 6800 }] };
  }
  const noop = { addListener() {} };
  window.chrome = {
    runtime: { id: 'fixture', getManifest: () => ({ version }), onMessage: { addListener: fn => fixture.listeners.push(fn) },
      async sendMessage(message) {
        fixture.calls.push(clone(message));
        if (message.action === 'patch') Object.assign(fixture.config, message.patch);
        return { ok: true, result: clone(fixture.config) };
      } },
    tabs: {
      async query() { return clone(fixture.tabs); },
      async sendMessage(tabId, message) {
        fixture.calls.push({ tabId, ...clone(message) });
        if (message.action === 'config') Object.assign(fixture.config, message.patch);
        if (message.action === 'applyRoute') Object.assign(fixture.config, { enabled: true, selection: 'fixed', pcdnHost: message.patch.host });
        return { ok: true, result: state() };
      },
      async update(id) { return { id, windowId: 1 }; }, async reload() {}, async getCurrent() { return { id: 99 }; },
      onRemoved: noop, onUpdated: noop, onCreated: noop },
    windows: { async update() {} },
    storage: { local: { async get() { return { bilismoothMotion: fixture.motion }; }, async set(value) { fixture.calls.push({ storage: value }); } }, onChanged: noop }
  };
}

async function open(browser, { scenario = 'live', theme = 'light', lang = 'zh', width = 1280, height = 800, page: name = 'overview' }, errors, external) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce', acceptDownloads: true });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    const file = path.join(root, 'dist/extension', decodeURIComponent(url.pathname));
    if (!file.startsWith(path.join(root, 'dist/extension') + path.sep)) return route.abort();
    const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(file)];
    try { return route.fulfill({ body: await fs.readFile(file), contentType: type || 'application/octet-stream' }); } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  const config = { enabled: true, selection: 'auto', mode: 'bad-only', pcdnHost: HOSTS[0], mcdnStrategy: 'proxy-all', portHeuristic: true, stallRecovery: true,
    rewriteAkamai: false, p2pGuard: false, lang, accent: 'blue', theme, floatingEntryType: 'icon' };
  await context.addInitScript(installStub, { version, hosts: HOSTS, scenario, config });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/control/index.html${scenario === 'disconnected' ? '' : '?tab=41'}#${name}`);
  await page.waitForFunction(scenario => window.BiliSmoothView?.status() === (scenario === 'disconnected' ? 'no-tab' : 'connected'), scenario);
  await page.waitForTimeout(150);
  return { context, page };
}

async function main() {
  const label = createEvidenceOutput({ root, suite: 'control-ui' });
  const browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  const checks = [], errors = [], external = [], shots = [];
  const check = async (name, fn) => { try { await fn(); checks.push({ name, passed: true }); } catch (error) { checks.push({ name, passed: false, error: error.message }); } };
  let build = null;
  await check('The built dashboard matches its sources', async () => { build = await assertBuildMatches(root); });
  try {
    for (const [theme, lang] of [['light', 'zh'], ['dark', 'en']]) {
      for (const name of PAGES) {
        const { context, page } = await open(browser, { theme, lang, page: name }, errors, external);
        const file = `${name}-${theme}-${lang}.png`;
        await page.screenshot({ path: path.join(label, file) }); shots.push(file);
        await context.close();
      }
    }
    {
      const { context, page } = await open(browser, { scenario: 'disconnected', page: 'overview' }, errors, external);
      await page.screenshot({ path: path.join(label, 'overview-disconnected-light-zh.png') }); shots.push('overview-disconnected-light-zh.png');
      await check('Without a video every number reads as —', async () => {
        const values = await page.locator('.kpi strong').allTextContents();
        assert.deepEqual(values.map(value => value.trim()), ['—', '—', '—', '—']);
      });
      await context.close();
    }
    {
      const { context, page } = await open(browser, { page: 'settings' }, errors, external);
      await page.getByRole('button', { name: '恢复默认设置' }).click();
      await page.locator('dialog[open]').waitFor();
      await page.screenshot({ path: path.join(label, 'settings-confirm-light-zh.png') }); shots.push('settings-confirm-light-zh.png');
      await context.close();
    }
    for (const name of PAGES) {
      const { context, page } = await open(browser, { page: name, width: 900, height: 800 }, errors, external);
      await check(`${name} fits 900 px without sideways scrolling`, async () => {
        const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
        assert.ok(overflow <= 0, `overflow ${overflow}px`);
      });
      await check(`${name}: every visible control has a name`, async () => {
        const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, input, select, a[href]')].filter(node => node.getClientRects().length || node.closest('label')?.getClientRects().length)
          .filter(node => !(node.getAttribute('aria-label') || node.textContent.trim() || node.closest('label')?.textContent.trim() || node.labels?.[0]?.textContent.trim()))
          .map(node => node.outerHTML.slice(0, 80)));
        assert.deepEqual(unnamed, []);
      });
      await check(`${name}: keyboard focus is visible`, async () => {
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press('Tab');
          const style = await page.evaluate(() => {
            const node = document.activeElement, target = node.matches('input[type=radio]') ? node.closest('label') : node;
            const css = getComputedStyle(target);
            return { tag: node.tagName, outline: css.outlineStyle, width: css.outlineWidth };
          });
          if (style.tag !== 'BODY' && style.tag !== 'MAIN') assert.ok(style.outline !== 'none' && style.width !== '0px', JSON.stringify(style));
        }
      });
      await page.screenshot({ path: path.join(label, `${name}-900.png`), fullPage: true }); shots.push(`${name}-900.png`);
      await context.close();
    }
    await check('No page errors and no requests outside the extension', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); });
  } finally { await browser.close(); }
  const report = { version, build, fixtureOnly: true, scope: 'Dashboard layout and controls on a local fixture; no playback evidence.',
    passed: checks.every(item => item.passed), checks, shots, errors, external };
  await fs.writeFile(path.join(label, 'checks.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, failed: checks.filter(item => !item.passed), shots: shots.length }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
