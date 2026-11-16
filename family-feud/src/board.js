// Renders one question's board and handles tile reveals.
// Content is live DOM (crisp text, selectable, translatable); the Codex-generated
// bezel will be layered over this in phase 4 rather than baked into it.

const LONG_AT  = 18;   // characters before the answer type steps down
const XLONG_AT = 26;

function sizeClass(text) {
  if (text.length > XLONG_AT) return 'is-xlong';
  if (text.length > LONG_AT)  return 'is-long';
  return '';
}

/**
 * Build a blank board for `question`.
 *
 * Only the NUMBER of answers is read here. Each tile's words and points arrive
 * with its reveal event, so the answers are never sitting in the DOM waiting to
 * be read out of the inspector — which also means a guest in an online match
 * can be sent a board with the answers stripped out of it entirely.
 */
export function createBoard(rootEl, question) {
  rootEl.replaceChildren();

  // Two columns, filled top-to-bottom. 5-6 answers => 3 rows, 7-8 => 4.
  rootEl.style.setProperty('--rows', String(Math.ceil(question.answers.length / 2)));

  const tiles = question.answers.map((answer, i) => {
    const rank = i + 1;

    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.rank = String(rank);

    const inner = document.createElement('div');
    inner.className = 'tile-inner';

    const back = document.createElement('div');
    back.className = 'face face-back';
    const ghost = document.createElement('span');
    ghost.className = 'rank-ghost';
    ghost.textContent = String(rank);
    back.append(ghost);

    const front = document.createElement('div');
    front.className = 'face face-front';

    const badge = document.createElement('span');
    badge.className = 'rank-badge';
    badge.textContent = String(rank);

    const text = document.createElement('span');
    text.className = 'answer-text';

    const pts = document.createElement('span');
    pts.className = 'points-box';

    front.append(badge, text, pts);
    inner.append(back, front);
    tile.append(inner);

    // Accessibility: the board announces reveals, not the blank state.
    tile.setAttribute('role', 'group');
    tile.setAttribute('aria-label', `Answer ${rank}, hidden`);

    rootEl.append(tile);
    return { tile, answer, rank, revealed: false, textEl: text, ptsEl: pts };
  });

  return {
    question,
    tiles,

    /**
     * Reveal a 1-indexed rank, writing its words in as it turns.
     *
     * `text` and `points` come from the reveal event. They fall back to the
     * question this board was built from, which is what the host has and a
     * guest does not.
     */
    reveal(rank, text = null, points = null) {
      const t = tiles[rank - 1];
      if (!t || t.revealed) return 0;
      const words = text ?? t.answer?.text ?? '';
      const score = points ?? t.answer?.points ?? 0;
      t.revealed = true;
      t.textEl.textContent = words;
      t.textEl.className = `answer-text ${sizeClass(words)}`.trim();
      t.ptsEl.textContent = String(score);
      t.tile.classList.add('revealed');
      t.tile.setAttribute('aria-label', `Answer ${t.rank}, ${words}, ${score} points`);
      return score;
    },

    get revealedCount() { return tiles.filter((t) => t.revealed).length; },
    get isCleared()     { return tiles.every((t) => t.revealed); },
  };
}
