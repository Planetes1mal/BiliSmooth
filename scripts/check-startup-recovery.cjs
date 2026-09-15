// Native startup recovery in disposable MV3 profiles. No signed-in browser is used.
// Uses generated VP8/WebM media and loopback TLS to observe native startup failures.
'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), https = require('node:https');
const crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const python = process.env.BILISMOOTH_PYTHON || 'python';
const { chromium } = require('playwright');
const { createEvidenceOutput, assertBuildMatches } = require('./validation-support.cjs');
const root = path.resolve(__dirname, '..'), expectedVersion = require(path.join(root, 'package.json')).version;
const A = 'upos-sz-mirroraliov.bilivideo.com', B = 'upos-sz-mirrorcosov.bilivideo.com';
const pageUrl = 'https://www.bilibili.com/video/BVstartupfixture';
const reportName = `startup-recovery-${expectedVersion}.json`;
const evidence = createEvidenceOutput({ root, suite: 'startup-recovery', version: expectedVersion, legacyDirectory: path.join(root, 'outputs'), reportFile: reportName });
const output = path.join(evidence, reportName);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const checks = [], runs = [], unexpected = [], network = [];
const check = (name, passed, detail) => checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });

async function certificate(directory) {
  const pem = path.join(directory, 'local-cert.pem'), key = path.join(directory, 'local-key.pem');
  execFileSync(python, ['-c', `from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime,timedelta,timezone
import sys,ipaddress
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'BiliSmooth isolated startup fixture')])
c=x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(datetime.now(timezone.utc)-timedelta(minutes=1)).not_valid_after(datetime.now(timezone.utc)+timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),False).sign(k,hashes.SHA256())
open(sys.argv[1],'wb').write(c.public_bytes(serialization.Encoding.PEM))
open(sys.argv[2],'wb').write(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))`, pem, key]);
  return { cert: await fs.readFile(pem), key: await fs.readFile(key) };
}

