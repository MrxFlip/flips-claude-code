# BELLAFOX FEUD — HANDOFF / CURRENT STATE
Last updated: 2026-11-15 (second pass: play-test fixes + online multiplayer)

**Read this first in any new session.** It is the authoritative record of what
exists, what is done, and what is left. The build plan
(`family-feud-build-plan.md`) is the design; this is the state.

---

## 1. One-line state

The game is **complete and playable, on one screen or over the internet**, and
is **not deployed anywhere**.

It exists only as source in this GitHub repo. It is **not** on the owner's PC
and **not** on theflipside. The only remaining work is putting it on the arcade.

The first real play-through (owner, 2026-11-15) found seven faults. All seven
are fixed, each with a test that fails without the fix — see section 8. Online
multiplayer was built in the same pass.

---

## 2. Where everything is

| Thing | Where |
|---|---|
| Repo | `MrxFlip/flips-claude-code` on GitHub |
| Branch | `claude/affectionate-newton-itx827` (all work; nothing on main) |
| Game code | `family-feud/` |
| Online relay | `family-feud/server/feud-server.mjs` + its own README |
| Browser tests | `family-feud/tools/browser/` |
| Docs | `docs/` |
| Deploy target | `https://bellafox.gg/arcade/feud/` — slug approved by the owner |
| Library home (eventual) | `X:\LLM Build Library\Website\family-feud\` |

To get it running anywhere:

```bash
git clone -b claude/affectionate-newton-itx827 https://github.com/MrxFlip/flips-claude-code.git
```

```bash
cd flips-claude-code/family-feud && python3 -m http.server 8080
```

It is a static bundle: HTML, CSS, ES modules, images, mp3s. No build step, no
database, no dependencies. Any static host serves it.

**Online play is the one exception** and it is optional. It needs one Node
process — `node server/feud-server.mjs`, no install — and an nginx `location
/ws` block. Without it the game is exactly what it was: same-screen play is
untouched and the Online option reports that it cannot reach a server. Full
instructions in `family-feud/server/README.md`.

---

## 3. What is done

| Area | State |
|---|---|
| Game logic | Face-off (blind sequential entry), 3 rounds at x1/x2/x3, strikes, play/pass, steal, sudden death on a tie, banking |
| Fast Money | Both-players and winner-solo modes, look-away curtain, per-player clock, duplicate detection, spare question, 200 target |
| Players | 2-4, same screen (one keyboard) **or online, one machine each** |
| Online | Room codes, host runs the engine and posts events, guests render them; per-seat redaction so a guest is never sent an unrevealed answer |
| Answer matching | Normalization + 4-stage cascade, curated synonym map, host override keys |
| Questions | **40 main + 20 Fast Money** (the ship minimum) |
| Artwork | **12/12**, 1.8 MB, in `family-feud/img/` |
| Bella voice | **109/109 clips**, 6.1 MB, in `family-feud/audio/` |
| Sound effects | Synthesized in-browser with Web Audio; no files needed |
| Tests | 148 matcher cases, 1297 alias round-trips, 93 game checks, 6 committed browser suites |
| Library doc blocks | Drafted, ready to paste (`family-feud-library-entries.md`) |

Run everything headless:

```bash
cd family-feud && node tools/test-all.mjs
```

**The browser suites are now in the repo** (they used to be scratch files — that
is fixed):

```bash
cd family-feud && node tools/browser/run-all.mjs
```

It starts its own static server and relay and shuts them down afterwards, so
there is nothing to start by hand. It needs Playwright somewhere importable;
`PLAYWRIGHT_MODULE` points it at a copy. Six suites: `main-game` (45),
`fast-money` (22), `regressions` (24, one per fault found in play), `audio`
(suspend/resume and the voice queue), `online` (two browsers, one relay, one
match) and `resolutions` (1366x768 / 1920x1080 / 2560x1440). All passing.

---

## 4. What is left

### 4.1 Deploy to the arcade — THE ONLY THING BLOCKING "SHIPPED"

Blocked on two pieces of information that are **not in this repo**:

1. **SSH access to theflipside.** The owner's own
   `Server/TheFlipside Server Reference.txt` has it (and
   `Server/TheFlipside Runbooks.txt` has a hostname-resolution playbook).
   Inference only, unverified: the account is probably `mrxflip` (the library
   README references `/home/mrxflip/scripts/`) and the host is called
   `theflipside`. Do not treat that as fact.
2. **How the arcade's static root is laid out** — where other arcade games live
   and what nginx serves them from.

With those two, the deploy is: clone the branch on the server, copy
`family-feud/` into the arcade static root as `feud/`, point nginx at it.
Nothing to install.

### 4.2 Then, in order

1. Paste the three blocks from `family-feud-library-entries.md` into
   `Website/Arcade Reference.md`, `Server/TheFlipside Changelog.txt` and the
   Website START HERE map.
2. Play one full match **from a different machine** before calling it shipped.
   Precedent: the 2026-08-13 Tools/ incident, where a change was tested in a way
   that bypassed the part that broke.
3. Owner to confirm Bella's voice (see 5.1) — if wrong, re-rendering is minutes.

### 4.3 Optional, not blocking

- **Deploy the relay** if online play is wanted on the arcade. Separate from the
  static deploy and not required by it: `server/README.md` has the nginx block
  and a systemd unit. Until it is up, the Online button reports that it cannot
  reach a server and same-screen play is unaffected.
- Grow the question bank toward the 80/40 target. Currently at the 40/20 minimum.
  **Each new question needs a voice clip** — see 5.2.
- The plan's phase-4 polish list in `family-feud-build-plan.md` is all done, but
  the animation inventory there is worth re-reading before any visual change.

---

## 5. Facts a new session will need

### 5.1 Bella's voice

| | |
|---|---|
| Voice used | **BellaFox**, professional clone, `OwhTuJJ7sxOWEm5PsdCh` |
| Model | `eleven_v4` |
| Takes | **1 per line** (deliberate: fixed lines being batch-rendered, not takes to audition) |
| Cost | ~1 US dollar for all 109 clips |
| ElevenLabs flow | `QLYKV43I2CqopF0plqZw` — every generation lives there |

There is a **second** BellaFox voice in the workspace, an instant clone
`oT4V2YiWzUv5ao8yrmtY`. It was not used. The owner has not yet confirmed which
one they want, so a voice swap is still possible.

**The clips were generated through the ElevenLabs MCP connector, not through
`tools/render-voice.mjs`.** Consequences:

- No `data/voice-hashes.json` exists, so a plain `node tools/render-voice.mjs`
  run would re-render **all 109** clips rather than just new ones.
- The script's default model was changed to `eleven_v4` to match what is on disk.
- `data/voice-manifest.json` is what the game actually reads. It is generated
  from the files present, so it is always truthful about what exists.

### 5.2 Adding a question end-to-end

1. Add it to `family-feud/data/surveys.json`. Main questions: 5-8 answers,
   ordered highest-points-first, summing to **exactly 100**. Fast Money: no sum
   rule, but the bank needs **at least 6** Fast Money questions total.
2. Give every answer 3-6 aliases — the bare noun, the plural, the obvious slang.
3. `node tools/test-all.mjs` — `test-aliases.mjs` is the one that matters here.
4. **Generate a voice clip** to `audio/questions/<id>.mp3`, either through the
   ElevenLabs connector (as all the existing ones were) or with
   `tools/render-voice.mjs`. Without it Bella falls back to the browser's robot
   voice for that question only.
5. Rebuild the manifest. The snippet that does it is in the "Record all 71 Bella
   voice lines" commit message and in `tools/render-voice.mjs`.

### 5.3 Naming and trademark

Ships as **BellaFox Feud**. "Family Feud", its logo and its set design are
Fremantle trademarks. The art is original, the questions are our own, and the
prompts in `codex-image-prompts.md` explicitly avoid recreating the real logo or
set. Keep it that way.

---

## 6. Gotchas worth not rediscovering

These each cost real time in the build.

**Headless tests can pass with the page completely broken.** A dead
`setCutinSource` import threw on module load and nothing rendered, while all 203
headless checks stayed green. Always run a browser check after touching imports.

<a id="62"></a>**The engine mutates state synchronously; the UI catches up asynchronously.** In
browser tests, wait on `window.__feud.ui` (`pendingInput`, `awaitingChoice`,
`awaitingAdvance`, `busy`), **never** on `game.state.phase` — the phase changes
before the screen does. Several test failures were this, not product bugs.

**`[hidden]` does not hide anything on its own here.** A class rule like
`.choice-row { display: flex }` outranks the user agent's
`[hidden] { display: none }`. There is a global `[hidden] { display: none
!important }` in `styles.css` — do not remove it.

**`grid-auto-flow: column` needs an explicit row track list**, or the grid
creates implicit *columns* and the board spills sideways.

**Event batches must drain one at a time.** `app.js` queues them. Without that,
a fast key press interleaves two event streams and the screen describes neither.

**Images only write to disk when sent to an idle session.** Files attached while
Claude is mid-turn arrive as viewable pictures but not as readable files. If a
future session needs assets uploaded, ask for them when it is not working.

**Fast Money needs at least 6 questions** (5 played + 1 spare for a duplicate).
The validator now errors below that; it used to silently break.

**An AudioContext does not stay running.** Backgrounding the tab or changing the
output device suspends it, and a suspended context accepts scheduled nodes and
plays none of them. Resume on every entry point; never assume one unlock holds
for the session.

**A label inside a container that gets hidden is not a label.** "Press SPACE to
continue" lived inside the answer form, which is hidden at exactly the moments
that message was needed. Check where a message renders, not just that it is set.

**A permanently animated button is a permanently hard-to-click button.**
Playwright refuses to click an element that never settles, which is a fair
warning about real users too. Pulse the glow, not the geometry.

**`pendingInput` means "this screen owes an answer", not "the engine is
waiting".** Online those are different questions. Conflating them let one
player's words be submitted as another's.

---

## 7. Online play, in short

For a new session that has to touch it.

- **Shape:** one browser (the room creator, seat 0) runs `src/game.js` exactly as
  it does in a hot-seat match and posts every event batch it produces. The others
  have no engine; they adopt the state that came with the batch and render the
  events through the same `handle()` as always. `server/` is a relay and never
  learns the rules — which is the point, because the alternative is a second
  implementation of the rulebook.
- **Why it was nearly free:** the engine already returned ordered event arrays
  and `app.js` already decided nothing. Online play is `src/net.js` plus a few
  `isHost()` / `myTurn()` branches.
- **Redaction** is in `snapshotFor` and `eventsFor` (`src/net.js`). A guest is
  not sent unrevealed board answers, the other player's Fast Money answers, or
  Fast Money questions they have not been asked yet. `src/board.js` fills each
  tile in from its reveal event rather than putting every answer in the page, so
  there is nothing to redact on screen either.
- **The host validates every guest input** against what the engine is actually
  waiting for. The relay forwards a message sent at the wrong moment just as
  happily as one sent at the right one.
- **Known limits:** no reconnect (if the host's browser closes the match ends and
  everyone is told why); the host is the authority. Both are in
  `server/README.md`.

---

## 8. Faults found in the first play-through (all fixed)

Owner played one match on 2026-11-15 and reported seven things. Each fix has a
test that fails without it, in `tools/browser/regressions.mjs` or the headless
suites.

| Reported | Cause | Fix |
|---|---|---|
| Sound kept turning itself off | The AudioContext suspends when the tab is backgrounded; `unlock()` set a flag once and never looked at `ctx.state` again, so every effect after that was scheduled into a parked context | Resume on every entry point + on `visibilitychange` |
| Wanted more of Bella | Every `say()` cancelled the line still playing; three rendered buckets were never wired up; subtitles showed a different take than the clip; every line had 1.5s of dead air bolted on | Voice queue with priorities, `faceoff`/`roundOpen`/`fmLookaway` wired in, index passed through, resolve on `ended` |
| Both missed, question was binned | `resolveFaceoff` loaded a new question on a double miss | Question stays, players keep guessing; host key `N` bins one |
| Stuck after a failed steal, nothing to click | "Press SPACE to continue" was written into a label inside the answer form, which is hidden at every advance point | A real `CONTINUE` button on each screen, clickable and Space-able |
| "measuring tape" said already on the board | `tape` was listed as an alias of Scissors, and a one-token form matched any input containing that word | Alias removed; containment now requires the leftover words to be non-content |
| Face-off masking looked inconsistent | The second player's box was deliberately unmasked | Both masked; online, neither (there is nobody next to you) |
| Wanted online multiplayer | — | Built; see section 7 |

The alias audit that found `tape` also found `washing up` landing on Laundry
(both chore boards carry Laundry *and* the dishes) and `back pain` reaching
`neck pain` in two edits. Transpositions now count as one edit, so ordinary
typos still land. `tools/test-aliases.mjs` plus an ambiguity sweep now report
zero.

---

## 9. Session history

Built over 2026-11-14/15 in one session. Commits on the branch, oldest first:

1. `3ec50b2` Build plan
2. `190f821` Phase 0 board harness + expanded Codex prompts
3. `8674a9d` Phases 1-5: full game, matcher, audio, Fast Money
4. `ad4531f` First 5 artwork assets + the art resolution layer
5. `29c8811` 5 more assets (10/12)
6. `cfa4164` Final 2 assets + library doc blocks
7. `f4fbd38` All 71 Bella voice lines (pre-expansion bank)
8. `9a63a89` 40/20 question bank, fully voiced, + `test-aliases.mjs`
9. `ba755bd` Cold-handoff documentation
10. `fc7db30` The seven faults from the first play-through
11. *(this pass)* Online multiplayer, relay, and the browser suites committed

Each commit message records what was found and fixed. They are worth reading
rather than re-deriving.
