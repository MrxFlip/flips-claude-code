#!/usr/bin/env node
// Run every browser suite against a freshly started copy of the game.
//
//   node tools/browser/run-all.mjs            # all of them
//   node tools/browser/run-all.mjs online     # just that one
//
// Starts tools/dev-server.mjs — which serves the game and answers /ws from one
// port, the same shape the deployed site has behind nginx — and shuts it down
// afterwards. Nothing to start or stop by hand.

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gameRoot = resolve(here, '../..');

// One process serves the game and answers /ws, exactly as the deployed site
// does behind nginx — so the online suite exercises the real arrangement
// instead of a test-only one.
const PORT = Number(process.env.FEUD_TEST_PORT ?? 8099);

const SUITES = [
  'main-game.mjs',
  'fast-money.mjs',
  'regressions.mjs',
  'audio.mjs',
  'online.mjs',
  'resolutions.mjs',
];

const wanted = process.argv.slice(2);
const suites = wanted.length
  ? SUITES.filter((s) => wanted.some((w) => s.startsWith(w.replace(/\.mjs$/, ''))))
  : SUITES;

if (!suites.length) {
  console.error(`No suite matches ${wanted.join(', ')}. Known: ${SUITES.join(', ')}`);
  process.exit(2);
}

const site = spawn(process.execPath, [resolve(gameRoot, 'tools/dev-server.mjs')], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

// Wait for it to actually answer rather than guessing at a delay.
const base = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 60; i++) {
  const ok = await fetch(`${base}healthz`).then((r) => r.ok).catch(() => false);
  if (ok) break;
  if (i === 59) { console.error('dev server never came up'); process.exit(1); }
  await new Promise((r) => setTimeout(r, 250));
}

// No FEUD_RELAY: the suites then use the page's own same-origin resolution,
// which is the path a deployed copy takes.
const env = { ...process.env, FEUD_URL: base, FEUD_RELAY: '' };

let failed = 0;
for (const suite of suites) {
  console.log(`\n######## ${suite} ########`);
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, [join(here, suite)], { env, stdio: 'inherit' });
    child.on('exit', (c) => done(c ?? 1));
    child.on('error', () => done(1));
  });
  if (code !== 0) failed += 1;
}

site.kill('SIGTERM');

console.log(failed
  ? `\n${failed} of ${suites.length} browser suite(s) FAILED`
  : `\nAll ${suites.length} browser suite(s) passed`);
process.exit(failed ? 1 : 0);
