// Log rows in words: each recent event (src/page/event-log.js) gets a category, a title and a detail.
// Routine traffic the user cannot act on (request starts, progress, player bookkeeping) stays in the
// diagnostics export only.
import { serverName } from '../shared/format.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const SPACE = ' ';
export const FILTERS = Object.freeze({ all: null, playback: 'playback', servers: 'server', problems: 'problem' });
export const CATEGORY_KEYS = Object.freeze({ playback: 'categoryPlayback', server: 'categoryServer', problem: 'categoryProblem', system: 'categorySystem' });
const playerEvents = { playing: ['playback', 'eventPlaying'], pause: ['playback', 'eventPaused'], seeking: ['playback', 'eventSeeking'],
  waiting: ['playback', 'eventBuffering'], stalled: ['playback', 'eventBuffering'], ended: ['playback', 'ended'], error: ['problem', 'error'] };
const skipped = new Set(['request', 'progress', 'waiting-cleared', 'playinfo']);

// { category, title, detail } for one event row, or null when the row is routine.
export function describe(row, t, lang) {
  const name = host => serverName(host, lang);
  const parts = [], add = value => { if (value !== null && value !== undefined && value !== '') parts.push(value); };
  const seconds = ms => finite(ms) ? (ms / 1000).toFixed(1) + ' ' + t('seconds') : null;
  const route = () => (row.fromHost || row.toHost) && `${name(row.fromHost) || '—'} → ${name(row.toHost) || '—'}`;
  let category = 'system', title;
  switch (row?.type) {
    case 'playback-recovered': category = 'playback'; title = 'eventRecovered'; add(name(row.host)); add(seconds(row.durationMs)); break;
    case 'stall': case 'frame-stalled': category = 'problem'; title = 'eventStall'; add(name(row.host)); break;
    case 'stall-ended': category = 'playback'; title = 'eventStallEnded'; add(seconds(row.durationMs)); break;
    case 'race': category = 'server'; title = 'eventTest'; add(name(row.host)); if (finite(row.bytes)) add((row.bytes / 1e6).toFixed(1) + ' MB'); break;
    case 'switch': category = 'server'; title = 'eventSwitch'; add(route()); break;
    case 'route': category = 'server'; title = 'eventRouting'; add(route()); break;
    case 'transfer': {
      const failed = ['timeout', 'network-error', 'http-error'].includes(row.outcome);
      category = failed ? 'problem' : 'server';
      title = row.outcome === 'timeout' ? 'eventTimeout' : failed ? 'eventFailed' : ['aborted', 'cancelled'].includes(row.outcome) ? 'eventCancelled' : 'eventRequest';
      add(name(row.host)); if (finite(row.bytes) && row.bytes > 0 && !failed) add((row.bytes / 1e6).toFixed(1) + ' MB');
      if (finite(row.status) && row.status > 0 && (row.status < 200 || row.status >= 300)) add('HTTP ' + row.status);
      if (finite(row.elapsedMs)) add(t('ms', { n: Math.round(row.elapsedMs) }));
      break;
    }
    case 'synthetic-timeout':
      category = row.phase === 'disabled' ? 'problem' : 'server';
      title = row.phase === 'retried' ? 'eventRetryObserved' : row.phase === 'disabled' ? 'eventRetryDisabled' : 'eventRetry';
      add(name(row.host)); break;
    case 'network-reset': category = 'server'; title = ['manual', 'clear-data'].includes(row.reason) || !row.reason ? 'cleared' : 'eventAssessment'; break;
    case 'settings-save-failed': category = 'problem'; title = 'saveFailed'; break;
    case 'settings-read-failed': category = 'problem'; title = 'readFailed'; break;
    case 'p2p-blocked': title = 'p2p'; break;
    case 'player-event': {
      const known = playerEvents[row.source];
      if (!known) return null;
      [category, title] = known; break;
    }
    default:
      if (!row?.type || skipped.has(row.type)) return null;
      title = 'eventOther'; add(row.type);
  }
  return { category, title: t(title), detail: parts.join(SPACE) };
}

// Rows for the list, newest first, with stable ids. The page and the kernel both report some player
// events; an identical one within 250 ms is shown once. `notable` drops ordinary segment downloads.
export function rows(events, { filter = 'all', t, lang, limit = Infinity, notable = false } = {}) {
  const wanted = FILTERS[filter] ?? null, result = [];
  let previous = null;
  for (const row of Array.isArray(events) ? events : []) {
    if (row?.type === 'player-event' && previous?.type === 'player-event' && previous.source === row.source && Math.abs(row.at - previous.at) < 250) continue;
    previous = row;
    const text = describe(row, t, lang);
    if (!text || (wanted && text.category !== wanted)) continue;
    // Overview shows what changed playback: completed or cancelled downloads are left to the Log page.
    if (notable && row.type === 'transfer' && text.category !== 'problem') continue;
    result.push({ id: `${row.seq ?? ''}:${row.at}:${row.type}`, at: row.at, ...text });
  }
  return result.reverse().slice(0, limit);
}
