import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateMessage } from './check-commit-message.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
function git(args, accepted = [0]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (!accepted.includes(result.status)) throw Error((result.stderr || result.stdout).trim() || `Git exited ${result.status}`);
  return result;
}
function scopedPath(value) {
  const relative = path.relative(root, path.resolve(root, value));
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || relative.split(path.sep)[0].toLowerCase() === '.git')
    throw Error(`Use explicit files or subdirectories inside the repository: ${value}`);
  return relative.split(path.sep).join('/');
}
function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('node scripts/commit.mjs --message-file <file> -- <explicit repository-relative paths>'); return;
  }
  if (args[0] !== '--message-file' || !args[1] || args[2] !== '--' || args.length < 4)
    throw Error('Use --message-file <file> -- <explicit repository-relative paths>');
  const messageFile = path.resolve(args[1]), errors = validateMessage(readFileSync(messageFile, 'utf8'));
  if (errors.length) throw Error(errors.join('\n'));
  const actualRoot = path.resolve(git(['rev-parse', '--show-toplevel']).stdout.trim());
  const sameRoot = process.platform === 'win32' ? actualRoot.toLowerCase() === root.toLowerCase() : actualRoot === root;
  if (!sameRoot) throw Error('The helper must be stored in this repository\'s scripts directory');
  const paths = [...new Set(args.slice(3).map(scopedPath))];
  const staged = git(['diff', '--cached', '--name-only', '--no-renames', '-z']).stdout.split('\0').filter(Boolean);
  const unrelated = staged.filter(file => !paths.some(scope => file === scope || file.startsWith(scope + '/')));
  if (unrelated.length) throw Error(`Unrelated staged paths were left untouched:\n${unrelated.join('\n')}\nInclude them explicitly only if authorized, or manage the index before retrying.`);
  git(['--literal-pathspecs', 'add', '--', ...paths]);
  git(['diff', '--cached', '--check']);
  if (git(['diff', '--cached', '--quiet'], [0, 1]).status === 0) throw Error('No staged changes in the requested scope');
  const result = git(['commit', '--no-signoff', '--cleanup=verbatim', '--file', messageFile]);
  const hash = git(['rev-parse', 'HEAD']).stdout.trim();
  const recordedErrors = validateMessage(git(['show', '-s', '--format=%B', 'HEAD']).stdout);
  if (recordedErrors.length) throw Error(`Created commit ${hash} violates the message policy after hooks:\n${recordedErrors.join('\n')}\nThe commit exists and was not rewritten. Correct it before publishing.`);
  console.log(result.stdout.trim());
  console.log(`Verified recorded message: ${hash}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
