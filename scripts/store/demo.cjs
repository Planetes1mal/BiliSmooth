const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const extension = path.join(root, 'dist/extension');
const local = require('../lib/local.cjs');

// Chromium's MP4 recorder writes fragmented MP4. Read its actual video sample
// durations instead of trusting the requested MediaStream frame rate.
function inspectMP4(buffer) {
  const durations = [];
  let timescale;
  let codec;
  const walk = (start, end) => {
    for (let offset = start; offset + 8 <= end;) {
      const size = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      if (size < 8 || offset + size > end) throw new Error('Invalid MP4 box size.');
      const data = offset + 8;
      if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'moof', 'traf'].includes(type)) {
        walk(data, offset + size);
      } else if (type === 'mdhd') {
        timescale = buffer.readUInt32BE(data + (buffer[data] === 1 ? 20 : 12));
      } else if (type === 'stsd') {
        codec = buffer.toString('ascii', data + 12, data + 16);
      } else if (type === 'trun') {
        const flags = buffer.readUIntBE(data + 1, 3);
        const count = buffer.readUInt32BE(data + 4);
        if (!(flags & 0x100)) throw new Error('Expected per-frame MP4 durations.');
        let sample = data + 8 + ((flags & 1) ? 4 : 0) + ((flags & 4) ? 4 : 0);
        for (let i = 0; i < count; i++) {
          durations.push(buffer.readUInt32BE(sample));
          sample += 4 + ((flags & 0x200) ? 4 : 0) + ((flags & 0x400) ? 4 : 0) + ((flags & 0x800) ? 4 : 0);
        }
      }
      offset += size;
    }
  };
  walk(0, buffer.length);
  const intervals = durations.map(duration => duration * 1000 / timescale).sort((a, b) => a - b);
  const seconds = durations.reduce((sum, duration) => sum + duration, 0) / timescale;
  if (!intervals.length || !timescale || codec !== 'avc1') throw new Error('Expected an H.264 MP4 with video samples.');
  return {
    codec, frames: durations.length, seconds: Number(seconds.toFixed(3)),
    averageFPS: Number((durations.length / seconds).toFixed(3)),
    medianFrameMs: Number(intervals[Math.floor(intervals.length / 2)].toFixed(3)),
    p95FrameMs: Number(intervals[Math.floor(intervals.length * .95)].toFixed(3)),
    longestFrameMs: Number(intervals.at(-1).toFixed(3)),
    framesOver25ms: intervals.filter(interval => interval > 25).length
  };
}

// Give every captured frame exactly 1/60 s. This slightly shortens a capture
// that dropped frames; it never duplicates, invents, or re-encodes a frame.
// Only the single-video-track fragmented MP4 layout emitted above is accepted.
function retimeMP4(buffer) {
  const output = Buffer.from(buffer);
  const headers = [];
  const indexes = [];
  const fragmentTimes = new Map();
  let frames = 0;
  const walk = (start, end, fragment) => {
    for (let offset = start; offset + 8 <= end;) {
      const size = output.readUInt32BE(offset);
      const type = output.toString('ascii', offset + 4, offset + 8);
      const data = offset + 8;
      if (size < 8 || offset + size > end) throw new Error('Invalid MP4 box size.');
      if (type === 'moof') {
        fragmentTimes.set(offset, frames * 1000);
        walk(data, offset + size, offset);
      } else if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'traf', 'mfra'].includes(type)) {
        walk(data, offset + size, fragment);
      } else if (['mvhd', 'tkhd', 'mdhd'].includes(type)) {
        headers.push({ type, data });
      } else if (type === 'tfdt') {
        const time = fragmentTimes.get(fragment);
        if (output[data] === 1) output.writeBigUInt64BE(BigInt(time), data + 4);
        else output.writeUInt32BE(time, data + 4);
      } else if (type === 'trun') {
        const flags = output.readUIntBE(data + 1, 3);
        if (!(flags & 0x100) || (flags & 0x800)) throw new Error('Unsupported MP4 sample timing.');
        const count = output.readUInt32BE(data + 4);
        let sample = data + 8 + ((flags & 1) ? 4 : 0) + ((flags & 4) ? 4 : 0);
        for (let i = 0; i < count; i++) {
          output.writeUInt32BE(1000, sample);
          sample += 4 + ((flags & 0x200) ? 4 : 0) + ((flags & 0x400) ? 4 : 0);
        }
        frames += count;
      } else if (type === 'tfra') {
        indexes.push(data);
      }
      offset += size;
    }
  };
  walk(0, output.length);
  if (headers.filter(header => header.type === 'mdhd').length !== 1) throw new Error('Expected one video track.');
  for (const { type, data } of headers) {
    const wide = output[data] === 1;
    const duration = data + (type === 'tkhd' ? (wide ? 28 : 20) : (wide ? 24 : 16));
    if (type !== 'tkhd') output.writeUInt32BE(60000, duration - 4);
    if (wide) output.writeBigUInt64BE(BigInt(frames * 1000), duration);
    else output.writeUInt32BE(frames * 1000, duration);
  }
  for (const data of indexes) {
    const wide = output[data] === 1;
    const lengths = output.readUInt32BE(data + 8);
    const suffix = ((lengths >> 4) & 3) + ((lengths >> 2) & 3) + (lengths & 3) + 3;
    const count = output.readUInt32BE(data + 12);
    let entry = data + 16;
    for (let i = 0; i < count; i++) {
      const fragment = wide ? Number(output.readBigUInt64BE(entry + 8)) : output.readUInt32BE(entry + 4);
      const time = fragmentTimes.get(fragment);
      if (time === undefined) throw new Error('Unknown MP4 random-access fragment.');
      if (wide) output.writeBigUInt64BE(BigInt(time), entry);
      else output.writeUInt32BE(time, entry);
      entry += (wide ? 16 : 8) + suffix;
    }
  }
  return output;
}

