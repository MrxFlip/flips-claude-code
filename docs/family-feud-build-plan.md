# BELLAFOX FEUD — BUILD PLAN
Status: phases 0-5 BUILT and tested, all 12 artwork assets in place; phase 6 awaits
        the question bank, Bella's voice render and the arcade deploy
Written: 2026-11-14 · Last updated: 2026-11-15
Target home: bellafox.gg arcade (static bundle served from theflipside)
Code: `family-feud/` · Image prompts: `codex-image-prompts.md`

## Build status

| Phase | State | Notes |
|---|---|---|
| 0 Scaffold | DONE | Fixed 1920x1080 stage, board from JSON, data validator |
| 1 Game logic | DONE | Face-off, play/pass, strikes, steal, banking, multipliers, sudden death |
| 2 Matching + typing | DONE | 123-case fixture suite, host override keys, type-ahead queueing |
| 3 Audio | DONE | Procedural Web Audio SFX, 3-stage voice fallback, render script |
| 4 Art integration | DONE | All 12 assets in, 1.8 MB of a 4 MB budget; CSS fallback retained |
| 5 Fast Money | DONE | Both-players and solo modes, look-away curtain, duplicate + spare |
| 6 Ship | PARTIAL | Doc entries drafted (`family-feud-library-entries.md`). Outstanding: question bank to 40/20, Bella voice render, arcade deploy |

Tests: `node family-feud/tools/test-all.mjs` (validator + 123 matcher cases + 80 game
checks). Browser coverage was run with Playwright at 1920x1080, 1366x768 and 2560x1440:
44 end-to-end checks on the main game and 22 on Fast Money, all passing.

Question bank currently holds 12 main and 10 Fast Money questions — playable, but
below the 40/20 ship minimum below.

Artwork is complete: twelve assets in `family-feud/img/`, 1801 KB as WebP. `src/art.js`
resolves each by base name across `.webp`/`.png`/`.jpg`, so the extension never matters.
Library doc entries for the Arcade Reference, Changelog and START HERE map are drafted
in `codex-image-prompts.md`'s sibling, `family-feud-library-entries.md`, ready to paste.

---

## 0. One-paragraph summary

A fully visual, game-show-looking Family Feud clone that runs as a static page in the
BellaFox arcade. Two or more players share one screen and one keyboard (hot-seat). Bella
hosts: every question and catchphrase is pre-rendered to .mp3 with ElevenLabs at build
time, so the host *speaks* the question out loud with zero latency and the player types
their answer. Survey data is simulated (hand-authored, 100-point distributions). Full show
structure — face-off, three scoring rounds with multipliers, strikes, steal, and Fast
Money. Artwork is generated externally with Codex from the prompts in section 10 and
dropped into `img/`.

---

## 1. Decisions locked

| Decision | Choice | Consequence |
|---|---|---|
| Deploy target | BellaFox arcade page | Static folder, no server runtime, no DB. Must work behind the existing nginx/arcade routing. |
| Host voice | Pre-rendered Bella via ElevenLabs | Build-time render step; audio files are committed assets. Web Speech API kept only as an emergency fallback. |
| Player setup | Hot-seat, one screen + one keyboard | No networking, no room codes, no websockets. State lives in one browser tab. |
| Host character | Bella | Image prompts describe Bella at the podium / on the splash / in bumpers. |

### 1.1 One thing to flag before launch
"Family Feud" and the show's logo and set design are Fremantle trademarks. For a page on a
public site, ship it as **BellaFox Feud** (or "Fox Feud"), use the original art from section
10 rather than a recreation of the real logo or set, and don't use the show's actual
question bank. The plan below is written that way throughout — same game, own skin. This is
the only place it's mentioned; everything else proceeds as asked.

---

## 2. Where it lives

```
Repo (version history):   git.bellafox.gg/mrxflip/llm-build-library
Library folder:           X:\LLM Build Library\Website\family-feud\
Server (deployed):        /data/Projects/... per arcade convention (runtime), served at
                          https://bellafox.gg/arcade/feud/
Docs to update at the end: Website/Arcade Reference.md (add the game),
                          Website/00 START HERE.txt (if it lists games),
                          Server/TheFlipside Changelog.txt (dated entry for the deploy)
```

Filenames use `lowercase-kebab-case.md` so the Gitea → Wiki.js sync doesn't choke (per the
library README: no spaces in page paths, `.md` imports, `.txt` does not).

Per the library's maintenance rules: no secrets in this folder. The ElevenLabs API key for
the render step lives in the environment/owner's shell only, never in a committed file —
see section 9.4.

---

## 3. Game design — full show structure

