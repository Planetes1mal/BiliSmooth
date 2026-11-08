'use strict';
// The ignored local/ folder is the only place scripts write to. Layout:
//   local/build/               packaged ZIP, SHA256SUMS.txt, release notes, file lists
//   local/runs/<suite>/<label> check and benchmark evidence
//   local/tmp/                 build backups, release worktrees, browser profiles, capture scratch
//   local/tools/               Python venv, baseline builds, generated media fixtures
//   local/store/               store listing sources and the upload tool
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const LOCAL = path.join(ROOT, 'local');
const layout = Object.freeze({
  root: ROOT,
  local: LOCAL,
  build: path.join(LOCAL, 'build'),
  runs: path.join(LOCAL, 'runs'),
  tmp: path.join(LOCAL, 'tmp'),
  tools: path.join(LOCAL, 'tools'),
  store: path.join(LOCAL, 'store')
});

// Repository-relative spelling for reports and messages.
const relative = file => path.relative(ROOT, file).split(path.sep).join('/');

module.exports = { ...layout, relative };
