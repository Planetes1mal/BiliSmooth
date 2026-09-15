'use strict';

// The suite exercises production sources. It does not load the design prototype.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { runLabel } = require('./validation-support.cjs');
const label = runLabel();
const args = process.argv.slice(2).filter(value => !value.startsWith('--label='));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...args, 'test/design-adoption.test.js'], {
  cwd: path.resolve(__dirname, '..'), env: { ...process.env, ...(label ? { BILISMOOTH_RUN_LABEL: label } : {}) }, stdio: 'inherit'
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