// The README demo: the built extension on a real Bilibili page that plays Blender's open movie Spring
// (CC BY 4.0), in a fresh signed-out profile. The video tab and the dashboard tab are each recorded with tab
// capture on one clock, then cut together with a drawn pointer, a camera, one caption per scene and the credit.
const VIDEO = 'BV1Yb411g7VV';
const SCENE_START = 95;
// Other people's videos and ads in the recommendation column, the sign-in prompt and danmaku stay out of frame.
const PAGE_CSS = '.right-container, .bpx-player-toast-wrap, .bpx-player-render-dm-wrap, .bpx-player-dm-wrap, .bili-mini-mask,'
  + ' .login-tip, .vip-login-tip { visibility: hidden !important; } * { cursor: none !important; }';
const COPY = {
  zh: {
    captions: ['在 B 站看清网速和缓冲', '悬停查看速度、缓冲和线路', '一键测速，比较各条线路', '自动选最快的线路，也能固定一条',
      '仪表盘：速度曲线、线路对比和设置', 'Chrome 应用商店搜索 BiliSmooth'],
    credit: '画面：《Spring》© Blender Foundation | cloud.blender.org/spring | CC BY 4.0'
  },
  en: {
    captions: ['See download speed and buffer on Bilibili', 'Hover for speed, buffer and server', 'Test every server in one click',
      'Automatic picks the fastest server, or keep one', 'Dashboard: speed history, servers and settings', 'Search BiliSmooth in the Chrome Web Store'],
    credit: 'Footage: Spring © Blender Foundation | cloud.blender.org/spring | CC BY 4.0'
  }
};

