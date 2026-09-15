'use strict';

// Real production CSS/markup in document and the actual floating shadow root.
// --source-dir=work/theme-readability-baseline reads frozen pre-fix inputs.
// Animation timelines are paused and sampled, not disabled: semantic opacity
// remains part of effective foreground contrast throughout the first 2 seconds.
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const { createEvidenceOutput, runLabel } = require('./validation-support.cjs');
const root = path.resolve(__dirname, '..');
const value = key => process.argv.find(arg => arg.startsWith('--' + key + '='))?.split('=').slice(1).join('=');
const label = runLabel() || 'current', frozen = value('source-dir');
const out = createEvidenceOutput({ root, suite: 'theme-readability', version: require('../package.json').version });
const sources = ['src/ui/surface.js', 'src/ui/entry-display.js', 'src/ui/control/control.css', 'src/ui/control/index.html', 'src/page/floating-control.js', 'src/core/settings.js', 'src/ui/motion-runtime.js', 'src/ui/choice.js'];
const accents = ['peach', 'bili', 'teal', 'emerald', 'violet', 'pink', 'sunset', 'graphite'];
const types = ['status-logo', 'logo', 'status', 'speed', 'buffer', 'combined', 'route', 'rate', 'resolution'];
const states = ['smooth', 'playing', 'buffering', 'frozen', 'paused', 'waiting'];
const times = [0, 250, 500, 750, 1000, 1032, 1176, 1300, 1500, 1750, 1900, 2000];

function helpers() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = value => { context.clearRect(0, 0, 1, 1); context.fillStyle = value === 'none' ? 'transparent' : value; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v); };
  const over = (fg, bg, opacity = 1) => { const alpha = fg[3] * opacity; return [0, 1, 2].map(i => fg[i] * alpha + bg[i] * (1 - alpha)).concat(1); };
  const parent = node => node.parentElement || node.getRootNode()?.host;
  const chain = node => { const list = []; for (let item = node; item; item = parent(item)) list.unshift(item); return list; };
  const lum = rgb => rgb.slice(0, 3).map(v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
  const visible = node => { const s = getComputedStyle(node), r = node.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0; };
  function paint(node, property = 'color', ownBackground = true) {
    let background = [255, 255, 255, 1], opacity = 1;
    for (const ancestor of chain(ownBackground ? node : parent(node))) {
      const style = getComputedStyle(ancestor); opacity *= Number(style.opacity);
      background = over(rgba(style.backgroundColor), background, opacity);
    }
    const style = getComputedStyle(node);
    if (!ownBackground) opacity *= Number(style.opacity);
    const extra = property === 'fill' ? Number(style.fillOpacity) : property === 'stroke' ? Number(style.strokeOpacity) : 1;
    const foreground = rgba(style[property]), effective = over(foreground, background, opacity * extra);
    return { foreground: style[property], background: background.slice(0, 3).map(v => +v.toFixed(2)), opacity: +(opacity * extra).toFixed(4), effective: effective.slice(0, 3).map(v => +v.toFixed(2)), contrast: +ratio(effective, background).toFixed(4) };
  }
  function sample(face) {
    const rows = [];
    for (const node of face.querySelectorAll('.bs-entry-number,.bs-entry-unit,.bs-entry-status-label')) if (visible(node)) rows.push({ role: 'text', part: node.className, text: node.textContent, threshold: 4.5, ...paint(node) });
    // Outer pieces carry the mark. The intentionally missing paused center is
    // not required; its removal distinguishes pause while the outline survives.
    for (const node of face.querySelectorAll('.bs-entry-logo-piece-0,.bs-entry-logo-piece-2')) if (visible(node)) {
      const style = getComputedStyle(node), property = style.fill === 'none' || rgba(style.fill)[3] === 0 ? 'stroke' : 'fill';
      rows.push({ role: 'logo', part: node.getAttribute('class'), threshold: 3, ...paint(node, property, false), x: node.getBoundingClientRect().x });
    }
    const signal = face.matches('.bs-status-signal') ? face : face.querySelector('.bs-status-signal');
    if (signal) {
      const frame = signal.getBoundingClientRect(), candidates = [...signal.querySelectorAll('.bs-status-frame')].filter(node => { const r = node.getBoundingClientRect(); return visible(node) && r.right > frame.left + 1 && r.left < frame.right - 1; });
      const measured = candidates.map(node => ({ part: 'frame-' + [...node.parentElement.children].indexOf(node), ...paint(node, rgba(getComputedStyle(node).backgroundColor)[3] > 0 ? 'backgroundColor' : 'borderTopColor', false) }));
      // Record every visible frame including alpha. The strongest primary frame
      // must remain legible; translucent flow trails are decorative, not failures.
      if (measured.length) { const strongest = measured.reduce((a, b) => a.contrast >= b.contrast ? a : b); rows.push({ role: 'signal', threshold: 3, ...strongest, strongestFrame: strongest.part, part: 'primary-visible-frame', frames: measured }); }
    }
    return rows;
  }
  function timeline(face, times) {
    const animations = face.getAnimations({ subtree: true }); animations.forEach(animation => animation.pause());
    const keyframeTimes = animations.flatMap(animation => {
      const timing = animation.effect.getComputedTiming(), duration = Number(timing.duration), delay = Number(timing.delay) || 0;
      if (!Number.isFinite(duration)) return [];
      return animation.effect.getKeyframes().map(frame => delay + (frame.computedOffset ?? frame.offset ?? 0) * duration).filter(time => time >= 0 && time <= 2000);
    });
    const sampleTimes = [...new Set([...times, ...keyframeTimes])].sort((a, b) => a - b);
    const samples = sampleTimes.map(time => { animations.forEach(animation => animation.currentTime = time); return { time, rows: sample(face) }; });
    const moving = [...face.querySelectorAll('.bs-entry-logo-piece-0,.bs-entry-logo-piece-2')].map(node => {
      const positions = sampleTimes.map(time => { animations.forEach(animation => animation.currentTime = time); const rect = node.getBoundingClientRect(); return { time, x: rect.x, y: rect.y }; });
      const amplitude = Math.max(0, ...positions.flatMap(a => positions.map(b => Math.hypot(a.x - b.x, a.y - b.y))));
      return { part: node.getAttribute('class'), positions, amplitude: +amplitude.toFixed(3) };
    });
    animations.forEach(animation => animation.currentTime = 0);
    return { animationNames: animations.map(animation => animation.animationName || 'WAAPI'), samples, movement: moving };
  }
  window.readability = { paint, sample, timeline, visible };
  window.readabilitySnapshot = state => ({ observedAt: Date.now(), lastTransferAt: Date.now(), lastMbps: 20.32, bufferWallSeconds: 28.7, buffer: 43.05, rate: 1.5,
    actualHost: 'upos-sz-mirrorcosov.bilivideo.com', status: state === 'smooth' ? 'smooth' : state,
    media: { present: state !== 'waiting', playback: state === 'smooth' ? 'playing' : state, height: 1080, width: 1920, frameHealth: { state: state === 'smooth' ? 'healthy' : state === 'frozen' ? 'frozen' : 'unknown', ageMs: 15 } } });
}

