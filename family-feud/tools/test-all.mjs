#!/usr/bin/env node
// Runs every headless check. Browser tests live outside the repo; this is the
// gate to run before committing anything in family-feud/.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suites = ['validate-surveys.mjs', 'test-match.mjs', 'test-aliases.mjs', 'test-game.mjs'];

let failed = 0;
for (const suite of suites) {
  console.log(`\n--- ${suite} ---`);
  const r = spawnSync(process.execPath, [resolve(here, suite)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log(failed ? `\n${failed} suite(s) FAILED` : '\nAll suites passed');
process.exit(failed ? 1 : 0);
