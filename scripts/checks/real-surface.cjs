'use strict';
// One disposable real-page inspection of the floating control: placement against the real player, the three
// phases, the server menu, web and native full screen, and (with --themes) light/dark × zh/en screenshots.
// Anonymous profile, no settings writes except --themes, no route changes and no media benchmark.
const fs = require('node:fs/promises'), path = require('node:path');
const { chromium } = require('playwright');
const { createEvidenceOutput, assertBuildMatches } = require('../lib/evidence.cjs');
const local = require('../lib/local.cjs');
const root = path.resolve(__dirname, '../..');
const version = require('../../package.json').version;
const output = createEvidenceOutput({ root, suite: 'real-surface' });
const url = process.argv.find(value => value.startsWith('--url='))?.slice(6) || 'https://www.bilibili.com/video/BV14nYT6mE5N/';
const report = { version, url, startedAt: new Date().toISOString(), viewport: { width: 1440, height: 900 }, checks: [], screenshots: [], errors: [], uncovered: [],
  scope: 'Real Bilibili page, anonymous disposable profile, built extension. Placement, phases, server menu, full screen. No playback benchmark.' };
const check = (name, passed, detail) => report.checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });

// Runs in the page: geometry of the control against the viewport, the player and its native controls.
function observe() {
  const host = document.getElementById('bilismooth-floating'), shadow = host?.shadowRoot;
  const rect = node => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
  const overlap = (a, b) => a && b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)) : 0;
  const box = rect(host), width = document.documentElement.clientWidth, height = document.documentElement.clientHeight;
  const player = rect(document.querySelector('.bpx-player-container,#bilibili-player')), controls = rect(document.querySelector('.bpx-player-control-bottom'));
  const menu = shadow?.querySelector('.menu:not([hidden])'), menuRect = rect(menu);
  const inside = r => !!r && r.x >= 7.5 && r.y >= 7.5 && r.right <= width - 7.5 && r.bottom <= height - 7.5;
  const view = window.BiliSmoothRuntime?.getViewState?.();
  return { phase: host?.dataset.phase, hidden: !host || host.hidden, hiddenReason: host?.dataset.hiddenReason, state: host?.dataset.state, theme: host?.dataset.theme, motion: host?.dataset.motion,
    rect: box, inside: inside(box), playerOverlap: overlap(box, player), controlsOverlap: overlap(box, controls), menuOpen: !!menu, menuInside: inside(menuRect),
    panelOverflow: (() => { const body = shadow?.querySelector('.panel:not([hidden]) .body'); return body ? body.scrollWidth > body.clientWidth : false; })(),
    runtime: { version: view?.version, mediaPresent: view?.media?.present, playback: view?.media?.playback } };
}