### 3.1 Player model
- 2 to 4 players. Each player is their own "family" (no team-member rotation).
- Players are named on the setup screen; names appear on the podium plates.
- Default is 2 (true 1v1). 3–4 players changes only the face-off rotation and steal order.

### 3.2 Round structure
| Round | Multiplier | Questions |
|---|---|---|
| 1 | ×1 | 1 |
| 2 | ×2 | 1 |
| 3 | ×3 | 1 |
| Sudden Death (only if tied) | ×4 | 1 |
| Fast Money | separate scoring | 5 |

Main game winner = highest score after round 3 (or sudden death). Target-300 mode is a
toggle in settings: first to 300 ends the main game early.

### 3.3 Face-off (start of each round)
1. Board shows blanked tiles. Bella reads the question.
2. Two players are at the podium (in 2-player games, always both; in 3–4 player games,
   rotate the pair each round so everyone gets face-offs).
3. **Both type simultaneously is not possible on one keyboard**, so face-off is sequential:
   the player whose turn it is to go first (alternates each round) types one answer, then
   the other does. The input box is cleared and the first answer is hidden from the screen
   until both are in, so the second player can't copy it.
4. Higher-ranked revealed answer wins control. A miss loses the face-off automatically. If
   both miss, the next pair (or the same pair in 2-player) gets a fresh face-off question.
5. Control-winner chooses **PLAY** or **PASS** (keys `P` / `S`). Pass hands control to the
   opponent; the passer becomes the stealer.

### 3.4 Playing the board
- The controlling player keeps answering until the board is cleared or they take 3 strikes.
- Correct answer: tile flips, points added to the **round pot** (not yet to the player).
- Wrong answer: strike. Strike X animates full-screen, buzzer plays, strike counter fills.
- Board cleared → controlling player banks `pot × multiplier`.
- 3 strikes → **steal**.

### 3.5 Steal
- Opponent (or next player in order for 3–4 players) gets **one** guess.
- Correct and not already revealed → they bank `pot × multiplier`.
- Wrong → controlling player banks the pot.
- Either way, all remaining answers are then revealed one at a time with Bella reading them
  (or a short reveal chime if no audio for that line).

### 3.6 Fast Money
Default (recommended for 1v1): **both players play, higher total wins the match bonus.**
- Player A plays first; player B is shown a full-screen "LOOK AWAY" curtain with a countdown
  before A starts, and the same curtain covers A's answers between turns.
- 5 questions, 20 seconds each for player 1, 25 seconds for player 2 (as the real show does).
- Typing an answer and pressing Enter locks it and advances immediately.
- After both turns: reveal A's answers with points one at a time, then B's. Duplicate answer
  by B → buzzer, B gets one extra question (the 6th from the pool).
- Combined target: **200**. Hit it → "BIG WINNER" sequence. Miss → consolation sequence.
- Alternate mode in settings: only the main-game winner plays Fast Money solo vs 200.

### 3.7 Scoring display
Always on screen: each player's banked score, the current round pot, the round multiplier,
whose turn it is, and the strike count. Nothing about the state should ever require asking
"wait, whose turn is it?"

---

## 4. Survey data

### 4.1 Schema (`data/surveys.json`)
```json
{
  "version": 1,
  "main": [
    {
      "id": "q001",
      "prompt": "Name something people do the moment they wake up.",
      "readAs": "Name something people do the moment they wake up.",
      "answers": [
        { "text": "Check their phone", "points": 38, "aliases": ["phone", "look at phone", "scroll phone", "check messages"] },
        { "text": "Hit snooze",        "points": 21, "aliases": ["snooze", "snooze button", "go back to sleep"] },
        { "text": "Stretch",           "points": 14, "aliases": ["stretching"] },
        { "text": "Go to the bathroom","points": 11, "aliases": ["bathroom", "pee", "toilet", "restroom"] },
        { "text": "Drink water",       "points": 9,  "aliases": ["water", "have a drink"] },
        { "text": "Turn on a light",   "points": 7,  "aliases": ["light", "lights", "lamp"] }
      ]
    }
  ],
  "fastMoney": [
    {
      "id": "f001",
      "prompt": "Name a food people eat straight out of the container.",
      "readAs": "Name a food people eat straight out of the container.",
      "answers": [
        { "text": "Ice cream", "points": 41, "aliases": ["icecream", "ice-cream"] },
        { "text": "Peanut butter", "points": 19, "aliases": ["pb"] }
      ]
    }
  ]
}
```

Rules for the data:
- `points` across a main question's answers must sum to **100**. A validator enforces this.
- 5–8 answers per main question; 6 is the sweet spot for board layout.
- `readAs` exists separately from `prompt` so the spoken line can differ from the printed
  one (spelling out abbreviations, adding "Our survey said..." phrasing, etc.).
