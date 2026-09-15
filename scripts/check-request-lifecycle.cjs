// Native MV3 lifecycle coverage. Never replaces video clocks, readiness, ranges,
// compositor callbacks or visibility properties with simulated getters.
'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const { createEvidenceOutput, assertBuildMatches } = require('./validation-support.cjs');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'outputs'), work = path.join(root, 'work');
const expectedVersion = require(path.join(root, 'package.json')).version;
const reportName = `request-lifecycle-checks-${expectedVersion}.json`;
const evidence = createEvidenceOutput({ root, suite: 'request-lifecycle', version: expectedVersion, legacyDirectory: output, reportFile: reportName });
const reportPath = path.join(evidence, reportName);
const pageUrl = 'https://www.bilibili.com/video/BVlifecycle';
const A = 'upos-sz-mirrorcosov.bilivideo.com', B = 'upos-sz-mirroraliov.bilivideo.com', peer = 'upos-sz-302ppio.bilivideo.com';
const hash = value => crypto.createHash('sha256').update(value).digest('hex'), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], phases = {}, errors = [], unexpected = [], network = [], limits = [];
const check = (name, passed, detail) => checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });

function html(metadata, qualityMetadata) {
  const early = { data: { dash: { video: [{ id: 80, baseUrl: `https://${peer}/upgcxcode/lifecycle/early/video.m4s`, backupUrl: [],
    width: 640, height: 360, frame_rate: '30', bandwidth: 1000000 }], audio: [{ id: 30280, baseUrl: `https://${A}/upgcxcode/lifecycle/early/audio.m4s`, backupUrl: [], bandwidth: 96000 }] } } };
  return `<!doctype html><html><head><meta charset="utf-8"><title>Native lifecycle fixture</title>
<script>window.__playinfo__=${JSON.stringify(early)};window.earlyObservation={base:window.__playinfo__.data.dash.video[0].baseUrl,sessionInstalled:!!window.BiliSmoothSession,at:performance.now()};</script>
</head><body><div class="bpx-player-container"><video muted playsinline style="width:640px;height:360px"></video></div>
<script>(()=>{
const metadata=${JSON.stringify(metadata)},qualityMetadata=${JSON.stringify(qualityMetadata)},state={requests:[],events:[],loads:[],frames:0,videoSerial:0,errors:[],inputFrames:0,bridgeMessages:0};
let video,source,vb,ab,canvasTimer,canvasTrack,audioContext;
window.addEventListener('message',event=>{if(event.source===window&&event.data?.__bilismoothConfig)state.bridgeMessages++;});
const ranges=value=>Array.from({length:value.length},(_,i)=>[value.start(i),value.end(i)]);
function bind(element){video=element;state.videoSerial++;video.muted=true;video.playsInline=true;video.loop=true;
 const owner=video,serial=state.videoSerial;
 const frame=(now,data)=>{if(owner!==video)return;state.frames++;state.lastFrame={now,mediaTime:data.mediaTime,presentedFrames:data.presentedFrames,serial};owner.requestVideoFrameCallback(frame);};
 owner.requestVideoFrameCallback(frame);
 for(const name of ['waiting','playing','loadedmetadata','emptied','seeking','seeked','ratechange','pause','ended'])owner.addEventListener(name,()=>state.events.push({name,at:performance.now(),serial,time:owner.currentTime}));
}
bind(document.querySelector('video'));
function get(url,kind,transport='xhr'){
 const record={url,kind,transport,at:performance.now(),outcome:'pending'};state.requests.push(record);
 if(transport==='fetch')return fetch(url,{headers:{Range:'bytes=0-'+((kind==='video'?url.includes('/quality/')?qualityMetadata.bytes:metadata.videoBytes:metadata.audioBytes)-1)}})
 .then(async response=>{record.status=response.status;if(response.status!==206)throw Error('HTTP '+response.status);const data=await response.arrayBuffer();record.outcome='complete';record.bytes=data.byteLength;return data;});
 return new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('GET',url);x.responseType='arraybuffer';x.timeout=15000;
 x.setRequestHeader('Range','bytes=0-'+((kind==='video'?url.includes('/quality/')?qualityMetadata.bytes:metadata.videoBytes:metadata.audioBytes)-1));
 for(const name of ['abort','timeout','error'])x.addEventListener(name,()=>{record.outcome=name;reject(Error(name));});
 x.addEventListener('load',()=>{record.status=x.status;record.outcome='complete';record.bytes=x.response.byteLength;x.status===206?resolve(x.response):reject(Error('HTTP '+x.status));});x.send();});
}
function append(buffer,data){return new Promise((resolve,reject)=>{const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(Error('SourceBuffer append'));};
const cleanup=()=>{buffer.removeEventListener('updateend',done);buffer.removeEventListener('error',fail);};buffer.addEventListener('updateend',done);buffer.addEventListener('error',fail);buffer.appendBuffer(data);});}
async function play(label='early',options={}){
 clearInterval(canvasTimer);canvasTimer=null;canvasTrack?.stop();canvasTrack=null;if(audioContext){await audioContext.close();audioContext=null;}
 if(options.replace){video.pause();const replacement=document.createElement('video');replacement.style.cssText='width:640px;height:360px';video.replaceWith(replacement);bind(replacement);}
 const quality=label==='quality',width=quality?320:640,height=quality?180:360;
 const payload={data:{dash:{video:[{id:quality?32:80,baseUrl:'https://${peer}/upgcxcode/lifecycle/'+label+'/video.m4s',backupUrl:[],width,height,frame_rate:'30',bandwidth:quality?400000:1000000}],
 audio:[{id:30280,baseUrl:'https://${A}/upgcxcode/lifecycle/'+label+'/audio.m4s',backupUrl:[],bandwidth:96000}]}}};
 if(label!=='early')window.__playinfo__=payload;
 const dash=window.__playinfo__.data.dash,v=dash.video[0],a=dash.audio[0],load={label,serial:state.videoSerial,startedAt:performance.now(),base:v.baseUrl};state.loads.push(load);
 video.pause();vb=null;ab=null;video.srcObject=null;source=new MediaSource();const owner=source;video.src=URL.createObjectURL(source);load.source=video.src;
 await new Promise(resolve=>owner.addEventListener('sourceopen',resolve,{once:true}));
 vb=owner.addSourceBuffer(metadata.videoType);ab=owner.addSourceBuffer(metadata.audioType);
 const bodies=await Promise.all([get(v.baseUrl,'video',options.transport),get(a.baseUrl,'audio',options.transport)]);
 await Promise.all([append(vb,bodies[0]),append(ab,bodies[1])]);owner.endOfStream();video.playbackRate=1;await video.play();load.readyAt=performance.now();return load;
}
async function seek(time){const done=new Promise(resolve=>video.addEventListener('seeked',resolve,{once:true}));video.currentTime=time;await done;return video.currentTime;}
function generate(enabled){clearInterval(canvasTimer);canvasTimer=null;if(!enabled)return;
 const canvas=window.__lifecycleCanvas,ctx=canvas.getContext('2d');const draw=()=>{state.inputFrames++;ctx.fillStyle='hsl('+(state.inputFrames*7%360)+' 50% 35%)';ctx.fillRect(0,0,640,360);ctx.fillStyle='#efd284';ctx.fillRect(state.inputFrames*9%560,100,80,120);canvasTrack.requestFrame();};
 draw();canvasTimer=setInterval(draw,1000/30);}
async function live(){video.pause();vb=null;ab=null;video.removeAttribute('src');video.load();video.loop=false;
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;window.__lifecycleCanvas=canvas;
 const captured=canvas.captureStream(0);canvasTrack=captured.getVideoTracks()[0];audioContext=new AudioContext({sampleRate:48000});
 const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),destination=audioContext.createMediaStreamDestination();gain.gain.value=0;
 oscillator.connect(gain);gain.connect(destination);oscillator.start();video.srcObject=new MediaStream([canvasTrack,...destination.stream.getAudioTracks()]);
 await audioContext.resume();generate(true);await video.play();}
function snapshot(){const s=BiliSmoothSession.getState();return {at:performance.now(),url:location.href,source:video.currentSrc,serial:state.videoSerial,time:video.currentTime,
readyState:video.readyState,width:video.videoWidth,height:video.videoHeight,paused:video.paused,rate:video.playbackRate,hidden:document.hidden,frames:state.frames,inputFrames:state.inputFrames,lastFrame:state.lastFrame,
audioTime:audioContext?.currentTime??null,buffered:ranges(video.buffered),videoBuffered:vb?ranges(vb.buffered):[],audioBuffered:ab?ranges(ab.buffered):[],error:video.error?.code??null,
session:{version:s.version,kernelVersion:s.kernelVersion,startupReady:s.startupReady,status:s.status,frameHealth:s.media.frameHealth,mediaGeneration:s.mediaGeneration,networkEpoch:s.networkEpoch,
actualHost:s.actualHost,requestedHost:s.requestedHost,targetHost:s.targetHost,config:s.config,recoveryAttempts:s.recoveryAttempts,needReload:s.needReload},
native:{noOwn:['currentTime','readyState','buffered','requestVideoFrameCallback'].every(key=>!Object.hasOwn(video,key)),
getters:['currentTime','readyState','buffered'].every(key=>Function.prototype.toString.call(Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,key).get).includes('[native code]')),
rvfc:Function.prototype.toString.call(video.requestVideoFrameCallback).includes('[native code]')}};}
window.lifecycle={state,play,seek,live,generate,snapshot,rate:value=>{video.playbackRate=value;},pause:()=>video.pause(),resume:()=>video.play()};
})();</script></body></html>`;
}

