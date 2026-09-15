(function () {
  'use strict';
  const api = chrome, key = 'bilismooth.config.v4';
  let loaded = false, cached = null, revision = 0, writes = Promise.resolve();
  const post = data => window.postMessage(data, location.origin);
  async function pushMotion() {
    try { const saved = await api.storage.local.get('bilismoothMotion'); post({ __bilismoothFloating: 'motion', value: saved.bilismoothMotion !== false }); } catch {}
  }
  const push = () => { if (loaded) post({ __bilismoothConfig: 'config', config: cached }); };
  async function authority(action, patch) {
    const response = await api.runtime.sendMessage({ channel: 'bilismooth-settings', action, patch });
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
      api.runtime.sendMessage({ channel: 'bilismooth-control', action: 'open' })
        .then(response => post({ __bilismoothFloating: 'opened', id: message.id, ok: response?.ok === true }),
          () => post({ __bilismoothFloating: 'opened', id: message.id, ok: false }));
      return;
    }
    if (message?.__bilismoothConfig === 'ready') { if (loaded) push(); else void read(); }
    if (message?.__bilismoothConfig !== 'save') return;
    revision++;
    writes = writes.catch(() => {}).then(async () => {
      try {
        cached = await authority('patch', message.patch || message.config); loaded = true;
        post({ __bilismoothConfig: 'saved', id: message.id, ok: true });
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
  const commands = new Set(['state', 'config', 'reset', 'retry', 'applyRoute', 'clearData', 'clearEvents', 'diagnostics', 'boost', 'reload', 'resetFloatingPosition']);
  api.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== api.runtime.id || message?.channel !== 'bilismooth' || !commands.has(message.action)) return;
    if (pending.size >= 8) { reply({ ok: false, error: 'busy' }); return; }
    const id = crypto.randomUUID(), timer = setTimeout(() => { pending.delete(id); reply({ ok: false, error: 'no-response' }); }, 6500);
    pending.set(id, { reply, timer });
    post({ __biliSmooth: 'request', id, action: message.action, patch: message.patch });
    return true;
  });
})();