- `aliases` is where the game is won or lost. Every answer needs 3–6 realistic alternate
  phrasings, including the bare noun, the plural, and the obvious slang.
- Main questions deliberately avoid anything that needs real survey data to feel fair —
  they're written so the "correct" answers are the ones a room full of people would shout.

### 4.2 Volume
- **Minimum to ship:** 40 main + 20 Fast Money.
- **Target:** 80 main + 40 Fast Money. At 4 main questions per match that's 20 matches
  before repeats.
- Authored in batches of 10 so the voice render step can run incrementally.

### 4.3 Question selection
- Shuffle per match with a seeded RNG; the seed is shown on the results screen so a match
  can be replayed identically.
- Used question IDs are kept in `localStorage` and deprioritized for the next ~3 matches so
  back-to-back sessions don't repeat.

---

## 5. Answer matching engine (`src/match.js`)

This is the single highest-risk part of the build. A party game dies the instant it rejects
an answer everyone in the room agrees is right.

### 5.1 Normalization pipeline
Applied to both the typed input and every alias:
1. Lowercase; NFKD-normalize and strip diacritics.
2. Strip punctuation and symbols; collapse runs of whitespace.
3. Drop leading articles: `a`, `an`, `the`.
4. Drop filler prefixes: `my`, `your`, `their`, `some`, `going to`, `gonna`.
5. Naive de-pluralize: trailing `ies`→`y`, `ses`/`xes`/`zes`→drop `es`, trailing `s` when
   length > 3 and not `ss`.
6. Expand a small hand-written synonym map (`tv`→`television`, `fridge`→`refrigerator`,
   `kids`→`children`, `cell`→`phone`, etc.).

### 5.2 Match cascade (first hit wins)
1. **Exact** normalized equality against `text` or any alias.
2. **Token-set containment** — all tokens of a short alias (≤3 tokens) present in the input,
   or vice versa. Catches "check phone" vs "check their phone".
3. **Fuzzy** — Dice coefficient on character bigrams ≥ **0.86**, or Levenshtein distance ≤ 1
   for inputs under 6 characters. Catches typos at speed.
4. **No match** → strike.

Guard: an answer already revealed can never match again; it returns a distinct
`ALREADY_REVEALED` result that plays a soft buzz and does **not** cost a strike (it's a
typing accident, not a wrong guess). Configurable.

### 5.3 Host override — non-negotiable for a party game
The person running the game needs a judge's gavel. Hidden host keys, always live:
| Key | Effect |
|---|---|
| `1`–`8` | Force-reveal answer at that rank (awards points as if guessed) |
| `X` | Force a strike |
| `Z` | Undo the last action (single-level undo of the last reveal or strike) |
| `Shift+R` | Reveal the whole board (end-of-round sweep) |
| `Shift+N` | Skip to next question |
| `Shift+S` | Open settings overlay |
| `Space` | Advance any "waiting for host" beat (round cards, reveals) |
| `Esc` | Pause / return to menu (with confirm) |

A one-line key legend is togglable with `?` and hidden by default so it doesn't pollute the
stage look.

### 5.4 Testing the matcher
`tools/test-match.mjs` runs a fixtures file of ~200 `input → expected answer id | MISS`
pairs, including deliberate typos, plurals, slang, and near-misses that *should* fail. This
runs before any commit that touches `match.js` or the synonym map. Target: 100% of the
fixture set.

---

## 6. State machine & screens

### 6.1 States
```
BOOT → ATTRACT → SETUP → ROUND_CARD → FACEOFF_READ → FACEOFF_INPUT_A →
FACEOFF_INPUT_B → FACEOFF_RESOLVE → PLAY_OR_PASS → BOARD_PLAY →
(BOARD_CLEARED | STRIKE_OUT → STEAL_INPUT → STEAL_RESOLVE) →
ROUND_BANK → [next round] → MAIN_RESULT → FM_INTRO → FM_LOOKAWAY →
FM_PLAY(p1) → FM_LOOKAWAY → FM_PLAY(p2) → FM_REVEAL → FM_RESULT → OUTRO
```
One reducer, one immutable state object, one `render(state)`. Every transition is a named
action so `Z` (undo) can pop the previous state off a small history stack.

### 6.2 Screens
1. **Attract** — logo art, Bella on stage, "PRESS ENTER TO PLAY", looping ambient music bed.
2. **Setup** — player count, name entry, settings (target-300 on/off, Fast Money mode,
   audio volume, subtitles on/off).
