// Integration coverage with the production kernel and passive adapter in one
// JavaScript world. Native networking is a dispatch fixture, not playback proof.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const A = 'upos-sz-mirrorcosov.bilivideo.com', B = 'upos-sz-mirroraliov.bilivideo.com';
const peer = 'https://upos-sz-302ppio.bilivideo.com/upgcxcode/1/video.m4s?sign=IN_MEMORY_ONLY';
const root = path.resolve(__dirname, '..');
function emitter(value = {}) {
  const listeners = new Map();
  value.addEventListener = (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); };
  value.removeEventListener = (type, fn) => listeners.get(type)?.delete(fn);
  value.emit = (type, event) => { for (const fn of [...(listeners.get(type) || [])]) fn(event); };
  return value;
}
function load() {
  const wall = 1800000000000, timers = new Map(), dispatches = [], messages = [];
  let serial = 0;
  const rankKey = 'bilismooth.routing.rank.v3.America/New_York|en-US';
  const store = new Map([[rankKey, JSON.stringify({ at: wall - 3600000, ranking: [B, A],
    samples: [{ host: B, ok: true, mbps: 64, ttfb: 40, bytes: 786432 }, { host: A, ok: true, mbps: 8, ttfb: 70, bytes: 786432 }] })]]);
  class LocalDate extends Date { static now() { return wall; } }
  class XHR {
    constructor() { emitter(this); this.responseType = ''; this.readyState = 0; this.status = 0; }
    open(method, url) { this.method = method; this.url = String(url); this.readyState = 1; }
    send(body) { dispatches.push({ transport: 'xhr', url: this.url, body }); }
    setRequestHeader() {}
    getResponseHeader() { return null; }
    get response() { return ''; }
    get responseText() { return ''; }
  }
  const nativeFetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url || input.href;
    dispatches.push({ transport: 'fetch', url, input, init });
    const response = new Response('native media bytes', { headers: { 'content-type': 'video/mp4' } });
    Object.defineProperty(response, 'url', { value: url });
    response.clone = () => { throw new Error('integration must not clone the media body'); };
    return response;
  };
  const document = emitter({ readyState: 'complete', hidden: false, querySelector: () => null, querySelectorAll: () => [] });
  const scope = emitter({ URL, Request, Response, Headers, AbortController, DOMException, Date: LocalDate,
    JSON: { parse: JSON.parse, stringify: JSON.stringify }, performance: { now: () => 1000 },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: 'America/New_York' }) }) },
    navigator: { language: 'en-US', connection: emitter({}) }, document, XMLHttpRequest: XHR, fetch: nativeFetch,
    location: { href: 'https://www.bilibili.com/video/BVstartup', origin: 'https://www.bilibili.com', reload() {} },
    localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    postMessage: message => messages.push(JSON.parse(JSON.stringify(message))),
    setInterval: fn => { timers.set(++serial, fn); return serial; }, clearInterval: id => timers.delete(id),
    setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id),
    __playinfo__: { data: { dash: { video: [{ id: 80, baseUrl: peer, backupUrl: [] }] } } }
  });
  scope.globalThis = scope;
  const context = vm.createContext(scope);
  const evaluate = file => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  for (const file of ['src/core/settings.js', 'src/core/routing-policy.js', 'src/core/media-observer.js',
    'src/page/frame-monitor.js', 'src/page/network-probe.js', 'src/page/request-interceptor.js', 'src/page/playback-kernel.js', 'src/page/passive-session.js']) evaluate(file);
  const kernel = vm.runInContext('BiliSmoothPlaybackKernel.create({scope:globalThis})', context);
  const message = config => {
    context.__incomingConfig = config;
    vm.runInContext('globalThis.emit("message", {source:globalThis, origin:location.origin, data:{__bilismoothConfig:"config",config:__incomingConfig}})', context);
  };
  return { scope, context, evaluate, kernel, api: scope.BiliSmoothSession, dispatches, messages, timers, store, rankKey, message };
}

