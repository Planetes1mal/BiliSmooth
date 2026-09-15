'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
function emitter(value = {}) {
  const listeners = new Map();
  value.addEventListener = (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); };
  value.removeEventListener = (name, fn) => listeners.get(name)?.delete(fn);
  value.emit = (name, detail = {}) => { for (const fn of [...(listeners.get(name) || [])]) fn(detail); };
  return value;
}
module.exports = function load(options = {}) {
  let time = options.now ?? 1800000000000, serial = 0;
  const calls = [], events = [], timers = new Map(), store = new Map(options.storage || []);
  const video = emitter({ paused: false, ended: false, seeking: false, currentTime: 10, readyState: 4,
    currentSrc: 'blob:https://www.bilibili.com/contract', buffered: { length: 0 }, playbackRate: 1 });
  class LocalDate extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  class XHR {
    constructor() { emitter(this); this.headers = {}; this.responseHeaders = {}; this.status = 0; this.responseType = ''; this.readyState = 0; this.timeout = 0; }
    open(method, url, ...args) { this.method = method; this.url = String(url); this.openArgs = args; this.readyState = 1; }
    setRequestHeader(name, value) { this.headers[name.toLowerCase()] = value; }
    getResponseHeader(name) { return this.responseHeaders[name.toLowerCase()] || null; }
    get responseText() { if (this.responseType === 'json') throw Error('InvalidStateError'); return this.text || ''; }
    get response() { return this.responseType === 'json' ? JSON.parse(this.text || 'null') : this.responseType === 'arraybuffer' ? this.bytes : this.text || ''; }
    send(body) { this.body = body; this.sent = true; }
    abort() { this.status = 0; this.emit('abort'); this.emit('loadend', { loaded: 0 }); }
  }
  const document = emitter({ readyState: 'complete', documentElement: null, head: null, hidden: false,
    querySelector: selector => selector === 'video' ? video : null,
    querySelectorAll: selector => selector === 'video' ? [video] : [], getElementById: () => null, createElement: () => ({}) });
  const scope = emitter({ URL, Request, Response, Headers, AbortController, DOMException, TextDecoder, Uint8Array,
    Date: LocalDate, JSON: { parse: JSON.parse, stringify: JSON.stringify }, Intl, Promise, WeakSet, WeakMap, Set, Map, Math, Reflect,
    XMLHttpRequest: XHR, document, navigator: emitter({ language: 'en-US', onLine: true, connection: emitter({}) }),
    location: { href: 'https://www.bilibili.com/video/BVcontract', origin: 'https://www.bilibili.com', pathname: '/video/BVcontract', reload() {} },
    performance: { now: () => time }, console: { info() {}, warn() {}, error() {} },
    localStorage: { getItem: key => options.storageGet?.(key, time) ?? store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    setTimeout(fn, delay) { timers.set(++serial, { fn, at: time + delay, delay, interval: false }); return serial; },
    clearTimeout: id => timers.delete(id),
    setInterval(fn, delay) { timers.set(++serial, { fn, at: time + delay, delay, interval: true }); return serial; },
    clearInterval: id => timers.delete(id), postMessage() {},
  });
  if (options.fetch) scope.fetch = async (input, init) => { calls.push({ input, init }); return options.fetch(input, init, { advance: ms => time += ms, scope }); };
  Object.assign(scope, options.globals || {}); scope.globalThis = scope; scope.window = scope;
  const native = { json: scope.JSON.parse, fetch: scope.fetch, open: XHR.prototype.open, send: XHR.prototype.send };
  const files = ['src/core/settings.js', 'src/core/routing-policy.js', 'src/page/network-probe.js', 'src/page/request-interceptor.js', 'src/page/playback-kernel.js'];
  vm.runInNewContext(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'), scope);
  scope.__contractConfig = options.config || {}; scope.__contractEvent = event => events.push(event);
  vm.runInNewContext('globalThis.__contractKernel = BiliSmoothPlaybackKernel.create({scope:globalThis,config:__contractConfig,onEvent:__contractEvent})', scope);
  const api = scope.__contractKernel;
  return { scope, document, video, api, native, calls, events, store, timers, files,
    state: () => clone(api.getState()), config: () => clone(api.getConfig()),
    advance(ms) {
      const target = time + ms; let guard = 0;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break; if (++guard > 10000) throw Error('Timer loop exceeded fixture bound');
        const [id, timer] = due; time = Math.max(time, timer.at);
        if (timer.interval) timer.at += timer.delay; else timers.delete(id);
        timer.fn();
      }
      time = Math.max(time, target);
    },
    xhr(url, { method = 'GET', type = '', text = '', status = 200, complete = false } = {}) {
      const request = new scope.XMLHttpRequest(); request.open(method, url); request.responseType = type; request.send();
      if (complete) { request.status = status; request.responseURL = request.url; request.responseHeaders['content-type'] = 'application/json'; request.text = text;
        request.readyState = 4; request.emit('load'); request.emit('loadend', { loaded: text.length }); }
      return request;
    },
    flush: async () => { for (let i = 0; i < 250; i++) await Promise.resolve(); }
  };
};
