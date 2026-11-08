// Regional challenger history in localStorage, keyed by time zone and language.
// Removes the keys of retired ranking and feedback formats once at startup.
import { createHistory } from '../core/playback-feedback.js';

const RANK_PREFIX = 'bilismooth.routing.rank.v4.', FEEDBACK_PREFIX = 'biliSmooth.playback-feedback.v1.';
export const HISTORY_PREFIX = 'bilismooth.delivery-history.v1.';

export function createHistoryStore({ root, json, wallNow }) {
  const parse = text => Reflect.apply(json.parse, json, [text]), stringify = value => Reflect.apply(json.stringify, json, [value]);
  function regionKey() {
    try { return (root.Intl || Intl).DateTimeFormat().resolvedOptions().timeZone + '|' + (root.navigator?.language || ''); } catch { return 'unknown'; }
  }
  const key = () => HISTORY_PREFIX + regionKey();
  function migrateLegacy() {
    try {
      const storage = root.localStorage;
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const name of keys) {
        if (name.startsWith(RANK_PREFIX)) { storage.removeItem(name); continue; }
        if (!name.startsWith(FEEDBACK_PREFIX)) continue;
        const nextKey = HISTORY_PREFIX + name.slice(FEEDBACK_PREFIX.length);
        const oldText = storage.getItem(name), nextText = storage.getItem(nextKey);
        let legacy, initial;
        try { legacy = parse(oldText); } catch {}
        try { initial = parse(nextText); } catch {}
        const migrated = createHistory({ now: wallNow, initial });
        if (migrated.importFailures(legacy)) storage.setItem(nextKey, stringify(migrated.snapshot()));
        storage.removeItem(name);
      }
    } catch { /* A failed write retains its old key; the next page start retries migration. */ }
  }
  migrateLegacy();
  let saved; try { saved = parse(root.localStorage?.getItem(key()) || 'null'); } catch {}
  const history = createHistory({ now: wallNow, random: root.Math?.random, initial: saved });
  function save() { try { root.localStorage?.setItem(key(), stringify(history.snapshot())); } catch {} }
  return { history, save, key };
}
