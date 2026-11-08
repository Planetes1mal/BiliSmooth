// Store media made from the real UI: node scripts/store.mjs <artwork|capture|demo> [args].
// Listing text, privacy fields and the upload tool live in local/store/ (see the store-assets skill).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isMain } from './lib/entry.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const commands = {
  artwork: { file: 'artwork.cjs', summary: 'Extension PNG icons from src/ui/icon.svg, then the store icon and promo tiles into local/store/listing/global/' },
  capture: { file: 'capture.cjs', summary: 'Store screenshots from the built extension on the local demo page: --locale=en | --locale=zh-CN' },
  demo: { file: 'demo.cjs', summary: 'README demo video preview into local/store/readme-demo/ (--locale=en for English)' }
};

function usage() {
  return ['node scripts/store.mjs <command> [options]', '',
    ...Object.entries(commands).map(([name, command]) => `  ${name.padEnd(8)}  ${command.summary}`)].join('\n');
}

export function run(argv) {
  const [name, ...rest] = argv;
  if (!name || name === '--help') { console.log(usage()); return Promise.resolve(name ? 0 : 1); }
  const command = commands[name];
  if (!command) { console.error(`Unknown store command "${name}".\n\n${usage()}`); return Promise.resolve(1); }
  const child = spawn(process.execPath, [path.join(here, 'store', command.file), ...rest], { stdio: 'inherit' });
  return new Promise(resolve => child.on('close', code => resolve(code ?? 1)));
}

if (isMain(import.meta.url)) run(process.argv.slice(2)).then(code => { process.exitCode = code; });
