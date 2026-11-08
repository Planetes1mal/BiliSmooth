(function () {
  'use strict';
  const api = chrome, key = 'bilismooth.config.v4';
  const settings = globalThis.BiliSmoothSettings, migration = globalThis.BiliSmoothSettingsMigration;
  let loaded = false, cached = null, revision = 0, writes = Promise.resolve();
  const post = data => window.postMessage(data, location.origin);
  const unreachable = error => /Receiving end does not exist|Could not establish connection/i.test(error?.message || '');
  // A starting worker can miss one message. Retry briefly before treating the
  // background as unavailable; other errors are real replies and are not retried.
  async function background(message) {
    for (const delay of [250, 1000, 0]) {
      try { return await api.runtime.sendMessage(message); }
      catch (error) { if (!unreachable(error) || !delay) throw error; await new Promise(resolve => setTimeout(resolve, delay)); }
    }
  }
  async function pushMotion() {
    try { const saved = await api.storage.local.get('bilismoothMotion'); post({ __bilismoothFloating: 'motion', value: saved.bilismoothMotion !== false }); } catch {}
  }
  const push = () => { if (loaded) post({ __bilismoothConfig: 'config', config: cached }); };
  async function authority(action, patch) {
    let response;
    try { response = await background({ channel: 'bilismooth-settings', action, patch }); }
    catch (error) {
      if (!unreachable(error) || !migration || !settings) throw error;
      // Same read/merge/write as the background. Saved settings stay usable
      // when Chrome cannot start the worker; only cross-tab queuing is lost.
      const current = await migration.read(api.storage.local);
      return action === 'patch' ? migration.write(api.storage.local, { ...current, ...settings.patch(patch) }) : current;
    }
    if (!response?.ok) throw Error(response?.error || 'settings-read-failed');
    return response.result;
  }
  function read() {
    const serial = ++revision;
    return authority('read').then(config => {
      if (serial !== revision) return;
      cached = config; loaded = true; push();
    }).catch(() => post({ __bilismoothConfig: 'storageError' }));
  }
  void read();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.__bilismoothFloating === 'ready') { void pushMotion(); return; }
    if (message?.__bilismoothFloating === 'open-control' && typeof message.id === 'string' && message.id.length <= 100) {
      background({ channel: 'bilismooth-control', action: 'open' })
        .then(response => post({ __bilismoothFloating: 'opened', id: message.id, ok: response?.ok === true }),
          error => post({ __bilismoothFloating: 'opened', id: message.id, ok: false, error: unreachable(error) ? 'background-unreachable' : 'open-control-failed' }));
      return;
    }
    if (message?.__bilismoothConfig === 'ready') { if (loaded) push(); else void read(); }
    if (message?.__bilismoothConfig !== 'save') return;
    const serial = ++revision;
    writes = writes.catch(() => {}).then(async () => {
      try {
        cached = await authority('patch', message.patch || message.config); loaded = true;
        post({ __bilismoothConfig: 'saved', id: message.id, ok: true });
        // Unchanged writes have no storage event to complete the startup handshake.
        if (serial === revision) push();
      } catch {
        post({ __bilismoothConfig: 'saved', id: message.id, ok: false });
      }
    });
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.bilismoothMotion) void pushMotion();
    if (area !== 'local' || !changes[key]) return;
    // Read latest authority after pending saves; never replay old event values.
    void writes.catch(() => {}).then(read);
  });
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.__biliSmooth !== 'response') return;
    const request = pending.get(event.data.id); if (!request) return;
    clearTimeout(request.timer); pending.delete(event.data.id);
    request.reply(event.data.ok ? { ok: true, result: event.data.result } : { ok: false, error: event.data.error || 'command-failed' });
  });
  // The page bridge owns the command whitelist; this script only relays the extension's own messages.
  api.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== api.runtime.id || message?.channel !== 'bilismooth' || typeof message.action !== 'string') return;
    if (pending.size >= 8) { reply({ ok: false, error: 'busy' }); return; }
    const id = crypto.randomUUID(), timer = setTimeout(() => { pending.delete(id); reply({ ok: false, error: 'no-response' }); }, 6500);
    pending.set(id, { reply, timer });
    post({ __biliSmooth: 'request', id, action: message.action, patch: message.patch });
    return true;
  });
})();
