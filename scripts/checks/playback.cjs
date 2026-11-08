// Observe the installed candidate on the actual website in a disposable profile.
// No response interception, network throttling or synthetic playback properties.
'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const { createEvidenceOutput, assertBuildMatches, redactReportUrls } = require('../lib/evidence.cjs');
const { observe, snapshot, summarize } = require('../lib/playback-observer.cjs');
const { requireLoginCookies, checkLogin } = require('../lib/login.cjs');
const local = require('../lib/local.cjs');
const settings = require('../../src/core/settings.js');
const root = path.resolve(__dirname, '../..');
const expectedVersion = require('../../package.json').version;
const cli = process.argv.slice(2), compare = cli.includes('--compare');
const authenticatedRun = cli.includes('--auth'), headed = cli.includes('--headed');
const phaseSeconds = Number(cli.find(value => value.startsWith('--seconds='))?.slice(10) ?? 70);
if (!Number.isInteger(phaseSeconds) || phaseSeconds < 15 || phaseSeconds > 180) throw Error('--seconds must be an integer from 15 to 180');
const requestedRate = Number(cli.find(value => value.startsWith('--rate='))?.slice(7) ?? 1);
const requestedQuality = cli.find(value => value.startsWith('--quality='))?.slice(10) ?? 'auto';
if (!Number.isFinite(requestedRate) || requestedRate < 0.5 || requestedRate > 3) throw Error('--rate must be from 0.5 to 3');
if (!['auto', '4k'].includes(requestedQuality)) throw Error('--quality must be auto or 4k');
const target = new URL(cli.find(value => value.startsWith('--url='))?.slice(6) ||
  (requestedQuality === '4k' ? 'https://www.bilibili.com/video/BV1rp4y1e745/' : 'https://www.bilibili.com/video/BV14nYT6mE5N/'));
if (target.origin !== 'https://www.bilibili.com' || target.username || target.password || !/^\/video\/(?:BV[A-Za-z0-9]+|av\d+)\/?$/.test(target.pathname))
  throw Error('--url must be a normal https://www.bilibili.com/video/BV.../ or /video/av.../ URL');
target.hash = '';
const url = target.href;
const evidence = createEvidenceOutput({ root, suite: 'playback' });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { version: expectedVersion, startedAt: new Date().toISOString(), url,
  requestedConditions: { quality: requestedQuality, rate: requestedRate, minimumObservedMs: 5000,
    resolutionDefinition: '4k requires decoded video width or height >=3840 pixels; cinematic aspect ratios are allowed. UI labels alone are not confirmation.' },
  environment: { isolatedProfile: true, authenticationRequested: authenticatedRun, authenticated: false, headless: !headed, requestInterception: false,
    throttling: false, externalSchedulerExtensions: false, phaseSeconds,
    pageArtifacts: authenticatedRun ? 'Full-page screenshots, page titles and visible text omitted for signed-in runs.' : 'Anonymous page screenshots and text retained.',
    profilePreparation: 'Fresh profile; real same-origin robots.txt navigation seeds startup preferences before the first video request. Initial media cache is empty.' },
  observation: { sampleMs: 250, stallThresholdMs: 1500, clockProgressThresholdSeconds: 0.05,
    definition: 'After the first presented frame: no presented-frame progress for >=1500 ms while foreground, not paused, not seeking and not ended. Metadata-clock progress is reported separately; startup and refresh wait are separate, excluded from stalls.' },
  comparison: compare ? { order: ['disabled-control', 'enabled-candidate'],
    caveat: 'Short sequential observations use separate fresh profiles after same-origin settings preparation on the same video URL. CDN allocation, network conditions, quality and codecs may differ. Differences do not establish a causal speed benefit; disabled-control still loads the extension with optimization disabled.' } : null,
  runs: [], phases: [], errors: [], mediaProperties: [], mediaErrors: [], requests: [] };
