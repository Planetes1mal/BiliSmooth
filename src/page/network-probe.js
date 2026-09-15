/* BiliSmooth bounded measurements. A probe reports evidence, never a routing decision. */
(function (root) {
  'use strict';
  async function run(options) {
    const scope = options.scope || root, fetch = options.fetch || scope.fetch;
    const now = options.now || (() => scope.performance.now());
    const timeoutMs = options.timeoutMs ?? 4000, maxBytes = options.maxBytes ?? 768 * 1024;
    const delay = scope.setTimeout.bind(scope), cancel = scope.clearTimeout.bind(scope);
    const Controller = scope.AbortController || root.AbortController;
    const targets = [...new Map((options.targets || []).map(target => [target.host, target])).values()].slice(0, 12);
    async function measure({ host, url: inputUrl }) {
      const began = now(); let receivedAt = null, bodyAt = null, bytes = 0, status = 0, complete = false, timedOut = false, interrupted = false;
      let reader = null, timer = null, controller = Controller ? new Controller() : null, release;
      const stopped = new Promise(resolve => { release = resolve; });
      const stop = reason => { if (interrupted) return; interrupted = true; timedOut = reason === 'timeout'; release({ stopped: true }); controller?.abort(); };
      const externalAbort = () => stop('cancelled');
      const wait = promise => Promise.race([Promise.resolve(promise), stopped]);
      let error = '', url;
      try {
        url = new URL(inputUrl);
        if (!['https:', 'http:'].includes(url.protocol)) throw Error('invalid-url');
      } catch { error = 'invalid-url'; }
      if (!error) {
        options.signal?.addEventListener('abort', externalAbort, { once: true });
        if (options.signal?.aborted) externalAbort();
        if (!interrupted) timer = delay(() => stop('timeout'), timeoutMs);
        try {
          if (interrupted) throw Error('cancelled');
          const response = await wait(Reflect.apply(fetch, scope, [url.href, { method: 'GET', mode: 'cors', cache: 'no-store', credentials: 'omit', ...(controller ? {signal:controller.signal} : {}) }]));
          if (response?.stopped) throw Error('interrupted');
          receivedAt = now(); status = Number(response.status) || 0;
          if (!response.ok) { error = 'http'; try { void response.body?.cancel?.()?.catch?.(() => {}); } catch {} }
          else if (!response.body?.getReader) complete = true;
          else {
            reader = response.body.getReader(); bodyAt = now();
            while (!interrupted) {
              const chunk = await wait(reader.read());
              if (chunk?.stopped || interrupted) break;
              if (chunk.value) bytes += chunk.value.byteLength;
              if (chunk.done || bytes >= maxBytes) { complete = true; break; }
            }
          }
        } catch { if (!error) error = interrupted ? timedOut ? 'timeout' : 'cancelled' : 'network'; }
        finally {
          cancel(timer); options.signal?.removeEventListener('abort', externalAbort);
          try { void reader?.cancel()?.catch?.(() => {}); } catch {}
          controller?.abort();
        }
      }
      if (interrupted) error = timedOut ? 'timeout' : 'cancelled';
      // A deadline after a partial response remains a slow measured fallback.
      // External cancellation belongs to a discarded round and is never success.
      const usable = bytes > 0 && (!error && complete || timedOut && receivedAt !== null);
      const elapsedMs = Math.max(0, now() - began), bodyMs = bodyAt === null ? 0 : Math.max(0, now() - bodyAt);
      const sample = { host, ttfb: usable ? Math.max(0, receivedAt - began) : null,
        mbps: usable && bodyMs > 0 ? bytes * 0.008 / bodyMs : 0, ok: !!usable, bytes, elapsedMs,
        timedOut, status, error: usable ? '' : error || (complete ? 'empty-body' : 'network') };
      try { options.onSample?.(sample); } catch {}
      return sample;
    }
    const samples = await Promise.all(targets.map(measure));
    return { samples, totalBytes: samples.reduce((sum,sample) => sum + sample.bytes, 0) };
  }
  const api = Object.freeze({ run }); root.BiliSmoothNetworkProbe = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
