// Online play — client side.
//
// The shape of this is decided by src/game.js: the engine turns every action
// into an ordered list of events, and app.js renders events without deciding
// anything. So one browser runs the engine and posts the events it produces,
// and the others render them through the code path they already use. The
// relay in server/ never learns the rules.
//
//   host  : runs the engine, sends { events, state } after every action
//   guest : sends { input }, renders whatever comes back
//
// Everything here is optional. With no server configured, or none reachable,
// the page is exactly the hot-seat game it was before.

export const NET_STATE = {
  OFFLINE: 'offline',
  CONNECTING: 'connecting',
  LOBBY: 'lobby',
  PLAYING: 'playing',
  LOST: 'lost',
};

/**
 * Where the relay lives.
 *
 * Resolution order: an explicit ?relay= in the URL, then a `relay` field in
 * data/online.json, then same-origin /ws. The first two exist so the game can
 * be dropped onto a static host whose relay is somewhere else entirely.
 */
export async function resolveRelayUrl(configUrl = 'data/online.json') {
  const fromQuery = new URLSearchParams(location.search).get('relay');
  if (fromQuery) return normalizeUrl(fromQuery);

  try {
    const res = await fetch(configUrl, { cache: 'no-cache' });
    if (res.ok) {
      const cfg = await res.json();
      if (cfg && cfg.relay) return normalizeUrl(cfg.relay);
      if (cfg && cfg.enabled === false) return null;
    }
  } catch { /* no config file is the normal case */ }

  if (location.protocol === 'file:') return null;
  return normalizeUrl(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
}

function normalizeUrl(raw) {
  try {
    const u = new URL(raw, location.href);
    if (u.protocol === 'http:') u.protocol = 'ws:';
    if (u.protocol === 'https:') u.protocol = 'wss:';
    return u.toString();
  } catch {
    return null;
  }
}

export function createNet() {
  let sock = null;
  let state = NET_STATE.OFFLINE;
  let code = null;
  let seat = null;
  let players = [];
  let closedReason = null;

  const listeners = new Map();
  const on = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  };
  const emit = (type, payload) => {
    for (const fn of listeners.get(type) ?? []) {
      try { fn(payload); } catch (err) { console.error('[net]', type, err); }
    }
  };

  // Requests that are waiting for the server to answer, by the reply it wants.
  const waiting = new Map();
  function expect(type, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(type);
        reject(new Error('The server did not answer in time.'));
      }, timeoutMs);
      waiting.set(type, { resolve, reject, timer });
    });
  }
  function settle(type, value, failed = false) {
    const w = waiting.get(type);
    if (!w) return false;
    waiting.delete(type);
    clearTimeout(w.timer);
    if (failed) w.reject(value); else w.resolve(value);
    return true;
  }
  function rejectAll(err) {
    for (const [type] of [...waiting]) settle(type, err, true);
  }

  function send(obj) {
    if (!sock || sock.readyState !== WebSocket.OPEN) return false;
    sock.send(JSON.stringify(obj));
    return true;
  }

  function connect(url) {
    if (!url) return Promise.reject(new Error('Online play is not configured for this copy of the game.'));
    if (sock) disconnect();
    state = NET_STATE.CONNECTING;

    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(url);
      } catch {
        state = NET_STATE.OFFLINE;
        reject(new Error('That relay address is not valid.'));
        return;
      }
      sock = ws;

      const fail = (message) => {
        if (settled) return;
        settled = true;
        state = NET_STATE.OFFLINE;
        reject(new Error(message));
      };
      // A WebSocket that cannot reach its server fires `error` then `close`
      // with no useful detail, so the timeout is what produces a message a
      // person can act on.
      const timer = setTimeout(() => { try { ws.close(); } catch {} fail('Could not reach the game server.'); }, 10_000);

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve();
      });
      ws.addEventListener('error', () => { clearTimeout(timer); fail('Could not reach the game server.'); });
      ws.addEventListener('close', () => {
        clearTimeout(timer);
        fail('Could not reach the game server.');
        const wasPlaying = state === NET_STATE.PLAYING || state === NET_STATE.LOBBY;
        state = wasPlaying ? NET_STATE.LOST : NET_STATE.OFFLINE;
        rejectAll(new Error('The connection closed.'));
        if (wasPlaying) emit('closed', closedReason ?? 'The connection to the game server dropped.');
        sock = null;
      });
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        receive(msg);
      });
    });
  }

  function receive(msg) {
    switch (msg.t) {
      case 'hello':
        return;

      case 'joined':
        code = msg.code;
        seat = msg.seat;
        state = NET_STATE.LOBBY;
        settle('joined', { code, seat });
        return;

      case 'roster':
        players = msg.players ?? [];
        emit('roster', players);
        return;

      case 'start':
        state = NET_STATE.PLAYING;
        emit('start', msg);
        return;

      case 'relay':
        emit('relay', { from: msg.from, body: msg.body });
        return;

      case 'closed':
        closedReason = msg.reason ?? 'The game ended.';
        emit('closed', closedReason);
        return;

      case 'error':
        if (!settle('joined', new Error(msg.message ?? 'The server refused that.'), true)) {
          emit('error', msg.message ?? 'Something went wrong.');
        }
        return;

      default:
        return;
    }
  }

  function disconnect() {
    const s = sock;
    sock = null;
    state = NET_STATE.OFFLINE;
    code = null;
    seat = null;
    players = [];
    if (s) {
      try { s.send(JSON.stringify({ t: 'leave' })); } catch {}
      try { s.close(1000, 'bye'); } catch {}
    }
  }

  return {
    on,
    connect,
    disconnect,

    async create(name) {
      const reply = expect('joined');
      send({ t: 'create', name });
      return reply;
    },

    async join(roomCode, name) {
      const reply = expect('joined');
      send({ t: 'join', code: String(roomCode ?? '').toUpperCase(), name });
      return reply;
    },

    start() {
      state = NET_STATE.PLAYING;
      send({ t: 'start' });
    },

    /** Post an opaque payload: host -> everyone else, guest -> host. */
    relay(body) {
      return send({ t: 'relay', body });
    },

    get state() { return state; },
    get code() { return code; },
    get seat() { return seat; },
    get players() { return players; },
    get isHost() { return seat === 0; },
    get online() { return state === NET_STATE.LOBBY || state === NET_STATE.PLAYING; },
  };
}

