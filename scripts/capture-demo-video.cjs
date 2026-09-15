const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'dist/extension');
const images = path.join(root, 'docs/images');
const demoURL = 'https://www.bilibili.com/video/BV1BiliSmoothDemo/?motion=1';
const imageURL = 'https://i0.hdslb.com/bfs/bilismooth-demo/test-video.png';

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

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log(`Usage: npm run demo:record [-- --locale=en]

Build the extension first with npm run build. Requires Playwright Chromium.
Records the actual floating controls and composes a local 60 fps H.264 preview
with a smooth pointer, click feedback and a camera that follows the controls.
Uses original Test video artwork and blocks external HTTP requests.
No FFmpeg or additional dependencies are needed.
Writes outputs/readme-demo/floating-demo-preview.mp4 (Chinese).
With --locale=en, writes floating-demo-preview-en.mp4.
Raw footage, pointer timing and capture details remain under work/demo-video-*.
This command leaves README and store assets unchanged. Review the local video
before uploading an attachment or replacing the README demonstration.`);
    return;
  }
  if (args.length > 1 || args.some(arg => !['--locale=en', '--locale=zh-CN'].includes(arg))) {
    throw new Error(`Unknown argument: ${args.join(' ')}. Use --help.`);
  }
  const locale = args[0] === '--locale=en' ? 'en' : 'zh-CN';
  const language = locale === 'en' ? 'en' : 'zh';
  const suffix = locale === 'en' ? '-en' : '';
  const demoHTML = (await fs.readFile(path.join(__dirname, 'fixtures/store-demo.html'), 'utf8'))
    .replace('<html lang="en">', `<html lang="${locale}">`);
  const artwork = await fs.readFile(path.join(images, 'test-video.png'));
  await fs.mkdir(path.join(root, 'work'), { recursive: true });
  const out = await fs.mkdtemp(path.join(root, 'work/demo-video-'));
  let recording;
  let sourceTiming;
  let timeline;
  let settings;
  let title;
  const blockedRequests = new Set();
  const context = await chromium.launchPersistentContext(path.join(out, 'profile'), {
    channel: 'chromium', headless: true, locale: locale === 'en' ? 'en-US' : 'zh-CN',
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--autoplay-policy=no-user-gesture-required', '--auto-accept-this-tab-capture',
      '--enable-usermedia-screen-capturing', '--disable-background-timer-throttling']
  });
  try {
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url === demoURL) return route.fulfill({ status: 200, contentType: 'text/html', body: demoHTML });
      if (url === imageURL) return route.fulfill({ status: 200, contentType: 'image/png', body: artwork,
        headers: { 'access-control-allow-origin': '*' } });
      if (!/^https?:/.test(url)) return route.continue();
      blockedRequests.add(url);
      return route.abort('blockedbyclient');
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(async lang => {
      const key = 'bilismooth.config.v4';
      const previous = (await chrome.storage.local.get(key))[key] || {};
      await chrome.storage.local.set({ [key]: { ...previous, lang, theme: 'light', accent: 'teal' } });
    }, language);
    const page = await context.newPage();
    for (const old of context.pages()) if (old !== page) await old.close();
    await page.goto(demoURL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#bilismooth-floating')?.shadowRoot &&
      window.BiliSmoothSession?.getState().startupReady && document.querySelector('video').currentTime > 1);
    await page.addStyleTag({ content: '* { cursor: none !important; }' });
    await page.mouse.move(650, 580);
    await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60, max: 60 }, width: 1280, height: 800, cursor: 'never' },
        audio: false, preferCurrentTab: true
      });
      window.demoCapture = { stream, settings: stream.getVideoTracks()[0].getSettings() };
    });
    // Let the tab capture pipeline settle before the public clip.
    await page.waitForTimeout(2000);
    settings = await page.evaluate(() => {
      const capture = window.demoCapture;
      capture.parts = [];
      capture.recorder = new MediaRecorder(capture.stream, {
        mimeType: 'video/mp4;codecs=avc1.42002a', videoBitsPerSecond: 3500000
      });
      capture.recorder.ondataavailable = event => capture.parts.push(event.data);
      capture.done = new Promise(resolve => { capture.recorder.onstop = resolve; });
      capture.recorder.start();
      return capture.settings;
    });
    const started = Date.now();
    const at = async milliseconds => page.waitForTimeout(Math.max(0, started + milliseconds - Date.now()));
    const pointer = [{ time: 0, x: 650, y: 580, pressed: false }];
    const mark = (x, y, pressed = false) => pointer.push({ time: (Date.now() - started) / 1000, x, y, pressed });
    const move = async (target, duration = 850) => {
      const from = pointer.at(-1);
      const point = typeof target.boundingBox === 'function'
        ? await target.boundingBox().then(box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }))
        : target;
      mark(from.x, from.y);
      const begin = Date.now();
      const steps = Math.ceil(duration / 1000 * 30);
      const dx = point.x - from.x, dy = point.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      for (let step = 1; step <= steps; step++) {
        const t = step / steps, eased = t * t * (3 - 2 * t);
        const curve = Math.sin(Math.PI * t) * Math.min(28, length * .065);
        const x = from.x + dx * eased - dy / length * curve;
        const y = from.y + dy * eased + dx / length * curve;
        await page.mouse.move(x, y);
        mark(x, y);
        await page.waitForTimeout(Math.max(0, begin + step * duration / steps - Date.now()));
      }
    };
    const click = async () => {
      const { x, y } = pointer.at(-1);
      mark(x, y, true);
      await page.mouse.down();
      await page.waitForTimeout(120);
      await page.mouse.up();
      mark(x, y, false);
    };
    const host = page.locator('#bilismooth-floating');
    await at(1200); await move(host.locator('#bs-edge'), 1000);
    await at(2600); await move(host.locator('#bs-move'), 550);
    await at(3400); await click();
    await at(4300);
    const panelBox = await host.boundingBox();
    const focus = { x: panelBox.x + panelBox.width / 2, y: panelBox.y + panelBox.height / 2 };
    await move(host.locator('.bs-metrics'), 750);
    await at(6800); await move(host.locator('#bs-route'), 900);
    await at(8100); await click();
    await at(9500); await move(host.locator('.bs-choice-option').filter({ hasText: 'COSOV' }), 650);
    await at(10900); await move(host.locator('#bs-route'), 650);
    await at(11900); await click();
    await at(12500); await move(host.locator('.bs-metrics'), 650);
    await at(14600); await move(host.locator('#bs-close'), 850);
    await at(15700); await click();
    await at(16200); await move({ x: 650, y: 580 }, 1000);
    await at(20000);
    mark(650, 580);
    timeline = {
      duration: (Date.now() - started) / 1000,
      pointer,
      camera: [
        { time: 0, scale: 1, x: 640, y: 400 },
        { time: 1.35, scale: 1, x: 640, y: 400 },
        { time: 3.4, scale: 1.32, ...focus },
        { time: 6.8, scale: 1.32, ...focus },
        { time: 8.3, scale: 1.28, ...focus },
        { time: 12.1, scale: 1.28, ...focus },
        { time: 14.9, scale: 1.32, ...focus },
        { time: 16.0, scale: 1.32, ...focus },
        { time: 18.2, scale: 1, x: 640, y: 400 },
        { time: 20.0, scale: 1, x: 640, y: 400 }
      ]
    };
    const encoded = await page.evaluate(async () => {
      const capture = window.demoCapture;
      capture.recorder.stop();
      await capture.done;
      capture.stream.getTracks().forEach(track => track.stop());
      const bytes = new Uint8Array(await new Blob(capture.parts, { type: 'video/mp4' }).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    });
    recording = Buffer.from(encoded, 'base64');
    sourceTiming = inspectMP4(recording);
    title = await page.title();
    await fs.writeFile(path.join(out, 'recording.mp4'), recording);
    await fs.writeFile(path.join(out, 'timeline.json'), JSON.stringify(timeline, null, 2) + '\n');
    console.log(JSON.stringify({ stage: 'recorded', sourceTiming, capture: out }));
  } finally {
    await context.close();
  }

  const editorHTML = await fs.readFile(path.join(__dirname, 'fixtures/demo-video-editor.html'), 'utf8');
  const editorURL = 'https://bilismooth-demo.local/editor';
  const sourceURL = 'https://bilismooth-demo.local/recording.mp4';
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/*', route => {
      if (route.request().url() === editorURL) return route.fulfill({ contentType: 'text/html', body: editorHTML });
      if (route.request().url() === sourceURL) return route.fulfill({ contentType: 'video/mp4', body: recording });
      return route.abort('blockedbyclient');
    });
    await page.goto(editorURL);
    const composed = await page.evaluate(args => window.renderDemo(args), {
      sourceURL, timeline, outputWidth: 1440, outputHeight: 900, bitrate: 1600000
    });
    const rawComposite = Buffer.from(composed.base64, 'base64');
    await fs.writeFile(path.join(out, 'composed.mp4'), rawComposite);
    const mp4 = retimeMP4(rawComposite);
    const timing = inspectMP4(mp4);
    if (timing.seconds < timeline.duration * .9) {
      throw new Error(`The composed clip ended early or lost too many frames; source footage remains at ${out}.`);
    }
    const output = path.join(root, 'outputs/readme-demo', `floating-demo-preview${suffix}.mp4`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, mp4);
    const metadata = { settings, sourceTiming, timing, bytes: mp4.length, locale, title,
      output, capture: out, width: composed.width, height: composed.height,
      blockedRequests: [...blockedRequests],
      source: 'Real extension UI with composed pointer and camera; not a CDN performance measurement.' };
    await fs.writeFile(path.join(out, 'capture.json'), JSON.stringify(metadata, null, 2) + '\n');
    console.log(JSON.stringify(metadata, null, 2));
  } finally {
    await browser.close();
  }
}

module.exports = { inspectMP4, retimeMP4 };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
