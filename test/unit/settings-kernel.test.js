// Integration coverage with the production kernel and passive adapter in one
// JavaScript world. Native networking is a dispatch fixture, not playback proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSession } from '../../src/page/session.js';
import { createKernel } from '../../src/page/playback-kernel.js';
import settings from '../../src/core/settings.js';
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const A = 'upos-sz-mirrorcosov.bilivideo.com', B = 'upos-sz-mirroraliov.bilivideo.com';
const peer = 'https://upos-sz-302ppio.bilivideo.com/upgcxcode/1/video.m4s?sign=IN_MEMORY_ONLY';
import emitter from '../support/emitter.cjs';
function load() {
  const wall = 1800000000000, timers = new Map(), dispatches = [], messages = [];
  let serial = 0;
  const rankKey = 'bilismooth.routing.rank.v4.America/New_York|en-US';
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
    localStorage: { get length() { return store.size; }, key: index => [...store.keys()][index] ?? null, getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    postMessage: message => messages.push(JSON.parse(JSON.stringify(message))),
    setInterval: fn => { timers.set(++serial, fn); return serial; }, clearInterval: id => timers.delete(id),
    setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id),
    __playinfo__: { data: { dash: { video: [{ id: 80, baseUrl: peer, backupUrl: [] }] } } }
  });
  scope.globalThis = scope;
  const api = createSession({ scope, version: pkg.version });
  const kernel = createKernel({ scope });
  const message = config => scope.emit('message', { source: scope, origin: scope.location.origin, data: { __bilismoothConfig: 'config', config } });
  return { scope, kernel, api, dispatches, messages, timers, store, rankKey, message };
}

async function assertNativeDispatch(h, host) {
  const response = await h.scope.fetch(peer);
  const xhr = new h.scope.XMLHttpRequest(); xhr.open('GET', peer); xhr.send();
  assert.equal(h.dispatches.length, 2, 'startup does not cause probe dispatches');
  for (const call of h.dispatches) assert.equal(new URL(call.url).hostname, host);
  assert.equal(response.bodyUsed, false);
  assert.equal(await response.text(), 'native media bytes');
  assert.equal(h.api.getState().requestedHost, host);
  assert.equal(h.api.getState().actualHost, null, 'dispatch and headers alone are not byte evidence');
}

test('initial automatic storage handshake ignores removed ranking and preserves authoritative PCDN preferences', async () => {
  const h = load();
  assert.equal(h.api.getConfig().pcdnHost, A);
  assert.equal(h.store.has(h.rankKey), false);
  assert.equal(h.api.getState().startupReady, false);
  assert.equal(h.dispatches.length, 0);
  assert.equal(h.messages.filter(row => row.__bilismoothConfig === 'save').length, 0);
  h.message(settings.normalize({ selection: 'auto', pcdnHost: A, theme: 'dark' }));
  assert.equal(h.api.getState().startupReady, true);
  assert.equal(h.api.getConfig().pcdnHost, A);
  assert.equal(h.api.getConfig().theme, 'dark');
  assert.equal(h.kernel.getConfig().pcdnHost, A);
  assert.equal(h.messages.filter(row => row.__bilismoothConfig === 'save').length, 0);
  assert.equal(JSON.parse(h.store.get('bilismooth.startup.v4')).pcdnHost, A);
  await assertNativeDispatch(h, A);
  assert.doesNotMatch(JSON.stringify(h.api.getDiagnostics()), /IN_MEMORY_ONLY|\?sign/);
  h.kernel.destroy();
});

test('initial fixed storage preference controls dispatch without restoring old automatic selection', async () => {
  const h = load();
  assert.equal(h.api.getConfig().pcdnHost, A);
  h.message(settings.normalize({ selection: 'fixed', pcdnHost: A }));
  assert.equal(h.api.getConfig().selection, 'fixed');
  assert.equal(h.api.getConfig().pcdnHost, A);
  assert.equal(h.kernel.getConfig().pcdnHost, A);
  assert.equal(h.messages.filter(row => row.__bilismoothConfig === 'save').length, 0);
  assert.equal(h.api.getState().needReload, true, 'an already delivered manifest precedes the fixed preference');
  await assertNativeDispatch(h, A);
  h.kernel.destroy();
});

test('adapter reinjection and repeated create retain a single kernel and one network interception layer', async () => {
  const h = load();
  const hooks = { parse: h.scope.JSON.parse, fetch: h.scope.fetch, open: h.scope.XMLHttpRequest.prototype.open,
    send: h.scope.XMLHttpRequest.prototype.send, header: h.scope.XMLHttpRequest.prototype.setRequestHeader };
  const beforeTimers = h.timers.size, session = h.api;
  assert.equal(createSession({ scope: h.scope }), session);
  const again = createKernel({ scope: h.scope, config: { pcdnHost: 'ignored.example' } });
  assert.equal(again, h.kernel);
  assert.equal(h.timers.size, beforeTimers);
  assert.equal(h.scope.JSON.parse, hooks.parse); assert.equal(h.scope.fetch, hooks.fetch);
  assert.equal(h.scope.XMLHttpRequest.prototype.open, hooks.open); assert.equal(h.scope.XMLHttpRequest.prototype.send, hooks.send);
  assert.equal(h.scope.XMLHttpRequest.prototype.setRequestHeader, hooks.header);
  h.message(settings.normalize({ selection: 'auto', pcdnHost: A }));
  await assertNativeDispatch(h, A);
  assert.equal(h.api.getState().events.filter(event => event.type === 'request').length, 2);
  h.kernel.destroy();
});
