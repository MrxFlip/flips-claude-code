# BellaFox Feud

Hot-seat game show for 2–4 players, built for the BellaFox arcade.

- **Current state and outstanding work: `../docs/family-feud-handoff.md` — read first**
- Build plan (design): `../docs/family-feud-build-plan.md`
- Image prompts: `../docs/codex-image-prompts.md`
- 2.0 optional art + new voice lines: `../docs/bellafox-feud-2-art-and-voice.md`
- Library doc blocks + deploy checklist: `../docs/family-feud-library-entries.md`

**Not deployed yet.** This runs from a local checkout only; it is not on
theflipside and not on any PC. See section 4 of the handoff.

**State: complete and playable, on one screen or over the internet.** 40 main +
20 Fast Money questions, all 12 artwork assets, all 109 Bella voice clips. Full
show plays end to end — face-off, three scoring rounds with multipliers, strikes,
steal, sudden death, and Fast Money with duplicate handling. Artwork is in
(1.8 MB of a 4 MB budget) and so is Bella's voice (3.7 MB). Both still degrade
gracefully if removed.

## Run it

Needs an `http://` origin — ES modules and `fetch` are blocked on `file://`.

```bash
node tools/dev-server.mjs
```

Then open <http://localhost:8080/>. That one command serves the game **and**
answers `/ws`, so online play works locally with nothing else running. Any
static server does for same-screen play alone:

```bash
python3 -m http.server 8080
```

## Playing online

Pick **Online** on the setup screen. One player creates a game and reads out the
four-letter room code; the others join with it. Everyone plays from their own
machine, and the box only accepts typing from whoever's turn it is.

That needs a relay, because a static page cannot pass messages between browsers
on its own. `tools/dev-server.mjs` already includes one. On a real server, run
it as its own service and let nginx serve the files:

```bash
node server/feud-server.mjs
```

No dependencies and nothing to install. `server/README.md` has the nginx block
and a systemd unit. **Without a relay the game is exactly what it was**: the
Online option simply reports that it cannot reach a server, and same-screen play
is untouched.

How it works: one browser runs the engine and posts the events it produces; the
others render them. `src/game.js` already turns every action into events and
`app.js` already renders events without deciding anything, so online play reuses
both rather than keeping a second copy of the rules on a server. The host
redacts each batch per seat, so a guest is never sent an unrevealed answer or
the other player's Fast Money.

## Playing

1-4 players. Same screen, or online with a room code (2-4). Everything has a
button; the keys are shortcuts.

| Key | Effect |
|---|---|
| `Enter` | Start / submit an answer |
| `A` / `L` | Face-off buzzers, same screen (left player / right player) |
| `Space` | Online: your buzzer. Everywhere: the big gold button |
| `P` / `S` | Play or Pass after winning a face-off |
| `Tab` | Fast Money: pass on this question |
| `M` | Mute |
| `Esc` | Pause menu (resume, how to play, volume, restart, quit) |
| `?` | Host-key list |

### Host keys

Judgment calls, for whoever is running the game. Online, only the host has them.

| Key | Effect |
|---|---|
| `1`-`8` | Force-reveal that answer and award its points |
| `X` | Force a strike |
| `N` | New face-off question (the face-off never bins one by itself) |
| `Z` | Undo the last action |

While the cursor is in the answer box these need `Alt` (`Alt+3`, `Alt+X`) —
otherwise nobody could type an answer starting with X or Z.

## Adding questions

**Widening what counts as a right answer** (the commonest change): put lines
like `q003.4: video games | gaming pc` in a text file and run
`node tools/merge-aliases.mjs that-file.txt --write`, then `node tools/test-all.mjs`.
The existing pack, `data/alias-pack-2026-11-16.txt`, shows the format. Each
answer carries about 23 accepted phrasings.

Edit `data/surveys.json`, then:

```bash
node tools/test-all.mjs
```

`tools/test-aliases.mjs` is the one to watch when adding questions: it feeds every
answer's own text and every alias back through the real matcher and insists each
one resolves to its own answer. The validator catches two answers claiming the
same alias, but it normalizes without the synonym map, so only this catches an
alias made unreachable by a synonym collision.

**A new question needs a voice clip** at `audio/questions/<id>.mp3`, or Bella
falls back to the browser's speech for that one. See the Bella section below.

Rules the validator enforces:

- Main questions: 5–8 answers, ordered highest points first, summing to **exactly 100**.
- Fast Money: at least **6** questions in total (5 played + 1 spare for a duplicate).
- No duplicate IDs, and no alias claimed by two answers in the same question
  (the second one would be unreachable).

