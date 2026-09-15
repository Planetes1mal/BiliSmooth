/* Import prior local preferences by their data contract, never by product-name
 * aliases. The current v4 record always wins; imported records remain intact.
 */
(function (scope) {
  'use strict';
  const settings = scope.BiliSmoothSettings || (typeof require === 'function' ? require('./settings.js') : null);
  const key = 'bilismooth.config.v4', backupKey = 'bilismooth.config.import.v4', themeKey = 'bilismoothTheme';
  function isPreferences(value) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      typeof value.enabled === 'boolean' && typeof value.pcdnHost === 'string' &&
      (['auto','fixed'].includes(value.selection) || ['bad-only','force','off'].includes(value.mode));
  }
  async function read(storage) {
    const current = await storage.get(key);
    if (current[key] && typeof current[key] === 'object') return settings.normalize(current[key]);
    const data = await storage.get(null);
    const candidates = Object.entries(data).filter(([name,value]) => name !== key && isPreferences(value));
    const groups = new Set(candidates.map(([,value]) => JSON.stringify(settings.normalize(value))));
    if (groups.size > 1) throw new Error('Multiple distinct preference records require explicit selection');
    const imported = candidates[0];
    const config = settings.normalize({ ...imported?.[1],
      ...(['system', 'light', 'dark'].includes(data[themeKey]) ? { theme: data[themeKey] } : {}) });
    const values = { [key]: config };
    if (imported && !data[backupKey]) values[backupKey] = {
      savedAt: new Date().toISOString(), sourceKey: imported[0], version: imported[1].schemaVersion || 'unversioned', config: imported[1]
    };
    await storage.set(values);
    return config;
  }
  async function write(storage, config) {
    const normalized = settings.normalize(config);
    await storage.set({ [key]: normalized });
    return normalized;
  }
  const api = Object.freeze({ key, read, write });
  scope.BiliSmoothSettingsMigration = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
