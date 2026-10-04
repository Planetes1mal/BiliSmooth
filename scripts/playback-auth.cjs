// Manual login in a dedicated, temporary browser. Only Bilibili cookies are saved.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const loginUrl = 'https://www.bilibili.com/video/BV1rp4y1e745/';
const authDirectory = root => path.join(root, 'work', 'playback-auth');
const isBilibiliDomain = domain => typeof domain === 'string' &&
  (domain.replace(/^\./, '') === 'bilibili.com' || domain.endsWith('.bilibili.com'));

async function loadAuthState(root) {
  let source;
  try {
    source = await fs.readFile(path.join(authDirectory(root), 'state.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let state;
  try { state = JSON.parse(source); }
  catch { throw Error('登录状态文件无效，请运行 npm run test:login 重新登录。'); }
  if (!Array.isArray(state?.cookies) || !state.cookies.length ||
      state.cookies.some(cookie => !cookie || !isBilibiliDomain(cookie.domain) ||
        typeof cookie.name !== 'string' || typeof cookie.value !== 'string')) {
    throw Error('登录状态必须只包含 bilibili.com 域的 Cookie，请运行 npm run test:login 重新登录。');
  }
  // Never restore localStorage, IndexedDB, or any other supplied state.
  return { cookies: state.cookies, origins: [] };
}

async function checkLogin(page) {
  try {
    return await page.evaluate(async () => {
      try {
        const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
          credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return null;
        const payload = await response.json();
        return typeof payload?.data?.isLogin === 'boolean' ? payload.data.isLogin : null;
      } catch { return null; }
    });
  } catch { return null; }
}

async function main() {
  if (process.argv.length > 2) throw Error('此命令不接受参数；关闭专用浏览器后可删除 work/playback-auth/ 清除本地登录状态。');
  const root = path.resolve(__dirname, '..');
  const directory = authDirectory(root);
  const statePath = path.join(directory, 'state.json');
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + 15 * 60 * 1000;
  await fs.mkdir(directory, { recursive: true });
  const writeStatus = status => fs.writeFile(path.join(directory, 'status.json'),
    JSON.stringify({ status, startedAt, updatedAt: new Date().toISOString(),
      expiresAt: new Date(deadline).toISOString() }, null, 2) + '\n');
  let browser, page;
  try {
    await writeStatus('opening');
    // Do not attach to an existing browser or read its profile. Playwright removes
    // this temporary browser profile when the browser closes.
    browser = await chromium.launch({ channel: 'chromium', headless: false });
    const context = await browser.newContext();
    page = await context.newPage();
    console.log('请在新打开的专用浏览器中手动登录 B 站（最长等待 15 分钟）。关闭窗口会取消。');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await writeStatus('waiting-for-login');
    while (Date.now() < deadline && browser.isConnected() && !page.isClosed()) {
      const loggedIn = await checkLogin(page);
      if (loggedIn === true) {
        const cookies = (await context.cookies()).filter(cookie => isBilibiliDomain(cookie.domain));
        if (!cookies.length) throw Error('已确认登录，但未获得可复用的 B 站 Cookie。');
        await fs.writeFile(statePath, JSON.stringify({ cookies, origins: [] }, null, 2) + '\n', { mode: 0o600 });
        await fs.chmod(statePath, 0o600).catch(() => {});
        await writeStatus('authenticated');
        console.log(`登录已保存：${statePath}`);
        return;
      }
      await writeStatus(loggedIn === null ? 'waiting-for-network' : 'waiting-for-login');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    const cancelled = !browser.isConnected() || page.isClosed();
    await writeStatus(cancelled ? 'cancelled' : 'timed-out');
    console.log(cancelled ? '专用浏览器已关闭，登录已取消。' : '登录等待超时，请运行 npm run test:login 重试。');
    process.exitCode = 1;
  } catch (error) {
    if (browser && (!browser.isConnected() || page?.isClosed())) {
      await writeStatus('cancelled');
      console.log('专用浏览器已关闭，登录已取消。');
    } else {
      await writeStatus('failed');
      throw error;
    }
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
  }
}

module.exports = { loadAuthState, checkLogin };
if (require.main === module) main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