async function assertNativeDispatch(h, host) {
  const response = await h.scope.fetch(peer);
  const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', peer); xhr.send();
  assert.equal(h.dispatches.length, 2, 'cached ranking must not cause probe dispatches');
  for (const call of h.dispatches) assert.equal(new URL(call.url).hostname, host);
  assert.equal(response.bodyUsed, false);
  assert.equal(await response.text(), 'native media bytes');
  assert.equal(h.api.getState().requestedHost, host);
  assert.equal(h.api.getState().actualHost, null, 'dispatch and headers alone are not byte evidence');
}

test('initial auto storage handshake preserves the real cached winner and dispatches PCDN through it', async () => {
  const h = load();
  assert.equal(h.api.getConfig().pcdnHost, B);
  assert.equal(h.kernel.getState().ranking[0], B);
  assert.equal(h.api.getState().startupReady, false);
  assert.equal(h.dispatches.length, 0);
  assert.equal(h.messages.filter(row => row.__bilismoothConfig === 'save').length, 0);
  h.message(h.scope.BiliSmoothSettings.normalize({ selection: 'auto', pcdnHost: A, theme: 'dark' }));
  assert.equal(h.api.getState().startupReady, true);
  assert.equal(h.api.getConfig().pcdnHost, B);
  assert.equal(h.api.getConfig().theme, 'dark');
  assert.equal(h.kernel.getConfig().pcdnHost, B);
  assert.equal(h.messages.filter(row => row.__bilismoothConfig === 'save').length, 1);
  assert.equal(h.messages.find(row => row.__bilismoothConfig === 'save').config.pcdnHost, B);
  assert.equal(JSON.parse(h.store.get('bilismooth.startup.v4')).pcdnHost, B);
  await assertNativeDispatch(h, B);
  assert.doesNotMatch(JSON.stringify(h.api.getDiagnostics()), /IN_MEMORY_ONLY|\?sign/);
  h.kernel.destroy();
});

test('initial fixed storage preference outranks cached automatic selection and dispatches its node', async () => {
  const h = load();
  assert.equal(h.api.getConfig().pcdnHost, B);
  h.message(h.scope.BiliSmoothSettings.normalize({ selection: 'fixed', pcdnHost: A }));
  assert.equal(h.api.getConfig().selection, 'fixed');
  assert.equal(h.api.getConfig().pcdnHost, A);
  assert.equal(h.kernel.getConfig().pcdnHost, A);
  assert.equal(h.messages.filter(row => row.__bilismoothConfig === 'save').length, 0);
  assert.equal(h.api.getState().needReload, true, 'already delivered cached-target manifests need refresh');
  await assertNativeDispatch(h, A);
  h.kernel.destroy();
});

test('adapter reinjection and repeated create retain a single kernel and one network interception layer', async () => {
  const h = load();
  const hooks = { parse: h.scope.JSON.parse, fetch: h.scope.fetch, open: h.scope.XMLHttpRequest.prototype.open,
    send: h.scope.XMLHttpRequest.prototype.send, header: h.scope.XMLHttpRequest.prototype.setRequestHeader };
  const beforeTimers = h.timers.size, session = h.api;
  h.evaluate('src/page/passive-session.js');
  const again = vm.runInContext('BiliSmoothPlaybackKernel.create({scope:globalThis,config:{pcdnHost:"ignored.example"}})', h.context);
  assert.equal(again, h.kernel); assert.equal(h.scope.BiliSmoothSession, session);
  assert.equal(h.timers.size, beforeTimers);
  assert.equal(h.scope.JSON.parse, hooks.parse); assert.equal(h.scope.fetch, hooks.fetch);
  assert.equal(h.scope.XMLHttpRequest.prototype.open, hooks.open); assert.equal(h.scope.XMLHttpRequest.prototype.send, hooks.send);
  assert.equal(h.scope.XMLHttpRequest.prototype.setRequestHeader, hooks.header);
  h.message(h.scope.BiliSmoothSettings.normalize({ selection: 'auto', pcdnHost: A }));
  await assertNativeDispatch(h, B);
  assert.equal(h.api.getState().events.filter(event => event.type === 'request').length, 2);
  h.kernel.destroy();
});
