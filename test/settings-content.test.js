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
  let failWrite = false, failRead = false, failOpen = false, viewVersion = require('../package.json').version;
  const sender = { id: 'test-extension', tab: { id: 27, url: 'https://www.bilibili.com/video/BVfixture' } };
  const storage = { get: async () => { if (failRead) throw Error('read denied'); return structuredClone(store); }, set: async data => {
    if (failWrite) throw Error('disk full');
    const diff = {};
    for (const [key, value] of Object.entries(data)) {
      if (JSON.stringify(store[key]) !== JSON.stringify(value)) diff[key] = { oldValue: store[key], newValue: value };
      store[key] = structuredClone(value);
    }
    writes.push(data); for (const fn of changes) fn(diff, 'local');
  } };
  const request = (message, source = { id: sender.id }) => new Promise((resolve, reject) => {
    messages.push(message); let accepted = false;
    if (message.channel === 'bilismooth-control' && message.action === 'locate' && tabs.length) { resolve({ ok: true, tabId: tabs[0].id, version: viewVersion }); return; }
    if (message.channel === 'bilismooth-control' && message.action === 'select-tab' && viewVersion === require('../package.json').version && tabs.length) { const url = new URL(tabs[0].url); url.searchParams.set('tab', String(message.tabId)); tabs[0].url = url.href; resolve({ ok: true }); return; }
    for (const fn of listeners) if (fn(message, source, resolve)) accepted = true;
    if (!accepted) reject(Error('no receiver'));
  });
  const chrome = { storage: { local: storage, onChanged: { addListener: fn => changes.push(fn) } },
    runtime: { id: 'test-extension', getURL: file => 'chrome-extension://test-extension/' + file,
      getManifest: () => ({ version: require('../package.json').version }),
      onMessage: { addListener: fn => listeners.push(fn) }, sendMessage: request }, action: { onClicked: { addListener: fn => actionListeners.push(fn) } },
    tabs: { onUpdated: { addListener: fn => updates.add(fn), removeListener: fn => updates.delete(fn) }, onRemoved: { addListener: fn => removals.add(fn), removeListener: fn => removals.delete(fn) },
      reload: async id => { reloads.push(id); for (const fn of [...updates]) fn(id, { status: 'loading' }); if (autoCompleteReload) Promise.resolve().then(() => completeReload(id)); },
      query: async () => tabs, get: async id => { const tab = { ...tabs.find(tab => tab.id === id) }; if (omitTabUrl) delete tab.url; return tab; }, create: async tab => { if (failOpen) throw Error('cannot-open'); tabs.push({ ...tab, id: tabs.length + 10, windowId: 1 }); },
      update: async (id, change) => { tabUpdates.push({ id, ...change }); return Object.assign(tabs.find(tab => tab.id === id), change); } },
    windows: { update: async () => {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/extension/background.js'), 'utf8'), {
    chrome, importScripts() {}, BiliSmoothSettings: settings, BiliSmoothSettingsMigration: migration, URL, setTimeout, clearTimeout
  });
  function content({ unreachable = false } = {}) {
    const posted = [], events = [], runtime = [], sent = [];
    const sendMessage = unreachable ? async message => { sent.push(message); throw Error('Could not establish connection. Receiving end does not exist.'); } : message => request(message, sender);
    const pageChrome = { ...chrome, runtime: { ...chrome.runtime, sendMessage, onMessage: { addListener: fn => runtime.push(fn) } } };
    const scope = { chrome: pageChrome, location: { origin: 'https://www.bilibili.com' }, crypto, clearTimeout,
      setTimeout: unreachable ? fn => Promise.resolve().then(fn) : setTimeout, BiliSmoothSettings: settings, BiliSmoothSettingsMigration: migration,
      postMessage: message => posted.push(message), addEventListener: (type, fn) => { if (type === 'message') events.push(fn); } };
    scope.window = scope;
    const context = vm.createContext(scope);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/extension/content.js'), 'utf8'), context);
    function message(data) { context.input = data; context.events = events; vm.runInContext('events.forEach(fn=>fn({source:window,origin:location.origin,data:input}))', context); }
    return { posted, message, runtime, sent };
  }
  const command = (action, patch) => chrome.runtime.sendMessage({ channel: 'bilismooth-settings', action, patch });
  return { store, writes, messages, content, command, tabs, actionListeners, reloads, tabUpdates, updates, removals, completeReload, sender, request, changes,
    hideTabUrl(value) { omitTabUrl = value; }, autoCompleteReload(value) { autoCompleteReload = value; },
    setViewVersion(value) { viewVersion = value; },
    failWrite(value) { failWrite = value; }, failRead(value) { failRead = value; }, failOpen(value) { failOpen = value; } };
}
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

