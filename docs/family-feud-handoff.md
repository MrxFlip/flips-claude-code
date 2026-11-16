# BELLAFOX FEUD — HANDOFF / CURRENT STATE
Last updated: 2026-11-15

**Read this first in any new session.** It is the authoritative record of what
exists, what is done, and what is left. The build plan
(`family-feud-build-plan.md`) is the design; this is the state.

---

## 0. UPDATE 2026-11-15 — the 2.0 flow and visual pass (READ THIS FIRST)

The owner played 1.0 and called it "just ok ... too rough". 2.0 is a rebuild of
the presentation layer and several rules. **It is in the working tree at
`Z:\LLM Build Library\Website\BellaFox Feud\repo\` and is NOT committed or
pushed** — the branch on GitHub is still 1.0. Sections 1-7 below describe 1.0
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

### Deploy and branch state (2026-11-15, evening)

- **2.0 is live** at https://bellafox.gg/arcade/feud/ (copied to `Z:\Websitercadeeud\`,
  1.0 files backed up to `Z:\Backups\BellaFoxWebsite6-11-15-feud2\`, changed
  files curl-verified). Scripts carry `?v=20261115-feud2`.
- **2.0 is committed locally as `115c375` but NOT pushed.** The push was rejected:
  another session pushed `fc7db30`, `984377a`, `a1bc83e` to the same branch
  (seven play-through fixes, **online multiplayer** via `src/net.js` +
  `server/feud-server.mjs`, browser suites in `tools/browser/`). Those were built
  on 1.0 and rewrite the same `app.js` / `index.html` / `styles.css` / `board.js`.
- **The two lines are not merged.** Live has 2.0 and no online play. GitHub has
  online play and the 1.0 look. Do not force-push either way. Merging means
  porting host/guest roles from their `app.js` into the 2.0 `app.js` and taking
  their `match.js`, `synonyms.js`, `board.js`, `audio.js` queue and fixtures.
- Online play also needs the relay running on the server plus an nginx `/ws`
  block (owner-run; see `family-feud/server/README.md` on the remote branch).

### Still to do

1. Owner plays it and gives notes.
2. Optional art and 17 new Bella lines: `docs/bellafox-feud-2-art-and-voice.md`
   has every prompt and the line list. The game is complete without them.
3. Commit and push (not done — nobody asked yet).
4. Deploy: unchanged from section 4.

---

## 1. One-line state

The game is **complete and playable**, and is **not deployed anywhere**.

It exists only as source in this GitHub repo. It is **not** on the owner's PC
and **not** on theflipside. The only remaining work is putting it on the arcade.

---

## 2. Where everything is

| Thing | Where |
|---|---|
| Repo | `MrxFlip/flips-claude-code` on GitHub |
| Branch | `claude/affectionate-newton-itx827` (all work; nothing on main) |
| Game code | `family-feud/` |
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
Node runtime, no database, no server process. Any static host serves it.

---

## 3. What is done

| Area | State |
|---|---|
| Game logic | Face-off (blind sequential entry), 3 rounds at x1/x2/x3, strikes, play/pass, steal, sudden death on a tie, banking |
| Fast Money | Both-players and winner-solo modes, look-away curtain, per-player clock, duplicate detection, spare question, 200 target |
| Players | 2-4, hot-seat, one keyboard |
| Answer matching | Normalization + 4-stage cascade, curated synonym map, host override keys |
| Questions | **40 main + 20 Fast Money** (the ship minimum) |
| Artwork | **12/12**, 1.8 MB, in `family-feud/img/` |
| Bella voice | **109/109 clips**, 6.1 MB, in `family-feud/audio/` |
| Sound effects | Synthesized in-browser with Web Audio; no files needed |
| Tests | 123 matcher cases, 1297 alias round-trips, 80 game checks, 45 + 22 browser checks |
| Library doc blocks | Drafted, ready to paste (`family-feud-library-entries.md`) |

Run everything headless:

```bash
cd family-feud && node tools/test-all.mjs
```

**What the browser checks actually cover.** The Playwright suites live outside
the repo (they were scratch files, never committed): 45 checks on the main game
and 22 on Fast Money at 1920x1080, plus a 12-screen visual tour. Separately, the
finished game was checked at **1366x768, 1920x1080 and 2560x1440** — stage fits
the viewport, no page scrollbars, every key element inside the stage, board
renders, artwork applies, no page errors. All passed at all three.

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

**The Playwright suites are not in the repo.** They were written as scratch
files during the build and were not committed. A future session that wants
browser coverage will need to rewrite them — the patterns to copy are in 6.2
below and in `window.__feud.ui`. The headless suites in `tools/` *are* committed
and are the real safety net.

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

---

## 7. Session history

Built over 2026-11-14/15 in one session. Commits on the branch, oldest first:

1. `3ec50b2` Build plan
2. `190f821` Phase 0 board harness + expanded Codex prompts
3. `8674a9d` Phases 1-5: full game, matcher, audio, Fast Money
4. `ad4531f` First 5 artwork assets + the art resolution layer
5. `29c8811` 5 more assets (10/12)
6. `cfa4164` Final 2 assets + library doc blocks
7. `f4fbd38` All 71 Bella voice lines (pre-expansion bank)
8. `9a63a89` 40/20 question bank, fully voiced, + `test-aliases.mjs`

Each commit message records what was found and fixed. They are worth reading
rather than re-deriving.
