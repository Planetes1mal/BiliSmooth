// Compare real signed DASH bytes through native, same-origin browser Fetch.
// This is a bounded delivery measurement, not a 4K decoding/playback benchmark.
'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
const { chromium } = require('playwright');
const { createEvidenceOutput } = require('../lib/evidence.cjs');
const { requireLoginCookies, checkLogin } = require('../lib/login.cjs');
const settings = require('../../src/core/settings.js');
const { addressForHost } = require('../../src/core/routing-policy.js');
const root = path.resolve(__dirname, '../..'), version = require('../../package.json').version;
const args = process.argv.slice(2), option = name => args.find(value => value.startsWith('--' + name + '='))?.slice(name.length + 3);
if (require.main === module && args.includes('--help')) {
  console.log('node scripts/check-cdn.cjs --label=unique-run [--auth] [--url=https://www.bilibili.com/video/BV.../] [--quality=4k] [--hosts=host,host] [--include-source-hosts] [--rounds=2] [--bytes=2097152] [--offset=random]');
  process.exit(0);
}
const target = new URL(option('url') || 'https://www.bilibili.com/video/BV1rp4y1e745/');
if (target.origin !== 'https://www.bilibili.com' || target.username || target.password || !/^\/video\/(?:BV[A-Za-z0-9]+|av\d+)\/?$/.test(target.pathname))
  throw Error('--url must be a public https://www.bilibili.com/video/BV.../ or /video/av.../ page');
target.hash = '';
const hosts = [...new Set((option('hosts') || settings.candidatePool.join(',')).split(',').map(host => host.trim().toLowerCase()))];
// The hosts a user may choose (upos and bcache under bilivideo), plus upos hosts on Akamai.
const isUpOsHost = host => settings.isCdnHost(host) || /^upos-[a-z0-9-]+\.akamaized\.net$/.test(host);
if (!hosts.length || hosts.length > 20 || hosts.some(host => !isUpOsHost(host)))
  throw Error('--hosts must contain 1–20 upos or bcache CDN hostnames');
const offsetMode = option('offset') || 'start';
if (!['start', 'random'].includes(offsetMode)) throw Error('--offset must be start or random');
const rounds = Number(option('rounds') || 2), maxBytes = Number(option('bytes') || (offsetMode === 'random' ? 786432 : 2097152)), timeoutMs = 6000;
if (offsetMode === 'random' && maxBytes !== 786432) throw Error('--offset=random uses exactly 768 KiB (or the whole resource if shorter)');
let offset = 0;
const quality = option('quality') || 'highest';
if (!['highest', '4k'].includes(quality)) throw Error('--quality must be highest or 4k');
if (!Number.isInteger(rounds) || rounds < 2 || rounds > 3) throw Error('--rounds must be 2 or 3');
if (!Number.isInteger(maxBytes) || maxBytes < 65536 || maxBytes > 2097152) throw Error('--bytes must be 65536–2097152');
const authenticatedRun = args.includes('--auth'), includeSourceHosts = args.includes('--include-source-hosts');
let plannedBytes = (hosts.length * rounds + 1) * maxBytes + (offsetMode === 'random' ? 1 : 0);
if (plannedBytes > 100 * 1048576) throw Error('Planned reference + candidate traffic exceeds 100 MiB; reduce --hosts, --rounds or --bytes');
const directory = require.main === module ? createEvidenceOutput({ root, suite: 'cdn' }) : null;
const report = { version, startedAt: new Date().toISOString(), page: target.origin + target.pathname,
  authentication: { requested: authenticatedRun, status: authenticatedRun ? 'pending' : 'anonymous' },
  method: { isolatedProfile: true, authenticated: false, extensionLoaded: false, nativePageFetch: true,
    requestOrigin: target.origin, credentials: 'omit', cache: 'no-store', range: `bytes=0-${maxBytes - 1}`,
    rounds, quality, offsetMode, bytesPerRequest: maxBytes, timeoutMs, plannedBytes, includeSourceHosts, sequential: true,
    candidateAddress: 'Replace only the selected source host, retaining its path and signed query. Native backup URLs with different signatures are not tested independently.',
    budgetScope: 'Reference, candidate and at most one 1-byte resource-length request; obtaining the real page/player is additional site traffic.',
    order: 'Rotate the starting host each round; no simultaneous media downloads.',
    limitation: 'One accessible representation and one byte range, at this location and time. Manifest bandwidth is an average. Range throughput is not proof of 4K or 2x playback, peak segment demand, or decoding performance.' },
  samples: [], summary: [], recommendations: [] };