function recordDash(phase, payload) {
  const data = payload?.data || payload?.result || payload;
  if (!data?.dash?.video) return;
  phase.playinfoQuality = data.quality;
  for (const video of data.dash.video) {
    const urls = [video.baseUrl, video.base_url, ...(video.backupUrl || video.backup_url || [])].filter(Boolean);
    const paths = [...new Set(urls.map(value => { try { return new URL(value).pathname; } catch { return null; } }).filter(Boolean))];
    const entry = { quality: video.id, width: video.width, height: video.height, bandwidthBps: video.bandwidth,
      codecs: video.codecs, frameRate: video.frameRate || video.frame_rate, paths };
    if (!phase.dashRepresentations.some(row => JSON.stringify(row) === JSON.stringify(entry))) phase.dashRepresentations.push(entry);
  }
}
async function selectQuality(page) {
  if (requestedQuality === 'auto') return { requested: 'auto', action: 'site-default' };
  const result = { requested: '4k', action: 'native-quality-menu' };
  const current4k = async () => {
    const dimensions = await page.evaluate(() => {
      const video = [...document.querySelectorAll('video')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
      return video ? { width: video.videoWidth, height: video.videoHeight } : null;
    }).catch(() => null);
    return dimensions && Math.max(dimensions.width, dimensions.height) >= 3840
      ? { ...result, action: 'native-already-4k', decodedDimensions: dimensions } : null;
  };
  try {
    const existing = await current4k();
    if (existing) return existing;
    await page.locator('.bpx-player-container').hover({ timeout: 3000 });
    const control = page.locator('.bpx-player-ctrl-quality');
    await control.waitFor({ state: 'visible', timeout: 20000 });
    await control.hover({ timeout: 3000 });
    const items = page.locator('.bpx-player-ctrl-quality-menu-item');
    await items.first().waitFor({ state: 'visible', timeout: 3000 });
    result.options = await items.allTextContents();
    const option = items.filter({ hasText: /4K|2160P/i }).first();
    if (!await option.count()) return { ...result, unavailable: true, reason: '4k-not-offered' };
    result.option = await option.innerText();
    if (!authenticatedRun && /登录即享|登录解锁|大会员专享/.test(result.option))
      return { ...result, unavailable: true, reason: 'account-or-membership-required' };
    if (await option.getAttribute('aria-disabled') === 'true' || /disabled|locked/i.test(await option.getAttribute('class') || ''))
      return { ...result, unavailable: true, reason: '4k-option-locked' };
    await option.click({ timeout: 3000 });
    // Use the site's own quality action. A login/VIP gate is an unavailable
    // condition, not permission to alter a manifest or unlock a media URL.
    const gate = page.getByText(/扫码登录|密码登录|登录后.*(?:4K|高清)|开通大会员.*(?:4K|观看)/).first();
    if (await gate.isVisible()) return { ...result, unavailable: true, reason: 'account-or-membership-required' };
    return { ...result, clicked: true };
  } catch (error) {
    const existing = await current4k();
    return existing ? { ...existing, menuError: String(error) }
      : { ...result, unavailable: true, reason: 'native-quality-control-unavailable', error: String(error) };
  }
}
function checkRequestedConditions(phase) {
  const matches = sample => sample.media && sample.frames > 0 && !sample.media.paused && !sample.media.seeking &&
    sample.visibility === 'visible' && Math.abs(sample.media.rate - requestedRate) < 0.01 &&
    (requestedQuality === 'auto' || Math.max(sample.media.width, sample.media.height) >= 3840);
  let observedMs = 0;
  for (let i = 1; i < phase.samples.length; i++) {
    const previous = phase.samples[i - 1], sample = phase.samples[i];
    if (previous.videoId === sample.videoId && matches(previous) && matches(sample) && sample.frames > previous.frames)
      observedMs += Math.min(500, sample.at - previous.at);
  }
  return { quality: requestedQuality, rate: requestedRate, observedMs, minimumObservedMs: 5000,
    met: observedMs >= 5000, unavailableReason: observedMs >= 5000 ? null : phase.qualitySelection.unavailable ? phase.qualitySelection.reason
      : requestedQuality === '4k' && !phase.samples.some(sample => sample.media && Math.max(sample.media.width, sample.media.height) >= 3840)
        ? '4k-not-observed' : !phase.samples.some(sample => sample.media && Math.abs(sample.media.rate - requestedRate) < 0.01)
          ? 'rate-not-observed' : 'requested-condition-duration-insufficient' };
}
function phaseStatus(phase) {
  if (phase.blocker) return 'blocked';
  if (!phase.candidateCheck?.valid) return 'failed-candidate';
  if (phase.samples.some(sample => sample.media?.error) || phase.events.some(event => event.event === 'error') || phase.mediaErrorCount)
    return 'failed-media';
  if ((requestedQuality !== 'auto' || requestedRate !== 1) && !phase.requestedConditions.met) return 'requested-condition-unavailable';
  return phase.summary.presentedFrames > 0 && phase.summary.activeForegroundSamples > phase.samples.length * 0.8
    ? 'observed' : 'incomplete-playback-observation';
}
function combinedStatus(statuses) {
  return ['failed-harness', 'failed-candidate', 'failed-media', 'blocked', 'requested-condition-unavailable', 'incomplete-playback-observation']
    .find(status => statuses.includes(status)) || (statuses.length ? 'observed' : 'incomplete-playback-observation');
}
function networkSummary(requests) {
  const groups = {};
  for (const request of requests) {
    const key = [request.kind, request.host, request.transport].join('|');
    const row = groups[key] ||= { kind: request.kind, host: request.host, transport: request.transport,
      requests: 0, statuses: {}, failures: {}, unfinished: 0 };
    row.requests++;
    if (request.status !== undefined) row.statuses[request.status] = (row.statuses[request.status] || 0) + 1;
    if (request.failure) row.failures[request.failure] = (row.failures[request.failure] || 0) + 1;
    if (!request.finishedAt) row.unfinished++;
  }
  return Object.values(groups);
}
async function observeVariant(directory, extension, variant, authState) {
  const run = { ...variant, startedAt: new Date().toISOString() }; report.runs.push(run);
  const args = ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-background-networking',
    `--disable-extensions-except=${extension}`, `--load-extension=${extension}`];
  let context, currentPhase;
  try {
    context = await chromium.launchPersistentContext(path.join(directory, variant.name), { channel: 'chromium', headless: !headed,
      viewport: { width: 1440, height: 1000 }, args });
    if (authState) await context.addCookies(authState.cookies);
    report.browserVersion = context.browser()?.version();
    let worker;
    try { worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 }); }
    catch (error) { run.candidateError = 'Candidate service worker did not load'; throw error; }
    // Seed both settings authorities before the first video request. MAIN reads
    // its same-origin startup cache synchronously, ahead of the storage bridge.
    run.extension = await worker.evaluate(async enabled => {
      const config = BiliSmoothSettings.normalize({ enabled });
      await BiliSmoothSettingsMigration.write(chrome.storage.local, config);
      return { version: chrome.runtime.getManifest().version, config };
    }, variant.enabled);
    if (run.extension.version !== expectedVersion) { run.candidateError = 'Unexpected runtime candidate version'; throw Error(run.candidateError); }
    const page = await context.newPage();
    const preparation = await page.goto(target.origin + '/robots.txt', { waitUntil: 'domcontentloaded', timeout: 25000 });
    const preparedUrl = new URL(page.url());
    if (preparedUrl.origin !== target.origin) throw Error('Startup settings preparation left the requested origin');
    if (authenticatedRun) {
      const verified = await checkLogin(page);
      run.authentication = { verified };
      if (verified !== true) {
        run.blocker = verified === false ? 'login-expired: log in again in the npm run dev browser' : 'login-status-unavailable';
        return;
      }
    }
    const cachedEnabled = await page.evaluate(({ key, config }) => {
      localStorage.setItem(key, JSON.stringify(config));
      return JSON.parse(localStorage.getItem(key)).enabled;
    }, { key: settings.cacheKey, config: run.extension.config });
    run.preparation = { url: preparedUrl.origin + preparedUrl.pathname, status: preparation?.status(), cachedEnabled };
    await context.addInitScript(observe);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Media.enable');
    cdp.on('Media.playerPropertiesChanged', event => report.mediaProperties.push({ variant: variant.name, phase: currentPhase?.name,
      at: new Date().toISOString(), playerId: event.playerId,
      properties: event.properties.filter(property => ['kVideoTracks', 'kAudioTracks', 'kVideoDecoderName', 'kAudioDecoderName',
        'kIsPlatformVideoDecoder', 'kResolution'].includes(property.name)) }));
    cdp.on('Media.playerErrorsRaised', event => report.mediaErrors.push({ variant: variant.name, phase: currentPhase?.name, at: new Date().toISOString(), ...event }));
    const tracked = new WeakMap(), pendingPlayinfo = new Set();
    page.on('request', request => {
      const u = new URL(request.url());
      const kind = /\.(m4s|mp4|flv)$/i.test(u.pathname) ? 'media' : /\/(playurl|playinfo)(\/|$)/i.test(u.pathname) ? 'playinfo' : null;
      if (!kind) return;
      const entry = { variant: variant.name, phase: currentPhase?.name, kind, at: new Date().toISOString(), host: u.hostname, path: u.pathname,
        method: request.method(), transport: request.resourceType(), resourceType: request.resourceType(), range: request.headers().range || null };
      tracked.set(request, entry); report.requests.push(entry);
    });
    page.on('pageerror', error => report.errors.push({ variant: variant.name, phase: currentPhase?.name, message: error.message }));
    page.on('response', response => {
      const request = response.request(), entry = tracked.get(request);
      if (entry) { entry.status = response.status(); entry.responseAt = new Date().toISOString(); }
      if (entry?.kind === 'playinfo' && response.ok()) {
        const phase = report.phases.find(row => row.variant === entry.variant && row.name === entry.phase);
        const reading = response.json().then(payload => recordDash(phase, payload)).catch(error => { phase.playinfoReadError = String(error); });
        pendingPlayinfo.add(reading); reading.finally(() => pendingPlayinfo.delete(reading));
      }
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && currentPhase)
        currentPhase.lastNavigation = { status: response.status(), host: new URL(response.url()).hostname };
    });
    page.on('requestfinished', request => { const entry = tracked.get(request); if (entry) entry.finishedAt = new Date().toISOString(); });
    page.on('requestfailed', request => {
      const entry = tracked.get(request);
      if (entry) { entry.failure = request.failure()?.errorText || 'unknown'; entry.finishedAt = new Date().toISOString(); }
    });
    for (const phaseName of ['startup', 'refresh']) {
      const phase = currentPhase = { name: phaseName, variant: variant.name, navigationAt: new Date().toISOString(), samples: [], dashRepresentations: [] }; report.phases.push(phase);
      try {
        if (phaseName === 'refresh') await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 });
        else await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      } catch (error) { phase.navigationError = String(error); }
      // Bilibili may automatically replace its first transient response with the
      // normal video page. Classify the final accessible state, not an iframe or
      // the status of that initial navigation while the real player is loading.
      try { await page.waitForFunction(() => !!document.querySelector('video'), undefined, { timeout: 20000 }); }
      catch (_) { /* Missing player is retained as evidence below. */ }
      if (!authenticatedRun) phase.title = await page.title();
      const landed = new URL(page.url());
      phase.finalUrl = landed.origin + landed.pathname;
      const wrongPage = landed.origin !== target.origin || landed.pathname.replace(/\/$/, '') !== target.pathname.replace(/\/$/, '');
      const screenshotName = `playback-${expectedVersion}-${compare ? variant.name + '-' : ''}${phaseName}.png`;
      if (phase.lastNavigation?.status >= 400 || wrongPage) {
        phase.blocker = phase.lastNavigation?.status >= 400 ? `HTTP ${phase.lastNavigation.status}`
          : phase.navigationError && /^(about:blank|chrome-error:)/.test(page.url()) ? 'Navigation failed' : 'Redirected away from the requested video';
        if (!authenticatedRun) phase.visibleText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 1800));
        phase.status = phaseStatus(phase);
        if (!authenticatedRun) await page.screenshot({ path: path.join(evidence, screenshotName) });
        break;
      }
      recordDash(phase, await page.evaluate(() => window.__playinfo__ || null));
      phase.qualitySelection = await selectQuality(page);
      // Keep a short lower-resolution observation when a known gate prevents
      // 4K, then skip a redundant refresh of the same unavailable condition.
      phase.plannedSeconds = phase.qualitySelection.unavailable ? Math.min(15, phaseSeconds) : phaseSeconds;
      const start = Date.now();
      let playbackAttempts = 0;
      while (Date.now() - start < phase.plannedSeconds * 1000) {
        const sample = await page.evaluate(snapshot); phase.samples.push(sample);
        if (playbackAttempts < 2 && sample.media && sample.media.readyState >= 1 &&
            (!playbackAttempts || Math.abs(sample.media.rate - requestedRate) >= 0.01)) {
          playbackAttempts++; phase.playActionAt ??= sample.at;
          // play() is idempotent; a toggle button races the site's own autoplay
          // between a paused-state read and the click, accidentally pausing it.
          // Use native play/rate setters; allow one reapplication if a quality
          // switch replaces the media element or restores the site's rate.
          try { await page.evaluate(({ rate, resetPosition }) => { const v = [...document.querySelectorAll('video')].sort((a,b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
            v.muted = true; v.playbackRate = rate;
            // Signed-in Bilibili restores server-side viewing history even in a
            // fresh profile. Compare the same opening segment in every phase.
            if (resetPosition) v.currentTime = 0;
            window.__biliObservation.playRequestAt = performance.now();
            v.play().catch(error => window.__biliObservation.events.push({ event: 'harness-play-rejected', message: String(error), at: performance.now() })); },
              { rate: requestedRate, resetPosition: authenticatedRun && playbackAttempts === 1 });
            if (authenticatedRun && playbackAttempts === 1) {
              phase.requestedStartTime = 0;
              phase.samples[phase.samples.length - 1] = await page.evaluate(snapshot);
            }
          }
          catch (error) { phase.playActionError = String(error); }
        }
        await delay(250);
      }
      const observation = await page.evaluate(() => window.__biliObservation);
      const observedPage = new URL(page.url());
      phase.finalUrl = observedPage.origin + observedPage.pathname;
      if (observedPage.origin !== target.origin || observedPage.pathname.replace(/\/$/, '') !== target.pathname.replace(/\/$/, ''))
        phase.blocker = 'Navigated away from the requested video during observation';
      const primaryIds = new Set(phase.samples.map(sample => sample.videoId));
      phase.events = observation.events.filter(event => primaryIds.has(event.videoId)); phase.summary = summarize(phase.samples);
      await Promise.race([Promise.allSettled([...pendingPlayinfo]), delay(1000)]);
      const mediaRequests = report.requests.filter(request => request.variant === variant.name && request.phase === phaseName && request.kind === 'media' && [200, 206].includes(request.status));
      phase.summary.selectedDashRepresentations = phase.dashRepresentations.filter(row =>
        phase.summary.dimensions.includes(`${row.width}x${row.height}`) && mediaRequests.some(request => row.paths.includes(request.path)));
      phase.summary.dashEvidenceDefinition = 'Representations matched by successful media request pathname and decoded dimensions. bandwidthBps is manifest bitrate, not measured throughput; unknown metadata stays unknown.';
      phase.summary.decodedVideoTracks = report.mediaProperties.filter(event => event.variant === variant.name && event.phase === phaseName)
        .flatMap(event => event.properties.filter(property => property.name === 'kVideoTracks').flatMap(property => {
          try { return JSON.parse(property.value).map(track => ({ codec: track.codec, codedSize: track['coded size'], naturalSize: track['natural size'] })); }
          catch { return []; }
        }));
      phase.requestedConditions = checkRequestedConditions(phase);
      const scheduler = phase.samples.at(-1)?.scheduler;
      phase.candidateCheck = { expectedVersion, expectedEnabled: variant.enabled, loaded: !!scheduler?.candidate,
        observedVersion: scheduler?.version || null, observedEnabled: scheduler?.config?.enabled ?? null,
        startupReady: scheduler?.startupReady ?? null,
        valid: !!scheduler?.candidate && scheduler.version === expectedVersion && scheduler.config?.enabled === variant.enabled && scheduler.startupReady !== false };
      phase.mediaErrorCount = report.mediaErrors.filter(event => event.variant === variant.name && event.phase === phaseName).length;
      phase.connection = { timeOrigin: observation.timeOrigin, initial: observation.initialConnection, events: observation.connectionEvents };
      phase.candidateDiagnostics = await page.evaluate(() => window.BiliSmoothSession?.getDiagnostics() || null);
      if (phase.candidateDiagnostics) {
        const d = phase.candidateDiagnostics;
        phase.networkSummary = { networkEpoch: d.networkEpoch, probeBytes: d.probeBytes,
          resetEvents: d.events.filter(event => event.type === 'network-reset'),
          probeStarts: d.events.filter(event => event.type === 'probe-start'),
          probeFinishes: d.events.filter(event => event.type === 'probe-finished'),
          completedProbeCounts: d.events.filter(event => event.type === 'probe').reduce((counts, event) => {
            counts[event.host] = (counts[event.host] || 0) + 1; return counts;
          }, {}) };
      }
      phase.summary.playActionToFirstFrameMs = phase.playActionAt === undefined || phase.summary.firstFrameFromNavigationMs === null ? null
        : Math.max(0, phase.summary.firstFrameFromNavigationMs - phase.playActionAt);
      if (!authenticatedRun) phase.visibleText = (await page.locator('body').innerText()).slice(0, 3000);
      phase.status = phaseStatus(phase);
      if (!authenticatedRun) await page.screenshot({ path: path.join(evidence, screenshotName) });
      console.log(JSON.stringify({ variant: variant.name, phase: phaseName, status: phase.status, summary: phase.summary, candidateCheck: phase.candidateCheck, requestedConditions: phase.requestedConditions }));
      if (phase.qualitySelection.unavailable) break;
    }
  } catch (error) { run.fatal = error.stack || String(error); }
  finally {
    if (context) await context.close();
    run.finishedAt = new Date().toISOString();
    run.status = run.blocker ? 'blocked' : run.candidateError ? 'failed-candidate' : run.fatal ? 'failed-harness'
      : combinedStatus(report.phases.filter(phase => phase.variant === variant.name).map(phase => phase.status));
    run.network = networkSummary(report.requests.filter(request => request.variant === variant.name));
  }
}
(async () => {
  await fs.mkdir(local.tmp, { recursive: true });
  const directory = await fs.mkdtemp(path.join(local.tmp, `playback-${expectedVersion}-`));
  report.workDirectory = path.relative(root, directory).replaceAll('\\', '/');
  const extension = path.join(directory, 'extension');
  try {
    // The signed-in arm imports only the dev browser's bilibili.com cookies into its fresh profile.
    const authState = authenticatedRun ? { cookies: await requireLoginCookies() } : null;
    await fs.cp(path.join(root, 'dist/extension'), extension, { recursive: true });
    await assertBuildMatches(root, extension);
    const manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'));
    if (manifest.version !== expectedVersion) throw Error('Unexpected candidate version');
    report.build = JSON.parse(await fs.readFile(path.join(extension, 'BUILD.json'), 'utf8'));
    report.runtimeFileSha256 = Object.fromEntries(await Promise.all(['playback.js','content.js','background.js'].map(async file => [file,hash(await fs.readFile(path.join(extension,file)))])));
    for (const [file,sha] of Object.entries(report.runtimeFileSha256)) if (report.build.outputSha256[file] !== sha) throw Error('Candidate differs from build');
    const variants = compare ? [{ name: 'disabled-control', enabled: false }, { name: 'enabled-candidate', enabled: true }]
      : [{ name: 'enabled-candidate', enabled: true }];
    for (const variant of variants) await observeVariant(directory, extension, variant, authState);
  } catch (error) { report.fatal = error.stack || String(error); }
  report.finishedAt = new Date().toISOString();
  report.environment.authenticated = authenticatedRun && report.runs.length > 0 && report.runs.every(run => run.authentication?.verified === true);
  report.status = report.fatal ? 'failed-harness' : combinedStatus(report.runs.map(run => run.status));
  report.exitCode = report.status === 'observed' ? 0 : report.status.startsWith('failed-') ? 1 : 2;
  if (compare) report.comparison.results = report.phases.map(phase => ({ variant: phase.variant, phase: phase.name,
    status: phase.status, summary: phase.summary, qualities: [...new Set(phase.samples.map(sample => sample.quality).filter(Boolean))] }));
  const output = path.join(evidence, `playback-${expectedVersion}.json`);
  await fs.writeFile(output, JSON.stringify(redactReportUrls(report), null, 2)); console.log(JSON.stringify({ report: output, status: report.status, exitCode: report.exitCode }));
  process.exitCode = report.exitCode;
})().catch(error => { console.error(error); process.exitCode = 1; });
