const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'dist/extension');
const assets = path.join(root, 'docs/chrome-web-store/assets');
const images = path.join(root, 'docs/images');
const demoURL = 'https://www.bilibili.com/video/BV1BiliSmoothDemo/';
const demoImageURL = 'https://i0.hdslb.com/bfs/bilismooth-demo/test-video.png';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(`Usage: npm run store:capture

Build the extension first with npm run build. Requires Playwright Chromium and
Python with Pillow; set PYTHON to choose the Python executable.
Captures the actual extension in a fresh work/store-capture-* browser profile,
saves English store screenshots, and encodes docs/images/floating-demo.gif.
The video page and cover are served locally from scripts/fixtures/store-demo.html
and docs/images/test-video.png. Remote web requests are blocked. Playback uses a
local canvas stream, so these images demonstrate the UI, not CDN performance.
This command does not upload or publish anything.`);
    return;
  }
  if (args.length) throw new Error(`Unknown argument: ${args[0]}. Use --help.`);
  const demoHTML = await fs.readFile(path.join(__dirname, 'fixtures/store-demo.html'), 'utf8');
  const demoImage = await fs.readFile(path.join(images, 'test-video.png'));

  const { chromium } = require('playwright');
  await fs.mkdir(path.join(root, 'work'), { recursive: true });
  const out = await fs.mkdtemp(path.join(root, 'work', 'store-capture-'));
  const frames = path.join(out, 'frames');
  const context = await chromium.launchPersistentContext(path.join(out, 'profile'), {
    channel: 'chromium', headless: true, locale: 'en-US',
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required']
  });
  try {
    const blockedRequests = new Set();
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url === demoURL) return route.fulfill({ status: 200, contentType: 'text/html', body: demoHTML });
      if (url === demoImageURL) return route.fulfill({ status: 200, contentType: 'image/png', body: demoImage,
        headers: { 'access-control-allow-origin': '*' } });
      if (!/^https?:/.test(url)) return route.continue();
      blockedRequests.add(url);
      return route.abort('blockedbyclient');
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const initial = await worker.evaluate(() => ({ manifest: chrome.runtime.getManifest(), language: chrome.i18n.getUILanguage() }));
    console.log(JSON.stringify({ stage: 'installed', version: initial.manifest.version, name: initial.manifest.name,
      language: initial.language, permissions: initial.manifest.host_permissions }));
    await worker.evaluate(async () => {
      const key = 'bilismooth.config.v4';
      const old = (await chrome.storage.local.get(key))[key] || {};
      await chrome.storage.local.set({ [key]: { ...old, lang: 'en', theme: 'light', accent: 'teal' } });
    });
    const page = await context.newPage();
    for (const old of context.pages()) if (old !== page) await old.close();
    const response = await page.goto(demoURL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    console.log(JSON.stringify({ stage: 'navigation', status: response.status(), title: await page.title() }));
    await page.waitForFunction(() => document.querySelector('video') && document.querySelector('#bilismooth-floating')?.shadowRoot &&
      window.BiliSmoothSession?.getState().startupReady && document.querySelector('video').currentTime > 1,
      {}, { timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, 'initial.png') });
    console.log(JSON.stringify({ stage: 'playback', state: await page.evaluate(() => {
      const s = BiliSmoothSession.getState(), v = document.querySelector('video');
      return { version: s.version, title: s.videoMeta?.title,
        media: { width: v.videoWidth, height: v.videoHeight, paused: v.paused, time: v.currentTime },
        floating: document.querySelector('#bilismooth-floating').dataset.phase, lang: s.config.lang };
    }) }));

    const host = page.locator('#bilismooth-floating');
    await page.mouse.move(700, 740); await page.waitForTimeout(1200);
    await fs.mkdir(assets, { recursive: true });
    await fs.mkdir(images, { recursive: true });
    await host.locator('#bs-edge').hover(); await host.locator('#bs-move').click();
    await page.mouse.move(700, 100); await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(assets, 'screenshot-floating-en.png') });
    await host.locator('#bs-close').click(); await page.mouse.click(200, 110); await page.mouse.move(10, 790);
    await page.setViewportSize({ width: 960, height: 600 }); await page.waitForTimeout(600);

    await fs.mkdir(frames, { recursive: true });
    let frame = 0;
    const shots = async count => {
      for (let n = 0; n < count; n++) {
        await page.screenshot({ path: path.join(frames, `frame-${String(frame++).padStart(3, '0')}.png`) });
        await page.waitForTimeout(80);
      }
    };
    await shots(8); await host.locator('#bs-edge').hover(); await shots(6);
    await host.locator('#bs-move').click(); await page.mouse.move(10, 590); await shots(8);
    await host.locator('#bs-route').click(); await shots(9); await page.keyboard.press('Escape'); await shots(3);
    await host.locator('#bs-close').click(); await page.mouse.click(200, 110); await page.mouse.move(10, 590); await shots(6);

    const id = new URL(worker.url()).hostname;
    const sourceId = await worker.evaluate(async actualURL => {
      const tabs = await chrome.tabs.query({ url: 'https://*.bilibili.com/video/*' });
      return tabs.find(tab => tab.url === actualURL).id;
    }, page.url());
    const control = await context.newPage();
    await control.goto(`chrome-extension://${id}/control/index.html?tab=${sourceId}`);
    await control.waitForFunction(() => window.BiliSmoothView?.getSnapshot().startupReady &&
      document.querySelector('#video-title')?.textContent === 'Test video' &&
      document.querySelector('#video-cover')?.complete && document.querySelector('#video-cover')?.naturalWidth > 0);
    const controlId = await control.evaluate(() => new Promise(resolve => chrome.tabs.getCurrent(tab => resolve(tab.id))));
    await worker.evaluate(async tab => chrome.tabs.setZoom(tab, 0.85), controlId);
    await control.waitForTimeout(2000);
    await control.screenshot({ path: path.join(assets, 'screenshot-dashboard-en.png') });
    await fs.copyFile(path.join(assets, 'screenshot-dashboard-en.png'), path.join(images, 'dashboard.png'));
    await control.locator('nav [data-page="routes"]').click(); await control.waitForTimeout(700);
    await control.screenshot({ path: path.join(assets, 'screenshot-routes-en.png') });
    await control.locator('nav [data-page="settings"]').click(); await control.waitForTimeout(700);
    await control.screenshot({ path: path.join(assets, 'screenshot-preferences-en.png') });
    console.log(JSON.stringify({ stage: 'dashboard', language: await control.locator('html').getAttribute('lang'),
      title: await control.locator('#video-title').innerText() }));
    const details = {
      version: initial.manifest.version, page: demoURL, cover: demoImageURL,
      title: await control.locator('#video-title').innerText(),
      mediaSource: 'Locally rendered canvas stream; no CDN performance samples.',
      blockedRequests: [...blockedRequests]
    };
    await fs.writeFile(path.join(out, 'capture.json'), JSON.stringify(details, null, 2) + '\n');
    console.log(JSON.stringify({ stage: 'local-only', ...details }));
  } finally { await context.close(); }

  const gif = path.join(images, 'floating-demo.gif');
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python', ['-c', `
from pathlib import Path
from PIL import Image
import sys
frames = [Image.open(file).convert('RGB').quantize(colors=128, dither=Image.Dither.NONE)
          for file in sorted(Path(sys.argv[1]).glob('frame-*.png'))]
frames[0].save(sys.argv[2], save_all=True, append_images=frames[1:], duration=200, loop=0, optimize=True)
`, frames, gif], { cwd: root, shell: false, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`GIF encoding failed (${code}); PNG frames remain at ${frames}.`)));
  });
  console.log(JSON.stringify({ screenshots: assets, gif, capture: out }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
