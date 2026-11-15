#!/usr/bin/env node
// Run every browser suite against a freshly started copy of the game.
//
//   node tools/browser/run-all.mjs            # all of them
//   node tools/browser/run-all.mjs online     # just that one
//
// Starts its own static server and relay on free-ish ports and shuts both down
// afterwards, so there is nothing to remember to start or stop.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gameRoot = resolve(here, '../..');

const PORT = Number(process.env.FEUD_TEST_PORT ?? 8099);
const RELAY_PORT = Number(process.env.FEUD_TEST_RELAY_PORT ?? 8787);

const SUITES = [
  'main-game.mjs',
  'fast-money.mjs',
  'regressions.mjs',
  'audio.mjs',
  'online.mjs',
  'resolutions.mjs',
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ico': 'image/x-icon',
};

const statics = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // normalize() then a prefix check: without it, ../ in a request walks out
    // of the game directory.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(gameRoot, rel);
    if (!file.startsWith(gameRoot)) { res.writeHead(403).end(); return; }
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

const wanted = process.argv.slice(2);
const suites = wanted.length
  ? SUITES.filter((s) => wanted.some((w) => s.startsWith(w.replace(/\.mjs$/, ''))))
  : SUITES;

if (!suites.length) {
  console.error(`No suite matches ${wanted.join(', ')}. Known: ${SUITES.join(', ')}`);
  process.exit(2);
}

await new Promise((r) => statics.listen(PORT, '127.0.0.1', r));

const relay = spawn(process.execPath, [resolve(gameRoot, 'server/feud-server.mjs')], {
  env: { ...process.env, PORT: String(RELAY_PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
await new Promise((r) => setTimeout(r, 600));

const env = {
  ...process.env,
  FEUD_URL: `http://127.0.0.1:${PORT}/`,
  FEUD_RELAY: `ws://127.0.0.1:${RELAY_PORT}/ws`,
};

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

relay.kill('SIGTERM');
statics.close();

console.log(failed
  ? `\n${failed} of ${suites.length} browser suite(s) FAILED`
  : `\nAll ${suites.length} browser suite(s) passed`);
process.exit(failed ? 1 : 0);
