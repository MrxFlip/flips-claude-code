#!/usr/bin/env node
// One command to play the game, online play included.
//
//   node tools/dev-server.mjs            # http://localhost:8080
//   PORT=3000 node tools/dev-server.mjs
//
// Serves the game AND answers the WebSocket upgrade on /ws from the same port,
// which is the layout nginx will have in production — so the Online button
// works here with no ?relay= and no second terminal.
//
// This is for playing and testing locally. On a server, serve the files with
// nginx and run server/feud-server.mjs as its own service; see
// server/README.md.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachRelay, relayStatus } from '../server/feud-server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(relayStatus()));
    return;
  }

  try {
    // normalize() and then a prefix check. Without it, ../ in a request path
    // walks straight out of the game directory.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, rel);
    if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }

    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = join(file, 'index.html');

    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

attachRelay(server);

server.listen(PORT, HOST, () => {
  console.log(`BellaFox Feud: http://localhost:${PORT}/`);
  console.log(`Online play is live on the same port (/ws) — pick "Online" on the setup screen.`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 800).unref(); });
}