// Tab capture: one stream and one recorder per clip. A tab in the background draws no frames, so a clip never spans
// one: the video tab is recorded as one clip before the dashboard and another after it.
async function openCapture(page) {
  await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60, max: 60 }, width: 1280, height: 800, cursor: 'never' }, audio: false, preferCurrentTab: true
    });
    window.demoCapture = { stream };
  });
  // Let the tab capture pipeline settle before the clip starts, then check it sees the whole 1280 × 800 tab.
  await page.waitForTimeout(1500);
  const size = await page.evaluate(() => { const { width, height } = window.demoCapture.stream.getVideoTracks()[0].getSettings(); return { width, height }; });
  if (size.width !== 1280 || size.height !== 800) throw new Error(`Tab capture is ${size.width} × ${size.height}, not 1280 × 800.`);
  return startRecorder(page);
}
// Resolves to the recorder's start on the wall clock.
async function startRecorder(page) {
  return page.evaluate(() => new Promise(resolve => {
    const capture = window.demoCapture;
    capture.parts = [];
    capture.recorder = new MediaRecorder(capture.stream, { mimeType: 'video/mp4;codecs=avc1.42002a', videoBitsPerSecond: 3500000 });
    capture.recorder.ondataavailable = event => { if (event.data.size) capture.parts.push(event.data); };
    capture.done = new Promise(done => { capture.recorder.onstop = done; });
    capture.recorder.addEventListener('start', () => resolve(Date.now()), { once: true });
    capture.recorder.start();
  }));
}
async function stopRecorder(page, { last = true } = {}) {
  const encoded = await page.evaluate(async last => {
    const capture = window.demoCapture;
    capture.recorder.stop();
    await capture.done;
    if (last) capture.stream.getTracks().forEach(track => track.stop());
    const bytes = new Uint8Array(await new Blob(capture.parts, { type: 'video/mp4' }).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }, last);
  return Buffer.from(encoded, 'base64');
}

// Recording: returns both clips and the timeline, all times in seconds from the video tab's first frame.
async function record({ context, url, language, out }) {
  const copy = COPY[language];
  const tracks = { page: { pointer: [], camera: [] }, dashboard: { pointer: [], camera: [] } };
  const captions = [], cuts = [];
  let origin = 0;
  const now = () => (Date.now() - origin) / 1000;
  const at = async (page, seconds) => page.waitForTimeout(Math.max(0, origin + seconds * 1000 - Date.now()));
  const caption = index => { const time = now(); if (captions.length) captions.at(-1).to = time; captions.push({ from: time, to: Infinity, text: copy.captions[index] }); };
  const camera = (source, time, scale, x, y) => tracks[source].camera.push({ time, scale, x, y });
  const pointer = (source, page) => {
    const track = tracks[source].pointer;
    const mark = (x, y, pressed = false) => track.push({ time: now(), x, y, pressed });
    return {
      mark,
      async move(target, duration = 800) {
        const from = track.at(-1);
        const box = typeof target.boundingBox === 'function' ? await target.boundingBox() : null;
        const point = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : target;
        mark(from.x, from.y);
        const begin = Date.now(), steps = Math.ceil(duration / 1000 * 30);
        const dx = point.x - from.x, dy = point.y - from.y, length = Math.hypot(dx, dy) || 1;
        for (let step = 1; step <= steps; step++) {
          const t = step / steps, eased = t * t * (3 - 2 * t), curve = Math.sin(Math.PI * t) * Math.min(28, length * .065);
          const x = from.x + dx * eased - dy / length * curve, y = from.y + dy * eased + dx / length * curve;
          await page.mouse.move(x, y);
          mark(x, y);
          await page.waitForTimeout(Math.max(0, begin + step * duration / steps - Date.now()));
        }
      },
      async click() {
        const { x, y } = track.at(-1);
        mark(x, y, true);
        await page.mouse.down();
        await page.waitForTimeout(120);
        await page.mouse.up();
        mark(x, y, false);
      }
    };
  };

  // The video tab: settle on the chosen scene with a full buffer and no test running, so the clip opens on calm playback.
  const page = await context.newPage();
  // Bilibili may redirect to a language path (/zh-Hans/) after the first load: style every document, then wait for the
  // address to hold still.
  await page.addInitScript(css => {
    const add = () => { const style = document.createElement('style'); style.textContent = css; document.documentElement.append(style); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add, { once: true }); else add();
  }, PAGE_CSS);
  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  for (let previous = ''; previous !== page.url();) { previous = page.url(); await page.waitForTimeout(2000); }
  await page.waitForFunction(() => document.querySelector('video')?.currentTime > 1 && window.BiliSmoothRuntime && window.BiliSmoothFloating,
    undefined, { timeout: 45000 });
  await page.mouse.move(420, 110);
  await page.evaluate(start => { document.querySelector('video').currentTime = start; }, SCENE_START);
  await page.waitForFunction(() => {
    const view = BiliSmoothRuntime.getViewState(), video = document.querySelector('video');
    return !video.paused && view.bufferWallSeconds > 25 && view.delivery?.canTest && view.delivery.status !== 'testing';
  }, undefined, { timeout: 90000, polling: 500 });
  const host = page.locator('#bilismooth-floating');
  await page.evaluate(() => { BiliSmoothFloating.collapse(); BiliSmoothFloating.collapse(); });
  await page.waitForTimeout(800);
  origin = await openCapture(page);
  const P = pointer('page', page);
  P.mark(420, 110);
  camera('page', 0, 1, 640, 400);
  caption(0);

  await at(page, 3); caption(1);
  camera('page', 3, 1, 640, 400);
  await P.move(host.locator('#entry'), 1000);
  await at(page, 6.2); await P.move(host.locator('#preview'), 500);
  await at(page, 6.9); await P.click();
  await page.waitForTimeout(500);
  const panel = await host.boundingBox();
  // Push in on the panel with some of the playing video beside it.
  const side = panel.x + panel.width / 2 < 640 ? 1 : -1;
  const focus = { x: panel.x + panel.width / 2 + side * 170, y: panel.y + panel.height / 2 - 60 };
  camera('page', 7.0, 1, 640, 400);
  camera('page', 8.2, 1.5, focus.x, focus.y);

  await at(page, 8.2); caption(2);
  await P.move(host.locator('#test'), 800);
  await page.waitForFunction(() => !document.querySelector('#bilismooth-floating').shadowRoot.querySelector('#test').disabled, undefined, { timeout: 20000 });
  await P.click();
  await page.waitForFunction(() => document.querySelector('#bilismooth-floating').shadowRoot.querySelector('#feedback')?.dataset.tone === 'ok',
    undefined, { timeout: 15000, polling: 100 });
  await page.waitForTimeout(2200);

  caption(3);
  await P.move(host.locator('#server'), 700); await P.click();
  await page.waitForTimeout(900);
  const fixed = host.locator('#server-menu [data-choice^="upos-"]').first();
  await P.move(fixed, 700); await page.waitForTimeout(1300);
  await P.move(host.locator('#server-menu [data-choice="auto"]'), 600); await page.waitForTimeout(400); await P.click();
  await page.waitForTimeout(900);

  // The dashboard tab, opened from the panel and recorded on the same clock.
  const opened = context.waitForEvent('page', { timeout: 15000 });
  await P.move(host.locator('[data-action="dashboard"]'), 700); await P.click();
  const dashboard = await opened;
  await dashboard.waitForLoadState('domcontentloaded');
  await dashboard.addStyleTag({ content: '* { cursor: none !important; }' });
  await dashboard.waitForFunction(() => window.BiliSmoothView?.status() === 'connected' && document.querySelector('#picker .title')?.textContent,
    undefined, { timeout: 20000 });
  await dashboard.mouse.move(640, 430);
  const dashboardStart = (await openCapture(dashboard) - origin) / 1000;
  const cutToDashboard = dashboardStart + .3;
  cuts.push({ source: 'page', track: 'page', from: 0, to: cutToDashboard });
  camera('page', cutToDashboard, 1.5, focus.x, focus.y);
  // The pointer leaves the video tab at the cut, so the closing shot has none.
  const last = tracks.page.pointer.at(-1);
  tracks.page.pointer.push({ time: cutToDashboard, x: last.x, y: last.y, pressed: false }, { time: cutToDashboard + .01, x: -80, y: 420, pressed: false });
  await dashboard.waitForTimeout(Math.max(0, (cutToDashboard - now()) * 1000));
  const firstClip = await stopRecorder(page);
  caption(4);
  const D = pointer('dashboard', dashboard);
  D.mark(640, 430);
  camera('dashboard', cutToDashboard, 1, 640, 400);
  await dashboard.waitForTimeout(3400);
  await D.move(dashboard.locator('nav [data-page="routes"]'), 750); await D.click();
  await dashboard.waitForTimeout(3600);
  await D.move(dashboard.locator('nav [data-page="settings"]'), 650); await D.click();
  await dashboard.waitForTimeout(3200);
  await page.evaluate(() => { BiliSmoothFloating.collapse(); BiliSmoothFloating.collapse(); });

  // Back on the video: the collapsed control keeps its live numbers under the closing line.
  // Back in front, the tab can come back smaller and the control still concealed: restore both first.
  await page.bringToFront();
  // Headless Chromium captures a tab brought back to front at its window's own size (88 px of it is browser chrome);
  // a 1282 × 888 window gives the 1280 × 800 the clip needs.
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: 1282, height: 888 } });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => BiliSmoothFloating.refresh());
  await page.waitForFunction(() => { const control = document.getElementById('bilismooth-floating'); return control && !control.hidden && control.dataset.phase === 'edge'; },
    undefined, { timeout: 10000 }).catch(async () => {
    throw new Error('The floating control did not come back on the video tab: ' + await page.evaluate(() => document.getElementById('bilismooth-floating')?.dataset.hiddenReason));
  });
  await page.waitForTimeout(700);
  // A tab that went to the background keeps capturing at its old size: a fresh capture for the closing clip.
  const secondStart = (await openCapture(page) - origin) / 1000;
  const cutBack = secondStart + .2;
  await page.waitForTimeout(Math.max(0, (cutBack - now()) * 1000));
  cuts.push({ source: 'dashboard', track: 'dashboard', from: cutToDashboard, to: cutBack });
  const dashboardClip = await stopRecorder(dashboard);
  caption(5);
  camera('page', cutBack, 1, 640, 400);
  await page.waitForTimeout(5200);
  const duration = now();
  cuts.push({ source: 'closing', track: 'page', from: cutBack, to: duration });
  captions.at(-1).to = duration;
  const clips = { page: firstClip, dashboard: dashboardClip, closing: await stopRecorder(page) };
  for (const [name, clip] of Object.entries(clips)) await fs.writeFile(path.join(out, name + '.mp4'), clip);
  for (const track of Object.values(tracks)) track.camera.sort((a, b) => a.time - b.time);
  const timeline = { duration, cuts, tracks, captions, credit: copy.credit, offsets: { page: 0, dashboard: dashboardStart, closing: secondStart } };
  await fs.writeFile(path.join(out, 'timeline.json'), JSON.stringify(timeline, null, 2) + '\n');
  const title = await page.title();
  return { clips, timeline, title, pageURL: page.url().replace(/\?.*$/, '') };
}

