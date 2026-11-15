# BellaFox Feud

Hot-seat game show for 2–4 players, built for the BellaFox arcade.

- Build plan: `../docs/family-feud-build-plan.md`
- Image prompts: `../docs/codex-image-prompts.md`

**State: phases 0–5 complete and tested, all 12 artwork assets in place.** Full show plays end to end — face-off,
three scoring rounds with multipliers, strikes, steal, sudden death, and Fast
Money with duplicate handling. Artwork is in (1.8 MB of a 4 MB budget).
Bella's rendered voice is still an optional drop-in; without it the game uses
synthesized sound effects and the browser's own speech.

## Run it

Needs an `http://` origin — ES modules and `fetch` are blocked on `file://`.

```bash
cd family-feud && python3 -m http.server 8080
```

Then open <http://localhost:8080/>.

## Playing

| Key | Effect |
|---|---|
| `Enter` | Start / submit an answer / rematch |
| `P` / `S` | Play or Pass after winning a face-off |
| `Space` | Advance between rounds, reveals and Fast Money turns |
| `M` | Mute |
| `?` | Toggle the host-key list |
| `Esc` | Back to the menu |

### Host keys

Judgment calls, for whoever is running the game:

| Key | Effect |
|---|---|
| `1`–`8` | Force-reveal that answer and award its points |
| `X` | Force a strike |
| `Z` | Undo the last action |

These fire when the answer box is empty or unfocused. With text already typed,
hold `Alt` — otherwise pressing `3` mid-word would reveal an answer.

## Adding questions

Edit `data/surveys.json`, then:

```bash
node tools/test-all.mjs
```

Rules the validator enforces:

- Main questions: 5–8 answers, ordered highest points first, summing to **exactly 100**.
- Fast Money: at least **6** questions in total (5 played + 1 spare for a duplicate).
- No duplicate IDs, and no alias claimed by two answers in the same question
  (the second one would be unreachable).

Aliases are where the game is won or lost. Three to six per answer, including the
bare noun, the plural and the obvious slang. If the matcher still rejects
something fair, add a fixture to `fixtures/match-cases.json` and a synonym to
`src/synonyms.js`, then re-run the tests.

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

To render Bella:

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
