// Local Chromium regression: a scrollbar is not usable space for floating UI.
// The helper extension sets real per-tab browser zoom. It has no production role.
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const { createEvidenceOutput, runLabel } = require('./validation-support.cjs');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const label = runLabel() || 'current';
const output = createEvidenceOutput({ root, suite: 'viewport', version });
const sources = ['src/core/settings.js', 'src/ui/surface.js', 'src/ui/entry-display.js', 'src/ui/motion-runtime.js', 'src/ui/choice.js', 'src/page/floating-control.js'];
const specs = [
  { name: 'classic-scrollbar', gutter: 'auto' },
  { name: 'stable-scrollbar', gutter: 'stable' },
  { name: 'both-edges', gutter: 'stable both-edges' },
  { name: 'wide-body', gutter: 'auto', bodyWidth: '100vw' },
  { name: 'narrow-body', gutter: 'auto', bodyWidth: '900px' },
  { name: 'browser-zoom-125', gutter: 'auto', zoom: 1.25 },
  { name: 'visual-viewport-125', gutter: 'auto', scale: 1.25 }
];
const only = process.argv.find(value => value.startsWith('--case='))?.slice(7);
const selected = only ? specs.filter(spec => spec.name === only) : specs;
if (!selected.length) throw Error('Unknown case');

async function fixture(page, spec, code) {
  await page.goto('https://www.bilibili.com/video/BV1viewport');
  await page.evaluate(spec => {
    document.documentElement.style.cssText = 'overflow-y:scroll;scrollbar-gutter:' + spec.gutter;
    document.body.style.cssText = 'margin:0;min-height:2000px;background:#f6f7f8;width:' + (spec.bodyWidth || 'auto');
    // Independently measures the browser's fixed-position containing block,
    // including both reserved gutters. Body width must not define this boundary.
    const bounds = document.createElement('div'); bounds.id = 'fixture-paint-bounds';
    bounds.style.cssText = 'position:fixed;inset:0;pointer-events:none;visibility:hidden';
    document.body.append(bounds);
    localStorage.clear();
  }, spec);
  for (const file of sources.slice(0, -1)) await page.addScriptTag({ content: code.get(file) });
  await page.evaluate(() => {
    const callbacks = new Set(), config = BiliSmoothSettings.normalize();
    const state = { config, media: { present: true, playback: 'playing', frameHealth: { state: 'healthy', ageMs: 25 } },
      status: 'smooth', observedAt: Date.now(), mediaGeneration: 1, bufferWallSeconds: 14.2,
      lastMbps: 16, lastTransferAt: Date.now(), actualHost: config.pcdnHost, settingsSave: { status: 'saved' } };
    window.viewportFixture = { state, notify() { state.observedAt = state.lastTransferAt = Date.now(); callbacks.forEach(fn => fn()); } };
    window.BiliSmoothRuntime = { getConfig: () => structuredClone(config), getState: () => structuredClone(state),
      getViewState: () => structuredClone(state), subscribe(fn) { callbacks.add(fn); return () => callbacks.delete(fn); },
      setConfig(patch) { Object.assign(config, patch); viewportFixture.notify(); }, async flushSettings() {},
      retry() { return true; }, resetNetwork() {}, reload() {}, applyRoute() { return true; } };
  });
  await page.addScriptTag({ content: code.get(sources.at(-1)) });
  await page.locator('#bilismooth-floating').waitFor({ state: 'visible' });
}

