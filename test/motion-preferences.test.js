// Real browser coverage of the public choice API and visible motion preferences.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture() {
  const page = await browser.newPage();
  await page.setContent('<button id="choose">Choose a route</button>');
  for (const file of ['src/ui/surface.js', 'src/ui/motion-runtime.js', 'src/ui/choice.js']) {
    await page.addScriptTag({ path: path.resolve(__dirname, '..', file) });
  }
  await page.evaluate(() => {
    window.picker = BiliSmoothChoice.create({ root: document, trigger: document.querySelector('#choose'), options: [{ value: 'a', label: 'Route A' }, { value: 'b', label: 'Route B' }] });
    window.reducedChanged = false;
    matchMedia('(prefers-reduced-motion:reduce)').addEventListener('change', () => { reducedChanged = true; });
  });
  return page;
}

for (const preference of ['OS reduced motion', 'application motion']) for (const phase of ['enter', 'exit']) {
test(`${preference} interruption settles the menu during ${phase}`, async () => {
  const page = await fixture();
  try {
    const started = await page.evaluate(phase => {
      picker.open();
      if (phase === 'exit') picker.close();
      const animations = document.querySelector('.bs-choice-layer').getAnimations();
      // Keep the real transition in flight on slow CI while the OS event arrives.
      animations.forEach(animation => { animation.playbackRate = .1; });
      return animations.length;
    }, phase);
    assert.ok(started > 0);
    if (preference === 'OS reduced motion') {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => reducedChanged);
    } else await page.evaluate(() => { document.documentElement.dataset.motion = 'off'; BiliSmoothChoice.syncMotion(); });
    const state = await page.evaluate(() => {
      const layer = document.querySelector('.bs-choice-layer');
      return { running: layer.getAnimations().filter(animation => animation.playState === 'running').length, opacity: getComputedStyle(layer).opacity, hidden: layer.hidden, popover: layer.matches(':popover-open'), expanded: document.querySelector('#choose').getAttribute('aria-expanded') };
    });
    assert.equal(state.running, 0);
    assert.equal(state.opacity, phase === 'enter' ? '1' : '0');
    assert.equal(state.hidden, phase === 'exit');
    assert.equal(state.popover, phase === 'enter');
    assert.equal(state.expanded, String(phase === 'enter'));
  } finally { await page.close(); }
});
}

test('turning off application motion during exit closes the popover and permits reopening', async () => {
  const page = await fixture();
  try {
    const closed = await page.evaluate(() => {
      picker.open(); picker.close();
      document.documentElement.dataset.motion = 'off'; BiliSmoothChoice.syncMotion();
      const layer = document.querySelector('.bs-choice-layer');
      return { running: layer.getAnimations().length, hidden: layer.hidden, popover: layer.matches(':popover-open'), expanded: document.querySelector('#choose').getAttribute('aria-expanded') };
    });
    assert.deepEqual(closed, { running: 0, hidden: true, popover: false, expanded: 'false' });
    await page.evaluate(() => { picker.open(); document.documentElement.dataset.motion = 'on'; BiliSmoothChoice.syncMotion(); });
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate(() => {
      const layer = document.querySelector('.bs-choice-layer');
      return { hidden: layer.hidden, popover: layer.matches(':popover-open'), opacity: getComputedStyle(layer).opacity, animations: layer.getAnimations().length };
    }), { hidden: false, popover: true, opacity: '1', animations: 0 });
  } finally { await page.close(); }
});

test('a reversed menu settles open and destruction cancels its in-flight transition', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => { picker.open(); picker.close(); picker.open(); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => reducedChanged);
    assert.equal(await page.evaluate(() => document.querySelector('.bs-choice-layer').matches(':popover-open')), true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const destroyed = await page.evaluate(() => {
      picker.close();
      const layer = document.querySelector('.bs-choice-layer'), animations = layer.getAnimations();
      picker.destroy(); BiliSmoothChoice.syncMotion();
      return { connected: layer.isConnected, popover: layer.matches(':popover-open'), animations: animations.map(animation => animation.playState), expanded: document.querySelector('#choose').getAttribute('aria-expanded') };
    });
    assert.equal(destroyed.connected, false);
    assert.equal(destroyed.popover, false);
    assert.ok(destroyed.animations.length > 0);
    assert.ok(destroyed.animations.every(state => state === 'idle'));
    assert.equal(destroyed.expanded, 'false');
  } finally { await page.close(); }
});
