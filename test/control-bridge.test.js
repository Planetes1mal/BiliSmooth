const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const settings = require('../src/core/settings.js');
function bridge() {
  const callbacks = [], responses = [], timers = [], calls = [];
  let settle, reject, persisted = Promise.resolve();
  const session = { getState: () => ({ version: '2.3.0' }), getDiagnostics: () => ({ events: ['retained'] }),
    setConfig: patch => calls.push(patch), flushSettings: () => persisted,
    reload: () => true, boost: () => true, applyRoute: host => settings.isCdnHost(host),
    resetNetwork() {}, clearEvents() {}, clearData() {}, retry: () => false };
  const scope = { BiliSmoothSession: session, BiliSmoothSettings: settings,
    location: { origin: 'https://www.bilibili.com', reload: () => calls.push('reload') },
    addEventListener: (type, fn) => callbacks.push(fn), postMessage: message => responses.push(message), setTimeout: fn => timers.push(fn) };
  const context = vm.createContext(scope);
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../src/page/control-bridge.js'), 'utf8'), context);
  return { responses, timers, calls,
    pending() { persisted = new Promise((resolve, fail) => { settle = resolve; reject = fail; }); },
    saved() { settle(); }, failed() { reject(Error('disk full')); },
    send(action, patch, badOrigin = false) {
      context.message = { __biliSmooth: 'request', id: 'request', action, patch }; context.callbacks = callbacks;
      context.origin = badOrigin ? 'https://evil.example' : scope.location.origin;
      return vm.runInContext('callbacks[0]({source:globalThis,origin,data:message})', context);
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
