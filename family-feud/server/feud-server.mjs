#!/usr/bin/env node
//
// BELLAFOX FEUD — online relay.
//
// What this is: a message switchboard and nothing else. It hands out room
// codes, keeps track of who is in which room, and passes messages between
// them. It does not know the rules, the questions, the answers or the score.
//
// Why it is built that way: src/game.js already turns every action into an
// ordered list of events, and app.js already renders events without deciding
// anything. So one browser — the host — runs the engine exactly as it does in
// a hot-seat game and broadcasts the events it produces; the guests render
// them with the same code path they use locally. Putting the rules on the
// server instead would mean a second implementation of them, and two
// implementations of a rulebook are one too many.
//
// No dependencies, deliberately. `node server/feud-server.mjs` is the whole
// install, which is the difference between this being deployable in five
// minutes and it being a project.
//
// Usage:
//   node feud-server.mjs                 # port 8787, path /ws
//   PORT=9000 WS_PATH=/feud node feud-server.mjs
//
// Put it behind nginx with a TLS terminator in front; see README.md.

import { createServer } from 'node:http';
import { createHash, randomInt } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const WS_PATH = process.env.WS_PATH ?? '/ws';
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 500);
const MAX_PER_ROOM = Number(process.env.MAX_PER_ROOM ?? 4);
const MAX_MESSAGE = Number(process.env.MAX_MESSAGE ?? 256 * 1024);
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS ?? 4 * 60 * 60 * 1000);
const PING_MS = 25_000;
const PONG_GRACE_MS = 70_000;
// A client may send this many messages per sliding 10 seconds. A real match
// sends a handful per turn; anything near this is a stuck loop or an abuser.
const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 240);
const RATE_WINDOW_MS = 10_000;

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
// No O/0/I/1: these get read aloud down a phone line.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------------------------------------------------------------- framing

/**
 * Minimal RFC 6455 server. Text frames only, with continuation support;
 * binary frames are refused.
 */
class Conn {
  constructor(socket, id) {
    this.socket = socket;
    this.id = id;
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOp = null;
    this.open = true;
    this.lastPong = Date.now();
    this.room = null;
    this.seat = null;
    this.name = '';
    this.stamps = [];
    this.onMessage = () => {};
    this.onClose = () => {};

    socket.on('data', (chunk) => this.feed(chunk));
    socket.on('error', () => this.destroy());
    socket.on('close', () => this.destroy());
  }

  feed(chunk) {
    if (!this.open) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    // A frame header is at most 14 bytes; refuse anything claiming more than
    // the cap before allocating for it.
    for (;;) {
      const frame = this.readFrame();
      if (!frame) break;
      if (frame === 'oversize') { this.close(1009, 'message too large'); return; }
      this.handleFrame(frame);
      if (!this.open) return;
    }
  }

  readFrame() {
    const b = this.buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (b.length < offset + 2) return null;
      len = b.readUInt16BE(offset); offset += 2;
    } else if (len === 127) {
      if (b.length < offset + 8) return null;
      const big = b.readBigUInt64BE(offset); offset += 8;
      if (big > BigInt(MAX_MESSAGE)) return 'oversize';
      len = Number(big);
    }
    if (len > MAX_MESSAGE) return 'oversize';
    // A client frame must be masked (RFC 6455 §5.1).
    if (!masked) { this.close(1002, 'unmasked frame'); return null; }
    if (b.length < offset + 4 + len) return null;

