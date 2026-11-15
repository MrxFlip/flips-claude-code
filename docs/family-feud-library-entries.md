# BELLAFOX FEUD — LIBRARY DOC ENTRIES
Ready to paste into the LLM Build Library. Written 2026-11-15.

These are the doc-hygiene items the build plan's phase 6 calls for. Paste each
block into the named file; adjust the URL slug if the arcade routing differs.

---

## 1. For `Website/Arcade Reference.md` — add to the games list

```markdown
### BellaFox Feud
Hot-seat game show for 2-4 players, added 2026-11-15. Static bundle, no server
runtime, no database. Source: LLM Build Library `Website/family-feud/`
(mirrored in the Gitea repo under `family-feud/`).

- **URL:** https://bellafox.gg/arcade/feud/  *(confirm against arcade routing)*
- **What it is:** Family Feud-style show with a simulated survey bank. Face-off
  with blind sequential entry, three scoring rounds at x1/x2/x3, strikes, steal,
  sudden death on a tie, and Fast Money with a look-away curtain, duplicate
  detection and a spare question.
- **Input:** one screen, one keyboard. Players take turns typing. Host override
  keys (1-8 reveal, X strike, Z undo) are always live for judgment calls.
- **Audio:** sound effects are synthesized in-browser with the Web Audio API —
  no audio files, nothing licensed. Bella reads the questions from pre-rendered
  clips when present, falling back to browser speech, then subtitles.
- **Art:** twelve generated assets in `img/`, 1.8 MB as WebP. The game probes
  for them and falls back to a CSS-drawn stage if any are missing.
- **Naming:** shipped as "BellaFox Feud", not "Family Feud" — the show name,
  logo and set are Fremantle trademarks. The art is original and the question
  bank is our own. Keep it that way.
```

---

## 2. For `Server/TheFlipside Changelog.txt` — dated entry

```
2026-11-15  BellaFox Feud built (arcade)
  New hot-seat game show for the arcade, 2-4 players on one screen and keyboard.
  Static bundle: vanilla ES modules, no bundler, no runtime dependencies, no
  server component. Lives at Website/family-feud/ in the library.

  Structure: src/game.js owns the rules and returns events; app.js turns those
  events into screens, sound and animation and decides no outcomes. That split
  means a whole match can be played in Node with no browser, which is how the
  game logic is tested.

  Answer matching is the part that decides whether the game is fun: a four-stage
  cascade (exact, token-set containment, Dice coefficient at 0.86, bounded
  Levenshtein) over a normalization pipeline and a curated synonym map. Edit
  distance is disabled below 6 characters because at distance 1 it maps "soap"
  to "soup". Backed by a 123-case fixture suite including deliberate near-misses
  that must fail. Host override keys exist because no matcher is good enough to
  survive a room of people disagreeing with it.

  Audio: all eleven sound effects are synthesized with the Web Audio API rather
  than sourced as files - full sound design, zero assets, nothing to license.
  Dropping a real .mp3 into audio/sfx/ overrides the synth. Spoken lines fall
  back clip -> speechSynthesis -> subtitles on a timer; no stage can deadlock
  the game.

  tools/render-voice.mjs renders Bella's lines with ElevenLabs, content-hashing
  each line so adding ten questions costs ten renders rather than a full
  rebuild. --dry-run prints the clip count before anything is spent. The API key
  is read from the environment only and is never written into the library, per
  the no-secrets rule.

  Artwork: twelve images generated externally from docs/codex-image-prompts.md,
  1.8 MB total as WebP against a 4 MB budget. src/art.js probes each asset by
  base name across .webp/.png/.jpg and only switches to it once it has decoded,
  so a missing or partial img/ degrades to the CSS-drawn stage instead of
  showing holes.

  Tests: tools/test-all.mjs runs the data validator, 123 matcher cases and 80
  game checks. Browser coverage via Playwright at 1920x1080, 1366x768 and
  2560x1440: 48 end-to-end checks on the main game and 22 on Fast Money.

  Gotcha worth remembering: all 203 headless checks passed while the page was
  completely broken by a dead import that threw on module load. Engine tests do
  not prove the thing renders. The browser checks caught it, and only because a
  screenshot script failed and the console was dumped.

  Naming: shipped as "BellaFox Feud". The show name, logo and set design are
  Fremantle trademarks; the art is original and the questions are our own.

  Question bank is at the 40/20 ship minimum. Bella's voice is fully recorded:
  109 clips (60 questions + 49 host takes) generated through the ElevenLabs
  connector on the BellaFox professional clone. NOT YET DEPLOYED as of this entry.
```

---

## 3. For `Website/00 START HERE.txt` — one line in the map

```
- family-feud/: BellaFox Feud arcade game (source + docs). Build plan and image
  prompts are in docs/. Read family-feud/README.md first.
```

---

## 4. Deploy checklist (phase 6)

1. Question bank is at 40/20. Adding more needs a voice clip per question.
2. `node tools/check-art.mjs` — expect 12/12, under 4096 KB.
3. `node tools/test-all.mjs` — all suites green.
5. Copy `family-feud/` to the arcade's static root; confirm the slug.
6. Play one full match from a different machine before calling it done. The
   2026-08-13 Tools/ incident is the precedent: tested in a way that bypassed
   the part that broke.
7. Then paste entries 1-3 above into their files.
