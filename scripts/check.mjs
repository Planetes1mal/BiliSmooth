// One entry point for every browser, CDN and benchmark check: node scripts/check.mjs <suite> [args].
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isMain } from './lib/entry.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const suites = {
  playback: { file: 'playback.cjs', summary: 'Real site: one video, startup and refresh; --compare adds a disabled arm; --auth uses the dev browser login' },
  compare: { file: 'playback.cjs', args: ['--compare'], summary: 'Alias for playback --compare' },
  '4k': { file: 'playback.cjs', args: ['--auth', '--quality=4k', '--headed'], summary: 'Alias for playback --auth --quality=4k --headed' },
  cdn: { file: 'cdn.cjs', summary: 'One signed media resource fetched on candidate hosts: CORS, Range body, hash, throughput' },
  recovery: { file: 'startup-recovery.cjs', summary: 'Local fixture: native XHR timeout mid-body, retry on the backup, MSE frames (needs Python cryptography)' },
  lifecycle: { file: 'request-lifecycle.cjs', summary: 'Local fixture: part change, quality change, player replacement, background tab' },
  control: { file: 'extension-control.cjs', summary: 'Local fixture: floating control and dashboard stay in sync through the extension' },
  ui: { file: 'control-ui.cjs', summary: 'Local fixture: dashboard layout at 900 px, control names, focus, no outside requests' },
  theme: { file: 'theme-readability.cjs', summary: 'Local fixture: floating control text contrast across themes, accents, states and phases' },
  viewport: { file: 'floating-viewport.cjs', summary: 'Local fixture: floating control placement against scrollbars and zoom' },
  surface: { file: 'real-surface.cjs', summary: 'Real site, anonymous: floating control coexistence with the page' },
  xhr: { file: 'xhr-order.cjs', summary: 'Local server: native XHR event ordering through the request interceptor' },
  benchmark: { file: 'benchmark.cjs', summary: 'Real site, signed in: native vs baseline vs current build over a verified sample set' },
  fixture: { file: 'media-fixture.cjs', summary: 'Generates the local VP8/Opus media fixture used by recovery' }
};

function usage() {
  const width = Math.max(...Object.keys(suites).map(name => name.length));
  return ['node scripts/check.mjs <suite> [--label=<label>] [suite options]', '',
    ...Object.entries(suites).map(([name, suite]) => `  ${name.padEnd(width)}  ${suite.summary}`), '',
    'Reports land in local/runs/<suite>/<label>/; an unlabeled run is named by its start time.'].join('\n');
}

export function run(argv) {
  const [name, ...rest] = argv;
  if (!name || name === '--help') { console.log(usage()); return Promise.resolve(name ? 0 : 1); }
  const suite = suites[name];
  if (!suite) { console.error(`Unknown check "${name}".\n\n${usage()}`); return Promise.resolve(1); }
  const child = spawn(process.execPath, [path.join(here, 'checks', suite.file), ...(suite.args || []), ...rest], { stdio: 'inherit' });
  return new Promise(resolve => child.on('close', code => resolve(code ?? 1)));
}

if (isMain(import.meta.url)) run(process.argv.slice(2)).then(code => { process.exitCode = code; });
