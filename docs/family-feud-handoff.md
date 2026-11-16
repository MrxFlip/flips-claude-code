# BELLAFOX FEUD — HANDOFF / CURRENT STATE
Last updated: 2026-11-15 (second pass: play-test fixes + online multiplayer)

**Read this first in any new session.** It is the authoritative record of what
exists, what is done, and what is left. The build plan
(`family-feud-build-plan.md`) is the design; this is the state.

---

## 0. UPDATE 2026-11-15 — the 2.0 flow and visual pass (READ THIS FIRST)

The owner played 1.0 and called it "just ok ... too rough". 2.0 is a rebuild of
the presentation layer and several rules. It is committed, merged with the online-play work (merge `afac12c`), pushed,
and live. Details are in the merge and relay notes further down this section. Sections 1-7 below describe 1.0
and are still right about the repo, voice, deploy blockers and gotchas; where
they describe how the game plays or looks, this section wins.

### What changed

| Area | 1.0 | 2.0 |
|---|---|---|
| Players | 2-4 only | **1-4.** Solo run: no face-off or steal, 3 strikes closes the board, best score saved |
| Face-off | Typed in a fixed order into a masked box | **Buzz-in race** (keys `A` / `L`, or click). "Take turns" is still a setup option |
| Answering | Typed answer vanished; tile flipped or X appeared | **"Survey says" beat**: the typed answer is shown big over the board with a drum roll, then resolved |
| Pressure | None | **Answer clock** (30s default, 15s, or off). Timeout = wrong answer |
| Match length | Always 3 rounds | Quick 3 / Classic 4 / Long 5 (last two always x2, x3) |
| Round end | Toast, then "press space" in small type | Score counts up on the podium, missed answers flip one at a time in a dimmed style, one big CONTINUE button saying what comes next |
| Layout | Board full width, flat score boxes, tiny strike squares | Left/right rails with coloured player podiums, round chip, pot, strike panel; Bella stands in the corner and reacts; her lines appear as a speech bubble |
| Menus | Bare form; Esc = browser `confirm()`; rematch = page reload; "Enter for rematch" did nothing | Title card, two-panel setup with every option explained, How To Play, pause menu (resume / how to play / host keys / volume / restart / quit), Play Again / Change Players / Main Menu. No reloads |
| Fast Money | One points column, all answers dumped at once | Per-player points columns, answers then points revealed one at a time, progress bar to target, PASS button (`Tab`), solo target 100 |
| Motion | Hard cuts | Light-streak wipe on every screen change, moving spotlights, tile entrance and sheen, podium and pot animations, steal "red alert" |
| Repeat questions | Random every match | Questions this browser has not seen are served first |
| Persistence | None | Names, options, volume, mute, seen questions and best solo score in `localStorage` (`bfeud.*`) |

### Bugs in 1.0 that 2.0 fixes

- **Answers starting with M, X, Z or a digit could not be typed.** Host keys
  fired on an empty answer box, so "zebra" triggered Undo and "mouse" toggled
  mute. Single-letter keys inside a text box now need `Alt`.
- **"Winner only" Fast Money could not be won.** Five top answers total about
  165; the target was 200. One-player Fast Money now plays to 100
  (`FM_TARGET_SOLO`).
- The result screen advertised "Enter for a rematch" but nothing handled it.

### Engine API added (`src/game.js`)

`settings.rounds`, `settings.buzzIn`, `settings.preshuffled`; `game.buzz(id)`,
`game.timeout()`; events `awaitBuzz`, `buzzed`, `roundEnd`; `reveal.missed`;
`roundCard` carries `isFinal`, `totalRounds`, `pair`. `bank` now comes
**before** the sweep of missed answers. Solo is simply `players.length === 1`.
Tests: `tools/test-game.mjs` went from 80 to 102 checks; `node tools/test-all.mjs`
passes.

### Verified / not verified

- Verified in a browser at 1600x900: full 2-player match (buzz, strikes, steal,
  three rounds, winner, Fast Money with a duplicate, final result), solo run,
  pause menu, restart mid-match. No console errors.
- **Not verified:** 3 and 4 player layouts by eye, "take turns" face-off in the
  browser, sound balance with audio on (testing was muted), other resolutions,
  touch devices. Play one real match with sound before deploying.
- Six optional-art probes 404 on load until that art exists (harmless).

### Merge with the online-play line (2026-11-15, night)

The fork described in earlier copies of this file is **resolved**. The other
session's three commits (`fc7db30` play-through fixes, `984377a` online
multiplayer, `a1bc83e` dev server) are merged with 2.0 in one merge commit.

What was taken from each side:

| File | Result |
|---|---|
| `src/net.js`, `server/`, `tools/dev-server.mjs`, `src/board.js`, `src/match.js`, `src/synonyms.js`, fixtures, surveys | Theirs, unchanged |
| `src/game.js` | Both. Their `faceoffRetry` (a double miss keeps the question), `skipQuestion()`, `attempt`; my buzz-in, solo, timeout, rounds. `state.buzzIn` and `state.clock` now ride in state so a guest's mirror has them |
| `src/audio.js` | Theirs (speech queue, context resume, one reused element) plus my effects, live volume, and caption-only fallback |
| `app.js`, `index.html`, `styles.css` | 2.0, with online play ported in: host/guest roles, `engineAwait` vs `pendingInput`, per-seat broadcast, lobby in the setup screen |

How online play behaves in 2.0:

- Setup has **Same screen / Online**. Online: type your name, CREATE A GAME or
  enter a 4-character code and JOIN. The host sets the rules and starts.
- Each player sees **only their own buzzer** (Space) in a face-off; everyone
  else watches. Answers, play/pass and Fast Money are typed on your own screen.