function html(metadata, init, clusterOffset) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Isolated native startup recovery</title></head>
<body><button id="start">Start native startup fixture</button><div class="bpx-player-container"><video muted playsinline style="width:640px;height:360px"></video></div>
<script>(()=>{
const video=document.querySelector('video'),state={events:[],requests:[],errors:[],frames:0,firstFrameAt:null,startedAt:null,started:false};
const init=Uint8Array.from(atob(${JSON.stringify(init.toString('base64'))}),c=>c.charCodeAt(0));
let source,buffer;
for(const name of ['loadedmetadata','loadeddata','seeking','seeked','waiting','playing','pause','error'])video.addEventListener(name,()=>state.events.push({name,at:performance.now(),readyState:video.readyState,paused:video.paused,seeking:video.seeking}));
function frame(now,data){state.frames++;if(state.firstFrameAt===null)state.firstFrameAt=now;state.lastFrame={at:now,time:data.mediaTime};video.requestVideoFrameCallback(frame);}
function append(bytes){return new Promise((resolve,reject)=>{const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(Error('append failed'));},cleanup=()=>{buffer.removeEventListener('updateend',done);buffer.removeEventListener('error',fail);};buffer.addEventListener('updateend',done);buffer.addEventListener('error',fail);buffer.appendBuffer(bytes);});}
function request(attempt=0){
 const record={attempt,at:performance.now(),requestedTarget:BiliSmoothSession.getState().targetHost,outcome:'pending'};state.requests.push(record);
 const xhr=new XMLHttpRequest();xhr.open('GET','https://${A}/upgcxcode/startup/video.m4s');xhr.responseType='arraybuffer';xhr.timeout=10000;
 xhr.setRequestHeader('Range','bytes=${clusterOffset}-${metadata.videoBytes - 1}');
 // Registered before send, just as a player owns its request timeout/retry.
 xhr.addEventListener('timeout',()=>{record.outcome='timeout';record.finishedAt=performance.now();record.retryTarget=BiliSmoothSession.getState().targetHost;
  if(attempt<1)request(attempt+1);else state.errors.push('both requests timed out');});
 xhr.addEventListener('progress',event=>{record.bytes=event.loaded;});
 xhr.addEventListener('error',()=>{record.outcome='error';state.errors.push('XHR network error');});
 xhr.addEventListener('load',()=>{record.outcome='complete';record.status=xhr.status;record.finishedAt=performance.now();record.responseBytes=xhr.response.byteLength;
  if(xhr.status!==206){state.errors.push('HTTP '+xhr.status);return;}
  append(xhr.response).then(()=>{source.endOfStream();return video.play();}).catch(error=>state.errors.push(String(error)));});
 xhr.send();
}
async function start(){if(state.started)return;state.started=true;state.startedAt=performance.now();
 const payload={data:{dash:{video:[{id:80,baseUrl:'https://${A}/upgcxcode/startup/video.m4s',backupUrl:[],width:640,height:360,frame_rate:'30'}]}}};
 window.__playinfo__=payload;source=new MediaSource();video.src=URL.createObjectURL(source);
 await new Promise(resolve=>source.addEventListener('sourceopen',resolve,{once:true}));buffer=source.addSourceBuffer(${JSON.stringify(metadata.videoType)});source.duration=${metadata.durationSeconds};
 video.requestVideoFrameCallback(frame);const metadataReady=new Promise(resolve=>video.addEventListener('loadedmetadata',resolve,{once:true}));await append(init);await metadataReady;
 video.currentTime=2;state.beforeRequest={paused:video.paused,seeking:video.seeking,readyState:video.readyState,frames:state.frames};request();
}
window.startupFixture={state,snapshot:()=>({at:performance.now(),currentTime:video.currentTime,readyState:video.readyState,paused:video.paused,seeking:video.seeking,frames:state.frames,error:video.error?.code??null,
 native:{clock:Function.prototype.toString.call(Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'currentTime').get).includes('[native code]'),ready:Function.prototype.toString.call(Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'readyState').get).includes('[native code]'),rvfc:Function.prototype.toString.call(video.requestVideoFrameCallback).includes('[native code]'),noOwn:['currentTime','readyState','requestVideoFrameCallback'].every(key=>!Object.hasOwn(video,key))},
 diagnostics:BiliSmoothSession.getDiagnostics()})};document.getElementById('start').addEventListener('click',()=>start().catch(error=>state.errors.push(String(error))));
})();</script></body></html>`;
}

async function run(adaptive, directory, server, metadata, video, clusterOffset) {
  const name = adaptive ? 'adaptive' : 'legacy-control', run = { name, adaptive, pageErrors: [], networkErrors: [] };
  const profile = await fs.mkdtemp(path.join(directory, name + '-')), extension = path.join(profile, 'extension');
  await fs.cp(path.join(root, 'dist/extension'), extension, { recursive: true });
  await assertBuildMatches(root, extension);
  const manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'));
  if (manifest.version !== expectedVersion) throw Error(`Build ${expectedVersion} before this test; found ${manifest.version}`);
  manifest.key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  run.sourceSha256 = hash(await fs.readFile(path.join(extension, 'playback.js')));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, ignoreHTTPSErrors: true,
    timezoneId: 'America/New_York', locale: 'en-US', viewport: { width: 1000, height: 750 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required', '--disable-background-networking'] });
  let page;
  try {
    run.browserVersion = context.browser()?.version();
    await context.grantPermissions(['local-network-access'], { origin: 'https://www.bilibili.com' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.href === pageUrl) return route.fulfill({ contentType: 'text/html', body: html(metadata, video.subarray(0, clusterOffset), clusterOffset) });
      if (url.pathname.startsWith('/upgcxcode/') && /\.bilivideo\.com$/.test(url.hostname)) {
        const target = new URL(`https://127.0.0.1:${server.address().port}${url.pathname}`);
        target.searchParams.set('run', name); target.searchParams.set('host', url.hostname); return route.continue({ url: target.href });
      }
      unexpected.push({ name, host: url.hostname, path: url.pathname }); return route.abort();
    });
    page = await context.newPage(); page.on('pageerror', error => run.pageErrors.push(error.message));
    page.on('requestfailed', request => run.networkErrors.push({ host: new URL(request.url()).hostname, error: request.failure()?.errorText }));
    await page.goto(pageUrl);
    await page.waitForFunction(() => window.BiliSmoothSession?.getState().startupReady === true, undefined, { timeout: 10000 });
    await page.evaluate(({ A, B, adaptive }) => {
      localStorage.setItem('bilismooth.routing.rank.v2.America/New_York|en-US', JSON.stringify({ ranking: [A, B], samples: [], at: Date.now() }));
      BiliSmoothSession.setConfig({ enabled: true, selection: 'auto', mode: 'force', pcdnHost: A, adaptiveRecovery: adaptive, stallRecovery: true });
    }, { A, B, adaptive });
    await page.click('#start');
    if (adaptive) await page.waitForFunction(() => startupFixture.state.frames >= 10 || startupFixture.state.errors.length > 0, undefined, { timeout: 18000 });
    else await page.waitForFunction(() => startupFixture.state.requests.length >= 2 || startupFixture.state.errors.length > 0, undefined, { timeout: 15000 });
    run.fixture = await page.evaluate(() => startupFixture.state); run.final = await page.evaluate(() => startupFixture.snapshot());
  } catch (error) {
    run.fatal = error.stack || String(error);
    if (page) {
      run.fixture = await page.evaluate(() => window.startupFixture?.state).catch(() => null);
      run.final = await page.evaluate(() => window.startupFixture?.snapshot()).catch(() => null);
    }
  }
  finally { await context.close(); }
  runs.push(run); return run;
}

