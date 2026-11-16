# BELLAFOX FEUD 2.0 — NEW ART AND VOICE
Written: 2026-11-15

The 2.0 pass rebuilt the flow and the look of the game. Everything below is
**optional**: the game already runs and looks finished without it, because each
item has a CSS-drawn or caption-only stand-in. Each one you add upgrades a
specific moment, listed in the table.

Save every image into:

```
Z:\LLM Build Library\Website\BellaFox Feud\repo\family-feud\img\
```

Any of `.png`, `.webp` or `.jpg` works — the game finds the file by its base
name. No code change is needed; drop the file in and reload. Then run
`node tools/check-art.mjs` from `family-feud/` to confirm it was picked up.

| # | File (base name) | Size | Where it shows | Without it |
|---|---|---|---|---|
| 13 | `bella-think` | 1024x1536, transparent | Bella's pose while a player is typing | She holds her neutral pose |
| 14 | `bella-point` | 1024x1536, transparent | Bella's pose during the "survey says" drum roll | She holds her neutral pose |
| 15 | `buzzer` | 1024x1024, transparent | Sits on top of each face-off buzzer button | Red pill buttons only |
| 16 | `crowd` | 1920x400, transparent | Audience silhouettes along the bottom of the title and winner screens | No audience |
| 17 | `trophy` | 1024x1024, transparent | Beside the winner's name on the result screen | No trophy |
| 18 | `logo-marquee` | 1960x1800, transparent | Bulb-lit frame behind the title card | CSS chase lights only |

**Priority if you only make some:** 13 and 14 first (Bella reacting to the
players is the biggest "alive" upgrade), then 15, then 16.

## Keeping Bella the same person

Prompts 13 and 14 need the existing portrait attached as a reference image, or
you will get a different host. Attach this file to the request:

```
Z:\LLM Build Library\Website\BellaFox Feud\repo\family-feud\img\bella-idle.webp
```

---

## 13 — Bella thinking
Save as `Z:\LLM Build Library\Website\BellaFox Feud\repo\family-feud\img\bella-think.png` · 1024x1536 · transparent PNG · attach `bella-idle.webp`

```
Use the attached image as the character reference. Same woman, same face, same
shoulder-length wavy dark-brown hair, same hazel-green eyes, same navy blazer over a black
turtleneck with a small gold lapel pin, same studio lighting.

Three-quarter-length studio portrait of her as a television game-show host waiting for a
contestant's answer: one hand raised with the index finger resting lightly against her
chin, the other arm folded across her waist supporting that elbow, head tilted slightly,
eyebrows raised, a playful expectant half-smile, eyes looking toward the upper left as if
watching a scoreboard. Body framed and scaled exactly like the reference, standing in the
same position in the frame.

Modern television game-show lighting: strong key light from the upper left, cool blue
fill, cyan rim light (#49d5ff) from behind right. Polished, flattering, crisp focus.
Fully transparent background with clean cutout edges including the hair. Nothing else in
frame. Portrait orientation, 1024 by 1536.

Avoid: any text or lettering, logos, watermarks, signatures, background scenery, a
different face from the reference, changed hair colour or wardrobe, extra limbs, extra
fingers, distorted hands, a bored or annoyed expression.
```

## 14 — Bella presenting the board
Save as `Z:\LLM Build Library\Website\BellaFox Feud\repo\family-feud\img\bella-point.png` · 1024x1536 · transparent PNG · attach `bella-idle.webp`

```
Use the attached image as the character reference. Same woman, same face, same
shoulder-length wavy dark-brown hair, same hazel-green eyes, same navy blazer over a black
turtleneck with a small gold lapel pin, same studio lighting.

Three-quarter-length studio portrait of her as a television game-show host at the big
reveal moment: turned slightly toward the left of frame, her arm nearest the left edge
extended up and out with an open palm, presenting something off-frame to the upper left,
face turned back toward camera with an excited open-mouthed smile and wide eyes. Energetic
and theatrical, like a host calling "show me!". Body framed and scaled exactly like the
reference. The whole extended arm and hand must be inside the frame.

Modern television game-show lighting: strong key light from the upper left, cool blue
fill, cyan rim light (#49d5ff) from behind right. Polished, flattering, crisp focus.
Fully transparent background with clean cutout edges including the hair. Nothing else in
frame. Portrait orientation, 1024 by 1536.

Avoid: any text or lettering, logos, watermarks, signatures, background scenery, a
different face from the reference, changed hair colour or wardrobe, extra limbs, extra
fingers, distorted hands, a hand cropped by the edge of the frame.
```

## 15 — Buzzer dome
Save as `Z:\LLM Build Library\Website\BellaFox Feud\repo\family-feud\img\buzzer.png` · 1024x1024 · transparent PNG

```
A single television game-show contestant buzzer on a fully transparent background, seen
from slightly above and straight on. A large glossy translucent red dome button, glowing
from within as if lit, seated in a polished chrome ring on a short round deep-navy base
with one thin gold band around it. Strong specular highlight on the top left of the dome,
soft red glow around it. Clean product-render look, crisp vector-sharp edges, symmetrical,
perfectly centred, generous empty margin on every side. Early-2020s broadcast game-show
styling: deep navy (#0d2a6b), warm gold (#ffc83d), bright red (#e01b1b).

Square, 1024 by 1024. Nothing else in frame.

Avoid: any text, letters or numbers on the button or base, logos, watermarks, signatures,
hands, people, a table or surface, a visible background, cast shadow on a floor, more than
one buzzer.
```