async function qualityFixture(context) {
  const directory = path.join(output, 'native-lifecycle-fixture'); await fs.mkdir(directory, { recursive: true });
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8')), bytes = await fs.readFile(path.join(directory, 'quality-320.webm'));
    if (metadata.sha256 === hash(bytes)) return { metadata, bytes };
  } catch (_) {}
  const page = await context.newPage(); await page.goto('https://fixture.invalid/quality-generation');
  const encoded = await page.evaluate(async () => {
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d'),stream=canvas.captureStream(0),track=stream.getVideoTracks()[0];
    const chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:400000});
    recorder.addEventListener('dataavailable',event=>{if(event.data.size)chunks.push(event.data);});
    const stopped=new Promise(resolve=>recorder.addEventListener('stop',resolve,{once:true}));let n=0;
    const draw=()=>{n++;ctx.fillStyle='hsl('+(n*5%360)+' 55% 30%)';ctx.fillRect(0,0,320,180);ctx.fillStyle='#d9b272';ctx.fillRect(n*4%280,40,40,80);track.requestFrame();};
    recorder.start(1000);draw();const timer=setInterval(draw,1000/30);await new Promise(resolve=>setTimeout(resolve,11000));clearInterval(timer);recorder.stop();await stopped;track.stop();
    const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return {base64:btoa(binary),frames:n};
  });
  await page.close(); const bytes = Buffer.from(encoded.base64, 'base64');
  const metadata = { width: 320, height: 180, frames: encoded.frames, bytes: bytes.length, sha256: hash(bytes), generatedAt: new Date().toISOString() };
  await fs.writeFile(path.join(directory, 'quality-320.webm'), bytes); await fs.writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
  return { metadata, bytes };
}

