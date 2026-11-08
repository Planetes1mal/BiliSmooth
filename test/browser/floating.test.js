// The floating control against a local stand-in for a Bilibili video page and a stubbed runtime contract.
// The control is bundled from source the same way scripts/build.mjs does it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '../..');
let browser, floatingSource;
before(async () => {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
  const result = await build({ absWorkingDir: root, entryPoints: ['src/ui/floating/index.js'], bundle: true, format: 'iife', platform: 'browser',
    target: ['chrome120'], write: false, loader: { '.css': 'text', '.svg': 'text' } });
  floatingSource = result.outputFiles[0].text;
});
after(async () => { await browser?.close(); });

const PAGE = '<!doctype html><style>body{margin:0;background:#fff}.bpx-player-container{position:absolute;left:120px;top:90px;width:1100px;height:620px;background:#18191c}.right-container{position:absolute;left:1250px;top:60px;width:380px;height:900px;background:#e3e5e7}#outside{position:absolute;left:400px;top:20px}</style><button id="outside">page</button><div class="bpx-player-container"><div class="bpx-player"><video></video></div></div><aside class="right-container"></aside>';

async function fixture({ path: page = '/video/BV1u2bg6XECo', state = {}, ...options } = {}) {
  const context = await browser.newContext({ viewport: { width: 1680, height: 940 }, ...options });
  await context.route('https://www.bilibili.com/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
  const tab = await context.newPage(), errors = [];
  tab.setDefaultTimeout(5000);
  tab.on('pageerror', error => errors.push(error.message));
  await tab.goto('https://www.bilibili.com' + page);
  for (const file of ['dist/extension/settings.js', 'src/ui/motion-runtime.js']) await tab.addScriptTag({ path: path.join(root, file) });
  await tab.evaluate(extra => {
    const listeners = new Set(), config = BiliSmoothSettings.normalize(extra.config || {});
    const state = { config, media: { present: true, playback: 'playing', frameHealth: { state: 'healthy', ageMs: 25 } }, observedAt: Date.now(), mediaGeneration: 1,
      bufferWallSeconds: 38.4, lastMbps: 38.56, speedObservedAt: Date.now(), actualHost: 'upos-sz-mirrorcosov.bilivideo.com', allowedHosts: BiliSmoothSettings.fixedHosts,
      delivery: { status: 'native', nativeHost: null, activeHost: null, nextTestAt: 0, canTest: true, comparedHosts: 0 }, settingsSave: { status: 'saved' }, ...extra, config };
    const notify = () => listeners.forEach(fn => fn());
    window.fixture = { state, calls: [], fail: false, notify };
    window.BiliSmoothSettings = { ...BiliSmoothSettings };
    window.BiliSmoothRuntime = {
      getConfig: () => structuredClone(state.config),
      getViewState: () => ({ ...structuredClone(state), observedAt: Date.now(), speedObservedAt: state.lastMbps === null ? null : Date.now() }),
      setConfig(patch) { fixture.calls.push({ action: 'config', patch: structuredClone(patch) }); state.config = BiliSmoothSettings.normalize({ ...state.config, ...patch }); state.settingsSave = { status: 'pending' }; notify(); },
      applyRoute(host) { fixture.calls.push({ action: 'route', host }); state.config = BiliSmoothSettings.normalize({ ...state.config, enabled: true, selection: 'fixed', pcdnHost: host }); notify(); return true; },
      async flushSettings() { fixture.calls.push({ action: 'flush' }); state.settingsSave = { status: fixture.fail ? 'error' : 'saved' }; notify(); if (fixture.fail) throw Error('storage-write-failed'); },
      retry() { fixture.calls.push({ action: 'retry' }); state.delivery = { ...state.delivery, status: 'testing', canTest: false }; notify(); return true; },
      resetNetwork() { fixture.calls.push({ action: 'reset' }); }, reload() { fixture.calls.push({ action: 'reload' }); return true; },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
    window.addEventListener('message', event => {
      if (event.data?.__bilismoothFloating === 'open-control') { fixture.calls.push({ action: 'open-control' }); window.postMessage({ __bilismoothFloating: 'opened', id: event.data.id, ok: true }, location.origin); }
    });
  }, state);
  await tab.addScriptTag({ content: floatingSource });
  const host = tab.locator('#bilismooth-floating');
  return { page: tab, context, errors, host };
}
const shadow = (page, selector, fn = node => node.textContent) => page.evaluate(([s, f]) => {
  const node = document.querySelector('#bilismooth-floating').shadowRoot.querySelector(s);
  return node && new Function('node', 'return (' + f + ')(node)')(node);
}, [selector, fn.toString()]);
const phase = page => page.evaluate(() => document.querySelector('#bilismooth-floating').dataset.phase);
const mutate = async (page, code) => { await page.evaluate(code); await page.waitForTimeout(80); };
const rect = locator => locator.boundingBox();
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('mounts collapsed on video paths only (also under a language prefix), avoids the player, and walks entry → preview → panel and back', async () => {
  const off = await fixture({ path: '/' });
  await off.page.waitForTimeout(200);
  assert.equal(await off.page.locator('#bilismooth-floating').count(), 0, 'no control on the home page');
  await off.context.close();
  for (const prefixed of ['/en/video/BV1u2bg6XECo', '/zh-Hans/video/BV1u2bg6XECo']) {
    const other = await fixture({ path: prefixed });
    await other.host.waitFor({ state: 'visible' });
    await other.context.close();
  }

  const { page, context, host, errors } = await fixture();
  await host.waitFor({ state: 'visible' });
  assert.equal(await phase(page), 'edge');
  const player = await rect(page.locator('.bpx-player-container')), right = await rect(page.locator('.right-container'));
  const placed = await rect(host);
  assert.ok(!overlaps(placed, player) && !overlaps(placed, right), 'first placement avoids the player and the right column');
  await host.hover(); await page.waitForTimeout(300);
  assert.equal(await phase(page), 'preview');
  assert.equal(await shadow(page, '#preview-speed'), '4.82 MB/s');
  assert.equal(await shadow(page, '#preview-buffer'), '38.4 秒');
  await page.mouse.click(5, 900);
  assert.equal(await phase(page), 'edge', 'outside pointer collapses');
  await page.evaluate(() => BiliSmoothFloating.open());
  assert.equal(await phase(page), 'panel');
  await page.keyboard.press('Escape');
  assert.equal(await phase(page), 'preview');
  await page.keyboard.press('Escape');
  assert.equal(await phase(page), 'edge');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a header that renders after the first placement sends the collapsed control to a clear corner', async () => {
  const { page, context, host } = await fixture();
  await host.waitFor({ state: 'visible' });
  const before = await rect(host);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div class="bili-header" style="position:fixed;left:0;top:0;width:100%;height:64px;background:#fff"><a href="/upload" style="position:absolute;right:16px;top:12px">upload</a></div>'));
  await page.waitForTimeout(200);
  const header = await rect(page.locator('.bili-header')), after = await rect(host);
  assert.ok(overlaps(before, header), 'the first placement sat where the header renders');
  assert.ok(!overlaps(after, header), 'the control moved off the header');
  await context.close();
});

test('unknown and blocked values show — and disable testing; Bilibili default turns routing off without a test', async () => {
  const { page, context, host } = await fixture({ state: { lastMbps: null, bufferWallSeconds: null } });
  await host.waitFor({ state: 'visible' });
  await page.evaluate(() => BiliSmoothFloating.open());
  assert.equal(await shadow(page, '#speed'), '—');
  assert.equal(await shadow(page, '#buffer'), '—');
  await mutate(page, () => { fixture.state.availability = { reason: 'region' }; fixture.notify(); });
  assert.equal(await shadow(page, '#panel-state b'), '所在地区无法播放');
  assert.equal(await shadow(page, '#test', node => node.disabled), true);
  assert.equal(await shadow(page, '#server', node => node.disabled), true);
  await mutate(page, () => { delete fixture.state.availability; fixture.state.config = BiliSmoothSettings.normalize({ ...fixture.state.config, enabled: false }); fixture.notify(); });
  assert.equal(await shadow(page, '#server-value'), 'B站默认');
  assert.equal(await shadow(page, '#test', node => node.disabled), true, 'testing needs Automatic');
  assert.equal(await shadow(page, '#panel-state b'), '使用 B站默认线路');
  await context.close();
});

test('the server menu writes Automatic, Bilibili default and fixed servers through the contract', async () => {
  const { page, context, host } = await fixture({ state: { config: { mode: 'off' } } });
  await host.waitFor({ state: 'visible' });
  await page.evaluate(() => BiliSmoothFloating.open());
  const pick = async value => {
    await host.locator('#server').click();
    await host.locator(`#server-menu [data-choice="${value}"]`).click();
    await page.waitForTimeout(60);
  };
  await pick('auto');
  await pick('default');
  await pick('upos-sz-mirroraliov.bilivideo.com');
  const calls = await page.evaluate(() => fixture.calls.filter(call => call.action !== 'flush'));
  assert.deepEqual(calls, [
    { action: 'config', patch: { enabled: true, selection: 'auto', mode: 'bad-only' } },
    { action: 'config', patch: { enabled: false } },
    { action: 'route', host: 'upos-sz-mirroraliov.bilivideo.com' }
  ]);
  assert.equal(await shadow(page, '#server-value'), '阿里云海外');
  await context.close();
});

test('test speed, save failure and retry, opening the dashboard', async () => {
  const { page, context, host } = await fixture();
  await host.waitFor({ state: 'visible' });
  await page.evaluate(() => BiliSmoothFloating.open());
  await host.locator('#test').click(); await page.waitForTimeout(60);
  assert.equal(await shadow(page, '#feedback'), '正在测速…');
  await mutate(page, () => { fixture.state.delivery = { ...fixture.state.delivery, status: 'current-fastest', activeHost: 'upos-sz-mirrorcosov.bilivideo.com' }; fixture.notify(); });
  assert.equal(await shadow(page, '#feedback'), '测速完成，腾讯云海外最快');
  await page.evaluate(() => { fixture.fail = true; });
  await host.locator('#server').click();
  await host.locator('#server-menu [data-choice="default"]').click(); await page.waitForTimeout(80);
  assert.equal(await shadow(page, '#save-notice', node => node.hidden), false);
  await page.evaluate(() => { fixture.fail = false; });
  await host.locator('#save-notice button').click(); await page.waitForTimeout(80);
  assert.equal(await shadow(page, '#save-notice', node => node.hidden), true);
  await host.locator('[data-action=dashboard]').click(); await page.waitForTimeout(60);
  assert.ok(await page.evaluate(() => fixture.calls.some(call => call.action === 'open-control')));
  await context.close();
});

test('dragging snaps to an edge and persists; arrows move; Home and the menu reset; full screen hides', async () => {
  const { page, context, host } = await fixture();
  await host.waitFor({ state: 'visible' });
  const start = await rect(host);
  await page.mouse.move(start.x + 10, start.y + 10); await page.mouse.down();
  await page.mouse.move(400, 300, { steps: 6 }); await page.mouse.move(14, 300, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(500);
  const snapped = await rect(host);
  assert.ok(Math.abs(snapped.x - 8) <= 1, 'snapped to the left edge');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bilismooth.panel.position.v3')));
  assert.equal(saved.snapX, 'left');
  await host.locator('#entry').focus(); await page.keyboard.press('ArrowRight');
  assert.ok((await rect(host)).x > snapped.x, 'arrow key moves');
  await page.keyboard.press('Home'); await page.waitForTimeout(80);
  const reset = await rect(host);
  assert.ok(reset.x > 1000, 'Home returns to the default corner');
  await mutate(page, () => document.querySelector('.bpx-player').classList.add('mode-webfullscreen'));
  await page.evaluate(() => BiliSmoothFloating.refresh()); await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => document.querySelector('#bilismooth-floating').hidden), true);
  await mutate(page, () => document.querySelector('.bpx-player').classList.remove('mode-webfullscreen'));
  await page.evaluate(() => BiliSmoothFloating.refresh()); await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => document.querySelector('#bilismooth-floating').hidden), false);
  assert.equal(await phase(page), 'edge');
  await context.close();
});

test('theme, accent, language and reduced motion follow the settings; a new video collapses the panel', async () => {
  const { page, context, host } = await fixture({ reducedMotion: 'reduce', colorScheme: 'dark', state: { config: { lang: 'en', accent: 'teal' } } });
  await host.waitFor({ state: 'visible' });
  const data = () => page.evaluate(() => ({ ...document.querySelector('#bilismooth-floating').dataset, lang: document.querySelector('#bilismooth-floating').lang }));
  assert.deepEqual([(await data()).theme, (await data()).accent, (await data()).lang, (await data()).motion], ['dark', 'teal', 'en', 'off']);
  await page.evaluate(() => BiliSmoothFloating.open());
  assert.equal(await shadow(page, '[data-action=dashboard]'), 'Dashboard');
  await mutate(page, () => { fixture.state.mediaGeneration = 2; fixture.notify(); });
  assert.equal(await phase(page), 'edge');
  await context.close();
});