3. **Round card** — "ROUND 2 — DOUBLE POINTS" wipe, 1.8s, skippable.
4. **Main board** — the hero screen. See section 7.
5. **Steal** — board dims, stealer's podium lights, single input, one shot.
6. **Fast Money** — five stacked answer rows per player, timer ring, point column.
7. **Results** — final scores, big-winner sequence or consolation, rematch / menu.

### 6.3 Subtitles
Every spoken line also renders as on-screen text (toggleable, on by default). Required for
the stream, and the game is still fully playable with audio muted.

---

## 7. Visual design spec

### 7.1 Canvas strategy
Design at a fixed **1920×1080** stage. Wrap everything in `#stage` and scale with
`transform: scale(min(vw/1920, vh/1080))`, centered, with letterbox bars matching the
backdrop. This is what makes it look like a broadcast set instead of a responsive website —
it's pixel-identical on a 1080p stream, a 1440p monitor, and a laptop.

Below 900px wide (phones), swap to a stacked "mobile fallback" layout: question up top,
board as a single column, input pinned to the bottom. Playable, not pretty — the real target
is a desktop/TV screen.

### 7.2 Colour tokens (`:root`)
```css
--stage-deep:    #050a24;  /* backdrop void */
--stage-blue:    #0d2a6b;  /* main set blue */
--stage-blue-lt: #1c4ab0;  /* panel gradient top */
--board-face:    #0a1f52;  /* unrevealed tile */
--board-reveal:  #f2f6ff;  /* revealed tile face */
--board-text:    #0a1f52;  /* text on revealed tile */
--gold:          #ffc83d;  /* primary accent */
--gold-deep:     #c88a12;
--strike-red:    #e01b1b;
--glow-cyan:     #49d5ff;
--ink:           #ffffff;
```

### 7.3 Typography
- Display / logo / scores: **Anton** (Google Fonts) — heavy condensed, reads as game-show.
- Board answers and question: **Archivo Black**, uppercase, letter-spacing `0.02em`.
- UI / subtitles: **Inter**.
- Load from Google Fonts with `display=swap`; include a local fallback stack so a blocked
  font request doesn't break the layout.

### 7.4 The board
- 2 columns × up to 4 rows (6 answers = 3 rows per column is the standard look).
- Each tile: rank number in a gold circle on the left, answer text centered, point value in
  a gold box on the right.
- Unrevealed: deep blue face with a subtle inner bevel and the rank number only.
- Reveal: **3D flip** on the Y axis, 420ms, `cubic-bezier(.2,.8,.2,1)`, with the ding on
  flip start and a white bloom at 50%.
- Board frame is the Codex-generated bezel PNG (section 10, asset 03) layered over the
  live DOM tiles — art for the chrome, DOM for the content, so text stays crisp and
  translatable.

### 7.5 Animation inventory
| Moment | Animation |
|---|---|
| Correct answer | Tile flip + point value counts up into the pot + gold particle burst |
| Strike | Full-screen red X scales in from 140% with a shake, 700ms, then shrinks into the strike counter |
| Steal | Board desaturates, spotlight sweep onto the stealing podium |
| Round bank | Pot digits fly into the winning player's score plate, score counts up |
| Multiplier | "×2" stamp lands with a thud over the pot |
| Fast Money timer | Conic-gradient ring draining, turns red under 5s, ticks audibly under 10s |
| Big winner | Confetti canvas + logo zoom + applause bed |

All animations respect `prefers-reduced-motion` (cross-fades instead of transforms, no
shake, no confetti).

### 7.6 Sound effects
Needed: `ding`, `buzzer`, `tile-flip`, `strike-slam`, `round-start`, `countdown-tick`,
`fast-money-bell`, `applause`, `win-fanfare`, `lose-sting`, `ambient-bed` (loop).

Source: generate with an SFX model, or pull CC0 from freesound.org. **Do not** rip the real
show's cues. Store as `.mp3` (not `.wav`) in `audio/sfx/`, loaded through one `AudioPool`
class that pre-warms each buffer on first user gesture (browsers block audio before an
interaction — this bites every time, so the Attract screen's "PRESS ENTER" doubles as the
unlock gesture).

---

## 8. Tech stack

- **No build step, no bundler, no framework.** Vanilla ES modules, one CSS file, served as
  static files. This is the right call because it drops into the arcade as a folder, has no
  toolchain to rot, and the whole thing is DOM + CSS animation.
- `index.html` loads `app.js` as `type="module"`.
- Web Audio API for SFX, plain `<audio>` elements for Bella's voice lines (simpler seeking,
  and they're long-ish files).
- `localStorage` for settings and recently-used question IDs, wrapped in try/catch (it
  throws in some private-browsing contexts).
