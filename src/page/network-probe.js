/* BiliSmooth bounded measurements. A probe reports evidence, never a routing decision. */
(function (root) {
  'use strict';
  const Policy = root.BiliSmoothDeliveryPolicy || (typeof require === 'function' ? require('../core/delivery-policy.js') : null);
  const C = Policy.constants;
  async function run(options) {
    const scope = options.scope || root, fetch = options.fetch || scope.fetch;
    const now = options.now || (() => scope.performance.now());
    const timeoutMs = options.timeoutMs ?? C.RACE_TIMEOUT_MS, maxBytes = options.maxBytes ?? C.RACE_SAMPLE_BYTES;
    const delay = scope.setTimeout.bind(scope), cancel = scope.clearTimeout.bind(scope);
    const Controller = scope.AbortController || root.AbortController;
    const targets = [...new Map((options.targets || []).map(target => [target.host, target])).values()].slice(0, 12);
    async function measure({ host, url: inputUrl }) {
      const began = now(); let receivedAt = null, bytes = 0, status = 0, complete = false, timedOut = false, interrupted = false;
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
            reader = response.body.getReader();
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
      const elapsedMs = Math.max(0, now() - began);
      const sample = { host, ttfb: usable ? Math.max(0, receivedAt - began) : null,
        mbps: usable && elapsedMs > 0 ? bytes * 0.008 / elapsedMs : 0, ok: !!usable, bytes, elapsedMs,
        timedOut, status, error: usable ? '' : error || (complete ? 'empty-body' : 'network') };
      try { options.onSample?.(sample); } catch {}
      return sample;
    }
    const samples = await Promise.all(targets.map(measure));
    return { samples, totalBytes: samples.reduce((sum,sample) => sum + sample.bytes, 0) };
  }
  async function race(options) {
    const { scope, now, fetch, signal } = options, deadline = now() + C.RACE_TIMEOUT_MS;
    const start = options.range.start, end = Math.min(options.range.end, start + C.RACE_SAMPLE_BYTES - 1);
    const expectedBytes = end - start + 1, range = `bytes=${start}-${end}`;
    let winner = null;
    async function measure(target) {
      const controller = new scope.AbortController(), startedAt = now();
      let bytes = 0, firstByteMs = null, status = 0, error = '', stoppedBy = '', rejectStop;
      const stopped = new Promise((_, reject) => { rejectStop = reject; });
      const stop = reason => { stoppedBy = reason; rejectStop(Error(reason)); controller.abort(); };
      const abort = () => stop('cancelled'), wait = promise => Promise.race([promise, stopped]);
      signal.addEventListener('abort', abort, { once: true });
      const timer = scope.setTimeout(() => stop('timeout'), deadline - now());
      try {
        if (signal.aborted) abort();
        const response = await wait(Reflect.apply(fetch, scope, [target.url, { method: 'GET', mode: 'cors',
          credentials: 'omit', cache: 'no-store', headers: { Range: range }, signal: controller.signal }]));
        status = response.status;
        if (status !== 206) { error = 'http'; controller.abort(); }
        else {
          const reader = response.body.getReader();
          while (bytes < expectedBytes) {
            const part = await wait(reader.read());
            if (part.done) break;
            if (part.value.byteLength && firstByteMs === null) firstByteMs = now() - startedAt;
            bytes += part.value.byteLength;
          }
          if (bytes !== expectedBytes) error = 'incomplete-range';
        }
      } catch { error = stoppedBy || 'network'; }
      finally { scope.clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); }
      const sample = { host: target.host, status, bytes, firstByteMs, elapsedMs: now() - startedAt, ok: !error, error, range };
      if (sample.ok && !winner && !signal.aborted) { winner = sample; options.onWinner(sample); }
      return sample;
    }
    const samples = await Promise.all(options.targets.slice(0, C.RACE_CHALLENGERS).map(measure));
    return { winner, runnerUp: samples.find(sample => sample.ok && sample !== winner) || null,
      samples, totalBytes: samples.reduce((sum, sample) => sum + sample.bytes, 0) };
  }
  const api = Object.freeze({ run, race }); root.BiliSmoothNetworkProbe = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
