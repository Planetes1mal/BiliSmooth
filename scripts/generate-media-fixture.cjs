// Standalone local VP8/Opus fixture generator; no runtime or archived implementation is loaded.
'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const fixtureDirectory = path.join(__dirname, '../outputs/av-recovery-fixture');
const blockedRequests = [], hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function generateMedia(browser) {
  await fs.mkdir(fixtureDirectory, { recursive: true });
  const metadataPath = path.join(fixtureDirectory, 'metadata.json');
  try {
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    const video = await fs.readFile(path.join(fixtureDirectory, 'video.webm'));
    const audio = await fs.readFile(path.join(fixtureDirectory, 'audio.webm'));
    if (metadata.videoSha256 === hash(video) && metadata.audioSha256 === hash(audio)) return { metadata, video, audio };
  } catch {}
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => {
    if (route.request().url() === 'https://fixture.invalid/generate') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local media generation</title>' });
    blockedRequests.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  await page.goto('https://fixture.invalid/generate');
  const result = await page.evaluate(async () => {
    const videoType = 'video/webm;codecs=vp8', audioType = 'audio/webm;codecs=opus';
    if (![videoType, audioType].every(type => MediaRecorder.isTypeSupported(type) && MediaSource.isTypeSupported(type))) throw Error('VP8/Opus MediaRecorder and MSE support required');
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const draw = canvas.getContext('2d'), stream = canvas.captureStream(0), track = stream.getVideoTracks()[0];
    let count = 0;
    function frame() {
      count++; draw.fillStyle = 'hsl(' + (count * 3 % 360) + ' 45% 25%)'; draw.fillRect(0, 0, 640, 360);
      draw.fillStyle = '#e8c884'; draw.fillRect((count * 7) % 560, 120, 80, 120); track.requestFrame();
    }
    const audio = new AudioContext({ sampleRate: 48000 }), oscillator = audio.createOscillator();
    const gain = audio.createGain(), destination = audio.createMediaStreamDestination();
    oscillator.frequency.value = 440; gain.gain.value = 0.05;
    oscillator.connect(gain); gain.connect(destination); oscillator.start(); await audio.resume();
    const record = (source, mimeType) => {
      const recorder = new MediaRecorder(source, { mimeType, ...(mimeType.startsWith('video') ? { videoBitsPerSecond: 1000000 } : { audioBitsPerSecond: 96000 }) });
      const chunks = []; recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
      const done = new Promise((resolve, reject) => { recorder.addEventListener('stop', resolve, { once: true }); recorder.addEventListener('error', reject, { once: true }); });
      recorder.start(1000); return { recorder, chunks, done };
    };
    const v = record(stream, videoType), a = record(destination.stream, audioType);
    frame(); const timer = setInterval(frame, 1000 / 30);
    await new Promise(resolve => setTimeout(resolve, 10500));
    v.recorder.stop(); a.recorder.stop(); clearInterval(timer);
    await Promise.all([v.done, a.done]); track.stop(); oscillator.stop(); await audio.close();
    const encode = async chunks => {
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let binary = ''; for (let at = 0; at < bytes.length; at += 16384) binary += String.fromCharCode(...bytes.subarray(at, at + 16384));
      return { base64: btoa(binary), chunkBytes: chunks.map(chunk => chunk.size) };
    };
    return { video: await encode(v.chunks), audio: await encode(a.chunks), videoType, audioType, generatedFrames: count };
  });
  await context.close();
  const video = Buffer.from(result.video.base64, 'base64'), audio = Buffer.from(result.audio.base64, 'base64');
  const metadata = { generatedAt: new Date().toISOString(), durationSeconds: 10.5, generatedFrames: result.generatedFrames,
    videoType: result.videoType, audioType: result.audioType, videoBytes: video.length, audioBytes: audio.length,
    videoChunkBytes: result.video.chunkBytes, audioChunkBytes: result.audio.chunkBytes,
    audioPrefixBytes: result.audio.chunkBytes.slice(0, 4).reduce((sum, bytes) => sum + bytes, 0),
    videoSha256: hash(video), audioSha256: hash(audio) };
  await fs.writeFile(path.join(fixtureDirectory, 'video.webm'), video);
  await fs.writeFile(path.join(fixtureDirectory, 'audio.webm'), audio);
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  return { metadata, video, audio };
}

(async () => { const browser = await chromium.launch({ channel: 'chromium', headless: true }); try { const result = await generateMedia(browser); console.log(JSON.stringify(result.metadata)); } finally { await browser.close(); } })().catch(error => { console.error(error); process.exitCode = 1; });
