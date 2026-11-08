import test from 'node:test';
import assert from 'node:assert/strict';
import settings from '../../src/core/settings.js';
import { installControlBridge } from '../../src/page/control-bridge.js';
function bridge() {
  const callbacks = [], responses = [], timers = [], calls = [];
  let settle, reject, persisted = Promise.resolve();
  const runtime = { getState: () => ({ version: '2.3.0' }), getDiagnostics: () => ({ events: ['retained'] }),
    setConfig: patch => calls.push(patch), flushSettings: () => persisted,
    reload: () => true, applyRoute: host => settings.isCdnHost(host),
    resetNetwork() {}, clearEvents() {}, clearData() {}, retry: () => false };
  const scope = { location: { origin: 'https://www.bilibili.com', reload: () => calls.push('reload') },
    addEventListener: (type, fn) => callbacks.push(fn), postMessage: message => responses.push(message), setTimeout: fn => timers.push(fn) };
  installControlBridge({ scope, runtime });
  return { responses, timers, calls,
    pending() { persisted = new Promise((resolve, fail) => { settle = resolve; reject = fail; }); },
    saved() { settle(); }, failed() { reject(Error('disk full')); },
    send(action, patch, badOrigin = false) {
      return callbacks[0]({ source: scope, origin: badOrigin ? 'https://evil.example' : scope.location.origin, data: { __biliSmooth: 'request', id: 'request', action, patch } });
    } };
}
test('save response waits for persistence and preserves patch validation', async () => {
  const b = bridge(); b.pending(); const done = b.send('config', { enabled: false, pcdnHost: 'evil.example' });
  assert.equal(b.responses.length, 0); assert.deepEqual(b.calls[0], { enabled: false });
  b.saved(); await done; assert.equal(b.responses[0].ok, true);
});
test('failed settings save returns an actionable error and prevents refresh', async () => {
  const b = bridge(); b.pending(); const done = b.send('reload'); b.failed(); await done;
  assert.equal(b.responses[0].ok, false); assert.equal(b.responses[0].error, 'settings-save-failed'); assert.equal(b.timers.length, 0);
});
test('successful refresh acknowledges saved settings before navigation', async () => {
  const b = bridge(); b.pending(); const done = b.send('reload'); assert.equal(b.timers.length, 0);
  b.saved(); await done; assert.equal(b.responses[0].ok, true); assert.equal(b.calls.includes('reload'), false);
  b.timers[0](); assert.equal(b.calls.at(-1), 'reload');
});
test('diagnostics are independent of save failures and origins are checked', async () => {
  const b = bridge(); await b.send('diagnostics', undefined, true); assert.equal(b.responses.length, 0);
  await b.send('diagnostics'); assert.deepEqual(b.responses[0].result.events, ['retained']);
});
test('unknown commands are refused by name', async () => {
  const b = bridge(); await b.send('format-disk'); assert.equal(b.responses[0].ok, false); assert.equal(b.responses[0].error, 'unknown-command');
});