- Zero runtime dependencies. Dev-only Node scripts in `tools/` for rendering voice and
  validating data.

### 8.1 Folder structure
```
family-feud/
  index.html
  app.js
  src/
    state.js          reducer + action creators + history stack
    rounds.js         round config, multipliers, scoring
    match.js          answer matching engine
    synonyms.js       hand-written synonym map
    audio.js          AudioPool, voice playback, subtitle emitter
    render.js         render(state) → DOM
    screens/
      attract.js  setup.js  board.js  steal.js  fastmoney.js  results.js
  data/
    surveys.json
    voice-manifest.json     id → audio file map, generated
  audio/
    questions/  q001.mp3 ...
    answers/    q001-a1.mp3 ...        (optional, for the end-of-round sweep)
    host/       intro.mp3 strike-1.mp3 good-answer.mp3 ...
    sfx/
  img/                      Codex output, see section 10
  tools/
    render-voice.mjs        ElevenLabs render + manifest writer
    validate-surveys.mjs    points sum to 100, alias sanity, duplicate detection
    test-match.mjs          matcher fixtures
  fixtures/
    match-cases.json
  README.md                 how to run, how to add questions, how to re-render voice
```

---

## 9. Audio / Bella voice plan

### 9.1 What gets pre-rendered
**Per-question (the bulk):**
- `questions/<id>.mp3` — Bella reading `readAs`.
- `answers/<id>-a<n>.mp3` — Bella reading each answer text, used for the end-of-round
  reveal sweep. Optional; phase 3b. Skippable with a chime if absent.

**Host lines (recorded once, reused all game).** Multiple takes per line, picked at random
so it doesn't sound like a soundboard:
| Bucket | Lines | Takes |
|---|---|---|
| Show open | "Welcome to BellaFox Feud!" / "Let's play the Feud!" | 2 |
| Face-off | "Hands on buzzers." / "Here comes the question." | 3 |
| Good answer | "Good answer!" / "Show me…" / "Yes!" / "That's up there!" | 6 |
| Top answer | "Number one answer!" | 3 |
| Strike | "Oh, no." / "Not up there." / "Strike!" | 6 |
| Three strikes | "Three strikes — let's go to the steal." | 3 |
| Steal win | "Stolen! That's the game right there." | 3 |
| Steal fail | "Nope — the board stays." | 3 |
| Round bank | "Points on the board." | 3 |
| Fast Money | intro, "look away", "20 seconds on the clock", "time's up", reveal, win, lose | 2 each |
| Outro | winner line, rematch line | 2 each |

Rough total: ~60 host clips + (80 questions × 1) + (80 × 6 answers, if phase 3b) ≈ 620
clips at ~4s each. Well inside a hobby budget; the questions and host lines alone are ~140
clips.

### 9.2 Render script (`tools/render-voice.mjs`)
- Reads `surveys.json` + `data/host-lines.json`.
- For each line, computes a **content hash** of `(text, voiceId, modelId, settings)` and
  skips rendering if `voice-manifest.json` already has a matching hash. Incremental by
  default; `--force` re-renders everything. This is what makes adding 10 questions cost 10
  renders instead of 620.
- Writes `audio/**.mp3` and regenerates `data/voice-manifest.json`.
- `--dry-run` prints what *would* render and the clip count, so cost is knowable before
  spending anything.
- Rate-limits to a couple of requests per second and retries transient failures with
  backoff.

### 9.3 Voice settings
Use the existing Bella voice ID already in use for the recording lists, so the game matches
the rest of the site. Delivery notes for the render: energetic game-show host, mid-high
energy, clear consonants, slight smile. Stability a touch lower than default for liveliness;
keep similarity high so it stays recognizably Bella across 600 clips.

### 9.4 Secrets
The API key is read from `process.env.ELEVENLABS_API_KEY` at render time and **never**
written to any file in the library — this folder is covered by the library's "no tokens"
rule. `tools/render-voice.mjs` exits with a clear message if the variable is unset. No
`.env` file is committed; `README.md` documents the one-line export.

### 9.5 Fallback chain
1. Manifest has a clip and it loads → play it.
2. Clip missing or errors → `speechSynthesis` with the best available local voice, at the
   same moment in the flow.
3. Web Speech unavailable → subtitles only, flow continues on a 2.5s timer.

The game must never deadlock waiting for audio. Every voice playback is wrapped in a
`Promise.race` against a timeout equal to `clip duration + 1.5s`, falling through to the
next state regardless.

---

## 10. Codex image prompts

Twelve assets. **Paste the style block first in every prompt** — that's what keeps twelve
separate generations looking like one set.