- The "survey says" beat and "out of time" are UI-only events (`guess`,
  `timeUp`) sent through the same stream, so every screen plays them.
- The answer clock is the host's; guests' clocks are displays.
- No look-away curtain online; a player waiting for their Fast Money turn is
  not shown the questions.
- PLAY AGAIN (host) restarts in the same room. Leaving as host closes the room.

Verified in two browser tabs against `tools/dev-server.mjs`: lobby, buzz from
the guest, guest sees no unrevealed answers, strikes, steal by the guest, three
rounds, winner, Fast Money both turns, final result, rematch, host leaving.
Same-screen play re-checked after the merge. Headless: 115 game checks, 148
matcher cases, all passing.

**Not verified / known gaps**

- `tools/browser/*.mjs` (their Playwright suites) target the 1.0 DOM and are
  **stale**; Playwright is not installed on the Claude Code PC. They need
  porting.
- 3-4 players online, real network latency, and sound with audio on.
- No reconnect: a dropped guest cannot rejoin a started match (their design).

### What is live (2026-11-15, night)

- https://bellafox.gg/arcade/feud/ serves the merged build. Scripts and every
  changed module import carry `?v=20261115-feud3` (including `game.js -> match.js`
  and `match.js -> synonyms.js`, which Cloudflare would otherwise serve stale).
- Backups of what was replaced: `Z:\Backups\BellaFoxWebsite\2026-11-15-feud2\`
  (1.0) and `...\2026-11-15-feud3\` (2.0 before the merge).
- Live-only file: `arcade/feud/data/online.json`. Relay source staged at
  `/data/Projects/feud-relay/feud-server.mjs` (not in the web root).
- `server/` and `tools/browser/` are not deployed to the web root.

### Relay on the server — DONE 2026-11-16

`feud-relay.service` is active and enabled on theflipside (127.0.0.1:5057, path
`/feud-ws`, origins limited to bellafox.gg), behind nginx `location = /feud-ws`.
Installed by the owner-run `Website/Feud Relay Setup.sh`. The first run stopped
because the server's only Node is nvm's (`/home/mrxflip/.nvm/versions/node/v24.16.0`)
and is not on PATH; the script now falls back to it. If that Node version is
removed, re-run the script.

Verified against `wss://bellafox.gg/feud-ws`: 101 upgrade, other origins refused,
and a host+guest room test (create, join, start, relay both ways, host leaving).
Not driven by the PM: the live page itself in two real browsers.

The live copy has `data/online.json` = `{"relay": "/feud-ws"}`, deliberately
**not** in the repo, because locally `tools/dev-server.mjs` serves the relay on `/ws`.

### Accepted answers widened (2026-11-16)

The owner reported right answers being struck: "video games" against Game
console, "doom scrolling" against Scroll their phone. Cause: the bank had about
1,300 accepted phrasings over 340 answers (3-4 each), which is too thin for
free typing.

- **Bank:** now about 7,860 phrasings, ~23 per answer. The merged pack is kept
  at `family-feud/data/alias-pack-2026-11-16.txt` (one line per answer).
- **Matcher (`src/match.js`):** apostrophes are dropped rather than turned into
  a space; I / we / he / she are noise words; and a new stage accepts a known
  phrasing plus leftover words that the same answer already uses elsewhere
  ("doomscrolling on my phone"). A leftover word from nowhere, or two answers
  qualifying at once, is still a miss.
- **Tests:** 179 matcher fixtures (31 new, including the reported cases and
  misses that must stay misses), 8,204 alias round-trips.
- **Cache tag:** `?v=20261116-feud4`. Backup: `Backups/BellaFoxWebsite/2026-11-16-feud4/`.

**To widen an answer again:** add lines to a pack file in the same format
(`q003.4: video games | gaming pc`), run
`node tools/merge-aliases.mjs <pack> --write`, then `node tools/test-all.mjs`.
The merge refuses a phrasing two answers on one board would both claim. No voice
work is needed; aliases are never spoken.

**Judgment call to know about:** the drafts were first written much wider
(e.g. accepting any messy food for Ribs) and were cut back to same-meaning
phrasings, because a loose match reveals a tile the player did not mean. Where
the line sits is a matter of taste; the pack file is the place to move it.
There is still no way for a player to dispute a strike except the host keys
(`Alt+1`-`8`), which online only the host has.

### Owner notes fixed 2026-11-16 (tag `?v=20261116-feud5`)

- **Hiccup after a correct answer.** `.tile` has an entrance animation and the
  reveal "punch" was a second `animation` on the same element; removing
  `.just-revealed` handed the property back to `tileIn`, which replayed. The
  board now gets `.no-enter` on the first reveal. Do not put another
  `animation` on `.tile` without that in mind.
- **Correct-answer sound.** One high bell (C7 with partials) fired 360 ms after
  the flip starts, instead of a C6 triad at 120 ms. The flip is a light swish
  with no low tone. Synthesized in `src/audio.js`; a real clip dropped at
  `audio/sfx/ding.mp3` would override it.
- **Fast Money clock.** `FM_TIME` is `[60, 60]` (was `[20, 25]`).

### Still to do

1. Owner plays it and gives notes.
2. Optional art and 17 new Bella lines: `docs/bellafox-feud-2-art-and-voice.md`
   has every prompt and the line list. The game is complete without them.
3. Port the stale browser suites to the 2.0 DOM.
4. Deploy: unchanged from section 4.

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
cd flips-claude-code/family-feud && node tools/dev-server.mjs
```

That serves the game and the online relay from one port — the same shape the
deployed site has behind nginx — so both ways of playing work immediately.

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