## 16 — Audience silhouette strip
Save as `Z:\LLM Build Library\Website\BellaFox Feud\repo\family-feud\img\crowd.png` · 1920x400 · transparent PNG

```
A very wide, short foreground strip showing the backs of a television studio audience as
dark silhouettes, seen from behind and slightly below, as if the camera is at the back of
the audience looking toward a stage. Two loose rows of heads and shoulders spanning the
full width, a few with arms raised and hands clapping above their heads. The figures are
near-black navy (#050a24) silhouettes with a thin cyan-blue rim light (#49d5ff) and
occasional warm gold edge light (#ffc83d) along the tops of heads, shoulders and raised
hands, as if lit by a bright stage in front of them. The silhouettes rise from the bottom
edge and occupy roughly the lower two thirds; everything above them is fully transparent.
The bottom edge is solid silhouette with no gaps.

Fully transparent background. Panoramic, 1920 by 400.

Avoid: faces, facial features, any text or lettering, signs, phones held up, logos,
watermarks, signatures, a visible stage or background, a hard horizontal line at the top,
figures cropped by the left or right edge in an obvious way.
```

## 17 — Trophy
Save as `Z:\LLM Build Library\Website\BellaFox Feud\repo\family-feud\img\trophy.png` · 1024x1024 · transparent PNG

```
A single game-show winner's trophy on a fully transparent background. A polished gold cup
with two curved handles on a short deep-navy pedestal base with a thin gold band, a small
five-pointed star embossed on the front of the cup. Glossy, reflective, warm gold
(#ffc83d) with bright white specular highlights and deeper amber shadows (#c88a12), a soft
golden glow around it and three or four small four-point sparkles. Front-on, symmetrical,
perfectly centred, generous empty margin on every side. Clean stylised 3D render,
vector-sharp edges, early-2020s broadcast graphics look.

Square, 1024 by 1024. Nothing else in frame.

Avoid: any text, engraving, letters or numbers, a blank nameplate with writing, logos,
watermarks, signatures, hands, people, confetti, a table or surface, a visible background,
cast shadow on a floor.
```

## 18 — Title marquee frame
Save as `Z:\LLM Build Library\Website\BellaFox Feud\repo\family-feud\img\logo-marquee.png` · 1960x1800 · transparent PNG

```
A theatrical game-show marquee FRAME only, on a fully transparent background, seen
perfectly straight-on with no perspective. A large rounded-rectangle frame, slightly
taller than a square, made of polished gold and deep-navy trim roughly 90 pixels thick,
studded all the way round with a single evenly spaced row of round warm-white marquee
light bulbs, every bulb lit and softly glowing. A small gold starburst ornament sits at
the top centre of the frame, overlapping its top edge. Soft golden glow spilling outward
from the frame.

The entire interior of the frame is completely empty and fully transparent, like a window.
The frame nearly fills the canvas with a small even margin. 1960 by 1800.

Avoid: any text, letters, numbers or logos, anything at all inside the frame, a filled or
tinted centre, perspective or tilt, a visible background, watermarks, signatures,
recreating any real television show's logo or sign.
```

---

## After generating

- If the generator did not honour transparency, run the image through background
  removal before saving it.
- Check every cutout against the dark stage, not a white editor canvas — halos
  only show on the real background.
- WebP is preferred for size (the whole `img/` folder has a 4 MB budget and is
  at 1.8 MB now), but PNG works as-is.

---

# New Bella voice lines

The 2.0 flow added moments Bella has no recording for. Until they are recorded
the game shows them as a **caption in her speech bubble with no audio** — it
deliberately does not fall back to the browser's robot voice once real Bella
clips exist.

They live in `family-feud/src/host-lines.js`, so `tools/render-voice.mjs` picks
them up automatically. Same voice and model as the existing 109 clips
(BellaFox professional clone `OwhTuJJ7sxOWEm5PsdCh`, `eleven_v4`). Save each to
`family-feud/audio/host/<bucket>-NN.mp3` and add the key to
`family-feud/data/voice-manifest.json` (key `host:<bucket>`, value: array of
file paths) — the same shape as the existing entries.

| Bucket (manifest key `host:…`) | When it plays | Lines |
|---|---|---|
| `buzzPrompt` | Face-off opens *(reserved; not wired yet)* | "Hands on your buzzers." / "Buzzers ready." |
| `playOrPass` | Face-off winner must choose | "Play, or pass?" / "You have control. Play or pass?" |
| `surveySays` | *(reserved for the drum-roll beat)* | "Survey says..." / "Show me!" / "Is it up there?" |
| `timeUp` | Answer clock runs out | "Out of time!" / "Too slow!" |
| `missedAnswers` | Before the unfound answers flip | "Let's see what you missed." / "Here is what was still up there." |
| `suddenDeath` | Tie after the last round | "We're tied. Sudden death!" |
| `finalRound` | Triple-points round card | "Final round. Triple points!" |
| `soloOpen` | Start of a solo run | "Just you and the board. Good luck." |
| `struckOut` | Solo: third strike | "Three strikes. That board is done." |

17 short clips in total. Three existing buckets that were recorded but never
used are now wired in: `roundOpen` (rounds 2+), `fmLookaway`, and `faceoff`
remains available.
