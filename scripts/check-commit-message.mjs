import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const titlePattern = /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([a-z0-9][a-z0-9._/-]*\))?!?: ([A-Za-z][\x20-\x7e]*)$/;
const byline = /^(?:(?:co[-\s]?)?author(?:ed)?|signed[-\s]?off|reviewed|assisted|generated|created|written|tested|acked|approved|suggested|helped|contributed|implemented|developed|committed)[-\s]?by\b/i;
const credit = /^(?:authors?|co[-\s]?authors?|contributors?|reviewers?|assistant|signature|credits?|ai[-\s]?assistance)\s*:/i;
const generation = /\b(?:generated|created|written|authored|assisted|built|made|developed|implemented)\s+(?:with|by|using)\s+/i;

export function validateMessage(message) {
  const lines = String(message).replace(/\r\n/g, '\n').split('\n'), title = lines[0], errors = [];
  const match = titlePattern.exec(title);
  if (!match || title.trim() !== title) errors.push('Use an English Conventional Commit title: type(scope): concrete description');
  else if ((match[1].match(/[A-Za-z0-9]+/g) || []).length < 2) errors.push('Describe both the change and its subject in the title');
  if (title.length > 72) errors.push('Keep the title within 72 characters');
  if (lines.length > 1 && lines[1].trim()) errors.push('Separate the title and body with a blank line');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^[\s>*#`_~\[\]\-\p{Extended_Pictographic}\uFE0F]+/u, '');
    if (byline.test(line) || credit.test(line) || generation.test(line) || /^thanks\s+to\b/i.test(line))
      errors.push(`Remove attribution or signature text on line ${i + 1}`);
  }
  return errors;
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr.trim() || 'Git message lookup failed');
  return result.stdout;
}

function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('node scripts/check-commit-message.mjs --file <message-file> | --range=<git-range>'); return;
  }
  const checks = [];
  if (args.length === 2 && args[0] === '--file') checks.push([args[1], readFileSync(args[1], 'utf8')]);
  else if (args.length === 1 && args[0].startsWith('--file=')) checks.push([args[0].slice(7), readFileSync(args[0].slice(7), 'utf8')]);
  else if (args.length === 1 && args[0].startsWith('--range=') && args[0].length > 8) {
    // Inspect every commit, including merges and reverts; titles have no author/tool exemptions.
    const hashes = git(['rev-list', '--reverse', '--end-of-options', args[0].slice(8)]).trim().split('\n').filter(Boolean);
    for (const hash of hashes) checks.push([hash, git(['show', '-s', '--format=%B', hash])]);
  } else throw Error('Use --file <message-file> or --range=<git-range>');
  const errors = checks.flatMap(([label, message]) => validateMessage(message).map(error => `${label}: ${error}`));
  if (errors.length) throw Error(errors.join('\n'));
  console.log(`Validated ${checks.length} commit message(s).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