(async () => {
  await fs.mkdir(path.join(root, 'outputs'), { recursive: true }); await fs.mkdir(path.join(root, 'work'), { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'work', 'native-startup-'));
  let server, fatal;
  try {
    const mediaDir = path.join(root, 'outputs/av-recovery-fixture');
    try { await fs.access(path.join(mediaDir, 'metadata.json')); }
    catch { execFileSync(process.execPath, [path.join(__dirname, 'generate-media-fixture.cjs'), '--generate-only'], { timeout: 30000 }); }
    const metadata = JSON.parse(await fs.readFile(path.join(mediaDir, 'metadata.json'), 'utf8')), video = await fs.readFile(path.join(mediaDir, 'video.webm'));
    if (hash(video) !== metadata.videoSha256) throw Error('Native generated video checksum mismatch');
    const clusterOffset = video.indexOf(Buffer.from([0x1f, 0x43, 0xb6, 0x75]));
    if (clusterOffset <= 0) throw Error('WebM fixture has no first Cluster boundary');
    server = https.createServer(await certificate(directory), (request, response) => {
      const url = new URL(request.url, 'https://127.0.0.1'), host = url.searchParams.get('host'), name = url.searchParams.get('run');
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Expose-Headers': 'Content-Length,Content-Range', 'Timing-Allow-Origin': '*', 'Content-Type': 'video/webm', 'Cache-Control': 'no-store' };
      if (request.method === 'OPTIONS') { response.writeHead(204, headers); response.end(); return; }
      const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range || '');
      const start = range ? Number(range[1]) : 0, end = range ? Number(range[2]) : video.length - 1, body = video.subarray(start, end + 1);
      const row = { name, host, range: request.headers.range || null, at: Date.now(), outcome: host === A ? 'partial-body-hang' : 'complete' }; network.push(row);
      response.writeHead(206, { ...headers, 'Content-Length': String(body.length), 'Content-Range': `bytes ${start}-${end}/${video.length}` }); response.flushHeaders();
      if (host === A) response.write(body.subarray(0, 128)); else response.end(body);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const [adaptive, legacy] = await Promise.all([run(true, directory, server, metadata, video, clusterOffset), run(false, directory, server, metadata, video, clusterOffset)]);
    for (const row of [adaptive, legacy]) {
      check(row.name + ': real paused metadata-only startup before any frame', row.fixture?.beforeRequest.paused && row.fixture.beforeRequest.frames === 0 && row.fixture.beforeRequest.readyState === 1, row.fixture?.beforeRequest);
      const first = row.fixture?.requests[0];
      check(row.name + ': real partial-body XHR reaches its native 10-second timeout', first?.outcome === 'timeout' && first.bytes > 0 && first.finishedAt - first.at >= 9500 && first.finishedAt - first.at < 13000, first);
      check(row.name + ': media element timing and compositor APIs stay native', row.final && Object.values(row.final.native).every(Boolean));
      check(row.name + ': no uncaught page or decoder error', !row.fatal && !row.pageErrors.length && !row.final?.error, { fatal: row.fatal, pageErrors: row.pageErrors });
    }
    check('adaptive: synchronous timeout consumer already observes the replacement target', adaptive.fixture?.requests[0]?.retryTarget === B, adaptive.fixture?.requests);
    check('adaptive: second request reaches replacement and presents native frames', network.some(row => row.name === 'adaptive' && row.host === B && row.outcome === 'complete') && adaptive.final?.frames >= 10);
    check('adaptive: timeout and loadend produce only one recovery attempt', adaptive.final?.diagnostics.recoveryAttempts === 1, adaptive.final?.diagnostics.recoveryAttempts);
    check('legacy control: same synchronous retry keeps the failed target and still has no frame', legacy.fixture?.requests[0]?.retryTarget === A && legacy.final?.frames === 0 && legacy.final?.diagnostics.recoveryAttempts === 0);
    check('both runs used identical built script bytes', adaptive.sourceSha256 === legacy.sourceSha256 && adaptive.sourceSha256 === hash(await fs.readFile(path.join(root, 'dist/extension/playback.js'))));
    check('all page requests remained on the local fixture', unexpected.length === 0, unexpected);
  } catch (error) { fatal = error.stack || String(error); check('native startup fixture completes', false, fatal); }
  finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    const report = { version: expectedVersion, at: new Date().toISOString(), passed: checks.every(row => row.passed), checks, runs, network, fatal,
      limits: ['Two disposable headless Chromium MV3 profiles; the signed-in user browser is not accessed.',
        'Native XHR, paused metadata-only MSE startup, partial body timeout, synchronous player retry and rVFC are exercised against a loopback TLS server.',
        'The fixture registers its native timeout listener after open and before send. Consumers registering before open retain their native order and are outside this ordering guarantee.',
        'Generated 640x360 VP8 media does not reproduce real Bilibili CDN routing, signed URLs, 4K decoding or the real player implementation.',
        'Temporary TLS certificates are never installed in the operating system; media responseURL identifies loopback.'] };
    await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ output, passed: report.passed, checks: checks.length, failed: checks.filter(row => !row.passed).map(row => row.name), fatal }));
    if (!report.passed) process.exitCode = 1;
  }
})();