const finite = value => Number.isFinite(value) ? value : null;
const median = values => { const sorted = values.filter(Number.isFinite).sort((a, b) => a - b), half = Math.floor(sorted.length / 2);
  return sorted.length ? sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2 : null; };
function dashOf(payload) {
  const data = payload?.data || payload?.result || payload;
  return data?.dash || data?.video_info?.dash;
}
function tracks(payload) {
  const dash = dashOf(payload);
  return Array.isArray(dash?.video) ? dash.video.filter(track => typeof (track.baseUrl || track.base_url) === 'string') : [];
}
function metadata(track) {
  return { id: track.id, width: finite(Number(track.width)), height: finite(Number(track.height)), codecs: track.codecs || null,
    codecId: track.codecid ?? track.codec_id ?? null, fps: track.frame_rate ?? track.frameRate ?? null,
    bandwidth: finite(Number(track.bandwidth)) };
}
const is4k = track => Number(track.id) === 120 && Math.max(Number(track.width) || 0, Number(track.height) || 0) >= 3840;
async function selectNative4k(page) {
  const result = { action: 'native-quality-menu', clicked: false };
  try {
    await page.locator('.bpx-player-container').hover({ timeout: 3000 });
    const control = page.locator('.bpx-player-ctrl-quality');
    await control.waitFor({ state: 'visible', timeout: 20000 });
    await control.hover({ timeout: 3000 });
    const items = page.locator('.bpx-player-ctrl-quality-menu-item');
    await items.first().waitFor({ state: 'visible', timeout: 3000 });
    const option = items.filter({ hasText: /4K|2160P/i }).first();
    if (!await option.count()) return { ...result, reason: '4k-not-offered' };
    if (!authenticatedRun && /登录即享|登录解锁|大会员专享/.test(await option.innerText()))
      return { ...result, reason: 'account-or-membership-required' };
    if (await option.getAttribute('aria-disabled') === 'true' || /disabled|locked/i.test(await option.getAttribute('class') || ''))
      return { ...result, reason: '4k-option-locked' };
    await option.click({ timeout: 3000 });
    return { ...result, clicked: true };
  } catch { return { ...result, reason: 'native-quality-control-unavailable' }; }
}
async function acquire(page) {
  let observed = [], audio = [], observedFrom = null; const observedLengths = new Map();
  const collect = (payload, from) => {
    const found = tracks(payload); if (!found.length) return;
    observed = found; audio = dashOf(payload)?.audio || []; observedFrom = from;
  };
  const onResponse = async response => {
    const url = new URL(response.url());
    const contentRange = /^bytes \d+-\d+\/(\d+)$/.exec(response.headers()['content-range'] || '');
    if (/\.m4s$/i.test(url.pathname) && response.status() === 206 && contentRange) observedLengths.set(url.pathname, Number(contentRange[1]));
    if (!/(^|\.)bilibili\.com$/.test(url.hostname) || !/\/playurl(?:\?|$)/.test(url.pathname + url.search)) return;
    try { collect(await response.json(), 'observed-official-playurl'); } catch {}
  };
  page.on('response', onResponse);
  try {
    const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    report.acquisition = { initialStatus: response?.status() ?? null };
    const deadline = Date.now() + 25000;
    while (!observed.length && Date.now() < deadline) {
      const payload = await page.evaluate(() => window.__playinfo__ || null);
      collect(payload, 'page-__playinfo__');
      if (observed.length) break;
      await page.waitForTimeout(250);
    }
    const landed = new URL(page.url());
    report.acquisition.finalPage = landed.origin + landed.pathname;
    if (!observed.length) throw Object.assign(Error(), { measurementReason: 'no-accessible-dash-representation' });
    if (quality === '4k' && !observed.some(is4k)) {
      report.acquisition.qualitySelection = await selectNative4k(page);
      if (report.acquisition.qualitySelection.clicked) {
        // Wait for the site's quality action to supply an authorized representation.
        // Never synthesize a higher-quality manifest or change its signed media path.
        const qualityDeadline = Date.now() + 20000;
        while (!observed.some(is4k) && Date.now() < qualityDeadline) await page.waitForTimeout(250);
      }
    }
    observed.sort((a, b) => Number(b.width || 0) * Number(b.height || 0) - Number(a.width || 0) * Number(a.height || 0) || Number(b.bandwidth || 0) - Number(a.bandwidth || 0));
    let available = observed;
    if (quality === '4k') {
      available = observed.filter(is4k);
      if (!available.length) throw Object.assign(Error(), { measurementReason: report.acquisition.qualitySelection?.reason || '4k-not-offered-to-current-account' });
      available.sort((a, b) => Number(b.bandwidth || 0) - Number(a.bandwidth || 0));
    }
    const chosen = available[0], raw = chosen.baseUrl || chosen.base_url, source = new URL(raw.startsWith('//') ? 'https:' + raw : raw);
    if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) throw Error('Page supplied an unsupported media address');
    const audioTrack = [...audio].sort((a, b) => Number(b.bandwidth || 0) - Number(a.bandwidth || 0))[0];
    const sourceHosts = new Set();
    for (const rawAddress of [raw, ...(chosen.backupUrl || chosen.backup_url || [])]) {
      try {
        const address = new URL(rawAddress, source);
        if (['http:', 'https:'].includes(address.protocol) && !address.username && !address.password &&
            isUpOsHost(address.hostname) && address.pathname === source.pathname) sourceHosts.add(address.hostname);
      } catch {}
    }
    if (includeSourceHosts) {
      for (const host of sourceHosts) if (!hosts.includes(host) && hosts.length < 20) hosts.push(host);
      plannedBytes = (hosts.length * rounds + 1) * maxBytes + (offsetMode === 'random' ? 1 : 0);
      if (plannedBytes > 100 * 1048576) throw Object.assign(Error(), { measurementReason: 'source-hosts-exceed-traffic-budget' });
      report.method.plannedBytes = plannedBytes;
    }
    report.method.hosts = [...hosts];
    report.source = { obtainedFrom: observedFrom, host: source.hostname, path: source.pathname,
      originalUpOsHosts: [...sourceHosts], observedTotalBytes: observedLengths.get(source.pathname) || null,
      ...metadata(chosen), availableRepresentations: observed.map(metadata),
      audio: audioTrack ? { id: audioTrack.id, codecs: audioTrack.codecs || null, bandwidth: finite(Number(audioTrack.bandwidth)) } : null,
      bitrateAt2xMbps: Number(chosen.bandwidth) > 0 && Number(audioTrack?.bandwidth) > 0 ? (Number(chosen.bandwidth) + Number(audioTrack.bandwidth)) * 2 / 1000000 : null,
      bitrateBasis: 'Selected offered video plus highest-bandwidth ordinary DASH audio; average manifest demand, not peak segment demand or confirmed player selection.' };
    await page.evaluate(() => { for (const video of document.querySelectorAll('video')) video.pause(); });
    // Leaving the video page stops its segment scheduler; only our sequential Fetches remain.
    await page.goto(target.origin + '/robots.txt', { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (new URL(page.url()).origin !== target.origin) throw Error('Measurement document left the Bilibili origin');
    return source.href;
  } finally { page.off('response', onResponse); }
}
async function measureInBrowser({ url, offset = 0, maxBytes = 2097152, timeoutMs = 6000 }) {
    const controller = new AbortController(), started = performance.now(), timer = setTimeout(() => controller.abort(), timeoutMs);
    const result = { ok: false, status: null, responseHost: null, headersMs: null, ttfbMs: null, elapsedMs: null,
      bytes: 0, receivedBytes: 0, mbps: null, bodyMbps: null, contentRange: null, contentType: null, sha256: null, error: null };
    let reader;
    try {
      const response = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', referrer: 'https://www.bilibili.com/',
        headers: { Range: `bytes=${offset}-${offset + maxBytes - 1}` }, signal: controller.signal });
      result.status = response.status; result.headersMs = performance.now() - started;
      result.responseHost = new URL(response.url).hostname;
      result.contentRange = response.headers.get('content-range'); result.contentType = response.headers.get('content-type');
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(result.contentRange || '');
      if (response.status !== 206) { result.error = 'expected-http-206'; await response.body?.cancel(); return result; }
      if (!range || Number(range[1]) !== offset || Number(range[2]) !== Math.min(offset + maxBytes, Number(range[3])) - 1) {
        result.error = result.contentRange ? 'invalid-content-range' : 'content-range-missing-or-not-cors-exposed'; await response.body?.cancel(); return result;
      }
      const expectedBytes = Number(range[2]) - Number(range[1]) + 1, chunks = []; reader = response.body.getReader();
      while (result.bytes < expectedBytes) {
        const part = await reader.read(); if (part.done) break;
        if (!part.value.byteLength) continue;
        if (result.ttfbMs === null) result.ttfbMs = performance.now() - started;
        result.receivedBytes += part.value.byteLength;
        const kept = part.value.subarray(0, expectedBytes - result.bytes); chunks.push(kept); result.bytes += kept.byteLength;
      }
      result.elapsedMs = performance.now() - started;
      await reader.cancel(); reader = null; clearTimeout(timer);
      if (result.bytes !== expectedBytes) { result.error = 'incomplete-range'; return result; }
      const bytes = new Uint8Array(result.bytes); let cursor = 0;
      for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
      result.firstBox = offset === 0 ? String.fromCharCode(...bytes.subarray(4, 8)) : null;
      result.sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      result.mbps = result.bytes * 8 / result.elapsedMs / 1000;
      const bodyMs = result.elapsedMs - result.ttfbMs;
      result.bodyMbps = bodyMs > 0 ? result.bytes * 8 / bodyMs / 1000 : null;
      result.ok = true; return result;
    } catch (error) {
      result.error = controller.signal.aborted ? 'timeout' : error.name === 'TypeError' ? 'cors-or-network' : 'fetch-failed'; return result;
    } finally {
      clearTimeout(timer); result.elapsedMs ??= performance.now() - started;
      if (reader) await reader.cancel().catch(() => {});
    }
}
async function measure(page, url) {
  return page.evaluate(measureInBrowser, { url, offset, maxBytes, timeoutMs });
}
function randomOffset(totalBytes, bytes, random = Math.random) { return Math.floor(random() * (Math.max(0, totalBytes - bytes) + 1)); }
function summarize() {
  for (const host of hosts) {
    const samples = report.samples.filter(sample => sample.host === host), passed = samples.filter(sample => sample.ok && sample.matchesReference === true);
    const readable = samples.filter(sample => sample.ok), speeds = passed.map(sample => sample.mbps);
    report.summary.push({ host, verifiedRounds: passed.length, readableRounds: readable.length, rounds,
      medianMbps: median(speeds), minMbps: speeds.length ? Math.min(...speeds) : null,
      medianBodyMbps: median(passed.map(sample => sample.bodyMbps)), medianTtfbMs: median(passed.map(sample => sample.ttfbMs)),
      errors: [...new Set(samples.filter(sample => sample.error || sample.matchesReference === false).map(sample => sample.error || 'content-mismatch'))] });
  }
  report.summary.sort((a, b) => b.verifiedRounds - a.verifiedRounds || (b.minMbps || 0) - (a.minMbps || 0));
  report.recommendations = report.summary.filter(row => row.verifiedRounds === rounds).map(row => ({ host: row.host,
    minMbps: row.minMbps, medianMbps: row.medianMbps, basis: 'Every round returned the same complete range bytes as the original signed source.' }));
  report.receivedBytes = (report.lengthDiscovery?.receivedBytes || 0) + (report.reference?.receivedBytes || 0) + report.samples.reduce((sum, sample) => sum + sample.receivedBytes, 0);
}
module.exports = { measureInBrowser, randomOffset };
if (require.main === module) (async () => {
  let browser;
  try {
    let authState = null;
    if (authenticatedRun) {
      try { authState = { cookies: await requireLoginCookies(), origins: [] }; }
      catch { throw Object.assign(Error(), { measurementReason: 'login-missing-run-npm-run-dev' }); }
    }
    browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--disable-background-networking', '--mute-audio'] });
    report.browserVersion = browser.version();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...(authState ? { storageState: authState } : {}) }), page = await context.newPage();
    if (authenticatedRun) {
      await page.goto(target.origin + '/robots.txt', { waitUntil: 'domcontentloaded', timeout: 25000 });
      const loggedIn = await checkLogin(page);
      report.authentication.status = loggedIn === true ? 'verified' : loggedIn === false ? 'expired' : 'unverified';
      if (loggedIn !== true) throw Object.assign(Error(), { measurementReason: loggedIn === false ? 'login-expired-log-in-again-in-the-dev-browser' : 'login-check-unavailable' });
      report.method.authenticated = true;
    }
    const source = await acquire(page);
    console.log(JSON.stringify({ source: report.source.host, width: report.source.width, height: report.source.height,
      codec: report.source.codecs, bandwidth: report.source.bandwidth, hosts, plannedBytes, authentication: report.authentication.status }));
    if (offsetMode === 'random') {
      let totalBytes = report.source.observedTotalBytes;
      if (totalBytes === null) {
        report.lengthDiscovery = { host: report.source.host, ...await page.evaluate(measureInBrowser, { url: source, offset: 0, maxBytes: 1, timeoutMs }) };
        if (!report.lengthDiscovery.ok) throw Object.assign(Error(), { measurementReason: 'native-resource-length-unavailable' });
        totalBytes = Number(/^bytes \d+-\d+\/(\d+)$/.exec(report.lengthDiscovery.contentRange)[1]);
      }
      offset = randomOffset(totalBytes, maxBytes);
      report.method.offset = offset; report.method.totalBytes = totalBytes;
      report.method.range = `bytes=${offset}-${Math.min(totalBytes, offset + maxBytes) - 1}`;
      report.method.lengthDiscoveryBytes = report.lengthDiscovery?.receivedBytes || 0;
    }
    report.reference = { host: report.source.host, ...await measure(page, source) };
    if (!report.reference.ok) throw Object.assign(Error(), { measurementReason: 'reference-unusable' });
    for (let round = 0; round < rounds; round++) {
      const shift = Math.floor(hosts.length * round / rounds), order = [...hosts.slice(shift), ...hosts.slice(0, shift)];
      for (const host of order) {
        const sample = { host, round: round + 1, ...await measure(page, addressForHost(source, host)) };
        sample.matchesReference = report.reference.ok && sample.ok ? sample.sha256 === report.reference.sha256 && sample.contentRange === report.reference.contentRange : null;
        report.samples.push(sample);
        console.log(JSON.stringify({ host, round: sample.round, status: sample.status, bytes: sample.bytes,
          mbps: sample.mbps, ttfbMs: sample.ttfbMs, matchesReference: sample.matchesReference, error: sample.error }));
      }
    }
    summarize(); report.status = 'complete';
  } catch (error) {
    // Browser errors can include a signed request URL. Keep their type only.
    report.status = 'blocked'; report.failure = { name: error.name, reason: error.measurementReason || null,
      stage: report.source ? 'measurement' : 'playinfo-acquisition' };
    process.exitCode = 2;
  } finally {
    report.receivedBytes = (report.lengthDiscovery?.receivedBytes || 0) + (report.reference?.receivedBytes || 0) + report.samples.reduce((sum, sample) => sum + sample.receivedBytes, 0);
    await browser?.close(); report.finishedAt = new Date().toISOString();
    const output = path.join(directory, 'cdn.json'); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ report: output, status: report.status, receivedBytes: report.receivedBytes, summary: report.summary }));
  }
})();