// Renders the timeline over the clips in real time; returns the retimed MP4 and its timing.
async function compose({ clips, timeline, locale, out }) {
  const editorHTML = await fs.readFile(path.join(__dirname, '../fixtures/demo-video-editor.html'), 'utf8');
  const brand = await fs.readFile(path.join(root, 'src/extension/icons/128.png'));
  const base = 'https://bilismooth-demo.local/';
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/*', route => {
      const name = route.request().url().slice(base.length);
      if (name === 'editor') return route.fulfill({ contentType: 'text/html', body: editorHTML });
      const clip = clips[name.replace(/\.mp4$/, '')];
      if (clip) return route.fulfill({ contentType: 'video/mp4', body: clip });
      if (name === 'brand.png') return route.fulfill({ contentType: 'image/png', body: brand });
      return route.abort('blockedbyclient');
    });
    await page.goto(base + 'editor');
    // Rendering runs in real time; a clip that stops playing would otherwise hang it.
    const limit = (timeline.duration + 60) * 1000;
    const composed = await Promise.race([
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Rendering did not finish within ${limit / 1000} s.`)), limit).unref()),
      page.evaluate(args => window.renderDemo(args), {
        sources: Object.entries(timeline.offsets).map(([id, offset]) => ({ id, url: base + id + '.mp4', offset })),
        timeline, brandURL: base + 'brand.png', lang: locale, outputWidth: 1440, outputHeight: 900, bitrate: 2400000
      })]);
    const raw = Buffer.from(composed.base64, 'base64');
    await fs.writeFile(path.join(out, 'composed.mp4'), raw);
    const mp4 = retimeMP4(raw);
    return { mp4, timing: inspectMP4(mp4), width: composed.width, height: composed.height };
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(`Usage: npm run store:demo [-- --locale=en] [-- --from=<capture folder>]

Build the extension first with npm run build. Requires Playwright Chromium and network access.
Opens a fresh signed-out profile with the built extension on a real Bilibili page that plays
Blender's open movie Spring (CC BY 4.0, ${VIDEO}), records the video tab and the dashboard tab,
and composes a 60 fps H.264 video with a drawn pointer, a camera, one caption per scene and the
footage credit. Speeds, buffer and test results are whatever the network gives during the run.
No FFmpeg or additional dependencies are needed.
Writes local/store/readme-demo/floating-demo-preview.mp4 (Chinese).
With --locale=en, records the /en/ page and writes floating-demo-preview-en.mp4.
Raw clips, the timeline and capture details remain under local/tmp/demo-video-*;
--from=<that folder> composes them again without recording (captions come from this script).
This command leaves README and store assets unchanged. Review the local video
before uploading an attachment or replacing the README demonstration.`);
    return;
  }
  const from = args.find(arg => arg.startsWith('--from='))?.slice(7);
  const rest = args.filter(arg => !arg.startsWith('--from='));
  if (rest.length > 1 || rest.some(arg => !['--locale=en', '--locale=zh-CN'].includes(arg))) {
    throw new Error(`Unknown argument: ${args.join(' ')}. Use --help.`);
  }
  const locale = rest[0] === '--locale=en' ? 'en' : 'zh-CN';
  const language = locale === 'en' ? 'en' : 'zh';
  const suffix = locale === 'en' ? '-en' : '';
  let recorded, out;
  if (from) {
    out = path.resolve(from);
    const timeline = JSON.parse(await fs.readFile(path.join(out, 'timeline.json'), 'utf8'));
    const clips = Object.fromEntries(await Promise.all(Object.keys(timeline.offsets).map(async name => [name, await fs.readFile(path.join(out, name + '.mp4'))])));
    // Captions and credit follow this script, so wording changes need no new recording.
    timeline.captions.forEach((item, index) => { item.text = COPY[language].captions[index]; });
    timeline.credit = COPY[language].credit;
    recorded = { clips, timeline, title: null, pageURL: null };
  } else {
    const url = `https://www.bilibili.com/${language === 'en' ? 'en/' : ''}video/${VIDEO}/`;
    await fs.mkdir(local.tmp, { recursive: true });
    out = await fs.mkdtemp(path.join(local.tmp, 'demo-video-'));
    const context = await chromium.launchPersistentContext(path.join(out, 'profile'), {
      channel: 'chromium', headless: true, locale: locale === 'en' ? 'en-US' : 'zh-CN',
      viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
        '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--auto-accept-this-tab-capture',
        '--enable-usermedia-screen-capturing', '--disable-background-timer-throttling']
    });
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      await worker.evaluate(async lang => {
        const key = 'bilismooth.config.v4';
        const previous = (await chrome.storage.local.get(key))[key] || {};
        await chrome.storage.local.set({ [key]: { ...previous, lang, theme: 'light', accent: 'blue', floatingEntryType: 'combined' } });
      }, language);
      for (const old of context.pages()) await old.close();
      recorded = await record({ context, url, language, out });
    } finally {
      await context.close();
    }
  }
  const sources = Object.fromEntries(Object.entries(recorded.clips).map(([name, clip]) => [name, inspectMP4(clip)]));
  console.log(JSON.stringify({ stage: 'recorded', sources, duration: recorded.timeline.duration, capture: out }));

  // Real-time encoding now and then drops frames; one more pass is cheaper than a new recording.
  let result;
  for (let attempt = 1; attempt <= 2; attempt++) {
    result = await compose({ clips: recorded.clips, timeline: recorded.timeline, locale, out });
    if (result.timing.seconds >= recorded.timeline.duration * .9) break;
    console.log(JSON.stringify({ stage: 'compose', attempt, seconds: result.timing.seconds, note: 'lost frames, composing again' }));
    if (attempt === 2) throw new Error(`The composed clip lost too many frames twice; compose again with --from=${out}.`);
  }
  const output = path.join(local.store, 'readme-demo', `floating-demo-preview${suffix}.mp4`);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, result.mp4);
  const metadata = { locale, page: recorded.pageURL, title: recorded.title, sources, timing: result.timing, bytes: result.mp4.length, output, capture: out,
    width: result.width, height: result.height,
    source: 'Real extension UI on a real Bilibili page in a signed-out profile, with a composed pointer, camera and captions; numbers are live readings, not a performance measurement.' };
  await fs.writeFile(path.join(out, 'capture.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify(metadata, null, 2));
}

module.exports = { inspectMP4, retimeMP4 };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
