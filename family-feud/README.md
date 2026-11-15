# BellaFox Feud

Hot-seat game show for 2–4 players, built for the BellaFox arcade.

- **Current state and outstanding work: `../docs/family-feud-handoff.md` — read first**
- Build plan (design): `../docs/family-feud-build-plan.md`
- Image prompts: `../docs/codex-image-prompts.md`
- Library doc blocks + deploy checklist: `../docs/family-feud-library-entries.md`

**Not deployed yet.** This runs from a local checkout only; it is not on
theflipside and not on any PC. See section 4 of the handoff.

**State: complete and playable.** 40 main + 20 Fast Money questions, all 12
artwork assets, all 109 Bella voice clips. Full show plays end to end — face-off,
three scoring rounds with multipliers, strikes, steal, sudden death, and Fast
Money with duplicate handling. Artwork is in (1.8 MB of a 4 MB budget) and so is Bella's
voice (3.7 MB). Both still degrade gracefully if removed.

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