(async () => {
  await fs.mkdir(out, { recursive: true });
  if (await fs.stat(path.join(out, 'report.json')).catch(() => null)) throw Error('Choose a fresh --label to preserve the existing report');
  const code = new Map();
  for (const source of sources) {
    const candidate = frozen && path.join(root, frozen, path.basename(source));
    code.set(source, await fs.readFile(candidate && await fs.stat(candidate).catch(() => null) ? candidate : path.join(root, source), 'utf8'));
  }
  const sourceSha256 = Object.fromEntries([...code].map(([source, text]) => [source, crypto.createHash('sha256').update(text).digest('hex')]));
  await fs.mkdir(path.join(out, 'inputs'), { recursive: true });
  for (const [source, text] of code) await fs.writeFile(path.join(out, 'inputs', path.basename(source)), text);
  const browser = await chromium.launch({ headless: true }), errors = [], cases = [], buttons = [], bodyText = [], screenshots = [];
  try {
    const doc = await browser.newPage({ viewport: { width: 1366, height: 1800 } });
    doc.on('pageerror', error => errors.push(error.message));
    const html = code.get('src/ui/control/index.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '').replace(/<img\b[^>]*>/gi, '');
    await doc.setContent(html);
    for (const file of ['src/core/settings.js', 'src/ui/surface.js', 'src/ui/entry-display.js']) await doc.addScriptTag({ content: code.get(file) });
    await doc.evaluate(() => { BiliSmoothSurfaceStyles.mount(document); BiliSmoothEntryDisplay.mount(document); document.documentElement.dataset.motion = 'on'; document.querySelectorAll('.view').forEach(node => node.hidden = node.id !== 'page-settings'); document.getElementById('page-title').textContent = '偏好设置'; const defaults = BiliSmoothSettings.normalize(); document.querySelectorAll('[data-config]').forEach(node => { if (node.type === 'checkbox') node.checked = !!defaults[node.dataset.config]; if (node.type === 'radio') node.checked = node.value === defaults[node.dataset.config]; }); window.entryInstances = [...document.querySelectorAll('[data-entry-preview]')].map(host => BiliSmoothEntryDisplay.create(host, { type: host.dataset.entryPreview, snapshot: null })); });
    await doc.addStyleTag({ content: code.get('src/ui/control/control.css') }); await doc.evaluate(helpers);
    const floating = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
    floating.on('pageerror', error => errors.push(error.message));
    await floating.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Readability fixture</title><style>body{margin:0;background:#18191c;min-height:1200px}.bpx-player-container{position:absolute;left:80px;top:100px;width:850px;height:478px;background:#222}video{width:100%;height:100%}</style><div class="bpx-player-container"><div class="bpx-player"><video></video></div></div>' }));
    await floating.goto('https://www.bilibili.com/video/BVreadability');
    for (const file of ['src/core/settings.js', 'src/ui/surface.js', 'src/ui/entry-display.js', 'src/ui/motion-runtime.js', 'src/ui/choice.js']) await floating.addScriptTag({ content: code.get(file) });
    await floating.evaluate(helpers);
    await floating.evaluate(() => {
      const listeners = new Set(); window.themeState = { ...readabilitySnapshot('smooth'), config: BiliSmoothSettings.normalize({ theme: 'light' }), mediaGeneration: 1, settingsSave: { status: 'saved' } };
      window.BiliSmoothRuntime = { getConfig: () => structuredClone(themeState.config), getViewState: () => structuredClone(themeState), getState: () => structuredClone(themeState), setConfig(patch) { Object.assign(themeState.config, patch); listeners.forEach(fn => fn()); }, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, async flushSettings() {}, retry: () => true, resetNetwork() {}, reload() {}, applyRoute: () => true };
      window.updateTheme = async (theme, accent, state, type) => { Object.assign(themeState, readabilitySnapshot(state)); Object.assign(themeState.config, { theme, accent, floatingEntryType: type }); listeners.forEach(fn => fn()); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); };
    });
    await floating.addScriptTag({ content: code.get('src/page/floating-control.js') });
    await floating.locator('#bilismooth-floating').waitFor({ state: 'visible' });
    for (const theme of ['light', 'dark']) for (const accent of accents) {
      await doc.evaluate(({ theme, accent }) => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.accent = accent; }, { theme, accent });
      for (const state of states) {
        await doc.evaluate(state => { entryInstances.forEach(instance => instance.update({ snapshot: readabilitySnapshot(state), motion: true })); }, state);
        const measured = await doc.evaluate(times => [...document.querySelectorAll('[data-entry-preview]')].map(host => ({ type: host.dataset.entryPreview, ...readability.timeline(host.querySelector('.bs-entry-face'), times) })), times);
        measured.forEach(result => cases.push({ context: 'dashboard-document', theme, accent, state, ...result }));
        for (const type of types) {
          await floating.evaluate(args => updateTheme(...args), [theme, accent, state, type]);
          const result = await floating.evaluate(times => readability.timeline(document.querySelector('#bilismooth-floating').shadowRoot.querySelector('#bs-edge .bs-entry-face'), times), times);
          cases.push({ context: 'production-shadow', theme, accent, state, type, ...result });
        }
      }
      if (['peach', 'graphite', 'bili'].includes(accent)) {
        await doc.evaluate(() => entryInstances.forEach(instance => instance.update({ snapshot: readabilitySnapshot('paused'), motion: true })));
        const file = 'settings-' + theme + '-' + accent + '.png';
        await doc.locator('.entry-settings').screenshot({ path: path.join(out, file) }); screenshots.push(file);
      }
      await doc.evaluate(() => { document.querySelectorAll('.view').forEach(node => node.hidden = node.id !== 'page-overview'); document.getElementById('speed-value').textContent = '2.54'; document.getElementById('speed-unit').textContent = 'MB/s'; document.getElementById('buffer-value').textContent = '28.7'; });
      for (const selector of ['#speed-value', '#speed-unit', '#buffer-value', '.metric h2', '.metric-note', '.speed-figure figcaption', '.workspace-footer']) {
        const result = await doc.locator(selector).first().evaluate(node => ({ text: node.textContent.trim(), ...readability.paint(node) }));
        bodyText.push({ context: 'dashboard-document', theme, accent, selector, threshold: 4.5, ...result });
      }
      await doc.evaluate(() => document.querySelectorAll('.view').forEach(node => node.hidden = node.id !== 'page-settings'));
      await floating.evaluate(args => updateTheme(...args), [theme, accent, 'smooth', 'status-logo']);
      await floating.evaluate(() => BiliSmoothFloating.open());
      await floating.waitForTimeout(450);
      for (const selector of ['#bs-retry', '#bs-reset', '[data-action=dashboard]', '#bs-route']) {
        const element = floating.locator('#bilismooth-floating').locator(selector);
        for (const interaction of ['rest', 'hover']) {
          if (interaction === 'hover') await element.hover(); else await floating.mouse.move(15, 15);
          await floating.waitForTimeout(260);
          const result = await element.evaluate(node => ({ text: node.textContent.trim(), ...readability.paint(node) }));
          buttons.push({ context: 'production-shadow', theme, accent, selector, interaction, threshold: 4.5, ...result });
        }
      }
      await floating.mouse.move(15, 15); await floating.keyboard.press('Escape'); await floating.keyboard.press('Escape');
      await floating.waitForFunction(() => document.querySelector('#bilismooth-floating').dataset.phase === 'edge');
      console.log('Measured ' + theme + '/' + accent);
    }
    const failures = [], movement = [];
    for (const item of cases) {
      const identity = { context: item.context, theme: item.theme, accent: item.accent, state: item.state, type: item.type };
      const grouped = new Map();
      for (const sample of item.samples) for (const row of sample.rows) {
        const key = row.role + '/' + row.part;
        if (!grouped.has(key) || row.contrast < grouped.get(key).contrast) grouped.set(key, { ...row, time: sample.time });
      }
      for (const row of grouped.values()) if (row.contrast + .001 < row.threshold) failures.push({ ...identity, ...row });
      if (item.type === 'status-logo') {
        const amplitude = Math.max(0, ...item.movement.map(row => row.amplitude));
        const shouldMove = ['smooth', 'buffering', 'frozen'].includes(item.state);
        const passed = shouldMove ? amplitude >= 3 : amplitude <= .1;
        movement.push({ ...identity, amplitude, expected: shouldMove ? '>=3px in first 2 seconds' : 'static <=0.1px', passed });
      }
    }
    for (const row of [...buttons, ...bodyText]) if (row.contrast + .001 < row.threshold) failures.push(row);
    const report = { label, generatedAt: new Date().toISOString(), browser: browser.version(), sourceSha256,
      scope: 'Actual production CSS and control DOM; actual production floating shadow root. WCAG sRGB contrast with ancestor opacity and transparent background composition. Semantic animations sampled at 12 regular times plus every actual CSS keyframe within first 2 seconds; motion measures 2D screen-space displacement.',
      thresholds: { text: 4.5, mainGraphic: 3, movingStatusLogo: '>=3px within 2 seconds', quietStatusLogo: '<=0.1px' },
      matrix: { themes: 2, accents: accents.length, types: types.length, states: states.length, contexts: 2, combinations: cases.length },
      passed: !failures.length && movement.every(row => row.passed) && !errors.length, failures, movement, buttons, bodyText, cases, screenshots, errors };
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    const minimums = {};
    for (const item of cases) for (const sample of item.samples) for (const row of sample.rows) minimums[row.role] = Math.min(minimums[row.role] ?? Infinity, row.contrast);
    const summary = { passed: report.passed, generatedAt: report.generatedAt, sourceSha256, combinations: cases.length, contrastFailures: failures.length, motionFailures: movement.filter(row => !row.passed).length, minimums: { ...minimums, panelButtonText: Math.min(...buttons.map(row => row.contrast)), dashboardBody: Math.min(...bodyText.map(row => row.contrast)) }, motionByState: Object.fromEntries(states.map(state => [state, { min: Math.min(...movement.filter(row => row.state === state).map(row => row.amplitude)), max: Math.max(...movement.filter(row => row.state === state).map(row => row.amplitude)) }])), errors, report: path.join(out, 'report.json'), screenshots, firstFailures: failures.slice(0, 8).map(({ frames, ...row }) => row) };
    await fs.writeFile(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
