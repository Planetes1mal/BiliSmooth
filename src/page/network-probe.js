/* BiliSmooth bounded measurements. A race reports evidence, never a routing decision. */
(function (root) {
  'use strict';
  const Policy = root.BiliSmoothDeliveryPolicy || (typeof require === 'function' ? require('../core/delivery-policy.js') : null);
  const C = Policy.constants;
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
  const api = Object.freeze({ race }); root.BiliSmoothNetworkProbe = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
