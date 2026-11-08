// Keeps the page's copy of the settings in step with the extension's storage authority.
// Startup reads the same-origin cache synchronously; the content script then delivers the
// authoritative config; every page edit is a patch with a save receipt. Also decides when a
// settings change needs a page reload.
import settings from '../core/settings.js';

const SAVE_TIMEOUT_MS = 5000;
const routingKeys = ['enabled', 'selection', 'mode', 'pcdnHost', 'mcdnStrategy', 'proxyHost', 'portHeuristic', 'rewriteAkamai'];
const sameSetting = (a, b) => a === b || Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);

export function createSettingsSync({ scope, wallNow, clone, log, notify, onConfig }) {
  let config = settings.normalize(), startupReady = false, observedPayload = false, earlyEdits = {};
  let saveSerial = 0, latestSave = null, unsavedEdits = {}, settingsSave = { status: 'saved' };
  const pendingSaves = new Map(), reloadReasons = new Set();
  try { config = settings.normalize(JSON.parse(scope.localStorage.getItem(settings.cacheKey) || '{}')); } catch {}
  const installedP2pGuard = config.p2pGuard;
  function startupCache() { try { scope.localStorage.setItem(settings.cacheKey, JSON.stringify(config)); } catch {} }
  function finishSave(id, ok, error = '') {
    const record = pendingSaves.get(id); if (!record) return;
    scope.clearTimeout(record.timer); pendingSaves.delete(id);
    if (ok) for (const [key, value] of Object.entries(record.patch)) {
      if (sameSetting(unsavedEdits[key], value)) delete unsavedEdits[key];
    }
    if (record === latestSave) {
      settingsSave = ok ? { status: 'saved' } : { status: 'error', error: error || 'storage-write-failed' };
      if (ok) reloadReasons.delete('storage-write-failed');
      else { reloadReasons.add('storage-write-failed'); log('settings-save-failed', { reason: settingsSave.error }); }
      notify();
    }
    record.resolve({ ok, error: error || 'storage-write-failed' });
  }
  // Sends the pending edits to storage; the receipt arrives as a 'saved' message.
  function persist(patch = {}) {
    startupCache();
    unsavedEdits = { ...unsavedEdits, ...settings.patch(patch) };
    const id = 'save-' + wallNow() + '-' + (++saveSerial), record = { id, patch: clone(unsavedEdits) };
    record.promise = new Promise(resolve => { record.resolve = resolve; });
    record.timer = scope.setTimeout(() => finishSave(id, false, 'storage-ack-timeout'), SAVE_TIMEOUT_MS);
    pendingSaves.set(id, record); latestSave = record; settingsSave = { status: 'pending' };
    scope.postMessage({ __bilismoothConfig: 'save', config: clone(config), patch: record.patch, id }, scope.location.origin);
    notify();
  }
  // Resolves when the latest save is acknowledged; rejects with the storage error.
  async function flush() {
    for (;;) {
      const record = latestSave; if (!record) return true;
      const result = await record.promise;
      if (record !== latestSave) continue;
      if (!result.ok) throw new Error(result.error);
      return true;
    }
  }
  function save(patch, authoritative = false) {
    const previous = config;
    if (!authoritative && !startupReady) earlyEdits = { ...earlyEdits, ...settings.patch(patch) };
    if (authoritative) patch = { ...patch, ...unsavedEdits, ...(!startupReady ? earlyEdits : {}) };
    config = settings.normalize({ ...config, ...settings.patch(patch) });
    if (config.p2pGuard !== installedP2pGuard) reloadReasons.add('p2p-guard'); else reloadReasons.delete('p2p-guard');
    // Already delivered manifests cannot be switched back in place.
    if (observedPayload && routingKeys.some(key => config[key] !== previous[key])) reloadReasons.add('playinfo-config');
    if (authoritative && !startupReady) {
      startupReady = true;
      if (observedPayload && routingKeys.some(key => config[key] !== previous[key])) reloadReasons.add('startup-config');
    }
    if (authoritative) reloadReasons.delete('storage-read-failed');
    onConfig(config);
    const changed = Object.fromEntries(Object.entries(config).filter(([key, value]) => !sameSetting(previous[key], value)));
    startupCache(); if (!authoritative) persist({ ...settings.patch(patch), ...changed });
    notify(); return clone(config);
  }
  // The kernel may normalize the config it was given; keep the page's copy identical.
  function adopt(next) { config = settings.normalize({ ...config, ...settings.patch(next) }); notify(); }
  function handleMessage(data) {
    if (data?.__bilismoothConfig === 'config') { save(data.config, true); return true; }
    if (data?.__bilismoothConfig === 'storageError') { reloadReasons.add('storage-read-failed'); log('settings-read-failed'); notify(); return true; }
    if (data?.__bilismoothConfig === 'saved') { finishSave(data.id, data.ok === true, data.error); return true; }
    return false;
  }
  return { config: () => config, save, persist, flush, adopt, handleMessage,
    markPayloadObserved() { observedPayload = true; }, startupReady: () => startupReady,
    status: () => ({ ...settingsSave }), reloadReasons: () => [...reloadReasons], needsReload: () => reloadReasons.size > 0 };
}
