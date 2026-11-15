# flips-claude-code

Work built with Claude Code for TheFlipside / BellaFox.

> **New session? Start with [`docs/family-feud-handoff.md`](docs/family-feud-handoff.md).**
> It is the authoritative record of what exists, what is done, and what is left.

## What is in here

### BellaFox Feud — `family-feud/`

A hot-seat game show for 2-4 players, built for the BellaFox arcade. Face-off,
three scoring rounds, strikes, steal, sudden death, and Fast Money. Bella hosts
and reads every question aloud.

**State: complete and playable. Not yet deployed.** It lives only in this repo —
not on the owner's PC, not on theflipside. The remaining work is the arcade
deploy; see section 4 of the handoff.

- 40 main + 20 Fast Money questions
- 12 artwork assets (1.8 MB)
- 109 Bella voice clips (6.1 MB)
- Sound effects synthesized in-browser — no audio files required
- No build step, no bundler, no runtime dependencies

Run it:

```bash
cd family-feud && python3 -m http.server 8080
```

Then <http://localhost:8080>. Needs an `http://` origin — ES modules and `fetch`
are blocked on `file://`.

Test it:

```bash
cd family-feud && node tools/test-all.mjs
```

## Documentation

| File | What it is |
|---|---|
| [`docs/family-feud-handoff.md`](docs/family-feud-handoff.md) | **Current state, outstanding work, gotchas. Read first.** |
| [`docs/family-feud-build-plan.md`](docs/family-feud-build-plan.md) | The original design: show structure, matcher design, visual spec, phases |
| [`docs/codex-image-prompts.md`](docs/codex-image-prompts.md) | The twelve image prompts, fully expanded and ready to paste |
| [`docs/family-feud-library-entries.md`](docs/family-feud-library-entries.md) | Ready-to-paste entries for the LLM Build Library, plus the deploy checklist |
| [`family-feud/README.md`](family-feud/README.md) | How to run it, add questions, add art, render voice |

## Branch

All work is on `claude/affectionate-newton-itx827`. Nothing has been merged to
`main` — `main` has no commits.
