// Commit helper and message validator shared by the hook, npm run commit and CI.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isMain, repositoryRoot } from './lib/entry.mjs';

const root = repositoryRoot(import.meta.url);
const titlePattern = /^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([a-z0-9][a-z0-9._/-]*\))?!?: ([A-Za-z][\x20-\x7e]*)$/;
const byline = /^(?:(?:co[-\s]?)?author(?:ed)?|signed[-\s]?off|reviewed|assisted|generated|created|written|tested|acked|approved|suggested|helped|contributed|implemented|developed|committed)[-\s]?by\b/i;
const credit = /^(?:authors?|co[-\s]?authors?|contributors?|reviewers?|assistant|signature|credits?|ai[-\s]?assistance)\s*:/i;
const generation = /\b(?:generated|created|written|authored|assisted|built|made|developed|implemented)\s+(?:with|by|using)\s+/i;

// A commit message is exactly one line: type(scope): subject. No body, trailer or signature.
// Commits recorded before this rule keep their bodies; the release range check passes allowBody.
export function validateMessage(message, { allowBody = false } = {}) {
  const lines = String(message).replace(/\r\n/g, '\n').split('\n'), title = lines[0], errors = [];
  const match = titlePattern.exec(title);
  if (!match || title.trim() !== title) errors.push('Use an English Conventional Commit title: type(scope): concrete description');
  else if ((match[1].match(/[A-Za-z0-9]+/g) || []).length < 2) errors.push('Describe both the change and its subject in the title');
  if (title.length > 72) errors.push('Keep the title within 72 characters');
  if (!allowBody && lines.slice(1).some(line => line.trim())) errors.push('A commit message is exactly one line; remove the body or trailer');
  if (allowBody && lines.length > 1 && lines[1].trim()) errors.push('Separate the title and body with a blank line');
  const stripped = title.replace(/^[\s>*#`_~\[\]\-\p{Extended_Pictographic}️]+/u, '');
  if (byline.test(stripped) || credit.test(stripped) || generation.test(stripped) || /^thanks\s+to\b/i.test(stripped))
    errors.push('Remove attribution or signature text from the title');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/^[\s>*#`_~\[\]\-\p{Extended_Pictographic}️]+/u, '');
    if (byline.test(line) || credit.test(line) || generation.test(line) || /^thanks\s+to\b/i.test(line))
      errors.push(`Remove attribution or signature text on line ${i + 1}`);
  }
  return errors;
}

function git(args, accepted = [0]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (!accepted.includes(result.status)) throw Error((result.stderr || result.stdout).trim() || `Git exited ${result.status}`);
  return result;
}

function check(input) {
  const allowBody = input.includes('--allow-body'), args = input.filter(value => value !== '--allow-body'), checks = [];
  if (args.length === 2 && args[0] === '--file') checks.push([args[1], readFileSync(args[1], 'utf8')]);
  else if (args.length === 1 && args[0].startsWith('--file=')) checks.push([args[0].slice(7), readFileSync(args[0].slice(7), 'utf8')]);
  else if (args.length === 1 && args[0].startsWith('--range=') && args[0].length > 8) {
    // Inspect every commit, including merges and reverts; titles have no author/tool exemptions.
    const hashes = git(['rev-list', '--reverse', '--end-of-options', args[0].slice(8)]).stdout.trim().split('\n').filter(Boolean);
    for (const hash of hashes) checks.push([hash, git(['show', '-s', '--format=%B', hash]).stdout]);
  } else throw Error('Use check --file <message-file> or check --range=<git-range>');
  const errors = checks.flatMap(([label, message]) => validateMessage(message, { allowBody }).map(error => `${label}: ${error}`));
  if (errors.length) throw Error(errors.join('\n'));
  console.log(`Validated ${checks.length} commit message(s).`);
}

function scopedPath(value) {
  const relative = path.relative(root, path.resolve(root, value));
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || relative.split(path.sep)[0].toLowerCase() === '.git')
    throw Error(`Use explicit files or subdirectories inside the repository: ${value}`);
  return relative.split(path.sep).join('/');
}

const listed = (args, paths) => git([...args, '-z', '--', ...paths]).stdout.split('\0').filter(Boolean);

function commit(args) {
  if (args[0] !== '--message-file' || !args[1] || args[2] !== '--' || args.length < 4)
    throw Error('Use --message-file <file> -- <explicit repository-relative paths>');
  const messageFile = path.resolve(args[1]), errors = validateMessage(readFileSync(messageFile, 'utf8'));
  if (errors.length) throw Error(errors.join('\n'));
  const actualRoot = path.resolve(git(['rev-parse', '--show-toplevel']).stdout.trim());
  const sameRoot = process.platform === 'win32' ? actualRoot.toLowerCase() === root.toLowerCase() : actualRoot === root;
  if (!sameRoot) throw Error('The helper must be stored in this repository\'s scripts directory');
  const paths = [...new Set(args.slice(3).map(scopedPath))];
  const staged = listed(['diff', '--cached', '--name-only', '--no-renames'], []);
  const unrelated = staged.filter(file => !paths.some(scope => file === scope || file.startsWith(scope + '/')));
  if (unrelated.length) throw Error(`Unrelated staged paths were left untouched:\n${unrelated.join('\n')}\nInclude them explicitly only if authorized, or manage the index before retrying.`);
  // A path may exist in the worktree, only in the index (an unstaged deletion) or only as an
  // already staged deletion. Stage what git knows about and reject typos that match nothing.
  const present = new Set(listed(['ls-files', '--cached', '--others', '--exclude-standard'], paths));
  const stagedDeletions = new Set(listed(['diff', '--cached', '--name-only', '--no-renames'], paths));
  const covers = (set, scope) => [...set].some(file => file === scope || file.startsWith(scope + '/'));
  const unknown = paths.filter(scope => !covers(present, scope) && !covers(stagedDeletions, scope));
  if (unknown.length) throw Error(`No tracked, untracked or staged content matches:\n${unknown.join('\n')}`);
  const addable = paths.filter(scope => covers(present, scope));
  if (addable.length) git(['--literal-pathspecs', 'add', '--all', '--', ...addable]);
  git(['diff', '--cached', '--check']);
  if (git(['diff', '--cached', '--quiet'], [0, 1]).status === 0) throw Error('No staged changes in the requested scope');
  const result = git(['commit', '--no-signoff', '--cleanup=verbatim', '--file', messageFile]);
  const hash = git(['rev-parse', 'HEAD']).stdout.trim();
  const recordedErrors = validateMessage(git(['show', '-s', '--format=%B', 'HEAD']).stdout);
  if (recordedErrors.length) throw Error(`Created commit ${hash} violates the message policy after hooks:\n${recordedErrors.join('\n')}\nThe commit exists and was not rewritten. Correct it before publishing.`);
  console.log(result.stdout.trim());
  console.log(`Verified recorded message: ${hash}`);
}

function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('node scripts/commit.mjs --message-file <file> -- <explicit repository-relative paths>');
    console.log('node scripts/commit.mjs check --file <message-file> | check --range=<git-range> [--allow-body]'); return;
  }
  if (args[0] === 'check') return check(args.slice(1));
  return commit(args);
}

if (isMain(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