(async () => {
  await fs.mkdir(local.tmp, { recursive: true });
  const work = await fs.mkdtemp(path.join(local.tmp, `real-surface-${version}-`)), extension = path.join(work, 'extension');
  await fs.cp(path.join(root, 'dist/extension'), extension, { recursive: true });
  await assertBuildMatches(root, extension);
  report.workDirectory = path.relative(root, work).replaceAll('\\', '/');
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(work, 'profile'), { channel: 'chromium', headless: true, viewport: report.viewport, colorScheme: 'light', locale: 'zh-CN',
      args: ['--mute-audio', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    const shot = async name => { const file = `real-surface-${version}-${name}.png`; await page.screenshot({ path: path.join(output, file) }); report.screenshots.push(file); };
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('video') && document.getElementById('bilismooth-floating')?.shadowRoot && window.BiliSmoothRuntime, undefined, { timeout: 25000 });
    await page.waitForFunction(() => document.querySelector('.bpx-player-control-bottom')?.getBoundingClientRect().height > 0, undefined, { timeout: 15000 }).catch(() => report.uncovered.push('Native player controls did not appear.'));
    await page.evaluate(() => document.querySelectorAll('video').forEach(video => video.pause()));
    await page.mouse.move(5, 5); await page.waitForTimeout(800);
    const host = page.locator('#bilismooth-floating');
    report.edge = await page.evaluate(observe); await shot('edge');
    check('Runtime and control are the built version', report.edge.runtime.version === version, report.edge.runtime);
    check('Entry is visible inside the viewport with an 8px inset', !report.edge.hidden && report.edge.inside, report.edge.rect);
    check('First placement covers neither the player nor its native controls', report.edge.playerOverlap === 0 && report.edge.controlsOverlap === 0, report.edge);
    const entry = await host.locator('#entry').boundingBox();
    await page.mouse.move(entry.x + entry.width / 2, entry.y + entry.height / 2); await page.waitForTimeout(500);
    report.preview = await page.evaluate(observe); await shot('preview');
    check('Hover opens the preview inside the viewport', report.preview.phase === 'preview' && report.preview.inside, report.preview.rect);
    await host.locator('#preview').click(); await page.mouse.move(5, 5); await page.waitForTimeout(500);
    report.panel = await page.evaluate(observe); await shot('panel');
    check('Click pins the panel inside the viewport without horizontal overflow', report.panel.phase === 'panel' && report.panel.inside && !report.panel.panelOverflow, report.panel.rect);
    check('The pinned panel stays off the player', report.panel.playerOverlap === 0, report.panel);
    await host.locator('#server').click(); await page.waitForTimeout(250);
    report.menu = await page.evaluate(observe); await shot('server-menu');
    check('The server menu opens inside the viewport', report.menu.menuOpen && report.menu.menuInside);
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    check('Escape closes only the menu', !(await page.evaluate(observe)).menuOpen && (await page.evaluate(observe)).phase === 'panel');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    check('Escape twice returns to the entry', (await page.evaluate(observe)).phase === 'edge');

    // Web full screen through the player's own button, then native full screen.
    const web = page.locator('.bpx-player-ctrl-web');
    if (await web.count()) {
      await page.locator('.bpx-player-container').hover(); await web.first().click({ force: true }); await page.waitForTimeout(800);
      report.webFullscreen = await page.evaluate(observe); await shot('web-fullscreen');
      check('Web full screen hides the control', report.webFullscreen.hidden && report.webFullscreen.hiddenReason === 'fullscreen', report.webFullscreen);
      await page.keyboard.press('Escape'); await page.waitForTimeout(800);
      report.afterWeb = await page.evaluate(observe);
      check('Leaving web full screen restores the collapsed entry', !report.afterWeb.hidden && report.afterWeb.phase === 'edge', report.afterWeb);
    } else report.uncovered.push('No web full screen button found.');
    const full = page.locator('.bpx-player-ctrl-full');
    if (await full.count()) {
      await page.locator('.bpx-player-container').hover(); await full.first().click({ force: true }); await page.waitForTimeout(1000);
      report.fullscreen = await page.evaluate(observe);
      check('Native full screen hides the control', report.fullscreen.hidden, report.fullscreen);
      await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()); await page.waitForTimeout(800);
      check('Leaving native full screen restores the entry', !(await page.evaluate(observe)).hidden);
    } else report.uncovered.push('No full screen button found.');

    if (process.argv.includes('--themes')) {
      for (const preferences of [{ theme: 'light', lang: 'zh' }, { theme: 'dark', lang: 'en' }, { theme: 'dark', lang: 'zh', accent: 'pink' }]) {
        await page.evaluate(async value => { BiliSmoothRuntime.setConfig(value); await BiliSmoothRuntime.flushSettings(); }, preferences);
        await page.waitForTimeout(400);
        const name = [preferences.theme, preferences.lang, preferences.accent].filter(Boolean).join('-');
        await page.evaluate(() => BiliSmoothFloating.open()); await page.mouse.move(5, 5); await page.waitForTimeout(500);
        await shot('panel-' + name);
        const state = await page.evaluate(observe);
        check(name + ': panel renders inside the viewport without overflow', state.theme === preferences.theme && state.inside && !state.panelOverflow);
        await page.evaluate(() => BiliSmoothFloating.collapse()); await page.evaluate(() => BiliSmoothFloating.collapse()); await page.waitForTimeout(300);
      }
    }
    check('No uncaught page errors from the extension', !report.errors.some(message => /bilismooth/i.test(message)), report.errors);
    report.status = report.checks.every(row => row.passed) ? 'passed' : 'issues-observed';
  } catch (error) { report.fatal = String(error.stack || error); report.status = 'incomplete'; }
  finally { await context?.close(); }
  report.finishedAt = new Date().toISOString();
  const file = path.join(output, `real-surface-${version}.json`);
  await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, fatal: report.fatal, failed: report.checks.filter(row => !row.passed).map(row => row.name), uncovered: report.uncovered, output: file }, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
