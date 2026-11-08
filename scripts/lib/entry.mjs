import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `import.meta.url` is the real path; argv[1] may reach the script through a symlinked
// folder such as macOS's /var → /private/var, so compare real paths.
export function isMain(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  let resolved = path.resolve(entry);
  try { resolved = realpathSync(resolved); } catch {}
  return resolved === fileURLToPath(moduleUrl);
}

// For an entry point stored directly in scripts/.
export const repositoryRoot = moduleUrl => path.resolve(fileURLToPath(new URL('..', moduleUrl)));

export function option(args, name, fallback = null) {
  const prefix = `--${name}=`, found = args.find(value => value.startsWith(prefix));
  return found === undefined ? fallback : found.slice(prefix.length);
}