async function measure(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#bilismooth-floating'), shadow = host.shadowRoot;
    const rect = value => ({ left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height });
    const fixed = rect(document.querySelector('#fixture-paint-bounds').getBoundingClientRect());
    const vv = window.visualViewport;
    const visual = { left: vv?.offsetLeft || 0, top: vv?.offsetTop || 0,
      right: (vv?.offsetLeft || 0) + (vv?.width || document.documentElement.clientWidth),
      bottom: (vv?.offsetTop || 0) + (vv?.height || document.documentElement.clientHeight) };
    const drawable = { left: Math.max(fixed.left, visual.left), right: Math.min(fixed.right, visual.right),
      top: Math.max(fixed.top, visual.top), bottom: Math.min(fixed.bottom, visual.bottom) };
    const outside = box => box.left < drawable.left - .75 || box.right > drawable.right + .75 || box.top < drawable.top - .75 || box.bottom > drawable.bottom + .75;
    const visible = node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const controls = [...shadow.querySelectorAll('button,.bs-switch-track,.bs-status-signal,.bs-entry-face,.bs-entry-logo,.bs-unit')].filter(visible).map(node => ({
      node: node.id || node.className || node.tagName, rect: rect(node.getBoundingClientRect())
    }));
    // Range geometry is clipped only by ancestor overflow, never by the viewport
    // under test. Thus intentionally ellipsized host labels are not false alarms.
    const texts = [], walker = document.createTreeWalker(shadow, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.tagName === 'STYLE' || !node.textContent.trim() || !visible(parent)) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      for (const original of range.getClientRects()) {
        let box = rect(original);
        for (let ancestor = parent; ancestor && ancestor !== host; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor), bounds = ancestor.getBoundingClientRect();
          if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { box.left = Math.max(box.left, bounds.left); box.right = Math.min(box.right, bounds.right); }
          if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { box.top = Math.max(box.top, bounds.top); box.bottom = Math.min(box.bottom, bounds.bottom); }
        }
        if (box.right > box.left && box.bottom > box.top) texts.push({ node: parent.id || parent.className || parent.tagName, text: node.textContent.trim(), rect: box });
      }
    }
    const hostRect = rect(host.getBoundingClientRect());
    const hitX = Math.min(innerWidth - 1, drawable.right + 2), hitY = Math.max(1, hostRect.top + 4);
    return { phase: host.dataset.phase, viewport: { innerWidth, innerHeight, clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight, devicePixelRatio, scrollbarWidth: innerWidth - document.documentElement.clientWidth,
      documentRect: rect(document.documentElement.getBoundingClientRect()), bodyRect: rect(document.body.getBoundingClientRect()),
      fixed, visual: { ...visual, scale: vv?.scale }, drawable, scrollbarHit: document.elementFromPoint(hitX, hitY)?.id || null },
      host: hostRect, hostOutside: outside(hostRect), controls, visibleTextRanges: texts,
      clippedControls: controls.filter(row => outside(row.rect)), clippedTexts: texts.filter(row => outside(row.rect)) };
  });
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  if (await fs.stat(path.join(output, 'report.json')).catch(() => null)) throw Error('Report label already exists; choose a new --label to preserve evidence');
  const code = new Map(await Promise.all(sources.map(async file => [file, await fs.readFile(path.join(root, file), 'utf8')])));
  const hashes = Object.fromEntries([...code].map(([file, text]) => [file, crypto.createHash('sha256').update(text).digest('hex')]));
  const helper = path.join(output, 'zoom-helper'); await fs.mkdir(helper, { recursive: true });
  await fs.writeFile(path.join(helper, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Local viewport test', version: '1.0',
    permissions: ['tabs'], background: { service_worker: 'worker.js' } }));
  await fs.writeFile(path.join(helper, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});\n');
  const profile = await fs.mkdtemp(path.join(output, 'browser-profile-'));
  const blocked = [], errors = [], cases = [];
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, channel: 'chromium',
      viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce',
      ignoreDefaultArgs: ['--hide-scrollbars'], args: ['--disable-features=OverlayScrollbar,OverlayScrollbars', '--show-scrollbars',
        '--disable-extensions-except=' + helper, '--load-extension=' + helper] });
    await context.route('**/*', route => {
      if (route.request().isNavigationRequest() && route.request().url().startsWith('https://www.bilibili.com/video/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local scrollbar fixture</title><body></body>' });
      blocked.push(route.request().url()); return route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    for (const spec of selected) {
      const page = await context.newPage(); page.setDefaultTimeout(4000);
      page.on('pageerror', error => errors.push({ case: spec.name, error: error.message }));
      await fixture(page, spec, code);
      const beforeZoom = await page.evaluate(() => ({ innerWidth, dpr: devicePixelRatio }));
      const zoom = await worker.evaluate(async factor => {
        const tabs = await chrome.tabs.query({ url: 'https://www.bilibili.com/video/*' });
        const tab = tabs.at(-1); await chrome.tabs.setZoom(tab.id, factor); return chrome.tabs.getZoom(tab.id);
      }, spec.zoom || 1);
      if (spec.scale) await (await context.newCDPSession(page)).send('Emulation.setPageScaleFactor', { pageScaleFactor: spec.scale });
      await page.waitForTimeout(80);
      const phases = [];
      for (const phase of ['edge', 'preview', 'panel']) {
        if (phase === 'preview') {
          // Focus is a genuine supported reveal path and does not depend on an
          // already-clipped pointer target being clickable.
          await page.locator('#bs-edge').focus();
        } else if (phase === 'panel') await page.evaluate(() => BiliSmoothFloating.open());
        await page.evaluate(() => viewportFixture.notify());
        await page.waitForTimeout(70);
        const sample = await measure(page);
        sample.expectedPhase = phase;
        sample.passed = sample.phase === phase && !sample.hostOutside && !sample.clippedControls.length && !sample.clippedTexts.length;
        if (['classic-scrollbar', 'both-edges', 'browser-zoom-125', 'visual-viewport-125'].includes(spec.name)) {
          sample.screenshot = spec.name + '-' + phase + '.png';
          await page.screenshot({ path: path.join(output, sample.screenshot), fullPage: false });
        }
        phases.push(sample);
      }
      const afterZoom = await page.evaluate(() => ({ innerWidth, dpr: devicePixelRatio }));
      const conditions = { traditionalScrollbar: phases[0].viewport.scrollbarWidth > 0,
        requestedZoomApplied: Math.abs(zoom - (spec.zoom || 1)) < .001 && (!spec.zoom || beforeZoom.innerWidth !== afterZoom.innerWidth || beforeZoom.dpr !== afterZoom.dpr),
        requestedVisualScaleApplied: !spec.scale || Math.abs(phases[0].viewport.visual.scale - spec.scale) < .01 };
      cases.push({ ...spec, browserZoom: zoom, beforeZoom, afterZoom, conditions,
        passed: Object.values(conditions).every(Boolean) && phases.every(phase => phase.passed), phases });
      await page.close();
    }
    const report = { label, generatedAt: new Date().toISOString(), browser: context.browser()?.version(),
      sourceSha256: hashes, fixtureOnly: true, externalNetworkAllowed: false,
      scope: 'Traditional scrollbar, reserved gutters, body width, genuine per-tab browser zoom and visual-viewport scale; three real production floating states.',
      passed: cases.every(row => row.passed) && !errors.length, cases, errors, blockedRequests: blocked };
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ passed: report.passed, cases: cases.map(row => ({ name: row.name, conditions: row.conditions,
      phases: row.phases.map(sample => ({ phase: sample.phase, passed: sample.passed, innerWidth: sample.viewport.innerWidth,
        clientWidth: sample.viewport.clientWidth, drawable: sample.viewport.drawable, host: sample.host,
        clippedControls: sample.clippedControls.map(item => item.node), clippedTexts: sample.clippedTexts.map(item => item.text) })) })), report: path.join(output, 'report.json') }, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally {
    await context?.close();
    const resolved = path.resolve(profile);
    if (!resolved.startsWith(path.resolve(output) + path.sep)) throw Error('Profile cleanup outside test output');
    await fs.rm(resolved, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
