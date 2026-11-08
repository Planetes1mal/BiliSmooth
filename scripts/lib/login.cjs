'use strict';
// Signed-in checks reuse the dedicated test browser's Bilibili login. Cookies are read
// live from that profile and handed to isolated fresh profiles; nothing is written to disk.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const DEV_PROFILE = process.env.BILISMOOTH_DEV_PROFILE || path.join(os.homedir(), 'Library', 'Application Support', 'BiliSmoothDev');
const DEV_PORT = Number(process.env.BILISMOOTH_DEV_PORT || 9226);
const DEV_URL = `http://127.0.0.1:${DEV_PORT}`;
const isBilibiliDomain = domain => typeof domain === 'string' &&
  (domain.replace(/^\./, '') === 'bilibili.com' || domain.endsWith('.bilibili.com'));

async function devBrowserInfo() {
  try {
    const response = await fetch(`${DEV_URL}/json/version`, { signal: AbortSignal.timeout(1500) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

const onlyBilibili = cookies => cookies.filter(cookie => cookie && isBilibiliDomain(cookie.domain) && typeof cookie.name === 'string' && typeof cookie.value === 'string');

// Reads the bilibili.com cookies of the dedicated profile: through the running
// dev browser's debugging port, or by opening the profile briefly when it is closed.
async function readLoginCookies() {
  if (await devBrowserInfo()) {
    const browser = await chromium.connectOverCDP(DEV_URL);
    try {
      const context = browser.contexts()[0];
      return onlyBilibili(context ? await context.cookies('https://www.bilibili.com/') : []);
    } finally { await browser.close(); }
  }
  if (!fs.existsSync(DEV_PROFILE)) return [];
  const context = await chromium.launchPersistentContext(DEV_PROFILE, { channel: 'chromium', headless: true });
  try { return onlyBilibili(await context.cookies('https://www.bilibili.com/')); }
  finally { await context.close(); }
}

// Throws with the action the maintainer must take when no login is available.
async function requireLoginCookies() {
  const cookies = await readLoginCookies();
  if (!cookies.length) throw Error('专用测试浏览器里没有 B 站登录：运行 npm run dev 并在该窗口登录一次。');
  return cookies;
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

module.exports = { DEV_PROFILE, DEV_PORT, DEV_URL, devBrowserInfo, readLoginCookies, requireLoginCookies, checkLogin, isBilibiliDomain };
