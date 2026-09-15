const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const settings = require('../src/core/settings.js');
const migration = require('../src/core/settings-migration.js');
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
function extension(initial = {}) {
  const updates = new Set(), removals = new Set(), reloads = [], tabUpdates = [];
  let omitTabUrl = false, autoCompleteReload = true;
  const completeReload = id => { viewVersion = require('../package.json').version; for (const fn of [...updates]) fn(id, { status: 'complete' }); };
  const store = structuredClone(initial), changes = [], listeners = [], actionListeners = [], messages = [], writes = [], tabs = [];
  let failWrite = false, failRead = false, viewVersion = require('../package.json').version;
  const storage = { get: async () => { if (failRead) throw Error('read denied'); return structuredClone(store); }, set: async data => {
    if (failWrite) throw Error('disk full');
    const diff = {};
    for (const [key, value] of Object.entries(data)) {
      if (JSON.stringify(store[key]) !== JSON.stringify(value)) diff[key] = { oldValue: store[key], newValue: value };
      store[key] = structuredClone(value);
    }
    writes.push(data); for (const fn of changes) fn(diff, 'local');
  } };
  const chrome = { storage: { local: storage, onChanged: { addListener: fn => changes.push(fn) } },
    runtime: { id: 'test-extension', getURL: file => 'chrome-extension://test-extension/' + file,
      getManifest: () => ({ version: require('../package.json').version }),
      onMessage: { addListener: fn => listeners.push(fn) }, sendMessage: message => new Promise((resolve, reject) => {
        messages.push(message); let accepted = false;
        if (message.channel === 'bilismooth-control' && message.action === 'locate' && tabs.length) { resolve({ ok: true, tabId: tabs[0].id, version: viewVersion }); return; }
        if (message.channel === 'bilismooth-control' && message.action === 'select-tab' && viewVersion === require('../package.json').version && tabs.length) { const url = new URL(tabs[0].url); url.searchParams.set('tab', String(message.tabId)); tabs[0].url = url.href; resolve({ ok: true }); return; }
        for (const fn of listeners) if (fn(message, { id: 'test-extension' }, resolve)) accepted = true;
        if (!accepted) reject(Error('no receiver'));
      }) }, action: { onClicked: { addListener: fn => actionListeners.push(fn) } },
    tabs: { onUpdated: { addListener: fn => updates.add(fn), removeListener: fn => updates.delete(fn) }, onRemoved: { addListener: fn => removals.add(fn), removeListener: fn => removals.delete(fn) },
      reload: async id => { reloads.push(id); for (const fn of [...updates]) fn(id, { status: 'loading' }); if (autoCompleteReload) Promise.resolve().then(() => completeReload(id)); },
      query: async () => tabs, get: async id => { const tab = { ...tabs.find(tab => tab.id === id) }; if (omitTabUrl) delete tab.url; return tab; }, create: async tab => { tabs.push({ ...tab, id: tabs.length + 10, windowId: 1 }); },
      update: async (id, change) => { tabUpdates.push({ id, ...change }); return Object.assign(tabs.find(tab => tab.id === id), change); } },
    windows: { update: async () => {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/extension/background.js'), 'utf8'), {
    chrome, importScripts() {}, BiliSmoothSettings: settings, BiliSmoothSettingsMigration: migration, URL, setTimeout, clearTimeout
  });
  function content() {
    const posted = [], events = [], runtime = [];
    const pageChrome = { ...chrome, runtime: { ...chrome.runtime, onMessage: { addListener: fn => runtime.push(fn) } } };
    const scope = { chrome: pageChrome, location: { origin: 'https://www.bilibili.com' }, crypto, setTimeout, clearTimeout,
      postMessage: message => posted.push(message), addEventListener: (type, fn) => { if (type === 'message') events.push(fn); } };
    scope.window = scope;
    const context = vm.createContext(scope);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/extension/content.js'), 'utf8'), context);
    function message(data) { context.input = data; context.events = events; vm.runInContext('events.forEach(fn=>fn({source:window,origin:location.origin,data:input}))', context); }
    return { posted, message, runtime };
  }
  const command = (action, patch) => chrome.runtime.sendMessage({ channel: 'bilismooth-settings', action, patch });
  return { store, writes, messages, content, command, tabs, actionListeners, reloads, tabUpdates, updates, removals, completeReload,
    hideTabUrl(value) { omitTabUrl = value; }, autoCompleteReload(value) { autoCompleteReload = value; },
    setViewVersion(value) { viewVersion = value; },
    failWrite(value) { failWrite = value; }, failRead(value) { failRead = value; } };
}
test('network defaults keep full candidate pool and validated advanced preferences', () => {
  const value = settings.normalize({ enabled: false, selection: 'fixed', pcdnHost: settings.candidatePool[3], mode: 'force',
    mcdnStrategy: 'proxy-v1', portHeuristic: false, rewriteAkamai: true, p2pGuard: true, lang: 'en', accent: 'pink', theme: 'dark', preemptive: true });
  assert.equal(value.candidatePool.length, 9); assert.equal(value.schemaVersion, 4); assert.equal(value.preemptive, undefined);
  assert.equal(value.enabled, false); assert.equal(value.mcdnStrategy, 'proxy-v1'); assert.equal(value.p2pGuard, true);
  assert.equal(value.selection, 'fixed'); assert.equal(value.mode, 'force');
  assert.equal(settings.normalize({ pcdnHost: 'evil.example', proxyHost: 'http://evil.example/a' }).proxyHost, settings.defaults.proxyHost);
});

test('new installs default to teal while current and imported peach preferences survive saving', async () => {
  const fresh = extension();
  const first = await fresh.command('read');
  assert.equal(first.result.accent, 'teal');
  assert.equal(first.result.schemaVersion, 4);
  const peach = settings.normalize({ accent: 'peach', lang: 'en' });
  for (const key of [migration.key, 'prior.preferences']) {
    const existing = extension({ [key]: peach });
    assert.equal((await existing.command('read')).result.accent, 'peach');
    const saved = await existing.command('patch', { theme: 'dark' });
    assert.equal(saved.result.accent, 'peach');
    assert.equal(existing.store[migration.key].accent, 'peach');
    assert.equal(existing.store[migration.key].lang, 'en');
    if (key !== migration.key) assert.deepEqual(existing.store[key], peach);
  }
});
test('one-time migration preserves old preferences and rollback records without trusting obsolete experiments', async () => {
  // Import uses the record shape; the historical storage key is irrelevant.
  const legacy = { enabled: false, selection: 'fixed', pcdnHost: settings.candidatePool[5], theme: 'light', preemptive: true, schemaVersion: 3 };
  const h = extension({ 'prior.preferences': legacy, bilismoothTheme: 'dark' });
  const { result } = await h.command('read');
  assert.equal(result.enabled, false); assert.equal(result.selection, 'fixed'); assert.equal(result.pcdnHost, legacy.pcdnHost);
  assert.equal(result.theme, 'dark'); assert.equal(result.preemptive, undefined);
  assert.deepEqual(h.store['prior.preferences'], legacy); assert.deepEqual(h.store['bilismooth.config.import.v4'].config, legacy);
  await h.command('patch', { theme: 'light' }); await h.command('read');
  assert.equal(h.store[migration.key].theme, 'light'); assert.equal(h.store.bilismoothTheme, 'dark');
  assert.deepEqual(h.store['prior.preferences'], legacy);
});

test('preference import rejects ambiguous unrelated records and current v4 always wins', async () => {
  const a = { enabled: true, selection: 'auto', pcdnHost: settings.candidatePool[0] };
  const b = { ...a, enabled: false };
  const ambiguous = extension({ first: a, second: b });
  assert.equal((await ambiguous.command('read')).ok, false);
  assert.equal(ambiguous.store[migration.key], undefined);
  const current = extension({ first: a, second: b, [migration.key]: settings.normalize({ theme: 'dark' }) });
  assert.equal((await current.command('read')).result.theme, 'dark');
  assert.equal(current.writes.length, 0);
});
test('simultaneous video-tab patches serialize and preserve unrelated settings', async () => {
  const h = extension({ [migration.key]: settings.normalize({ enabled: false, lang: 'en' }) });
  const a = h.content(), b = h.content(); await flush();
  a.message({ __bilismoothConfig: 'save', patch: { selection: 'fixed', pcdnHost: settings.candidatePool[2] }, id: 'a' });
  b.message({ __bilismoothConfig: 'save', patch: { theme: 'dark', accent: 'teal' }, id: 'b' });
  await flush();
  const config = h.store[migration.key];
  assert.equal(config.enabled, false); assert.equal(config.lang, 'en'); assert.equal(config.selection, 'fixed');
  assert.equal(config.pcdnHost, settings.candidatePool[2]); assert.equal(config.theme, 'dark'); assert.equal(config.accent, 'teal');
  assert.equal(a.posted.find(row => row.id === 'a').ok, true); assert.equal(b.posted.find(row => row.id === 'b').ok, true);
  assert.equal(a.posted.filter(row => row.__bilismoothConfig === 'config').at(-1).config.theme, 'dark');
});
test('early patch waits for migration and does not replace saved fields with defaults', async () => {
  const h = extension({ [migration.key]: settings.normalize({ enabled: false, lang: 'en' }) });
  const page = h.content(); page.message({ __bilismoothConfig: 'save', patch: { accent: 'violet' }, id: 'early' });
  assert.equal(page.posted.some(row => row.id === 'early'), false); await flush();
  assert.equal(h.store[migration.key].enabled, false); assert.equal(h.store[migration.key].lang, 'en');
  assert.equal(h.store[migration.key].accent, 'violet'); assert.equal(page.posted.find(row => row.id === 'early').ok, true);
});
test('ordinary save failure is acknowledged; later retry can succeed', async () => {
  const h = extension({ [migration.key]: settings.normalize() }), page = h.content(); await flush(); h.failWrite(true);
  page.message({ __bilismoothConfig: 'save', patch: { mode: 'force' }, id: 'failed' }); await flush();
  assert.equal(page.posted.find(row => row.id === 'failed').ok, false); assert.equal(h.store[migration.key].mode, 'bad-only');
  h.failWrite(false); page.message({ __bilismoothConfig: 'save', patch: { mode: 'force' }, id: 'retry' }); await flush();
  assert.equal(page.posted.find(row => row.id === 'retry').ok, true); assert.equal(h.store[migration.key].mode, 'force');
});
test('read failure is visible and does not reset stored settings', async () => {
  const h = extension({ [migration.key]: settings.normalize({ enabled: false }) }); h.failRead(true);
  const page = h.content(); await flush();
  assert.equal(page.posted.at(-1).__bilismoothConfig, 'storageError'); assert.equal(h.writes.length, 0);
});
test('rapid writes never broadcast obsolete intermediate values', async () => {
  const h = extension({ [migration.key]: settings.normalize() }), page = h.content(); await flush(); page.posted.length = 0;
  page.message({ __bilismoothConfig: 'save', patch: { mode: 'force' }, id: 'first' });
  page.message({ __bilismoothConfig: 'save', patch: { mode: 'bad-only' }, id: 'last' }); await flush();
  assert.equal(h.store[migration.key].mode, 'bad-only');
  assert.equal(page.posted.some(row => row.__bilismoothConfig === 'config' && row.config.mode === 'force'), false);
});
test('toolbar reuses one control tab and associates the explicitly invoked video', async () => {
  const h = extension();
  h.actionListeners[0]({ id: 1, url: 'https://www.bilibili.com/video/BVone' }); await flush();
  assert.equal(h.tabs.length, 1); assert.equal(h.tabs[0].url.endsWith('?tab=1'), true);
  h.actionListeners[0]({ id: 2, url: 'https://www.bilibili.com/video/BVtwo' }); await flush();
  assert.equal(h.tabs.length, 1); assert.equal(new URL(h.tabs[0].url).searchParams.get('tab'), '2');
  assert.equal(h.messages.at(-1).channel, 'bilismooth-control'); assert.equal(h.messages.at(-1).tabId, 2);
});
test('keyboard skip-link fragment does not create a second control space', async () => {
  const h = extension();
  h.actionListeners[0]({ id: 1, url: 'https://example.com' }); await flush();
  h.tabs[0].url += '#main';
  h.actionListeners[0]({ id: 2, url: 'https://www.bilibili.com/video/BVtwo' }); await flush();
  assert.equal(h.tabs.length, 1); assert.equal(new URL(h.tabs[0].url).searchParams.get('tab'), '2');
});

test('upgrade refreshes an old control document and preserves its selected video and section', async () => {
  const h = extension();
  h.actionListeners[0]({ id: 7, url: 'https://www.bilibili.com/video/BVone' }); await flush();
  h.tabs[0].url += '#settings'; h.setViewVersion('2.4.0');
  h.actionListeners[0]({ id: 8, url: 'https://example.com' }); await flush();
  const url = new URL(h.tabs[0].url);
  assert.equal(h.tabs.length, 1); assert.equal(url.searchParams.get('tab'), '7'); assert.equal(url.hash, '#settings');
  assert.equal(h.messages.filter(row => row.action === 'select-tab').length, 0, 'old code is navigated before any control command');
});

test('floating field customization validates values and persists with unrelated concurrent patches', async () => {
  assert.deepEqual(settings.normalize().floatingFields, ['status', 'speed', 'buffer']);
  assert.deepEqual(settings.patch({ floatingFields: ['buffer', 'unknown', 'speed', 'speed'] }).floatingFields, ['speed', 'buffer']);
  assert.deepEqual(settings.normalize({ floatingFields: [] }).floatingFields, []);
  const h = extension({ [migration.key]: settings.normalize({ theme: 'dark', selection: 'fixed' }) });
  await Promise.all([h.command('patch', { floatingFields: ['buffer'] }), h.command('patch', { lang: 'en' })]);
  assert.deepEqual(h.store[migration.key].floatingFields, ['buffer']); assert.equal(h.store[migration.key].theme, 'dark');
  assert.equal(h.store[migration.key].selection, 'fixed'); assert.equal(h.store[migration.key].lang, 'en');
});


test('legacy locate without version or visible tab URL reloads in place and retains video and section', async () => {
  const h = extension();
  h.actionListeners[0]({ id: 7, url: 'https://www.bilibili.com/video/BVone' }); await flush();
  h.tabs[0].url += '#logs'; const originalUrl = h.tabs[0].url;
  h.setViewVersion(undefined); h.hideTabUrl(true);
  h.actionListeners[0]({ id: 8, url: 'https://example.com' }); await flush();
  assert.deepEqual(h.reloads, [h.tabs[0].id]); assert.equal(h.tabs[0].url, originalUrl);
  assert.equal(h.tabUpdates.some(change => 'url' in change), false);
  assert.equal(h.messages.filter(row => row.action === 'select-tab').length, 0);
  assert.equal(h.tabs.length, 1); assert.equal(h.updates.size, 0); assert.equal(h.removals.size, 0);
});

test('legacy reload waits for the new document before selecting an explicitly invoked video', async () => {
  const h = extension();
  h.actionListeners[0]({ id: 7, url: 'https://www.bilibili.com/video/BVone' }); await flush();
  h.tabs[0].url += '#settings'; h.setViewVersion(undefined); h.hideTabUrl(true); h.autoCompleteReload(false);
  h.actionListeners[0]({ id: 9, url: 'https://www.bilibili.com/video/BVtwo' }); await flush();
  assert.deepEqual(h.reloads, [h.tabs[0].id]);
  assert.equal(h.messages.filter(row => row.action === 'select-tab').length, 0, 'no commands reach the loading legacy document');
  h.completeReload(h.tabs[0].id); await flush();
  const url = new URL(h.tabs[0].url);
  assert.equal(url.searchParams.get('tab'), '9'); assert.equal(url.hash, '#settings');
  assert.equal(h.messages.filter(row => row.action === 'select-tab').length, 1);
  assert.equal(h.tabUpdates.some(change => 'url' in change), false);
  assert.equal(h.tabs.length, 1); assert.equal(h.updates.size, 0); assert.equal(h.removals.size, 0);
});