    const mask = b.subarray(offset, offset + 4); offset += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = b[offset + i] ^ mask[i & 3];
    this.buf = b.subarray(offset + len);
    return { fin, opcode, payload };
  }

  handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case 0x9: this.sendFrame(0xa, payload); return;   // ping -> pong
      case 0xa: this.lastPong = Date.now(); return;
      case 0x8: this.close(1000, 'bye'); return;
      case 0x2: this.close(1003, 'binary not accepted'); return;
      case 0x1:
      case 0x0: break;
      default: this.close(1002, 'bad opcode'); return;
    }

    if (opcode === 0x1) {
      if (this.fragmentOp !== null) { this.close(1002, 'interleaved frame'); return; }
      if (fin) { this.deliver(payload); return; }
      this.fragmentOp = 0x1;
      this.fragments = [payload];
      return;
    }
    // continuation
    if (this.fragmentOp === null) { this.close(1002, 'stray continuation'); return; }
    this.fragments.push(payload);
    const total = this.fragments.reduce((n, p) => n + p.length, 0);
    if (total > MAX_MESSAGE) { this.close(1009, 'message too large'); return; }
    if (!fin) return;
    const joined = Buffer.concat(this.fragments);
    this.fragments = [];
    this.fragmentOp = null;
    this.deliver(joined);
  }

  deliver(payload) {
    const now = Date.now();
    this.stamps = this.stamps.filter((t) => now - t < RATE_WINDOW_MS);
    this.stamps.push(now);
    if (this.stamps.length > RATE_LIMIT) { this.close(1008, 'too many messages'); return; }

    let msg;
    try { msg = JSON.parse(payload.toString('utf8')); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    this.onMessage(msg);
  }

  sendFrame(opcode, payload) {
    if (!this.open) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    try { this.socket.write(Buffer.concat([header, payload])); } catch { this.destroy(); }
  }

  send(obj) {
    this.sendFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  ping() {
    this.sendFrame(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const body = Buffer.allocUnsafe(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this.sendFrame(0x8, body);
    this.destroy();
  }

  destroy() {
    if (!this.open) return;
    this.open = false;
    try { this.socket.destroy(); } catch {}
    this.onClose();
  }
}

// ---------------------------------------------------------------- rooms

const rooms = new Map();
let nextId = 1;

function makeCode() {
  for (let attempt = 0; attempt < 40; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

function roster(room) {
  return [...room.clients.values()]
    .sort((a, b) => a.seat - b.seat)
    .map((c) => ({ seat: c.seat, name: c.name }));
}

function announce(room) {
  const list = roster(room);
  for (const c of room.clients.values()) c.send({ t: 'roster', players: list, host: 0 });
}

function leave(conn) {
  const room = conn.room;
  if (!room) return;
  room.clients.delete(conn.id);
  conn.room = null;

  if (conn.seat === 0 || room.clients.size === 0) {
    // The host owns the engine. Without it there is no match to continue, and
    // pretending otherwise would leave guests staring at a frozen board.
    for (const c of room.clients.values()) {
      c.send({ t: 'closed', reason: 'The host left the game.' });
      c.room = null;
      c.close(1000, 'host left');
    }
    rooms.delete(room.code);
    log(`room ${room.code} closed`);
    return;
  }
  room.touched = Date.now();
  announce(room);
}

function handle(conn, msg) {
  switch (msg.t) {
    case 'create': {
      if (conn.room) return conn.send({ t: 'error', code: 'in_room', message: 'Already in a room.' });
      if (rooms.size >= MAX_ROOMS) {
        return conn.send({ t: 'error', code: 'busy', message: 'The server is full — try again shortly.' });
      }
      const code = makeCode();
      if (!code) return conn.send({ t: 'error', code: 'busy', message: 'Could not allocate a room.' });
      const room = { code, clients: new Map(), touched: Date.now() };
      rooms.set(code, room);
      conn.name = cleanName(msg.name, 'Host');
      conn.seat = 0;
      conn.room = room;
      room.clients.set(conn.id, conn);
      conn.send({ t: 'joined', code, seat: 0 });
      announce(room);
      log(`room ${code} created by ${conn.name}`);
      return;
    }

    case 'join': {
      if (conn.room) return conn.send({ t: 'error', code: 'in_room', message: 'Already in a room.' });
      const code = String(msg.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
      const room = rooms.get(code);
      if (!room) return conn.send({ t: 'error', code: 'no_room', message: `No game with code ${code || '????'}.` });
      if (room.started) {
        return conn.send({ t: 'error', code: 'started', message: 'That game has already started.' });
      }
      if (room.clients.size >= MAX_PER_ROOM) {
        return conn.send({ t: 'error', code: 'full', message: 'That game is full.' });
      }
      const taken = new Set([...room.clients.values()].map((c) => c.seat));
      let seat = 1;
      while (taken.has(seat)) seat++;
      conn.name = cleanName(msg.name, `Player ${seat + 1}`);
      conn.seat = seat;
      conn.room = room;
      room.clients.set(conn.id, conn);
      room.touched = Date.now();
      conn.send({ t: 'joined', code, seat });
      announce(room);
      log(`${conn.name} joined ${code} in seat ${seat}`);
      return;
    }

    case 'start': {
      // Only the host may start, and only once.
      if (!conn.room || conn.seat !== 0) return;
      conn.room.started = true;
      broadcast(conn, { t: 'start' }, { includeSelf: false });
      return;
    }

    case 'relay': {
      // The payload is opaque here on purpose. Host messages go to everyone
      // else in the room; a guest's go only to the host.
      const room = conn.room;
      if (!room) return;
      room.touched = Date.now();
      const envelope = { t: 'relay', from: conn.seat, body: msg.body };
      if (conn.seat === 0) {
        broadcast(conn, envelope, { includeSelf: false });
      } else {
        const host = [...room.clients.values()].find((c) => c.seat === 0);
        host?.send(envelope);
      }
      return;
    }

    case 'leave':
      leave(conn);
      conn.close(1000, 'bye');
      return;

    case 'ping':
      conn.send({ t: 'pong' });
      return;

    default:
      conn.send({ t: 'error', code: 'unknown', message: `Unknown message ${msg.t}` });
  }
}

function broadcast(from, payload, { includeSelf = true } = {}) {
  const room = from.room;
  if (!room) return;
  for (const c of room.clients.values()) {
    if (!includeSelf && c === from) continue;
    c.send(payload);
  }
}

function cleanName(value, fallback) {
  const s = String(value ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18);
  return s || fallback;
}

// ---------------------------------------------------------------- http

/**
 * Teach an existing http.Server to speak the relay protocol.
 *
 * Exported so tools/dev-server.mjs can serve the game and the relay from one
 * port and one process, which is what makes `?relay=` unnecessary when testing
 * online play locally.
 */
export function attachRelay(target) {
  target.on('upgrade', onUpgrade);
  return target;
}

export function relayStatus() {
  return { ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) };
}

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(relayStatus()));
    return;
  }
  res.writeHead(426, { 'content-type': 'text/plain' });
  res.end('This endpoint speaks WebSocket only.\n');
});

function onUpgrade(req, socket) {
  const path = (req.url ?? '').split('?')[0];
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];

  const refuse = (status, text) => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  if (path !== WS_PATH) return refuse(404, 'Not Found');
  if (!key || version !== '13') return refuse(400, 'Bad Request');
  if (ORIGINS.length) {
    const origin = req.headers.origin ?? '';
    if (!ORIGINS.includes(origin)) return refuse(403, 'Forbidden');
  }

  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);

  const conn = new Conn(socket, nextId++);
  conn.onMessage = (msg) => handle(conn, msg);
  conn.onClose = () => leave(conn);
  conn.send({ t: 'hello', server: 'bellafox-feud-relay/1' });
}

attachRelay(server);

setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    for (const c of room.clients.values()) {
      if (now - c.lastPong > PONG_GRACE_MS) { c.close(1001, 'timeout'); continue; }
      c.ping();
    }
    if (now - room.touched > ROOM_IDLE_MS) {
      for (const c of room.clients.values()) c.close(1001, 'idle');
      rooms.delete(room.code);
      log(`room ${room.code} expired`);
    }
  }
}, PING_MS).unref();

const startedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (startedDirectly) {
  server.listen(PORT, HOST, () => {
    log(`feud relay listening on ${HOST}:${PORT}${WS_PATH}`);
  });
}

if (startedDirectly) {
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      log(`${sig} — closing`);
      for (const room of rooms.values()) {
        for (const c of room.clients.values()) c.close(1001, 'server shutting down');
      }
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1500).unref();
    });
  }
}
