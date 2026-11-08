// Wraps XMLHttpRequest: routes media addresses at send, reports every request's lifecycle
// from the native events, and prepares textual playinfo responses on read.
import { readUrl, textual, relevant, signalText } from './request-rules.js';

export function installXhrHook({ scope, json, parse, stringify, now, isDisposed, route, begin, transfer, transform, fragmentKey, onSent }) {
  const XHR = scope.XMLHttpRequest, xhrPrototype = XHR?.prototype;
  const original = { open: xhrPrototype?.open, send: xhrPrototype?.send, header: xhrPrototype?.setRequestHeader, abort: xhrPrototype?.abort };
  const transactions = new WeakMap(), live = new Set(), readers = new Set();
  const earlyListeners = new WeakMap(), earlyReferences = new Set();
  const Weak = scope.WeakRef || globalThis.WeakRef;
  let wrappedXHR = null;
  function detach(tx, restore) {
    for (const [name, callback, capture] of tx.listeners) tx.xhr.removeEventListener(name, callback, capture);
    tx.listeners.length = 0; live.delete(tx);
    if (restore) for (const field of tx.fields) {
      if (Object.getOwnPropertyDescriptor(tx.xhr, field.name)?.get !== field.get) continue;
      if (field.previous) Object.defineProperty(tx.xhr, field.name, field.previous); else delete tx.xhr[field.name];
    }
  }
  function listen(tx, name, fn, capture = false) { tx.xhr.addEventListener(name, fn, capture); tx.listeners.push([name, fn, capture]); }
  function measured(tx, bytes) {
    if (bytes > 0 && tx.firstByteAt === null) tx.firstByteAt = now();
    tx.hiddenOverlap ||= !!scope.document?.hidden;
    return { firstByteAt: tx.firstByteAt, firstByteMs: tx.firstByteAt === null ? null : tx.firstByteAt - tx.startedAt,
      hiddenOverlap: tx.hiddenOverlap };
  }
  function onVisibilityChange() {
    if (scope.document.hidden) for (const tx of live) if (tx.sent && !tx.finished) tx.hiddenOverlap = true;
  }
  scope.document?.addEventListener?.('visibilitychange', onVisibilityChange);
  function outcome(tx, name, complete = false, loaded = 0) {
    if (tx.finished) return;
    tx.finished = true;
    const bytes = Math.max(tx.bytes, Number(loaded) || 0);
    transfer(tx.token, { status: Number(tx.xhr.status) || 0, responseUrl: tx.xhr.responseURL || '', bytes, complete, outcome: name,
      ...measured(tx, bytes), completedAt: now() });
  }
  function attachEarly(xhr) {
    if (earlyListeners.has(xhr)) return;
    const record = { xhr, listeners: [] };
    const register = (name, callback) => { xhr.addEventListener(name, callback, true); record.listeners.push([name, callback]); };
    // XHR is a target-only EventTarget in Chromium: capture alone cannot
    // overtake a previously registered player listener. Register on the
    // native instance before returning it from the constructor instead.
    for (const [event, result] of [['timeout','timeout'], ['error','network-error'], ['abort','aborted']]) register(event, () => {
      const tx = transactions.get(xhr); if (!isDisposed() && tx?.sent) outcome(tx, result);
    });
    const httpFailure = () => {
      const tx = transactions.get(xhr), status = Number(xhr.status) || 0;
      // DONE/status 0 also precedes abort and timeout. Wait for their native
      // event rather than turning cancellation into a network failure.
      if (!isDisposed() && tx?.sent && xhr.readyState === 4 && status > 0 && (status < 200 || status >= 300)) outcome(tx, 'http-error');
    };
    register('readystatechange', httpFailure); register('load', httpFailure);
    earlyListeners.set(xhr, record);
    if (Weak) { for (const ref of earlyReferences) if (!ref.deref()) earlyReferences.delete(ref); earlyReferences.add(new Weak(record)); }
  }
  function detachEarly(xhr) {
    const record = earlyListeners.get(xhr);
    if (!record) return;
    for (const [name, callback] of record.listeners) xhr.removeEventListener(name, callback, true);
    record.listeners.length = 0; earlyListeners.delete(xhr);
  }
  function descriptor(object, name) {
    for (let current = object; current; current = Object.getPrototypeOf(current)) { const found = Object.getOwnPropertyDescriptor(current, name); if (found) return found; }
    return null;
  }
  function addReaders(tx) {
    if (!relevant(tx.sourceUrl)) return;
    const xhr = tx.xhr, response = descriptor(xhr, 'response'), responseText = descriptor(xhr, 'responseText');
    function prepare() {
      if (tx.inspected || isDisposed() || xhr.readyState !== 4 || xhr.status < 200 || xhr.status >= 300 || !['', 'text', 'json'].includes(xhr.responseType || '')) return;
      tx.inspected = true;
      try {
        const type = xhr.getResponseHeader?.('content-type'); if (type && !textual(type)) return;
        const source = xhr.responseType === 'json' ? response?.get?.call(xhr) : responseText?.get?.call(xhr);
        const text = typeof source === 'string' ? source : Reflect.apply(stringify, json, [source]);
        if (!signalText(text)) return;
        const prepared = transform(typeof source === 'string' ? Reflect.apply(parse, json, [source]) : source, 'xhr');
        if (prepared.changed) tx.prepared = { value: prepared.value, text: Reflect.apply(stringify, json, [prepared.value]) };
      } catch {}
    }
    tx.prepare = prepare;
    if (Weak) { for (const ref of readers) if (!ref.deref()) readers.delete(ref); readers.add(new Weak(tx)); }
    for (const [name, desc] of [['response',response], ['responseText',responseText]]) {
      const previous = Object.getOwnPropertyDescriptor(xhr, name);
      if (!desc?.get || previous?.configurable === false) continue;
      const get = function () {
        const value = desc.get.call(this); // Preserve native receiver and responseType errors first.
        if (this !== xhr || isDisposed()) return value;
        prepare();
        return !tx.prepared ? value : name === 'response' && xhr.responseType === 'json' ? tx.prepared.value : tx.prepared.text;
      };
      try { Object.defineProperty(xhr, name, { configurable: true, enumerable: desc.enumerable, get }); tx.fields.push({ name, previous, get }); } catch {}
    }
  }
  function open(method, address, ...remaining) {
    const previous = transactions.get(this);
    if (previous) {
      // A player can reuse a completed request in readystatechange/onload,
      // before its loadend reports the body. Save that success before open
      // resets the native status, URL and response fields.
      if (previous.sent && this.readyState === 4 && this.status >= 200 && this.status < 300) outcome(previous, 'complete', true);
      detach(previous, true);
    }
    attachEarly(this); // Also support an instance created before installation.
    const sourceUrl = readUrl(address) || String(address);
    const returned = Reflect.apply(original.open, this, [method, address, ...remaining]);
    const tx = { xhr: this, sourceUrl, url: sourceUrl, method: String(method).toUpperCase(), range: '', bytes: 0, firstByteAt: null, listeners: [], fields: [], token: null, sent: false, finished: false, loaded: false };
    tx.openArgs = [method, ...remaining]; tx.headers = [];
    transactions.set(this, tx); live.add(tx);
    addReaders(tx); return returned;
  }
  function header(name, value) {
    const returned = Reflect.apply(original.header, this, arguments), tx = transactions.get(this);
    if (tx) tx.headers.push([String(name), String(value)]);
    if (tx && String(name).toLowerCase() === 'range') tx.range = tx.range ? tx.range + ', ' + value : String(value);
    return returned;
  }
  function send() {
    const tx = transactions.get(this);
    if (!tx || tx.sent) return Reflect.apply(original.send, this, arguments);
    const destination = route(tx.sourceUrl, { range: tx.range, transport: 'xhr' });
    // Reopening OPENED/unsent XHR clears headers. Replay its original call state.
    if (destination !== tx.url && this.readyState === 1) {
      const { responseType, timeout, withCredentials } = this;
      Reflect.apply(original.open, this, [tx.openArgs[0], destination, ...tx.openArgs.slice(1)]);
      this.responseType = responseType; this.timeout = timeout; this.withCredentials = withCredentials;
      for (const [name, value] of tx.headers) Reflect.apply(original.header, this, [name, value]);
      tx.url = destination;
    }
    tx.fragmentKey = fragmentKey?.(tx.sourceUrl, tx.range) || null;
    tx.sent = true; tx.startedAt = now(); tx.hiddenOverlap = !!scope.document?.hidden; tx.token = begin(tx.sourceUrl, tx.url, 'xhr', tx.method, tx.range);
    listen(tx, 'progress', event => { tx.bytes = Math.max(tx.bytes, Number(event.loaded) || 0); transfer(tx.token, { status: Number(tx.xhr.status) || 0, responseUrl: tx.xhr.responseURL || '', bytes: tx.bytes, outcome: 'progress', ...measured(tx, tx.bytes) }, 'progress'); });
    listen(tx, 'load', () => { if (transactions.get(tx.xhr) === tx && tx.xhr.readyState === 4) { tx.loaded = true; tx.prepare?.(); } });
    listen(tx, 'loadend', event => {
      // A consumer can reopen this same native instance inside error/load.
      // Its old dispatch may continue with loadend after the retry opened.
      if (transactions.get(tx.xhr) !== tx || !tx.finished && tx.xhr.readyState !== 4) return;
      const status = Number(tx.xhr.status) || 0, success = status >= 200 && status < 300 && tx.loaded;
      outcome(tx, success ? 'complete' : status ? 'http-error' : 'network-error', success, event.loaded);
      detach(tx, false);
    });
    try { const result = Reflect.apply(original.send, this, arguments); onSent?.(tx); return result; }
    catch (error) { outcome(tx, 'cancelled'); detach(tx, false); throw error; }
  }
  if (xhrPrototype && original.open && original.send) {
    xhrPrototype.open = open; xhrPrototype.send = send; if (original.header) xhrPrototype.setRequestHeader = header;
    wrappedXHR = new Proxy(XHR, { construct(target, args, newTarget) {
      const xhr = Reflect.construct(target, args, newTarget); attachEarly(xhr); return xhr;
    } });
    scope.XMLHttpRequest = wrappedXHR;
  }
  return {
    transactions, live, original, detach, detachEarly, outcome,
    dispose() {
      scope.document?.removeEventListener?.('visibilitychange', onVisibilityChange);
      for (const tx of [...live]) detach(tx, true);
      for (const ref of readers) { const tx = ref.deref(); if (tx) detach(tx, true); } readers.clear();
      for (const ref of earlyReferences) {
        const record = ref.deref();
        if (record) for (const [name, callback] of record.listeners) record.xhr.removeEventListener(name, callback, true);
      }
      earlyReferences.clear();
      if (scope.XMLHttpRequest === wrappedXHR) scope.XMLHttpRequest = XHR;
      if (xhrPrototype?.open === open) xhrPrototype.open = original.open;
      if (xhrPrototype?.send === send) xhrPrototype.send = original.send;
      if (xhrPrototype?.setRequestHeader === header) xhrPrototype.setRequestHeader = original.header;
    }
  };
}
