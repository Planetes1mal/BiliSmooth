'use strict';
// Text contrast of the floating control in every theme × accent × state, measured on the real shadow root
// (effective colors after backgrounds and opacity). Disabled controls are exempt, as in WCAG.
const fs = require('node:fs/promises'), path = require('node:path');
const { chromium } = require('playwright');
const { build } = require('esbuild');
const { createEvidenceOutput } = require('../lib/evidence.cjs');
const root = path.resolve(__dirname, '../..');
const out = createEvidenceOutput({ root, suite: 'theme-readability' });
const accents = ['blue', 'teal', 'green', 'orange', 'pink', 'graphite'];
const states = { smooth: {}, buffering: { media: { present: true, playback: 'buffering', frameHealth: { state: 'healthy' } } },
  frozen: { media: { present: true, playback: 'frozen', frameHealth: { state: 'frozen' } } }, waiting: { media: { present: false } }, blocked: { availability: { reason: 'region' } } };

// Runs in the page: every visible text run with its effective foreground over its composited background.
function measure() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v); };
  const over = (fg, bg, alpha) => [0, 1, 2].map(i => fg[i] * alpha + bg[i] * (1 - alpha));
  const lum = rgb => rgb.map(v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
  const parent = node => node.parentElement || node.getRootNode()?.host;
  const host = document.getElementById('bilismooth-floating'), rows = [];
  const walker = document.createTreeWalker(host.shadowRoot, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const node = text.parentElement;
    if (!node || node.tagName === 'STYLE' || !text.textContent.trim()) continue;
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    if (!rect.width || !rect.height || style.visibility === 'hidden' || node.closest('[hidden]')) continue;
    const chain = []; for (let item = node; item; item = parent(item)) chain.unshift(item);
    let background = [255, 255, 255], opacity = 1;
    for (const item of chain) { const s = getComputedStyle(item); opacity *= Number(s.opacity); const color = rgba(s.backgroundColor); background = over(color, background, color[3]); }
    const disabled = !!node.closest(':disabled');
    const foreground = over(rgba(style.color), background, rgba(style.color)[3] * opacity), size = parseFloat(style.fontSize), weight = Number(style.fontWeight);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    rows.push({ text: text.textContent.trim().slice(0, 40), size, contrast: +ratio(foreground, background).toFixed(2), threshold: disabled ? 0 : large ? 3 : 4.5, disabled });
  }
  return rows;
}

(async () => {
  const floating = (await build({ absWorkingDir: root, entryPoints: ['src/ui/floating/index.js'], bundle: true, format: 'iife', write: false, loader: { '.css': 'text', '.svg': 'text' } })).outputFiles[0].text;
  const settings = await fs.readFile(path.join(root, 'dist/extension/settings.js'), 'utf8');
  const browser = await chromium.launch({ args: ['--mute-audio'] }), failures = [], cases = [];
  try {
    for (const theme of ['light', 'dark']) for (const accent of accents) for (const [state, extra] of Object.entries(states)) {
      const context = await browser.newContext({ viewport: { width: 900, height: 700 }, reducedMotion: 'reduce' });
      await context.route('https://www.bilibili.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><body style="margin:0;background:${theme === 'dark' ? '#17181A' : '#fff'}">` }));
      const page = await context.newPage();
      await page.goto('https://www.bilibili.com/video/BV1theme');
      await page.addScriptTag({ content: settings });
      await page.evaluate(({ theme, accent, extra }) => {
        const config = BiliSmoothSettings.normalize({ theme, accent }), listeners = new Set();
        const state = { config, media: { present: true, playback: 'playing', frameHealth: { state: 'healthy' } }, mediaGeneration: 1, bufferWallSeconds: 12.4, lastMbps: 30,
          actualHost: 'upos-sz-mirrorcosov.bilivideo.com', allowedHosts: BiliSmoothSettings.fixedHosts, delivery: { status: 'native', canTest: true }, settingsSave: { status: 'saved' }, ...extra };
        window.BiliSmoothRuntime = { getConfig: () => structuredClone(config), getViewState: () => ({ ...structuredClone(state), observedAt: Date.now(), speedObservedAt: Date.now() }),
          setConfig() {}, applyRoute() { return true; }, async flushSettings() {}, retry() { return true; }, resetNetwork() {}, reload() {}, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
      }, { theme, accent, extra });
      await page.addScriptTag({ content: floating });
      await page.locator('#bilismooth-floating').waitFor({ state: 'visible' });
      const rows = [];
      for (const phase of ['edge', 'preview', 'panel']) {
        if (phase === 'preview') await page.locator('#bilismooth-floating #entry').hover();
        if (phase === 'panel') await page.evaluate(() => BiliSmoothFloating.open());
        await page.waitForTimeout(phase === 'edge' ? 50 : 300);
        rows.push(...(await page.evaluate(measure)).map(row => ({ ...row, phase })));
      }
      const failed = rows.filter(row => row.contrast < row.threshold);
      cases.push({ theme, accent, state, measured: rows.length, failed });
      for (const row of failed) failures.push({ theme, accent, state, ...row });
      await context.close();
    }
  } finally { await browser.close(); }
  const report = { generatedAt: new Date().toISOString(), scope: 'Floating control text in light/dark × 6 accents × 5 states × 3 phases', passed: failures.length === 0, failures, cases };
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, cases: cases.length, failures: failures.slice(0, 20), report: path.join(out, 'report.json') }, null, 2));
  if (!report.passed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