(async () => {
  await fs.mkdir(output, { recursive: true }); await fs.mkdir(work, { recursive: true });
  const profile = await fs.mkdtemp(path.join(work, 'request-lifecycle-')), extension = path.join(profile, 'fixture-extension');
  let context, fatal, sourceSha256, browserVersion, hiddenVerified = false, advancingClockFreeze = false;
  let holdProbes = false, delayMedia = false, quality;
  try {
    await fs.cp(path.join(root, 'dist/extension'), extension, { recursive: true });
    await assertBuildMatches(root, extension);
    const manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'));
    if (manifest.version !== expectedVersion) throw Error(`Lifecycle acceptance requires built version ${expectedVersion}; found ${manifest.version}`);
    sourceSha256 = hash(await fs.readFile(path.join(extension, 'playback.js')));
    const publicKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' });
    const extensionId = hash(publicKey).slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
    await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ ...manifest, key: publicKey.toString('base64') }));
    const mediaDirectory = path.join(output, 'av-recovery-fixture'), metadata = JSON.parse(await fs.readFile(path.join(mediaDirectory, 'metadata.json'), 'utf8'));
    const video = await fs.readFile(path.join(mediaDirectory, 'video.webm')), audio = await fs.readFile(path.join(mediaDirectory, 'audio.webm'));
    if (hash(video) !== metadata.videoSha256 || hash(audio) !== metadata.audioSha256) throw Error('Native fixture checksum mismatch');
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width: 1200, height: 850 },
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required', '--disable-background-networking'] });
    browserVersion = context.browser()?.version();
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const requestRows = new WeakMap(); context.on('requestfailed', request => { const row = requestRows.get(request); if (row) { row.failed = request.failure()?.errorText; row.finishedAt = Date.now(); } });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!/^https?:$/.test(url.protocol)) return route.continue();
      if (url.href === 'https://fixture.invalid/quality-generation') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Native quality media generator</title>' });
      if (url.origin === 'https://www.bilibili.com' && url.pathname.startsWith('/video/')) return route.fulfill({ contentType: 'text/html', body: html(metadata, quality.metadata) });
      if (/\.bilivideo\.(com|cn)$/.test(url.hostname) && url.pathname.startsWith('/upgcxcode/lifecycle/')) {
        const range = request.headers().range, row = { url: url.href, range: range || null, at: Date.now(), outcome: 'pending' }; network.push(row); requestRows.set(request, row);
        if (!range && holdProbes) { row.outcome = 'held-probe'; return; }
        if (range && delayMedia && url.pathname.includes('/network/')) { row.outcome = 'delayed-media'; await delay(1400); }
        const body = !range ? Buffer.alloc(768 * 1024, 1) : url.pathname.endsWith('/audio.m4s') ? audio : url.pathname.includes('/quality/') ? quality.bytes : video;
        const headers = { 'Content-Type': url.pathname.endsWith('/audio.m4s') ? 'audio/webm' : 'video/webm', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range,Content-Length', 'Timing-Allow-Origin': '*', 'Content-Length': String(body.length) };
        if (range) headers['Content-Range'] = `bytes 0-${body.length - 1}/${body.length}`;
        row.outcome = 'complete'; row.bytes = body.length; return route.fulfill({ status: range ? 206 : 200, headers, body });
      }
      unexpected.push(url.origin + url.pathname); return route.abort();
    });
    quality = await qualityFixture(context);
    const page = await context.newPage(); await page.goto(pageUrl);
    await page.waitForFunction(() => window.BiliSmoothSession?.getState().startupReady, undefined, { timeout: 10000 });
    phases.early = await page.evaluate(() => ({ ...earlyObservation, startupReady: BiliSmoothSession.getState().startupReady }));
    check('MAIN-world installation prepares head playinfo before the player exists', phases.early.sessionInstalled && new URL(phases.early.base).hostname === A && phases.early.startupReady, phases.early);
    const read = () => page.evaluate(() => lifecycle.snapshot());
    const healthy = async (label, timeout = 8000) => {
      const trace = [], started = Date.now();
      while (Date.now() - started < timeout) { const value = await read(); trace.push(value); if (value.session.frameHealth.state === 'healthy' && !value.paused) break; await delay(200); }
      phases[label] = trace; return trace.at(-1);
    };
    const series = async (label, duration) => {
      const trace = [await read()], started = Date.now(); while (Date.now() - started < duration) { await delay(250); trace.push(await read()); } phases[label] = trace; return trace;
    };
    await page.evaluate(() => lifecycle.play('early')); const initial = await healthy('early-playback');
    check('early manifest reaches real decoded 640x360 MSE playback', initial.width === 640 && initial.height === 360 && initial.frames > 2 && initial.session.status === 'smooth', initial);

    const beforeSource = initial.source, oldSerial = initial.serial;
    await page.evaluate(() => lifecycle.play('replacement', { replace: true, transport: 'fetch' })); const replaced = await healthy('player-replacement');
    check('a new video element and native MSE source are observed without stale player state', replaced.serial > oldSerial && replaced.source !== beforeSource && replaced.session.status === 'smooth', replaced);
    await page.evaluate(() => { history.pushState({}, '', '/video/BVlifecycle?p=2'); return lifecycle.play('part-two'); }); const part = await healthy('part-two');
    check('part navigation changes both page location and actual native media source', part.url.endsWith('?p=2') && part.source !== replaced.source && part.session.status === 'smooth', part);
    await page.evaluate(() => { history.pushState({}, '', '/video/BVlifecycleNext'); return lifecycle.play('next-video'); }); const next = await healthy('next-video');
    check('continuous-play navigation accepts a distinct manifest and real MSE source', next.url.endsWith('BVlifecycleNext') && next.source !== part.source && next.session.status === 'smooth', next);
    await page.evaluate(() => lifecycle.play('quality')); const changed = await healthy('quality-change');
    check('quality replacement really decodes a different 320x180 representation', changed.width === 320 && changed.height === 180 && changed.source !== next.source && changed.session.status === 'smooth', changed);

    await page.evaluate(() => lifecycle.seek(3)); const seeked = await healthy('real-seek');
    check('native seeking completes inside actual buffered media and frames recover', seeked.time >= 3 && seeked.buffered.length > 0 && seeked.session.status === 'smooth', seeked);
    await page.evaluate(() => lifecycle.rate(2)); const rates = await series('rate-two', 1500);
    check('2x changes native playback speed without losing presentation health', rates.at(-1).rate === 2 && rates.at(-1).time - rates[0].time > 2 && rates.at(-1).session.status === 'smooth', rates.at(-1));

    await page.evaluate(host => BiliSmoothSession.applyRoute(host), B);
    const chosen = await page.evaluate(() => BiliSmoothSession.getConfig());
    const dashboard = await context.newPage(); await dashboard.goto(`chrome-extension://${extensionId}/control/index.html`); await page.bringToFront();
    const tabId = await dashboard.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
    await dashboard.goto(`chrome-extension://${extensionId}/control/index.html?tab=${tabId}`); await dashboard.bringToFront(); await delay(800);
    hiddenVerified = await page.evaluate(() => document.hidden);
    await dashboard.waitForFunction(() => window.BiliSmoothLive?.command, undefined, { timeout: 10000 });
    const remote = await dashboard.evaluate(() => BiliSmoothLive.command('state'));
    phases.dashboard = { hidden: hiddenVerified, state: remote?.state || remote, chosen };
    const held = await page.evaluate(() => ({ config: BiliSmoothSession.getConfig(), route: BiliSmoothSession.rewriteUrl('https://upos-sz-302ppio.bilivideo.com/upgcxcode/lifecycle/current/video.m4s') }));
    check('the real full dashboard connects without revoking the chosen route', held.config.pcdnHost === B && held.config.selection === 'fixed' && new URL(held.route).hostname === B, held);
    if (!hiddenVerified) limits.push('Headless Chromium did not mark the source tab hidden after opening the real dashboard; native background visibility is unverified, with no visibility override used.');
    await page.bringToFront(); const foreground = await healthy('after-dashboard');
    check('returning from the full dashboard preserves routing and healthy real frames', foreground.session.config.pcdnHost === B && foreground.session.status === 'smooth', foreground);
    await dashboard.close();

    await page.evaluate(() => BiliSmoothSession.setConfig({ selection: 'auto', mode: 'bad-only' }));
    holdProbes = true; const beforeProbe = network.length; await page.evaluate(() => BiliSmoothSession.resetNetwork());
    for (let i = 0; i < 50 && network.slice(beforeProbe).filter(row => row.outcome === 'held-probe').length < 8; i++) await delay(50);
    const oldProbes = network.slice(beforeProbe).filter(row => row.outcome === 'held-probe');
    delayMedia = true; await page.evaluate(() => { lifecycle.pending = lifecycle.play('network', { transport: 'fetch' }); });
    for (let i = 0; i < 50 && !network.some(row => row.url.includes('/network/') && row.range && row.outcome === 'delayed-media'); i++) await delay(20);
    await page.evaluate(() => BiliSmoothSession.resetNetwork()); await page.evaluate(() => lifecycle.pending); delayMedia = false;
    const reset = await healthy('network-reset'); phases.oldProbes = oldProbes;
    const mediaRequests = await page.evaluate(() => lifecycle.state.requests.filter(row => row.url.includes('/network/')));
    check('network reset cancels only old native probe requests while media still completes', oldProbes.length === 8 && oldProbes.every(row => row.failed) && mediaRequests.length === 2 && mediaRequests.every(row => row.outcome === 'complete'), { oldProbes, mediaRequests });
    check('native media still appends and presents after network reassessment', reset.session.status === 'smooth' && reset.buffered.length > 0, reset);
    holdProbes = false; await page.evaluate(() => BiliSmoothSession.resetNetwork());

    await page.evaluate(() => { BiliSmoothSession.setConfig({ selection: 'fixed' }); return lifecycle.live(); });
    const live = await healthy('canvas-live'); const baseline = await series('canvas-baseline', 1300);
    check('native canvas plus silent audio creates real compositor frames', baseline.at(-1).frames > live.frames + 15 && baseline.at(-1).session.status === 'smooth', baseline.at(-1));
    await page.evaluate(() => { lifecycle.rate(2); lifecycle.generate(false); }); const frozen = await series('canvas-frozen', 5000);
    const settled = frozen.find(row => row.at - frozen[0].at >= 1000), end = frozen.at(-1);
    advancingClockFreeze = end.time - settled.time >= 1 && end.frames === settled.frames;
    phases.freezeObservation = { advancingClockFreeze, timeDelta: end.time - settled.time, audioDelta: end.audioTime - settled.audioTime, frameDelta: end.frames - settled.frames, inputDelta: end.inputFrames - settled.inputFrames };
    check('with frame production stopped, native compositor callbacks stop while audio continues', end.frames === settled.frames && end.inputFrames === settled.inputFrames && end.audioTime - settled.audioTime > 1, phases.freezeObservation);
    check('stopped native pictures cannot remain classified smooth', end.session.status !== 'smooth' && frozen.some(row => ['frozen', 'buffering'].includes(row.session.status)), end);
    if (!advancingClockFreeze) limits.push('The live captureStream fixture stopped its native video clock along with compositor frames. The specific clock-advancing/frame-stopped variant was not reproduced; actual audio/clock/frame traces are retained.');
    await page.evaluate(() => lifecycle.generate(true)); const recovered = await healthy('canvas-resumed');
    check('restoring native frame production restores a healthy status', recovered.session.status === 'smooth' && recovered.frames > end.frames + 1, recovered);
    await page.evaluate(() => { lifecycle.pause(); lifecycle.generate(false); }); const paused = await series('native-pause', 2500);
    check('actual pause does not produce a false frozen presentation incident', paused.every(row => row.paused && row.session.frameHealth.state !== 'frozen' && row.session.status === 'paused'), paused.at(-1));
    await page.evaluate(() => { lifecycle.generate(true); return lifecycle.resume(); }); const resumed = await healthy('native-resume');
    check('native resume establishes fresh healthy frames', resumed.session.status === 'smooth', resumed);

    phases.events = await page.evaluate(() => lifecycle.state.events);
    phases.final = await read(); phases.messages = await page.evaluate(() => lifecycle.state.bridgeMessages);
    const snapshots = Object.values(phases).filter(Array.isArray).flat().filter(value => value?.native);
    check('all sampled video clocks, readiness, buffered ranges and rVFC stayed native', snapshots.length > 20 && snapshots.every(value => Object.values(value.native).every(Boolean)));
    check('native lifecycle tests have no decoder or uncaught page error', errors.length === 0 && snapshots.every(value => !value.error), errors);
    check('page configuration stays settled without an unbounded message loop', phases.final.session.startupReady && phases.messages < 250, { messages: phases.messages, startupReady: phases.final.session.startupReady });
    check('all HTTP requests were fulfilled locally or intentionally held', unexpected.length === 0, unexpected);
    check('the tested runtime remains the current build', sourceSha256 === hash(await fs.readFile(path.join(root, 'dist/extension/playback.js'))));
  } catch (error) { fatal = error.stack || String(error); check('native lifecycle execution completed', false, fatal); }
  finally {
    if (context) await context.close();
    const report = { version: expectedVersion, generatedAt: new Date().toISOString(), passed: checks.every(item => item.passed), allIntendedScenariosVerified: checks.every(item => item.passed) && hiddenVerified && advancingClockFreeze,
      sourceSha256, browserVersion, nativeHiddenVerified: hiddenVerified, advancingClockFreeze, checks, phases, network, errors, unexpected, fatal,
      limits: [...limits, 'This is a controlled native player in an isolated MV3 profile, not the production Bilibili player, DRM, 4K decoding, physical screen scanout or internet/CDN performance.',
        'Part, continuous-play and quality tests replace real MSE sources. Quality decodes separate generated 640x360 and 320x180 VP8 streams; history changes alone never count as a media replacement.',
        'Held probe and delayed media routes use native browser request cancellation and responses. No synthetic video/visibility properties are installed.'] };
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ reportPath, passed: report.passed, allIntendedScenariosVerified: report.allIntendedScenariosVerified, checks: checks.length,
      failed: checks.filter(item => !item.passed).map(item => item.name), nativeHiddenVerified: hiddenVerified, advancingClockFreeze, fatal }));
    if (!report.passed) process.exitCode = 1;
  }
})();
