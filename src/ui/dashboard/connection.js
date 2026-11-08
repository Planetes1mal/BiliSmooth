// The dashboard's link to one Bilibili tab: tab discovery, polling every 1.2 s, whitelisted commands
// through the content script, and the background's settings authority when no tab answers.
// Status: 'connecting' | 'no-tab' | 'connected' | 'no-response' | 'stale'.
import settings from '../../core/settings.js';

const CONFIG_KEY = 'bilismooth.config.v4', POLL_MS = 1200, RELOAD_GRACE_MS = 8000;

export function createConnection({ api = globalThis.chrome, buildVersion = '', onChange = () => {}, onSelect = () => {} } = {}) {
  const manifestVersion = api.runtime.getManifest().version;
  const state = { status: 'connecting', tabs: [], tabId: Number(new URLSearchParams(location.search).get('tab')) || null,
    snapshot: null, config: settings.normalize({}), readFailed: false, loadFailed: false, motion: true };
  let generation = 0, issued = 0, applied = 0, timer = null, pending = false, closed = false, tabTimer = null, reloadingUntil = 0;
  const connected = () => state.status === 'connected';

  function setStatus(status) { state.status = status; if (status !== 'connected') state.snapshot = null; }
  function adopt(config) { if (config && typeof config === 'object') state.config = settings.normalize(config); }
  function fail(error) {
    if (error?.message === 'stale-script') setStatus('stale');
    else if (!state.tabId) setStatus('no-tab');
    else setStatus(Date.now() < reloadingUntil ? 'connecting' : 'no-response');
    onChange();
  }
  function schedule() {
    clearTimeout(timer);
    if (!closed && !document.hidden) timer = setTimeout(() => refresh(false), POLL_MS);
  }

  async function readConfig() {
    try {
      const reply = await api.runtime.sendMessage({ channel: 'bilismooth-settings', action: 'read' });
      if (!reply?.ok) throw Error(reply?.error || 'settings-read-failed');
      adopt(reply.result); state.readFailed = false;
    } catch { state.readFailed = true; }
    onChange();
  }
  async function queryTabs() {
    const previous = state.tabId;
    const tabs = await api.tabs.query({ url: ['https://*.bilibili.com/*'] });
    state.tabs = (tabs || []).filter(tab => Number.isInteger(tab.id));
    if (state.tabId && !state.tabs.some(tab => tab.id === state.tabId)) state.tabId = null;
    if (!state.tabId && state.tabs.length === 1) state.tabId = state.tabs[0].id;
    const moved = previous !== state.tabId;
    if (moved) { generation++; setStatus(state.tabId ? 'connecting' : 'no-tab'); onSelect(); }
    onChange();
    return moved;
  }
  async function request(action, patch) {
    if (!state.tabId) throw Error('no-video');
    const reply = await api.tabs.sendMessage(state.tabId, { channel: 'bilismooth', action, patch }, { frameId: 0 });
    if (!reply?.ok) throw Error(reply?.error || 'no-response');
    // A tab that still runs an older build answers with its own version; it needs a reload.
    if (action !== 'diagnostics' && reply.result?.version !== manifestVersion) throw Error('stale-script');
    return reply.result;
  }

  async function refresh(reconnect = false) {
    if (closed || (document.hidden && !reconnect) || (pending && !reconnect)) return;
    pending = true; clearTimeout(timer);
    let token = generation, sequence = ++issued;
    try {
      if (reconnect) { await queryTabs(); await readConfig(); token = generation; sequence = ++issued; }
      if (!state.tabId) { setStatus('no-tab'); onChange(); return; }
      const result = await request('state');
      if (token !== generation || sequence < applied || closed) return;
      applied = sequence; reloadingUntil = 0;
      state.status = 'connected'; state.snapshot = result; adopt(result.config);
      onChange();
    } catch (error) {
      if (token === generation && sequence >= applied && !closed) { applied = sequence; fail(error); }
    } finally { pending = false; schedule(); }
  }

  async function selectTab(id) {
    generation++; issued++;
    state.tabId = Number.isInteger(id) && id > 0 ? id : null;
    history.replaceState(null, '', location.pathname + (state.tabId ? '?tab=' + state.tabId : '') + location.hash);
    setStatus(state.tabId ? 'connecting' : 'no-tab'); onSelect(); onChange();
    await queryTabs();
    await refresh(true);
  }

  // Settings edits and route choices work without a tab: they go straight to the background authority.
  async function patchGlobal(patch) {
    const reply = await api.runtime.sendMessage({ channel: 'bilismooth-settings', action: 'patch', patch });
    if (!reply?.ok) throw Error(reply?.error || 'settings-save-failed');
    adopt(reply.result);
    return { config: state.config, routeApplied: true };
  }
  async function command(action, patch) {
    const token = generation, sequence = ++issued;
    try {
      // Only a reply from the video tab is its state; the background's reply to a patch carries only the config.
      let result, fromTab = false;
      if ((action === 'config' || action === 'applyRoute') && !connected()) {
        const mode = state.config.mode === 'off' ? 'bad-only' : state.config.mode;
        result = await patchGlobal(action === 'applyRoute' ? { enabled: true, selection: 'fixed', pcdnHost: patch?.host, mode } : patch);
      } else { result = await request(action, patch); fromTab = true; }
      if (token !== generation) throw Error('selection-changed');
      if (fromTab && action !== 'diagnostics' && connected() && sequence >= applied) { applied = sequence; state.snapshot = result; adopt(result.config); }
      onChange();
      return result;
    } catch (error) {
      if (token !== generation) throw Error('selection-changed');
      if (error?.message === 'settings-save-failed') await readConfig();
      else if (!['diagnostics', 'config', 'applyRoute'].includes(action)) fail(error);
      throw error;
    } finally { schedule(); }
  }
  // After a reload request the tab stops answering for a while; that is "connecting", not "not responding".
  function expectReload() { reloadingUntil = Date.now() + RELOAD_GRACE_MS; setStatus('connecting'); onChange(); schedule(); }

  async function focusVideo() {
    if (!state.tabId) return;
    try {
      const tab = await api.tabs.update(state.tabId, { active: true });
      if (Number.isInteger(tab?.windowId)) await api.windows.update(tab.windowId, { focused: true });
    } catch { fail(Error('closed-tab')); await queryTabs().catch(() => {}); }
  }
  async function reloadVideo() {
    if (!state.tabId) return;
    try { await api.tabs.reload(state.tabId); expectReload(); }
    catch { fail(Error('closed-tab')); }
  }
  async function setMotion(value) {
    await api.storage.local.set({ bilismoothMotion: value !== false });
    state.motion = value !== false; onChange();
  }

  // The background finds this page and hands it a tab (src/extension/background.js, openControl).
  api.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== api.runtime.id || message?.channel !== 'bilismooth-control') return;
    if (message.action === 'locate') {
      api.tabs.getCurrent().then(tab => reply({ ok: !!tab?.id, tabId: tab?.id, version: buildVersion, sourceTabId: state.tabId, hash: location.hash }), () => reply({ ok: false }));
      return true;
    }
    if (message.action !== 'select-tab') return;
    selectTab(message.tabId).then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.bilismoothMotion) state.motion = changes.bilismoothMotion.newValue !== false;
    if (changes[CONFIG_KEY]?.newValue) adopt(changes[CONFIG_KEY].newValue);
    if (changes.bilismoothMotion || changes[CONFIG_KEY]) onChange();
  });
  function queueTabRefresh() {
    clearTimeout(tabTimer);
    tabTimer = setTimeout(async () => {
      try {
        const moved = await queryTabs();
        if (!state.tabId) { setStatus('no-tab'); onChange(); } else if (moved) await refresh(true);
      } catch {}
    }, 250);
  }
  api.tabs.onRemoved?.addListener(queueTabRefresh);
  api.tabs.onUpdated?.addListener(queueTabRefresh);
  api.tabs.onCreated?.addListener(queueTabRefresh);
  document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden) refresh(true); });
  addEventListener('pagehide', () => { closed = true; clearTimeout(timer); clearTimeout(tabTimer); });

  async function start() {
    try {
      await readConfig();
      const saved = await api.storage.local.get('bilismoothMotion');
      state.motion = saved?.bilismoothMotion !== false;
      await queryTabs();
      await refresh();
    } catch { state.loadFailed = true; fail(Error('no-response')); schedule(); }
  }
  return { state, start, refresh, command, selectTab, focusVideo, reloadVideo, expectReload, setMotion, connected };
}