### 10.1 Shared style block (prepend to every prompt)
```
STYLE: Modern television game-show set design, early-2020s broadcast look. Deep navy and
royal blue palette (#050a24 to #1c4ab0) with warm gold accents (#ffc83d) and cyan rim light
(#49d5ff). Glossy surfaces, LED panel strips, volumetric haze, strong key light with cool
blue fill, subtle lens flare. Highly polished, confident, clean geometry — no clutter, no
text unless specified. Cinematic, high dynamic range, crisp focus.
AVOID: any real-world logos or trademarks, any recreation of an existing TV show's logo or
exact set, watermarks, signatures, gibberish lettering, muddy shadows, low contrast,
busy patterned backgrounds, extra limbs or hands, distorted faces.
```

### 10.2 Bella reference anchor
Generate **asset 05 first**, pick the best Bella, then pass that image back in as a
reference for assets 01, 06, 07 and 11 so she's the same character every time. Without this,
twelve generations give twelve different hosts.

```
BELLA DESCRIPTOR (reuse verbatim): Bella — a confident, friendly young woman game-show
host with [HAIR], [EYES], wearing a tailored deep-blue show-host blazer with a gold lapel
pin, warm genuine smile, poised broadcast posture.
```
Fill `[HAIR]` / `[EYES]` from the existing Bella art in the library so she matches the rest
of the site, then never change that line.

### 10.3 The prompts

**01 — Title / splash key art** · 1920×1080 · `img/splash.png`
```
[STYLE BLOCK]
A wide game-show splash frame. Center-left, [BELLA DESCRIPTOR] stands at a sleek
illuminated host podium, gesturing openly toward camera. Behind her, a towering curved LED
video wall glowing deep blue with radiating gold light rays and a starburst of light beams
converging at center. Polished dark reflective stage floor catching blue and gold
reflections. Two contestant podiums flank the frame, slightly out of focus. Dramatic haze,
spotlight shafts from above. Leave the upper-center third relatively clean and uncluttered
for a logo overlay. No text anywhere in the image.
```

**02 — Stage backdrop, empty** · 2560×1440 · `img/backdrop.png`
```
[STYLE BLOCK]
An empty television game-show stage seen head-on, no people. Curved LED wall in deep navy
with vertical gold light columns and concentric glowing rings. Dark glossy stage floor with
soft blue reflections and a subtle radial gradient. Overhead truss with blue and gold
spotlights casting visible light shafts through light haze. Symmetrical composition,
vignetted corners, generous clean negative space across the entire center of the frame.
Nothing in the foreground. No text, no logos, no furniture.
```

**03 — Answer board bezel / frame** · 1600×900, transparent PNG · `img/board-frame.png`
```
[STYLE BLOCK]
A single game-show answer board frame — ONLY the outer bezel and chrome, with a completely
empty transparent center window. Brushed dark metal and glossy navy frame, 40px thick, with
an inset gold pinstripe, soft cyan edge glow, screw-head details at the corners, and a
subtle top-edge highlight as if lit from above. Rendered straight-on, perfectly rectangular,
no perspective. Transparent background. The interior must be fully empty — no tiles, no
rows, no numbers, no text.
```

**04 — Strike X** · 1024×1024, transparent PNG · `img/strike-x.png`
```
[STYLE BLOCK]
A single bold red X mark on a transparent background, game-show "strike" graphic. Thick
geometric strokes with a glossy beveled edge, bright crimson (#e01b1b) core with a darker
red outline and a soft outer red glow. Slight 3D extrusion, lit from upper left. Clean
vector-sharp edges, perfectly centered, nothing else in frame.
```

**05 — Bella host portrait, neutral** · 1200×1600 transparent PNG · `img/bella-idle.png`
```
[STYLE BLOCK]
Three-quarter-length portrait of [BELLA DESCRIPTOR], standing relaxed and attentive with
hands resting on an unseen podium edge, looking directly at camera with a warm professional
smile. Studio key light from upper left, cyan rim light from behind right. Transparent
background, clean cutout edges including hair. Nothing else in frame.
GENERATE THIS ASSET FIRST and use the chosen result as the character reference for all
other Bella images.
```

**06 — Bella celebrating** · 1200×1600 transparent PNG · `img/bella-win.png`
```
[STYLE BLOCK]
Three-quarter-length portrait of [BELLA DESCRIPTOR], caught mid-celebration — both arms
raised, head tilted back slightly, delighted open-mouthed laugh, energetic and genuine.
Same lighting, same wardrobe, same face as the reference image. Transparent background,
clean cutout edges. Nothing else in frame.
```

