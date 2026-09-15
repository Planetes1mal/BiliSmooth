// Native Chromium XHR ordering regression. The local server produces real events.
// No dispatchEvent, readiness/status overrides, media playback or remote service traffic.
'use strict';
const http = require('node:http'), fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const { createEvidenceOutput, runLabel } = require('../scripts/validation-support.cjs');
const root = path.resolve(__dirname, '..');
const label = runLabel() || 'current';
const outputDirectory = createEvidenceOutput({ root, suite: 'core-rewrite', version: require('../package.json').version });

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/') return res.end('<!doctype html><title>Native XHR ordering</title>');
    if (req.url.endsWith('/error')) return req.socket.destroy();
    if (req.url.endsWith('/timeout') || req.url.endsWith('/abort')) return;
    res.statusCode = req.url.endsWith('/http') ? 503 : 200;
    res.setHeader('Content-Type', 'application/octet-stream'); res.end('native body');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const source = await fs.readFile(path.join(root, 'src/page/request-interceptor.js'), 'utf8');
  const report = { label, generatedAt: new Date().toISOString(), sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), checks: [] };
  try {
    browser = await chromium.launch({ channel: 'chromium', headless: true }); report.browserVersion = browser.version();
    const page = await browser.newPage(); await page.goto('http://127.0.0.1:' + server.address().port + '/'); await page.addScriptTag({ content: source });
    report.phases = await page.evaluate(async () => {
      const cases = [];
      for (const scenario of ['error', 'timeout', 'abort', 'http-load', 'http-readystatechange', 'error-property', 'error-reuse', 'success']) {
        const kind = scenario.startsWith('error-') ? 'error' : scenario;
        let target = 'old', serial = 0, retry = null; const events = [], consumerOrder = [], zeroStatusBeforeTerminal = [];
        const instance = BiliSmoothRequestInterceptor.install({ scope: window, active: () => true,
          route: raw => raw.replace('/old/', '/' + target + '/'), prepare: value => ({ value, changed: false }),
          begin: info => ({ ...info, id: ++serial, startedAt: performance.now() }),
          onTransfer: (type, request, detail) => {
            if (type !== 'transfer') return;
            events.push({ who: 'internal', event: detail.outcome, status: detail.status, request: request.id });
            if (['network-error', 'timeout', 'http-error'].includes(detail.outcome)) target = 'new';
          }
        });
        const xhr = new XMLHttpRequest(), eventName = kind.startsWith('http-') ? kind.slice(5) : kind === 'success' ? 'load' : kind;
        const terminal = new Promise(resolve => xhr.addEventListener('loadend', resolve));
        const eligible = () => eventName !== 'readystatechange' || xhr.readyState === 4;
        // These consumers intentionally register before open().
        const first = () => {
          if (!eligible()) return;
          consumerOrder.push('first'); events.push({ who: 'consumer', event: eventName, status: xhr.status, observedTarget: target });
          if (kind === 'success' || kind === 'abort') return;
          retry = new Promise(resolve => {
            const next = scenario === 'error-reuse' ? xhr : new XMLHttpRequest(); next.open('GET', location.origin + '/old/retry');
            next.addEventListener('loadend', () => { if (next.readyState === 4 && next.status === 200) resolve({ responseURL: next.responseURL, status: next.status }); }); next.send();
          });
        };
        if (scenario === 'error-property') xhr.onerror = first; else xhr.addEventListener(eventName, first);
        xhr.addEventListener(eventName, () => { if (eligible()) consumerOrder.push('second'); });
        xhr.addEventListener('readystatechange', () => { if (xhr.readyState === 4 && xhr.status === 0) zeroStatusBeforeTerminal.push(events.filter(event => event.who === 'internal').length); });
        xhr.open('GET', location.origin + '/old/' + (kind.startsWith('http-') ? 'http' : kind));
        if (kind === 'timeout') xhr.timeout = 40;
        xhr.send(); if (kind === 'abort') setTimeout(() => xhr.abort(), 10);
        await terminal; const retried = await retry;
        // Native event listeners have microtask checkpoints between callbacks.
        // Observe the whole loadend dispatch before disposing the adapter.
        await new Promise(resolve => setTimeout(resolve, 0));
        cases.push({ scenario, events, consumerOrder, zeroStatusBeforeTerminal, retry: retried }); instance.destroy();
      }
      const Native = XMLHttpRequest, nativeOpen = Native.prototype.open, callbacks = [];
      const instance = BiliSmoothRequestInterceptor.install({ scope: window, active: () => true, route: value => value,
        prepare: value => ({ value, changed: false }), begin: value => ({ ...value, id: 1 }), onTransfer: (...value) => callbacks.push(value) });
      const Wrapped = XMLHttpRequest;
      class Derived extends Wrapped {}
      const inherited = new Derived(), preserved = new Wrapped();
      const compatibility = { prototype: Wrapped.prototype === Native.prototype,
        constants: ['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE'].every(name => Wrapped[name] === Native[name]),
        descriptor: JSON.stringify(Object.getOwnPropertyDescriptor(Wrapped, 'DONE')) === JSON.stringify(Object.getOwnPropertyDescriptor(Native, 'DONE')),
        nativeInstance: inherited instanceof Native && inherited instanceof Wrapped && inherited instanceof Derived,
        tag: Object.prototype.toString.call(inherited) === '[object XMLHttpRequest]', callWithoutNew: false };
      try { Wrapped(); } catch (error) { compatibility.callWithoutNew = error.name === 'TypeError'; }
      let consumerAfterDestroy = 0;
      preserved.addEventListener('load', () => consumerAfterDestroy++);
      instance.destroy();
      compatibility.restore = XMLHttpRequest === Native && Native.prototype.open === nativeOpen;
      await new Promise(resolve => { preserved.open('GET', location.origin + '/old/http'); preserved.addEventListener('loadend', resolve); preserved.send(); });
      await new Promise(resolve => setTimeout(resolve, 0));
      compatibility.destroyedSilent = callbacks.length === 0 && consumerAfterDestroy === 1;
      return { cases, compatibility };
    });
    report.compatibility = report.phases.compatibility;
    report.phases = report.phases.cases;
    for (const [name, passed] of Object.entries(report.compatibility)) report.checks.push({ name: 'native constructor and destroy: ' + name, passed });
    for (const row of report.phases) {
      const initial = row.events.filter(event => event.request === 1 || event.who === 'consumer');
      const consumer = initial.findIndex(event => event.who === 'consumer');
      if (row.scenario === 'success') report.checks.push({ name: 'successful body settles after consumer load at native loadend', passed: consumer >= 0 && initial.findIndex(event => event.event === 'complete') > consumer });
      else report.checks.push({ name: row.scenario + ' internally settles before the pre-open consumer', passed: consumer > 0 && initial[0].who === 'internal', events: initial });
      if (row.retry) report.checks.push({ name: row.scenario + ' synchronous retry uses the new route', passed: row.retry.status === 200 && new URL(row.retry.responseURL).pathname === '/new/retry', retry: row.retry });
      if (row.retry) report.checks.push({ name: row.scenario + ' retry has one successful native body outcome', passed: row.events.filter(event => event.request === 2).length === 1 && row.events.some(event => event.request === 2 && event.event === 'complete' && event.status === 200), events: row.events.filter(event => event.request === 2) });
      report.checks.push({ name: row.scenario + ' preserves consumer registration order', passed: row.consumerOrder.join(',') === 'first,second' });
      report.checks.push({ name: row.scenario + ' yields exactly one terminal outcome for the original request', passed: initial.filter(event => event.who === 'internal' && event.event !== 'progress').length === 1 });
      if (row.zeroStatusBeforeTerminal.length) report.checks.push({ name: row.scenario + ' does not guess failure from DONE/status 0', passed: row.zeroStatusBeforeTerminal.every(count => count === 0) });
    }
    report.passed = report.checks.every(check => check.passed);
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    const destination = path.join(outputDirectory, 'xhr-order-' + label + '.json');
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(destination, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ report: destination, passed: report.passed, checks: report.checks.length, failures: report.checks.filter(check => !check.passed) }, null, 2));
    if (!report.passed) process.exitCode = 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
