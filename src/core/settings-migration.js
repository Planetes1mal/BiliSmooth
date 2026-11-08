// Import prior local preferences by their data contract, never by product-name
// aliases. The current v4 record always wins; imported records remain intact.
import settings from './settings.js';

export const key = 'bilismooth.config.v4';
const backupKey = 'bilismooth.config.import.v4', themeKey = 'bilismoothTheme';
function isPreferences(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    typeof value.enabled === 'boolean' && typeof value.pcdnHost === 'string' &&
    (['auto','fixed'].includes(value.selection) || ['bad-only','force','off'].includes(value.mode));
}
// Teal was the default accent before schema 5, so every record from then holds it whether chosen or not. Blue
// replaces it once, on the first read; the rewritten record carries schema 5, so a later choice of teal stays.
function upgrade(stored, config) {
  if (!(stored?.schemaVersion >= settings.defaults.schemaVersion) && config.accent === 'teal') config.accent = 'blue';
  return config;
}
export async function read(storage) {
  const current = await storage.get(key);
  if (current[key] && typeof current[key] === 'object') {
    const stored = current[key], config = upgrade(stored, settings.normalize(stored));
    const outdated = !(stored.schemaVersion >= settings.defaults.schemaVersion);
    if (outdated || (stored.selection === 'fixed' && config.selection === 'auto')) await storage.set({ [key]: config });
    return config;
  }
  const data = await storage.get(null);
  const candidates = Object.entries(data).filter(([name,value]) => name !== key && isPreferences(value));
  const groups = new Set(candidates.map(([,value]) => JSON.stringify(settings.normalize(value))));
  if (groups.size > 1) throw new Error('Multiple distinct preference records require explicit selection');
  const imported = candidates[0];
  const config = upgrade(imported?.[1], settings.normalize({ ...imported?.[1],
    ...(['system', 'light', 'dark'].includes(data[themeKey]) ? { theme: data[themeKey] } : {}) }));
  const values = { [key]: config };
  if (imported && !data[backupKey]) values[backupKey] = {
    savedAt: new Date().toISOString(), sourceKey: imported[0], version: imported[1].schemaVersion || 'unversioned', config: imported[1]
  };
  await storage.set(values);
  return config;
}
export async function write(storage, config) {
  const normalized = settings.normalize(config);
  await storage.set({ [key]: normalized });
  return normalized;
}
const migration = Object.freeze({ key, read, write });
export default migration;