**07 — Bella reacting to a strike** · 1200×1600 transparent PNG · `img/bella-strike.png`
```
[STYLE BLOCK]
Three-quarter-length portrait of [BELLA DESCRIPTOR], wincing sympathetically with one hand
raised palm-up in a playful "oof, no" gesture, eyebrows up, mouth in an amused grimace.
Same lighting, same wardrobe, same face as the reference image. Transparent background,
clean cutout edges. Nothing else in frame.
```

**08 — Contestant podium pair** · 1920×1080 transparent PNG · `img/podiums.png`
```
[STYLE BLOCK]
Two matching television game-show contestant podiums side by side with a gap between them,
viewed from a slight three-quarter angle. Glossy navy front panels with an inset gold
horizontal light bar and a blank dark rectangular score display recessed into each front
face. Brushed metal top edge, cyan underglow spilling onto the floor. Transparent
background. The score displays must be completely blank and unlit — no numbers, no text.
```

**09 — Round transition card background** · 1920×1080 · `img/round-card.png`
```
[STYLE BLOCK]
An abstract full-frame game-show transition background. Deep navy field with sweeping gold
light ribbons arcing from lower left to upper right, a bright radial burst behind center,
drifting gold bokeh particles, and fine concentric ring patterns. Dramatic and triumphant.
The exact center of the frame must be a clean, low-detail darker area suitable for large
text overlay. No text in the image.
```

**10 — Fast Money bumper** · 1920×1080 · `img/fastmoney-bg.png`
```
[STYLE BLOCK]
A high-energy game-show bonus-round background. Deep navy base shifting to electric cyan at
the edges, with a large softly glowing clock-face motif ghosted into the center-right at low
opacity, radiating speed lines, and a gold laurel-light sweep across the lower third. Urgent
and kinetic but not visually noisy. The left two-thirds must stay clean and low-contrast for
overlaid answer rows. No text, no numerals.
```

**11 — Big winner celebration frame** · 1920×1080 · `img/winner.png`
```
[STYLE BLOCK]
A triumphant game-show winner moment. [BELLA DESCRIPTOR] stands center-right applauding
toward camera, delighted. Gold and white confetti falls thickly through the frame, caught in
spotlight beams. The LED wall behind blazes gold and white with radiating light. Streamers,
haze, strong backlight, lens flare. Joyful and loud. Leave the center-left third relatively
clean for a score overlay. No text anywhere in the image.
```

**12 — Arcade tile / thumbnail** · 1200×1200 · `img/tile.png`
```
[STYLE BLOCK]
A square game-show icon composition for a website tile. Centered, a stylized glowing answer
board silhouette — a rounded rectangle split into two columns of blank tiles — rendered in
gold on a deep navy radial-gradient background, with a small bold red X mark overlapping the
lower-right corner and light rays behind. Bold, simple, instantly readable at small size,
strong silhouette. No text, no numbers, no faces.
```

### 10.4 Post-generation checklist
- Run assets 03, 04, 05, 06, 07, 08 through background removal if the generator didn't
  honour transparency.
- Export two sizes of every background: `@1x` (1920w) and `@2x` (3840w) for high-DPI; serve
  via `<picture>` / `image-set()`.
- Compress everything to WebP with a PNG fallback. Budget: **under 4 MB total** for the
  whole `img/` folder, so the arcade page still loads fast.
- Verify every asset against the dark stage background, not against a white editor canvas —
  cutout halos only show up on the real backdrop.

---

## 11. Build phases

Each phase ends in something that actually runs. No phase depends on art or audio existing.

### Phase 0 — Scaffold (half a day)
- Repo folder, `index.html`, fixed-canvas 1920×1080 stage with scaling, colour tokens,
  fonts loaded.
- `surveys.json` with 5 hand-written questions.
- `validate-surveys.mjs` enforcing the 100-point rule.
- **Done when:** the board renders 6 blank tiles from JSON at the right size on a 1080p and
  a laptop screen, and `1`–`6` reveal tiles with correct points.

### Phase 1 — Game logic (1 day)
- Reducer, action log, undo stack.
- Face-off → play/pass → board play → strikes → steal → bank → next round → results.
- Score plates, pot, multiplier, strike counter all live.
- **Done when:** a full 3-round match can be played start to finish using only host keys
  (no typing yet), with correct scoring at every step, including a successful steal and a
  failed steal.

