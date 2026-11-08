// Wraps window.fetch: routes media addresses, reports request lifecycles and prepares textual
// playinfo responses. Media bodies are never read or cloned.
import { readUrl, textual, relevant, signalText } from './request-rules.js';

export function installFetchHook({ scope, json, parse, stringify, active, isDisposed, route, begin, transfer, transform }) {
  const fetch = scope.fetch, RequestType = scope.Request || globalThis.Request;
  const ResponseType = scope.Response || globalThis.Response, HeadersType = scope.Headers || globalThis.Headers;
  const pending = new Map();
  let timingObserver = null;
  function removeFetch(entry) {
    pending.delete(entry.token.id);
    entry.signal?.removeEventListener('abort', entry.aborted);
  }
  // Resource timing is the only byte evidence for a fetch whose body the page consumes itself.
  function processTiming(entries) {
    for (const metric of entries) {
      if (metric.initiatorType && metric.initiatorType !== 'fetch') continue;
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
    let range = ''; try { range = new HeadersType(init?.headers ?? input?.headers).get('range') || ''; } catch {}
    const sourceUrl = readUrl(input), destination = route(sourceUrl, { range, transport: 'fetch' });
    let outgoing = input, extra = init;
    if (destination && destination !== sourceUrl) {
      if (RequestType && input instanceof RequestType) { outgoing = new RequestType(destination, new RequestType(input, init)); extra = undefined; }
      else outgoing = destination;
    }
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
  return {
    dispose() {
      timingObserver?.disconnect();
      for (const entry of pending.values()) removeFetch(entry);
      if (scope.fetch === sendFetch) scope.fetch = fetch;
    }
  };
}
