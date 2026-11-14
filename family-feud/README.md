# BellaFox Feud

Hot-seat Family Feud-style game show for the BellaFox arcade.
Build plan: `../docs/family-feud-build-plan.md`
Image prompts: `../docs/codex-image-prompts.md`

**Current state: Phase 0 — board harness.** Renders a question and its board from
`data/surveys.json` on a fixed 1920x1080 stage, with host reveal keys. No game
logic, no typing, no audio, no art yet.

## Run it

Needs an http:// origin — ES modules and `fetch` are blocked on `file://`.

```bash
cd family-feud && python3 -m http.server 8080
```

Then open <http://localhost:8080/>.

## Keys (Phase 0)

| Key | Effect |
|---|---|
| `1`–`8` | Reveal that rank |
| `R` | Reveal everything still hidden |
| `N` / `P` | Next / previous question |
| `C` | Reset the current board |
| click a tile | Reveal it |

## Adding questions

Edit `data/surveys.json`, then:

```bash
node tools/validate-surveys.mjs
```

Main questions must have 5–8 answers ordered highest-points-first and summing to
exactly 100. Fast Money questions have no sum requirement. The validator also
catches duplicate IDs and aliases claimed by two different answers (which would be
unreachable). Warnings are advisory; errors exit non-zero.

## Layout note

Every size in `styles.css` is a literal pixel on a 1920x1080 stage. `src/stage.js`
scales that stage to the viewport. Don't add responsive breakpoints to stage
elements — change the stage coordinates instead.
