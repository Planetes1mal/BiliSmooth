/* BiliSmooth browser integration. Routing and recovery are injected decisions. */
(function (global) {
  'use strict';
  const installations = new WeakMap();
  const capabilities = {
    localEvents: ['PCDNLoader', 'BPP2PSDK', 'SeederSDK'],
    remotePeer: ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection']
  };
  function protectCapabilitySlots(scope, onAttempt) {
    const handlers = {
      localEvents: {
        apply: () => undefined,
        construct: (_target, _arguments, derived) => Object.create(derived.prototype, {
          on: { value: () => undefined, configurable: false, enumerable: false, writable: false }
        })
      },
      remotePeer: {
        invoke(name) {
          onAttempt?.(name);
          throw new (scope.DOMException || global.DOMException)('BiliSmooth sharing protection', 'NotAllowedError');
        }
      }
    };
    for (const [kind, names] of Object.entries(capabilities)) for (const name of names) {
      const current = Object.getOwnPropertyDescriptor(scope, name);
      if (current?.configurable === false) continue;
      // The slot remains stable when a page publishes a later implementation.
      // SDK calls create local inert subscriptions; remote peer calls are denied.
      const constructor = kind === 'remotePeer' && typeof scope[name] === 'function' ? scope[name] : function BiliSmoothCapability() {};
      const gate = new Proxy(constructor, kind === 'localEvents' ? handlers.localEvents : {
        apply: () => handlers.remotePeer.invoke(name), construct: () => handlers.remotePeer.invoke(name)
      });
      Object.defineProperty(scope, name, { configurable: false, enumerable: current?.enumerable ?? true,
        get: () => gate, set: () => undefined });
    }
  }
  function install(options) {
    const scope = options.scope || global;
    if (installations.has(scope)) return installations.get(scope);
    const json = scope.JSON || JSON, parse = json.parse, stringify = json.stringify;
    const fetch = scope.fetch, XHR = scope.XMLHttpRequest, RequestType = scope.Request || global.Request;
    const ResponseType = scope.Response || global.Response, HeadersType = scope.Headers || global.Headers;
    const now = () => scope.performance?.now?.() ?? Date.now();
    const xhrPrototype = XHR?.prototype, original = { open: xhrPrototype?.open, send: xhrPrototype?.send, header: xhrPrototype?.setRequestHeader };
    const transactions = new WeakMap(), live = new Set(), readers = new Set(), restores = [], pending = new Map();
    const earlyListeners = new WeakMap(), earlyReferences = new Set();
    let disposed = false, timingObserver = null, requiresReload = false, wrappedXHR = null;
    const active = () => !disposed && options.active();
    const readUrl = value => typeof value === 'string' ? value : value?.href || value?.url || '';
    const textual = type => typeof type === 'string' && /json|text/i.test(type);
    const relevant = value => /\/x\/player|\/pgc\/player|playurl|getRoomPlayInfo|bilivideo/i.test(value || '');
    const signalText = value => typeof value === 'string' && /bilivideo|upgcxcode|mcdn|akamaized|mountaintoys|nexusedgeio|szbdyd|ahdohpiechei/i.test(value);
    function route(value) { try { return active() ? options.route(value) : value; } catch { return value; } }
    function transform(value, source) {
      try { return options.prepare(value, source); } catch { return { value, changed: false }; }
    }
    function begin(originalUrl, url, transport, method, range) {
      try { return !disposed ? options.begin({ originalUrl, url, transport, method, range }) : null; } catch { return null; }
    }
    function transfer(token, detail, type = 'transfer') {
      if (disposed || !token) return;
      try { options.onTransfer(type, token, detail); } catch {}
    }
    function parseForPage(text, ...args) {
      const value = Reflect.apply(parse, this, [text, ...args]);
      return !disposed && signalText(text) ? transform(value, 'JSON.parse').value : value;
    }
    json.parse = parseForPage;
    function removeFetch(entry) {
      pending.delete(entry.token.id);
      entry.signal?.removeEventListener('abort', entry.aborted);
    }
    function processTiming(entries) {
      for (const metric of entries) {
        if (metric.initiatorType && metric.initiatorType !== 'fetch' || options.ignoreTiming?.(metric)) continue;
        const group = [...pending.values()].filter(item => item.token.url === metric.name && metric.startTime >= item.token.startedAt - 3 && metric.startTime <= item.token.startedAt + 20);
        if (group.length > 1) {
          for (const item of group) { removeFetch(item); transfer(item.token, { outcome: 'unverified', evidence: 'resource-timing', evidenceReason: 'ambiguous-request', status: item.status || 0 }); }
        } else if (group.length === 1) {
          const item = group[0];
          if (!item.response) { item.metric = metric; continue; }
          removeFetch(item);
          const bytes = Math.max(0, Number(metric.encodedBodySize) || 0);
          transfer(item.token, { status: item.status, responseUrl: item.response.url || '', bytes,
            elapsedMs: Math.max(0, metric.responseEnd - metric.startTime), outcome: 'unverified', complete: false,
            evidence: 'resource-timing', evidenceReason: bytes ? 'passive-transfer' : 'unexposed-timing' });
        }
      }
    }
    function responseWithMetadata(response, source) {
      for (const key of ['url', 'redirected', 'type']) Object.defineProperty(response, key, { configurable: true, value: source[key] });
      const clone = ResponseType.prototype.clone;
      Object.defineProperty(response, 'clone', { configurable: true, value: function () { return responseWithMetadata(Reflect.apply(clone, this, []), source); } });
      return response;
    }
    async function sendFetch(input, init) {
      const sourceUrl = readUrl(input), destination = route(sourceUrl);
      let outgoing = input, extra = init;
      if (destination && destination !== sourceUrl) {
        if (RequestType && input instanceof RequestType) { outgoing = new RequestType(destination, new RequestType(input, init)); extra = undefined; }
        else outgoing = destination;
      }
      let range = ''; try { range = new HeadersType(init?.headers ?? input?.headers).get('range') || ''; } catch {}
      const token = begin(sourceUrl, destination, 'fetch', String(init?.method ?? input?.method ?? 'GET').toUpperCase(), range);
      const signal = extra?.signal !== undefined ? extra.signal : outgoing?.signal;
      const entry = token ? { token, signal, response: null, status: 0 } : null;
      if (entry) {
        entry.aborted = () => { removeFetch(entry); if (entry.response) transfer(token, { status: entry.status, responseUrl: entry.response.url || '', outcome: 'aborted' }); };
        signal?.addEventListener('abort', entry.aborted, { once: true }); pending.set(token.id, entry);
        while (pending.size > 128) removeFetch(pending.values().next().value);
      }
      let response;
      try { response = await Reflect.apply(fetch, this, extra === undefined ? [outgoing] : [outgoing, extra]); }
      catch (error) {
        if (entry) removeFetch(entry);
        transfer(token, { status: 0, outcome: signal?.aborted || error?.name === 'AbortError' ? 'aborted' : 'network-error' });
        throw error;
      }
      if (entry) {
        entry.response = response; entry.status = Number(response.status) || 0;
        transfer(token, { status: entry.status, responseUrl: response.url || '', outcome: response.ok ? 'response' : 'http-error' });
        if (!response.ok) removeFetch(entry); else if (entry.metric) processTiming([entry.metric]);
      }
      if (!active() || !relevant(sourceUrl) || !textual(response.headers?.get('content-type'))) return response;
      try {
        const text = await response.clone().text();
        if (!signalText(text)) return response;
        const result = transform(Reflect.apply(parse, json, [text]), 'fetch');
        if (!result.changed) return response;
        const headers = new HeadersType(response.headers);
        for (const field of ['content-length','content-encoding','etag','content-md5','digest','content-digest','repr-digest']) headers.delete(field);
        const replacement = new ResponseType(Reflect.apply(stringify, json, [result.value]), { status: response.status, statusText: response.statusText, headers });
        return responseWithMetadata(replacement, response);
      } catch { return response; }
    }
    if (typeof fetch === 'function') scope.fetch = sendFetch;
    if (scope.PerformanceObserver) try { timingObserver = new scope.PerformanceObserver(list => processTiming(list.getEntries())); timingObserver.observe({ type: 'resource', buffered: false }); } catch { timingObserver?.disconnect(); }
    function descriptor(object, name) {
      for (let current = object; current; current = Object.getPrototypeOf(current)) { const found = Object.getOwnPropertyDescriptor(current, name); if (found) return found; }
      return null;
    }
    function detach(tx, restore) {
      for (const [name, callback, capture] of tx.listeners) tx.xhr.removeEventListener(name, callback, capture);
      tx.listeners.length = 0; live.delete(tx);
      if (restore) for (const field of tx.fields) {
        if (Object.getOwnPropertyDescriptor(tx.xhr, field.name)?.get !== field.get) continue;
        if (field.previous) Object.defineProperty(tx.xhr, field.name, field.previous); else delete tx.xhr[field.name];
      }
    }
    function listen(tx, name, fn, capture = false) { tx.xhr.addEventListener(name, fn, capture); tx.listeners.push([name, fn, capture]); }
    function outcome(tx, name, complete = false, loaded = 0) {
      if (tx.finished) return;
      tx.finished = true;
      transfer(tx.token, { status: Number(tx.xhr.status) || 0, responseUrl: tx.xhr.responseURL || '', bytes: Math.max(tx.bytes, Number(loaded) || 0), complete, outcome: name });
    }
    function attachEarly(xhr) {
      if (earlyListeners.has(xhr)) return;
      const record = { xhr, listeners: [] };
      const register = (name, callback) => { xhr.addEventListener(name, callback, true); record.listeners.push([name, callback]); };
      // XHR is a target-only EventTarget in Chromium: capture alone cannot
      // overtake a previously registered player listener. Register on the
      // native instance before returning it from the constructor instead.
      for (const [event, result] of [['timeout','timeout'], ['error','network-error'], ['abort','aborted']]) register(event, () => {
        const tx = transactions.get(xhr); if (!disposed && tx?.sent) outcome(tx, result);
      });
      const httpFailure = () => {
        const tx = transactions.get(xhr), status = Number(xhr.status) || 0;
        // DONE/status 0 also precedes abort and timeout. Wait for their native
        // event rather than turning cancellation into a network failure.
        if (!disposed && tx?.sent && xhr.readyState === 4 && status > 0 && (status < 200 || status >= 300)) outcome(tx, 'http-error');
      };
      register('readystatechange', httpFailure); register('load', httpFailure);
      earlyListeners.set(xhr, record);
      const Weak = scope.WeakRef || global.WeakRef;
      if (Weak) { for (const ref of earlyReferences) if (!ref.deref()) earlyReferences.delete(ref); earlyReferences.add(new Weak(record)); }
    }
    function addReaders(tx) {
      if (!relevant(tx.sourceUrl)) return;
      const xhr = tx.xhr, response = descriptor(xhr, 'response'), responseText = descriptor(xhr, 'responseText');
      function prepare() {
        if (tx.inspected || disposed || xhr.readyState !== 4 || xhr.status < 200 || xhr.status >= 300 || !['', 'text', 'json'].includes(xhr.responseType || '')) return;
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
      const Weak = scope.WeakRef || global.WeakRef;
      if (Weak) { for (const ref of readers) if (!ref.deref()) readers.delete(ref); readers.add(new Weak(tx)); }
      for (const [name, desc] of [['response',response], ['responseText',responseText]]) {
        const previous = Object.getOwnPropertyDescriptor(xhr, name);
        if (!desc?.get || previous?.configurable === false) continue;
        const get = function () {
          const value = desc.get.call(this); // Preserve native receiver and responseType errors first.
          if (this !== xhr || disposed) return value;
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
      const sourceUrl = readUrl(address) || String(address), url = route(sourceUrl);
      const returned = Reflect.apply(original.open, this, [method, url === sourceUrl ? address : url, ...remaining]);
      const tx = { xhr: this, sourceUrl, url, method: String(method).toUpperCase(), range: '', bytes: 0, listeners: [], fields: [], token: null, sent: false, finished: false, loaded: false };
      transactions.set(this, tx); live.add(tx);
      addReaders(tx); return returned;
    }
    function header(name, value) {
      const returned = Reflect.apply(original.header, this, arguments), tx = transactions.get(this);
      if (tx && String(name).toLowerCase() === 'range') tx.range = tx.range ? tx.range + ', ' + value : String(value);
      return returned;
    }
    function send() {
      const tx = transactions.get(this);
      if (!tx || tx.sent) return Reflect.apply(original.send, this, arguments);
      tx.sent = true; tx.token = begin(tx.sourceUrl, tx.url, 'xhr', tx.method, tx.range);
      listen(tx, 'progress', event => { tx.bytes = Math.max(tx.bytes, Number(event.loaded) || 0); transfer(tx.token, { status: Number(tx.xhr.status) || 0, responseUrl: tx.xhr.responseURL || '', bytes: tx.bytes, outcome: 'progress' }, 'progress'); });
      listen(tx, 'load', () => { if (transactions.get(tx.xhr) === tx && tx.xhr.readyState === 4) { tx.loaded = true; tx.prepare?.(); } });
      listen(tx, 'loadend', event => {
        // A consumer can reopen this same native instance inside error/load.
        // Its old dispatch may continue with loadend after the retry opened.
        if (transactions.get(tx.xhr) !== tx || !tx.finished && tx.xhr.readyState !== 4) return;
        const status = Number(tx.xhr.status) || 0, success = status >= 200 && status < 300 && tx.loaded;
        outcome(tx, success ? 'complete' : status ? 'http-error' : 'network-error', success, event.loaded);
        detach(tx, false);
      });
      try { return Reflect.apply(original.send, this, arguments); }
      catch (error) { outcome(tx, 'cancelled'); detach(tx, false); throw error; }
    }
    if (xhrPrototype && original.open && original.send) {
      xhrPrototype.open = open; xhrPrototype.send = send; if (original.header) xhrPrototype.setRequestHeader = header;
      wrappedXHR = new Proxy(XHR, { construct(target, args, newTarget) {
        const xhr = Reflect.construct(target, args, newTarget); attachEarly(xhr); return xhr;
      } });
      scope.XMLHttpRequest = wrappedXHR;
    }
    function connectGlobal(name) {
      const previous = Object.getOwnPropertyDescriptor(scope, name);
      if (previous?.configurable === false) return;
      let assigned = !!previous, value;
      try { value = scope[name]; } catch { return; }
      if (value) value = transform(value, name).value;
      const get = () => value, set = input => { assigned = true; value = transform(input, name).value; };
      try {
        Object.defineProperty(scope, name, { configurable: true, enumerable: true, get, set });
        restores.push(() => {
          const current = Object.getOwnPropertyDescriptor(scope, name); if (current?.get !== get || current?.set !== set) return;
          if (previous?.get || previous?.set) Object.defineProperty(scope, name, previous);
          else if (!assigned) delete scope[name];
          else Object.defineProperty(scope, name, { configurable: true, enumerable: true, writable: true, ...previous, value });
        });
      } catch {}
    }
    function destroy() {
      if (disposed) return;
      disposed = true; timingObserver?.disconnect();
      for (const entry of pending.values()) removeFetch(entry);
      for (const tx of [...live]) detach(tx, true);
      for (const ref of readers) { const tx = ref.deref(); if (tx) detach(tx, true); } readers.clear();
      for (const ref of earlyReferences) {
        const record = ref.deref();
        if (record) for (const [name, callback] of record.listeners) record.xhr.removeEventListener(name, callback, true);
      }
      earlyReferences.clear();
      if (json.parse === parseForPage) json.parse = parse;
      if (scope.fetch === sendFetch) scope.fetch = fetch;
      if (scope.XMLHttpRequest === wrappedXHR) scope.XMLHttpRequest = XHR;
      if (xhrPrototype?.open === open) xhrPrototype.open = original.open;
      if (xhrPrototype?.send === send) xhrPrototype.send = original.send;
      if (xhrPrototype?.setRequestHeader === header) xhrPrototype.setRequestHeader = original.header;
      for (const restore of restores.reverse()) restore(); installations.delete(scope);
    }
    const api = { destroy, get requiresReload() { return requiresReload; } };
    installations.set(scope, api);
    for (const name of ['__playinfo__','__INITIAL_STATE__','__NEPTUNE_IS_MY_WAIFU__']) connectGlobal(name);
    if (options.sharingPolicy) { requiresReload = true; protectCapabilitySlots(scope, options.onSharingBlock); }
    return api;
  }
  const api = Object.freeze({ install }); global.BiliSmoothRequestInterceptor = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
