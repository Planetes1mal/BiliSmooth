// The dedicated test browser: a persistent Chromium profile outside the repository that loads
// dist/extension, keeps the maintainer's one-time Bilibili login, and after every build reloads
// the extension and refreshes the open video tabs. It opens only video pages under test.
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import login from './lib/login.cjs';
import { isMain, repositoryRoot, option } from './lib/entry.mjs';

const root = repositoryRoot(import.meta.url);
const extension = path.join(root, 'dist/extension');
const buildMarker = path.join(extension, 'BUILD.json');
const DEFAULT_VIDEO = 'https://www.bilibili.com/video/BV14nYT6mE5N/';
const isVideoPage = url => /^https:\/\/www\.bilibili\.com\/(?:video\/(?:BV[A-Za-z0-9]+|av\d+)|bangumi\/play\/(?:ep|ss)\d+|list\/(?:watchlater|ml\d+))\/?/.test(url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = message => console.log(`[dev ${new Date().toLocaleTimeString('en-GB')}] ${message}`);

function videoUrl(raw) {
  const url = new URL(raw);
  if (!isVideoPage(url.href) || url.username || url.password) throw Error('--url must be a Bilibili video, bangumi or list page');
  url.hash = ''; return url.href;
}

// Every build renames a fresh staging folder into place, so the marker's inode and time change even when its content does not.
async function buildStamp() {
  try { const info = await stat(buildMarker); return `${info.ino}:${info.mtimeMs}`; } catch { return null; }
}

async function serviceWorker(context) {
  const existing = context.serviceWorkers().find(worker => worker.url().startsWith('chrome-extension://'));
  return existing || context.waitForEvent('serviceworker', { timeout: 20000 });
}

// chrome://extensions is the only page with chrome.developerPrivate and chrome.management.
async function withExtensionsPage(context, fn) {
  const page = await context.newPage();
  try { await page.goto('chrome://extensions/'); return await fn(page); } finally { await page.close(); }
}

// Without developer mode Chromium disables an unpacked extension on reload ("unsupported developer extension").
async function enableDeveloperMode(context) {
  await withExtensionsPage(context, page => page.evaluate(() => new Promise(resolve =>
    chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, () => resolve()))));
}

async function reloadExtension(context) {
  const worker = await serviceWorker(context), id = new URL(worker.url()).hostname;
  const fresh = context.waitForEvent('serviceworker', { timeout: 10000, predicate: next => next !== worker }).catch(() => null);
  // chrome.runtime.reload re-reads an unpacked extension from disk.
  await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
  let next = await fresh;
  if (!next) {
    // The profile lost developer mode: re-enable the reloaded extension and wait for its worker.
    const again = context.waitForEvent('serviceworker', { timeout: 10000 });
    await withExtensionsPage(context, page => page.evaluate(id => new Promise(resolve => chrome.management.setEnabled(id, true, () => resolve())), id));
    next = await again;
  }
  const version = await next.evaluate(() => chrome.runtime.getManifest().version).catch(() => '?');
  const pages = context.pages().filter(page => isVideoPage(page.url()));
  for (const page of pages) await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(error => log(`refresh failed: ${error.message}`));
  log(`extension ${version} reloaded, ${pages.length} video tab(s) refreshed`);
}

async function watchBuilds(context, stop) {
  let last = await buildStamp(), pending = null;
  while (!stop.done) {
    await sleep(500);
    const current = await buildStamp();
    if (current === last) { if (pending && Date.now() - pending > 600) { pending = null; await reloadExtension(context).catch(error => log(`reload failed: ${error.message}`)); } continue; }
    last = current; pending = current ? Date.now() : null;
  }
}

async function watchLogin(context, stop) {
  let announced = null;
  while (!stop.done) {
    const page = context.pages().find(candidate => isVideoPage(candidate.url()));
    const state = page ? await login.checkLogin(page) : null;
    if (state !== announced && state !== null) {
      log(state ? 'B 站已登录，签名检查可以复用这个登录。' : '请在这个窗口登录 B 站（只需一次；之后的检查都复用它）。');
      announced = state;
    }
    await sleep(state === true ? 60000 : 10000);
  }
}

export async function main(argv) {
  const url = videoUrl(option(argv, 'url', DEFAULT_VIDEO));
  if (await login.devBrowserInfo()) {
    const browser = await chromium.connectOverCDP(login.DEV_URL);
    try {
      const context = browser.contexts()[0];
      if (!context.pages().some(page => page.url() === url)) { const page = await context.newPage(); await page.goto(url, { waitUntil: 'domcontentloaded' }); }
      log(`dev browser already running on port ${login.DEV_PORT}; opened ${url}`);
    } finally { await browser.close(); }
    return;
  }
  if (!await buildStamp()) throw Error('dist/extension is missing; run npm run build first.');
  const context = await chromium.launchPersistentContext(login.DEV_PROFILE, { channel: 'chromium', headless: false, viewport: null,
    // Always muted: the browser runs unattended and must never play sound.
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--remote-debugging-port=${login.DEV_PORT}`,
      '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run'] });
  const stop = { done: false };
  const finish = async () => { if (stop.done) return; stop.done = true; await context.close().catch(() => {}); log('closed'); process.exit(0); };
  process.on('SIGINT', finish); process.on('SIGTERM', finish);
  context.on('close', () => { stop.done = true; log('browser window closed'); process.exit(0); });
  const worker = await serviceWorker(context);
  await enableDeveloperMode(context);
  log(`profile ${login.DEV_PROFILE}`);
  log(`extension ${await worker.evaluate(() => chrome.runtime.getManifest().version)} loaded from dist/extension`);
  const page = context.pages()[0] || await context.newPage();
  for (const other of context.pages()) if (other !== page) await other.close();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  log(`opened ${url}; watching dist/extension for new builds`);
  await Promise.all([watchBuilds(context, stop), watchLogin(context, stop)]);
}

if (isMain(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
