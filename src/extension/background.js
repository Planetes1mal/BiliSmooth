/* One control space and one serialized authority for local settings. */
importScripts('settings.js', 'settings-migration.js');
const settings = BiliSmoothSettings, migration = BiliSmoothSettingsMigration;
const controlUrl = chrome.runtime.getURL('control/index.html');
const currentVersion = chrome.runtime.getManifest().version;
let settingsQueue = Promise.resolve(), opening = Promise.resolve();
function isVideoSite(url) {
  try { const value = new URL(url); return value.protocol === 'https:' && /(^|\.)bilibili\.(com|tv)$/.test(value.hostname); }
  catch { return false; }
}
function serializeSettings(action, patch) {
  const operation = settingsQueue.catch(() => {}).then(async () => {
    const current = await migration.read(chrome.storage.local);
    return action === 'patch' ? migration.write(chrome.storage.local, { ...current, ...settings.patch(patch) }) : current;
  });
  settingsQueue = operation;
  return operation;
}
function reloadControl(tabId) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = error => {
      if (finished) return;
      finished = true; clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      if (error) reject(error); else resolve();
    };
    const updated = (id, change) => { if (id === tabId && change.status === 'complete') finish(); };
    const removed = id => { if (id === tabId) finish(new Error('control-tab-closed')); };
    const timeout = setTimeout(() => finish(new Error('control-reload-timeout')), 5000);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
    // Reload keeps the browser's real URL even when tab permissions hide it.
    chrome.tabs.reload(tabId).catch(finish);
  });
}
async function openControl(source) {
  const tabId = Number.isInteger(source?.id) && isVideoSite(source.url) ? source.id : null;
  // Host access is restricted to video sites, so tab inventories may omit
  // extension-page URLs. Ask our control view for its own tab ID instead.
  let existing = null, view = null;
  try {
    const response = await chrome.runtime.sendMessage({ channel: 'bilismooth-control', action: 'locate' });
    if (response?.ok && Number.isInteger(response.tabId)) { existing = await chrome.tabs.get(response.tabId); view = response; }
  } catch { /* No live control view yet. */ }
  if (existing) {
    const destination = new URL(controlUrl);
    const oldUrl = (() => { try { return new URL(existing.url); } catch { return null; } })();
    const sourceId = tabId || (Number.isInteger(view?.sourceTabId) ? view.sourceTabId : Number(oldUrl?.searchParams.get('tab')));
    if (sourceId > 0) destination.searchParams.set('tab', String(sourceId));
    const section = String(view?.hash || oldUrl?.hash || '#overview').replace(/^#/, '');
    destination.hash = ['overview', 'routes', 'settings', 'logs'].includes(section) ? section : 'overview';
    // The document reports its embedded build version, not the newly updated
    // runtime's manifest: an already-open page can still contain old assets.
    if (view?.version !== currentVersion) {
      await reloadControl(existing.id);
      if (tabId) {
        const ready = await chrome.runtime.sendMessage({ channel: 'bilismooth-control', action: 'locate' });
        if (!ready?.ok || ready.tabId !== existing.id || ready.version !== currentVersion) throw new Error('control-not-ready');
        const response = await chrome.runtime.sendMessage({ channel: 'bilismooth-control', action: 'select-tab', tabId });
        if (!response?.ok) throw new Error('control-selection-failed');
      }
    } else if (tabId) {
      try { await chrome.runtime.sendMessage({ channel: 'bilismooth-control', action: 'select-tab', tabId }); }
      catch { await chrome.tabs.update(existing.id, { url: destination.href }); }
    }
    await chrome.tabs.update(existing.id, { active: true });
    if (Number.isInteger(existing.windowId)) await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: controlUrl + (tabId ? '?tab=' + tabId : '') });
  }
}
chrome.action.onClicked.addListener(tab => {
  opening = opening.catch(() => {}).then(() => openControl(tab));
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id === chrome.runtime.id && message?.channel === 'bilismooth-control' && message.action === 'open' &&
      Number.isInteger(sender.tab?.id) && isVideoSite(sender.tab.url)) {
    const operation = opening.catch(() => {}).then(() => openControl(sender.tab));
    opening = operation;
    operation.then(() => reply({ ok: true }), () => reply({ ok: false, error: 'open-control-failed' }));
    return true;
  }
  if (sender.id !== chrome.runtime.id || message?.channel !== 'bilismooth-settings' || !['read', 'patch'].includes(message.action)) return;
  serializeSettings(message.action, message.patch)
    .then(result => reply({ ok: true, result }), () => reply({ ok: false, error: message.action === 'patch' ? 'settings-save-failed' : 'settings-read-failed' }));
  return true;
});