test('saved Akamai fixed routes migrate to automatic selection and cannot be selected again', async () => {
  for (const [key, host] of [[migration.key, 'upos-hz-mirrorakam.akamaized.net'], ['prior.preferences', 'upos-sz-mirrorakam.akamaized.net']]) {
    const saved = { enabled: true, selection: 'fixed', pcdnHost: host, lang: 'en' };
    const h = extension({ [key]: saved }), { result } = await h.command('read');
    assert.equal(result.selection, 'auto'); assert.equal(result.pcdnHost, settings.defaults.pcdnHost);
    assert.equal(result.lang, 'en'); assert.equal(h.store[migration.key].selection, 'auto');
    assert.equal(settings.normalize(saved).selection, 'auto');
    assert.equal(settings.isCdnHost(host), false); assert.equal(settings.patch({ pcdnHost: host }).pcdnHost, undefined);
    assert.equal(settings.fixedHosts.includes(host), false);
  }
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
test('early unchanged save still completes the authoritative startup handshake', async () => {
  const saved = settings.normalize({ enabled: false, selection: 'fixed', pcdnHost: settings.candidatePool[2], lang: 'en' });
  const h = extension({ [migration.key]: saved }), page = h.content();
  page.message({ __bilismoothConfig: 'save', patch: { accent: saved.accent }, id: 'unchanged' });
  await flush();
  assert.equal(page.posted.find(row => row.id === 'unchanged').ok, true);
  assert.deepEqual(page.posted.find(row => row.__bilismoothConfig === 'config')?.config, saved,
    'an unchanged write emits no storage event, but the page still needs its disabled/fixed preferences');
});
test('ordinary save failure is acknowledged; later retry can succeed', async () => {
  const h = extension({ [migration.key]: settings.normalize() }), page = h.content(); await flush(); h.failWrite(true);
  page.message({ __bilismoothConfig: 'save', patch: { mode: 'force' }, id: 'failed' }); await flush();
  assert.equal(page.posted.find(row => row.id === 'failed').ok, false); assert.equal(h.store[migration.key].mode, 'bad-only');
  h.failWrite(false); page.message({ __bilismoothConfig: 'save', patch: { mode: 'force' }, id: 'retry' }); await flush();
  assert.equal(page.posted.find(row => row.id === 'retry').ok, true); assert.equal(h.store[migration.key].mode, 'force');
});
test('an unreachable background keeps saved settings usable and reports why the dashboard cannot open', async () => {
  const h = extension({ [migration.key]: settings.normalize({ lang: 'en' }) }), page = h.content({ unreachable: true }); await flush();
  assert.equal(page.posted.find(row => row.__bilismoothConfig === 'config')?.config.lang, 'en');
  page.message({ __bilismoothConfig: 'save', patch: { theme: 'dark' }, id: 'direct' }); await flush();
  assert.equal(page.posted.find(row => row.id === 'direct').ok, true);
  assert.equal(h.store[migration.key].theme, 'dark'); assert.equal(h.store[migration.key].lang, 'en');
  page.message({ __bilismoothFloating: 'open-control', id: 'open' }); await flush();
  const opened = page.posted.find(row => row.id === 'open');
  assert.deepEqual([opened.ok, opened.error], [false, 'background-unreachable']);
  assert.equal(page.sent.filter(row => row.action === 'open').length, 3, 'a starting worker gets bounded retries');
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
test('floating entry opens one dashboard associated with sender tab and acknowledges real failures', async () => {
  const h = extension({ bilismoothMotion: false }), page = h.content(); await flush();
  page.message({ __bilismoothFloating: 'open-control', id: 'first', tabId: 999 }); await flush();
  assert.equal(h.tabs.length, 1); assert.match(h.tabs[0].url, /\?tab=27$/);
  assert.equal(page.posted.find(row => row.id === 'first').ok, true);
  h.sender.tab.id = 28; page.message({ __bilismoothFloating: 'open-control', id: 'second' }); await flush();
  assert.equal(h.tabs.length, 1); assert.equal(h.messages.find(row => row.action === 'select-tab').tabId, 28);
  assert.equal(page.posted.find(row => row.id === 'second').ok, true);
  const failing = extension({ bilismoothMotion: false }), failedPage = failing.content(); failing.failOpen(true);
  failedPage.message({ __bilismoothFloating: 'open-control', id: 'failure' }); await flush();
  assert.equal(failedPage.posted.find(row => row.id === 'failure').ok, false); assert.equal(failing.tabs.length, 0);
});
test('floating motion uses the existing preference and rejected senders cannot invoke its bridge', async () => {
  const h = extension({ bilismoothMotion: false }), page = h.content(); page.message({ __bilismoothFloating: 'ready' }); await flush();
  assert.equal(page.posted.find(row => row.__bilismoothFloating === 'motion').value, false);
  h.store.bilismoothMotion = true; for (const listener of h.changes) listener({ bilismoothMotion: { newValue: true } }, 'local'); await flush();
  assert.equal(page.posted.filter(row => row.__bilismoothFloating === 'motion').at(-1).value, true);
  await assert.rejects(h.request({ channel: 'bilismooth-control', action: 'open' }, { id: 'foreign', tab: h.sender.tab }));
  await assert.rejects(h.request({ channel: 'bilismooth-control', action: 'open' }, { id: h.sender.id, tab: { id: 1, url: 'https://example.com/' } }));
  assert.equal(h.tabs.length, 0);
});