### Phase 2 — Answer input + matching (1 day)
- Input box, submit on Enter, locked during non-input states.
- `match.js` + `synonyms.js` + `fixtures/match-cases.json` + `test-match.mjs`.
- Face-off blind-entry handling (second player can't see the first answer).
- **Done when:** the fixture suite passes 100%, and a real match can be played entirely by
  typing, with the host keys reserved for judgment calls.

### Phase 3 — Audio (1 day)
- `AudioPool`, audio unlock on the Attract screen, SFX wired to every event.
- `render-voice.mjs` with hashing + `--dry-run`; render host lines + all question clips.
- Subtitles, volume control, full mute.
- **Done when:** Bella reads every question out loud, all eleven SFX fire at the right
  moments, and the game plays identically with audio fully blocked (fallback chain proven by
  deleting a clip and renaming the Web Speech check).

### Phase 4 — Art + polish (1–2 days)
- Drop in the Codex assets, layer the board bezel, podiums, Bella reaction swaps.
- All animations from 7.5, `prefers-reduced-motion` variants, confetti canvas.
- Attract screen, round cards, results sequence.
- **Done when:** a stranger watching over your shoulder says "is that the actual show?"

### Phase 5 — Fast Money (1 day)
- Five-row layout, per-player timer, look-away curtain, duplicate detection and the 6th
  question, reveal sweep, 200-point target, big-winner sequence.
- **Done when:** both-players mode and winner-solo mode each play correctly, including a
  duplicate answer forcing the extra question.

### Phase 6 — Ship (half a day)
- Question bank up to 40+20 minimum (ideally 80+40), all voice rendered.
- Asset budget check, Lighthouse pass, test on the actual stream setup.
- Deploy to the arcade; add to `Website/Arcade Reference.md`; dated entry in
  `Server/TheFlipside Changelog.txt`; `family-feud/README.md` written for future sessions.
- **Done when:** it's live at the arcade URL and a match has been played on it end to end
  from a different machine.

Total: roughly **5–7 focused days**, art and question-writing being the long poles.

---

## 12. Test checklist (run before deploy)

**Game logic**
- [ ] Face-off: both miss → new question, not a soft-lock
- [ ] Face-off: tie on the same answer rank → first in wins (documented, not accidental)
- [ ] Pass → the passer is correctly set as the stealer
- [ ] Board cleared on the 3rd-to-last answer with 2 strikes standing → no steal offered
- [ ] Steal with an already-revealed answer → rejected, no double points
- [ ] Target-300 mode ends the main game mid-round, cleanly
- [ ] Sudden death triggers only on an exact tie
- [ ] Undo (`Z`) after a strike, after a reveal, and after a bank

**Matcher**
- [ ] Fixture suite 100%
- [ ] Empty submit, whitespace-only submit, 200-character submit
- [ ] Emoji and non-Latin input don't throw
- [ ] Rapid double-Enter doesn't double-submit

**Audio**
- [ ] First interaction unlocks audio in Chrome, Firefox and Safari
- [ ] Deleted clip → Web Speech fallback → subtitle-only, each proven
- [ ] No overlapping host lines (new line cancels the previous)
- [ ] Mute is genuinely silent, including the ambient bed

**Visual**
- [ ] 1920×1080, 2560×1440, 1366×768, and a phone
- [ ] `prefers-reduced-motion` has no transforms or confetti
- [ ] No cutout halos on the dark backdrop
- [ ] `img/` under 4 MB; page interactive under 2s on the LAN

---

## 13. Risks and known gotchas

| Risk | Mitigation |
|---|---|
| Matcher rejects an obviously-right answer mid-party | Host override keys, generous aliases, fuzzy threshold tuned against real fixtures, `Z` undo |
| Browser blocks audio before interaction | Attract screen's "PRESS ENTER" is the unlock gesture; AudioPool pre-warms there |
| Twelve art assets look like twelve different shows | Shared style block, Bella generated first and reused as a reference image |
| Hot-seat face-off lets player 2 see player 1's answer | Blind entry — input masked and cleared between the two face-off entries |
| Voice render cost surprises | `--dry-run` prints clip count before spending; content hashing makes re-renders incremental |
| Simulated data feels arbitrary and arguments break out | Questions written so the top answers are self-evidently obvious; "SIMULATED SURVEY" printed small on the board, once |
| Tools-folder lesson from 2026-08-13 | This is not live tooling, but the deploy still gets tested from a second machine before it's called done, not just locally |
| Library doc drift | Phase 6 explicitly includes the Arcade Reference and Changelog updates; the plan isn't done until the docs are |

---

## 14. Open items for you

1. **Bella's `[HAIR]` / `[EYES]` descriptor** — pull the canonical wording from the existing
   Bella art so the host matches the rest of the site, then lock that line.
2. **Bella voice ID** — confirm which ElevenLabs voice the existing Bella voice lines use.
3. **Question writing** — 80 main + 40 Fast Money is the bulk of the human effort. Can be
   drafted in batches of 10; the validator catches the points math.
4. **Arcade URL slug** — `/arcade/feud/` assumed; confirm against the arcade's routing.
