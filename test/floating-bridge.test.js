// Exercise both real extension bridge scripts, including the browser-supplied source tab.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const settings = require('../src/core/settings.js'), migration = require('../src/core/settings-migration.js');
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
function fixture() {
  const listeners = [], changes = [], sent = [], tabs = [], posts = [], pageEvents = [], store = { bilismoothMotion: false };
  let failOpen = false;
  const sender = { id: 'test-extension', tab: { id: 27, url: 'https://www.bilibili.com/video/BVfixture' } };
  const request = (message, source = sender) => new Promise((resolve, reject) => {
    if (!listeners.some(fn => fn(message, source, resolve) === true)) reject(Error('no-receiver'));
  });
  const chrome = {
    storage: { local: { get: async () => structuredClone(store), set: async patch => Object.assign(store, patch) }, onChanged: { addListener: fn => changes.push(fn) } },
    runtime: { id: sender.id, getURL: value => 'chrome-extension://test-extension/' + value,
      getManifest: () => ({ version: require('../package.json').version }),
      onMessage: { addListener: fn => listeners.push(fn) },
      sendMessage: async message => { sent.push(message); if (message.action === 'locate' && tabs.length) return { ok: true, tabId: tabs[0].id, version: require('../package.json').version }; if (message.action === 'select-tab') return { ok: true }; throw Error('no-control-view'); } },
    action: { onClicked: { addListener() {} } },
    tabs: { get: async id => tabs.find(tab => tab.id === id), create: async value => { if (failOpen) throw Error('cannot-open'); const tab = { ...value, id: 61, windowId: 2 }; tabs.push(tab); return tab; }, update: async (id, patch) => Object.assign(tabs.find(tab => tab.id === id), patch) },
    windows: { update: async () => {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/extension/background.js'), 'utf8'), { chrome, importScripts() {}, BiliSmoothSettings: settings, BiliSmoothSettingsMigration: migration, URL });
  const pageChrome = { ...chrome, runtime: { ...chrome.runtime, onMessage: { addListener() {} }, sendMessage: message => request(message) } };
  const page = { chrome: pageChrome, location: { origin: 'https://www.bilibili.com' }, setTimeout, clearTimeout, crypto,
    postMessage: message => posts.push(message), addEventListener: (name, fn) => { if (name === 'message') pageEvents.push(fn); } };
  page.window = page; page.events = pageEvents;
  const context = vm.createContext(page);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/extension/content.js'), 'utf8'), context);
  const message = value => { context.input = value; vm.runInContext('events.forEach(fn=>fn({source:window,origin:location.origin,data:input}))', context); };
  return { message, posts, tabs, sent, sender, request, store, changes, failOpen: value => { failOpen = value; } };
}
test('floating entry opens one dashboard associated with sender tab and acknowledges real failures', async () => {
  const f = fixture(); await settle();
  f.message({ __bilismoothFloating: 'open-control', id: 'first', tabId: 999 }); await settle();
  assert.equal(f.tabs.length, 1); assert.match(f.tabs[0].url, /\?tab=27$/);
  assert.equal(f.posts.find(row => row.id === 'first').ok, true);
  f.sender.tab.id = 28; f.message({ __bilismoothFloating: 'open-control', id: 'second' }); await settle();
  assert.equal(f.tabs.length, 1); assert.equal(f.sent.find(row => row.action === 'select-tab').tabId, 28);
  assert.equal(f.posts.find(row => row.id === 'second').ok, true);
  const failing = fixture(); failing.failOpen(true);
  failing.message({ __bilismoothFloating: 'open-control', id: 'failure' }); await settle();
  assert.equal(failing.posts.find(row => row.id === 'failure').ok, false); assert.equal(failing.tabs.length, 0);
});
test('floating motion uses the existing preference and rejected senders cannot invoke its bridge', async () => {
  const f = fixture(); f.message({ __bilismoothFloating: 'ready' }); await settle();
  assert.equal(f.posts.find(row => row.__bilismoothFloating === 'motion').value, false);
  f.store.bilismoothMotion = true; for (const listener of f.changes) listener({ bilismoothMotion: { newValue: true } }, 'local'); await settle();
  assert.equal(f.posts.filter(row => row.__bilismoothFloating === 'motion').at(-1).value, true);
  await assert.rejects(f.request({ channel: 'bilismooth-control', action: 'open' }, { id: 'foreign', tab: f.sender.tab }));
  await assert.rejects(f.request({ channel: 'bilismooth-control', action: 'open' }, { id: f.sender.id, tab: { id: 1, url: 'https://example.com/' } }));
  assert.equal(f.tabs.length, 0);
});
