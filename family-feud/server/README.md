# Online play — the relay

`feud-server.mjs` is a message switchboard. It hands out room codes, tracks who
is in which room, and passes messages between them. It does not know the rules,
the questions, the answers or the score, and it stores nothing on disk.

One browser — whoever creates the room — runs the game engine and posts the
events it produces. The others render them. That works because `src/game.js`
already turns every action into an ordered list of events and `app.js` already
renders events without deciding anything, so online play reuses both instead of
needing a second copy of the rulebook on a server.

**The game works with no relay at all.** Same-screen play is untouched; the
Online option just reports that it cannot reach a server.

## Running it

```bash
node server/feud-server.mjs
```

No dependencies, no `npm install`, nothing to build. Node 18 or newer.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to bind. Keep it on loopback behind nginx |
| `WS_PATH` | `/ws` | Path that accepts the WebSocket upgrade |
| `ALLOWED_ORIGINS` | *(any)* | Comma-separated list, e.g. `https://theflipside.example` |
| `MAX_ROOMS` | `500` | Rooms alive at once |
| `MAX_PER_ROOM` | `4` | Players per room |
| `MAX_MESSAGE` | `262144` | Largest message accepted, in bytes |
| `ROOM_IDLE_MS` | `14400000` | Idle time before a room is dropped (4 hours) |
| `RATE_LIMIT` | `240` | Messages per client per 10 seconds |

`GET /healthz` returns `{"ok":true,"rooms":N,"uptime":S}`.

## Behind nginx

The page connects to `wss://<same host>/ws` unless told otherwise, so the
relay wants to live under the same name the game is served from. Inside the
existing `server` block for the site:

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;

    # A quiet lobby must not be cut off. The relay pings every 25s, so this
    # only has to outlast that.
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
```

Reload with `nginx -t && systemctl reload nginx`.

If the relay has to live somewhere else — a different host or port — put its
address in `data/online.json` next to the game:

```json
{ "relay": "wss://games.example.com/ws" }
```

`{ "enabled": false }` in that file turns the Online option off entirely.
`?relay=ws://localhost:8787/ws` on the URL overrides both, which is how the
test suite drives it.

## Keeping it running

```ini
# /etc/systemd/system/feud-relay.service
[Unit]
Description=BellaFox Feud relay
After=network.target

[Service]
ExecStart=/usr/bin/node /srv/feud/server/feud-server.mjs
Environment=PORT=8787
Environment=HOST=127.0.0.1
Restart=always
RestartSec=3
User=www-data
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now feud-relay
systemctl status feud-relay
```

## The protocol

Everything is JSON text. `t` names the message.

Client to server:

| Message | Meaning |
| --- | --- |
| `{t:"create", name}` | Open a room. The sender becomes seat 0, the host |
| `{t:"join", code, name}` | Take the next free seat in that room |
| `{t:"start"}` | Host only; tells the room the match is beginning |
| `{t:"relay", body}` | Pass `body` on. Host to everyone else, guest to the host |
| `{t:"rejoin", code, token}` | Take back the seat this browser held before its socket dropped |
| `{t:"leave"}` | Leave; the room closes if the host leaves |

Server to client:

| Message | Meaning |
| --- | --- |
| `{t:"hello"}` | Connected |
| `{t:"joined", code, seat, token, started, rejoined}` | You are in, in this seat. Keep the token |
| `{t:"roster", players, host}` | Who holds a seat now; each player has `connected` |
| `{t:"start"}` | The host started the match |
| `{t:"relay", from, body}` | Someone's `body`, with the seat it came from |
| `{t:"closed", reason}` | The room ended |
| `{t:"error", code, message}` | Something was refused, with words for the player |

`body` is opaque to the relay. The game puts two kinds in it: `{k:"events",
bySeat}` from the host, and `{k:"input", …}` from a guest. The host checks every
guest input against what the engine is actually waiting for before acting on it,
because the relay will forward a message sent at the wrong moment just as
happily as one sent at the right one.

## What a guest is and is not told

The host redacts each batch per seat before sending it (`snapshotFor` and
`eventsFor` in `src/net.js`):

- **Board answers are not sent until they are revealed.** `src/board.js` builds
  blank tiles and fills each one in from its reveal event, so the words are
  never in a guest's page waiting to be read out of the inspector.
- **Fast Money answers are not sent to the other player** until the reveal.
  That is what the look-away curtain does in a room, and there is no curtain
  over a wire.
- **Fast Money questions are sent one at a time**, so a waiting player cannot
  work ahead.

## Known limits

- **Reconnect is by seat, not by session.** Once a match has started, a dropped
  socket leaves a "ghost" holding the seat. The same browser gets it back with
  `{t:"rejoin", code, token}` (the token arrives in `joined`); anyone else gets
  it by joining with the code and the same name. A dropped host has
  `HOST_GRACE_MS` (default three minutes) to return before the room closes. A
  host who closes the tab loses the match: the engine lived there.
- **The host is the authority.** A host who edits their own game state in the
  console changes the match. This is a game for friends, not a tournament.
- **No TLS of its own.** Terminate it in nginx. A page served over `https:`
  will only open a `wss:` socket, which is the behaviour you want.