Aliases are where the game is won or lost. Three to six per answer, including the
bare noun, the plural and the obvious slang. If the matcher still rejects
something fair, add a fixture to `fixtures/match-cases.json` and a synonym to
`src/synonyms.js`, then re-run the tests.

> **The browser suites in `tools/browser/` are stale.** They were written
> against the 1.0 page (`#plates`, `.advance-btn`, `#answerPrompt`, a masked
> face-off box) and the 2.0 rebuild replaced those elements. They need porting to
> the 2.0 DOM and `window.__feud.actions` before they mean anything again. The
> headless suites below are current and are the gate.

## Tests

```bash
node tools/test-all.mjs            # rules, matcher, aliases, survey data — no browser
node tools/browser/run-all.mjs     # the screen, in a real Chromium
```

The first needs nothing but Node. The second needs Playwright somewhere it can
find (`PLAYWRIGHT_MODULE` points at a copy if it is not a local dependency), and
starts `tools/dev-server.mjs` itself — so the online suite runs against the same
one-origin arrangement the deployed site has, rather than a test-only one. Pass a name to run one suite: `node tools/browser/run-all.mjs online`.

| Suite | What it holds the line on |
|---|---|
| `main-game` | A full round: face-off, play/pass, strikes, steal, bank, host keys |
| `fast-money` | Both turns, the look-away curtain, masking, duplicates, the spare |
| `regressions` | Every fault found in play, so none of them comes back |
| `audio` | Suspend/resume, and that queued lines do not cut each other off |
| `online` | Two browsers, one relay, one match — including what a guest is not told |
| `resolutions` | 1366×768, 1920×1080, 2560×1440 |

Screenshots land in `.feud-shots/` (git-ignored); `FEUD_SHOTS` moves them.

## Artwork

Generate the twelve images from `../docs/codex-image-prompts.md`, then put them
in `family-feud/img/` using these base names. **`.webp`, `.png` and `.jpg` all
work** — `src/art.js` probes them in that order — and WebP is much the smallest.

```
splash  backdrop  board-frame  strike-x
bella-idle  bella-win  bella-strike  podiums
round-card  fastmoney-bg  winner  tile
```

`splash` and `winner` already contain Bella, so when either is present the
standalone portrait steps aside rather than putting two of her on one screen.
`tile` doubles as the page favicon.

Check what landed:

```bash
node tools/check-art.mjs
```

It lists what is present, what is missing, and anything in `img/` the game will
never look at — which is almost always a filename typo. Nothing is required: the
game probes each file and only switches to the art once it has actually decoded.

## Bella's voice

Sound effects are synthesized in the browser with the Web Audio API — no files,
nothing to license. Spoken lines use a three-stage fallback: a rendered Bella clip,
then the browser's speech synthesis, then subtitles on a timer. The game never
waits on audio.

**Bella is already recorded.** All 109 lines (60 questions + 49 host takes) are in
`audio/`, 6.1 MB, voiced by the BellaFox professional clone
(`OwhTuJJ7sxOWEm5PsdCh`) on `eleven_v4`. `data/voice-manifest.json` maps them.
They were generated through the ElevenLabs connector, not this script, so
`tools/render-voice.mjs` has no matching hash file and a plain run would
re-render everything — only use it when you have added questions, and expect it
to redo the existing clips too.

To render Bella yourself (new questions, or a different voice):

```bash
export ELEVENLABS_API_KEY=...
export ELEVENLABS_VOICE_ID=...
node tools/render-voice.mjs --dry-run
node tools/render-voice.mjs
```

The dry run prints the clip count before anything is spent. Renders are
content-hashed, so adding ten questions costs ten clips, not a full rebuild.
`--force` rebuilds everything.

**Never put the API key in a file in this folder** — the library's rules forbid
secrets here, and the script reads it only from the environment.

## Layout note

Every size in `styles.css` is a literal pixel on a fixed 1920×1080 stage, which
`src/stage.js` scales to the viewport. That is what makes it read as a broadcast
set rather than a web page. Don't add responsive breakpoints to stage elements —
change the stage coordinates instead.

## Architecture

`src/game.js` owns the rules and returns events. `app.js` turns those events into
screens, animation and sound, and decides nothing about outcomes. That split is
why a whole match can be played in Node with no browser (`tools/test-game.mjs`).

Event batches are drained one at a time. The engine mutates state synchronously
while the screen catches up asynchronously, so without that queue a fast key
press interleaves two event streams.

That same split is what makes online play small: `src/net.js` sends the batches
one browser produces to the others, which render them through the code path they
already use. The relay in `server/` never learns the rules.

`src/board.js` builds blank tiles and fills each one in from its reveal event,
rather than putting every answer in the page and hiding them with CSS. That is
what lets a guest be sent a board with the answers stripped out.
