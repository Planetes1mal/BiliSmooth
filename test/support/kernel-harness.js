// Headless harness: a fake window scope with a controllable clock, timers, storage, XHR and fetch,
// running the real kernel (and optionally the real session) through dependency injection.
import emitter from './emitter.cjs';
import { createKernel } from '../../src/page/playback-kernel.js';
import { createSession } from '../../src/page/session.js';

const clone = value => JSON.parse(JSON.stringify(value));
export default function load(options = {}) {
  let time = options.now ?? 1800000000000, serial = 0, frameCount = 0, bufferEnd = 40;
  const session = !!options.session, events = [], calls = [], timers = new Map(), frames = new Map();
  const store = options.store || new Map(options.storage || []), event = session || !!options.kernel;
  const emit = value => emitter(value, { event, targetOnly: !session });
  const video = emit({ paused: false, ended: false, seeking: false, currentTime: 10, readyState: 4,
    currentSrc: 'blob:https://www.bilibili.com/contract', buffered: { length: 0 }, playbackRate: 1,
    ...(session ? { currentTime: 1, currentSrc: 'blob:fixture', videoWidth: 3840, videoHeight: 2160,
      buffered: { length: 1, start: () => 0, end: () => bufferEnd },
      getVideoPlaybackQuality: () => ({ totalVideoFrames: frameCount, droppedVideoFrames: 0 }) } : {}), ...options.video });
  if (options.rvfc) {
    video.requestVideoFrameCallback = fn => { frames.set(++serial, fn); return serial; };
    video.cancelVideoFrameCallback = id => frames.delete(id);
  }
  let currentVideo = video;
  class LocalDate extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  class XHR {
    constructor() {
      emitter(this, { event, targetOnly: true }); this.headers = {}; this.responseHeaders = { 'content-type': 'video/mp4' };
      this.status = 0; this.responseType = ''; this.readyState = 0; this.timeout = 0; this.text = '';
    }
    open(method, url, ...args) { this.method = method; this.url = this.responseURL = String(url); this.openArgs = [method, url, ...args]; this.readyState = 1; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    getResponseHeader(name) { return this.responseHeaders[name.toLowerCase()] || null; }
    get responseText() { if (this.responseType && this.responseType !== 'text') throw new DOMException('Invalid response type', 'InvalidStateError'); return this.text; }
    get response() { return this.responseType === 'json' ? JSON.parse(this.text || 'null') : this.responseType === 'arraybuffer' ? this.bytes : this.text; }
    send(body) { this.body = body; this.sent = true; }
    progress(bytes) { this.status = 206; this.emit('progress', { loaded: bytes }); }
    complete(bytes, status = 206) { this.readyState = 4; this.status = status; this.emit('load'); this.emit('loadend', { loaded: bytes }); }
    expire(bytes = 0) { this.readyState = 4; this.status = 0; this.emit('timeout'); this.emit('loadend', { loaded: bytes }); }
    abort() { this.readyState = 4; this.status = 0; this.emit('abort'); this.emit('loadend', { loaded: 0 }); }
    cancel() { this.abort(); }
    finish(value, type = 'application/json') { this.text = JSON.stringify(value); this.responseHeaders['content-type'] = type; this.complete(this.text.length, 200); }
  }
  const document = emit({ readyState: 'complete', documentElement: null, head: null, hidden: false,
    querySelector: selector => selector === 'video' ? currentVideo : null,
    querySelectorAll: selector => selector === 'video' && currentVideo ? [currentVideo] : [], getElementById: () => null,
    createElement: () => { throw Error('kernel must be headless'); } });
  const scope = emit({ URL, Request, Response, Headers, AbortController, DOMException, TextDecoder, Uint8Array,
    Date: LocalDate, JSON: { parse: JSON.parse, stringify: JSON.stringify }, Intl: options.Intl || Intl, Promise, WeakSet, WeakMap, Set, Map, Math, Reflect,
    XMLHttpRequest: XHR, document, navigator: emit({ language: 'en-US', onLine: true, connection: emit({}) }),
    location: { href: 'https://www.bilibili.com/video/BVcontract', origin: 'https://www.bilibili.com', pathname: '/video/BVcontract', reload() {} },
    performance: { now: () => time }, console: { info() {}, warn() {}, error() {} },
    localStorage: { get length() { return store.size; }, key: index => [...store.keys()][index] ?? null, getItem: key => options.storageGet?.(key, time) ?? store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    setTimeout(fn, delay) { timers.set(++serial, { fn, at: time + delay }); return serial; }, clearTimeout: id => timers.delete(id),
    setInterval(fn, delay) { timers.set(++serial, { fn, at: time + delay, interval: delay }); return serial; }, clearInterval: id => timers.delete(id), postMessage() {} });
  if (options.fetch) scope.fetch = async (input, init) => { calls.push({ input, init }); return options.fetch(input, init, { advance: ms => time += ms, scope }); };
  Object.assign(scope, options.globals || {}); scope.globalThis = scope; scope.window = scope;
  const native = { json: scope.JSON.parse, parse: scope.JSON.parse, fetch: scope.fetch, open: XHR.prototype.open, send: XHR.prototype.send };
  let kernel, api;
  if (session) {
    api = createSession({ scope, version: '2.8.3', createKernel: input => { kernel = createKernel({ ...input, ...options.kernelOptions }); return kernel; } });
    api.setConfig(options.config); scope.__playinfo__ = options.payload;
  } else kernel = api = createKernel({ scope, config: options.config || {}, onEvent: row => events.push(row) });
  const flush = async () => { for (let i = 0; i < (options.kernel ? 80 : 250); i++) await Promise.resolve(); };
  function* ticks(ms, { frames: presentFrames = false, move = true } = {}) {
    const target = time + ms; let guard = 0;
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      const end = due ? due[1].at : target, elapsed = end - time;
      if (session) {
        if (move && !video.paused && !video.seeking) video.currentTime += elapsed / 1000 * video.playbackRate;
        if (presentFrames) frameCount += Math.round(elapsed / 1000 * 60 * video.playbackRate);
      }
      time = session || options.kernel ? end : Math.max(time, end);
      if (presentFrames) for (const [id, callback] of [...frames]) { frames.delete(id); callback(time, { presentedFrames: frameCount, mediaTime: video.currentTime }); }
      if (!due) break;
      if (++guard > 10000) throw Error('Timer loop exceeded fixture bound');
      const [id, timer] = due;
      if (timer.interval) timer.at += timer.interval; else timers.delete(id);
      timer.fn(); yield;
    }
  }
  const advance = options.kernel ? async ms => { for (const _ of ticks(ms)) await flush(); await flush(); }
    : (ms, detail) => { for (const _ of ticks(ms, detail)) {} };
  function request(raw) { const xhr = new scope.XMLHttpRequest(); xhr.open('GET', raw); xhr.send(); return xhr; }
  return { scope, document, video, api, kernel, native, originals: native, calls, events, store, timers, advance, flush, request,
    state: () => clone(api.getState()), config: () => clone(api.getConfig()), now: () => time,
    replacePlayer(next = null) { currentVideo = next; }, buffer: seconds => { bufferEnd = video.currentTime + seconds; },
    stopObservations() { for (const [id, timer] of timers) if (timer.interval === 1000 && timer.fn.name === 'tick') timers.delete(id); },
    close() { scope.emit('pagehide'); kernel.destroy(); },
    xhr(url, { method = 'GET', type = '', text = '', status = 200, complete = false } = {}) {
      const xhr = new scope.XMLHttpRequest(); xhr.open(method, url); xhr.responseType = type; xhr.send();
      if (complete) { xhr.responseHeaders['content-type'] = 'application/json'; xhr.text = text; xhr.complete(text.length, status); }
      return xhr;
    } };
}