/**
 * The state a given seat is allowed to see.
 *
 * Fast Money is the whole reason this exists. The second player must not be
 * able to read the first player's answers before the reveal — that is what the
 * look-away curtain is for in the room, and the same has to hold over a wire
 * where there is no curtain to hide behind. The board's answers are stripped
 * too: src/board.js fills each tile in from its reveal event, so a guest never
 * needs them and never gets them.
 */
export function snapshotFor(state, seat) {
  const copy = JSON.parse(JSON.stringify(state));

  if (copy.question?.answers) {
    copy.question.answers = copy.question.answers.map((a, i) => (
      copy.revealed?.[i] ? a : { text: '', points: 0, hidden: true }
    ));
  }

  const fm = copy.fm;
  if (fm && fm.order) {
    const revealing = ['FM_REVEAL', 'FM_DUPLICATE', 'FM_RESULT'].includes(copy.phase);
    if (!revealing) {
      fm.entries = fm.entries.map((list, turn) => (
        fm.order[turn] === seat ? list : list.map(() => ({ text: '', points: 0, hidden: true }))
      ));
      // The questions themselves are read out one at a time; sending the whole
      // set would let a waiting player prepare answers for questions they have
      // not been asked yet.
      fm.questions = fm.questions.map((q, i) => (i <= fm.qIndex ? q : { id: q.id, prompt: '', answers: [] }));
      if (fm.spare) fm.spare = { id: fm.spare.id, prompt: '', answers: [] };
    }
  }
  return copy;
}

const blankQuestion = (q) => ({
  id: q.id,
  prompt: q.prompt,
  readAs: q.readAs,
  // The count is all a guest needs: src/board.js builds blank tiles and fills
  // each one in from its own reveal event.
  answers: q.answers.map(() => ({ text: '', points: 0, hidden: true })),
});

/**
 * The events a given seat is allowed to see.
 *
 * Same reasoning as snapshotFor: the state mirror is not the only way a secret
 * travels, because app.js renders from the EVENT. readQuestion carries the
 * whole board, and the Fast Money events carry what the other player typed.
 */
export function eventsFor(events, seat) {
  return events.map((e) => {
    switch (e.type) {
      case 'readQuestion':
      case 'fmQuestion':
      case 'fmDuplicate':
        return e.question ? { ...e, question: blankQuestion(e.question) } : e;
      case 'fmAnswer':
        return e.player === seat ? e : { ...e, text: '' };
      case 'faceoffEntry':
        return e.player === seat ? e : { ...e, text: '' };
      default:
        return e;
    }
  });
}
