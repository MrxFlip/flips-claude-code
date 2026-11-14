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
    text.className = `answer-text ${sizeClass(answer.text)}`.trim();
    text.textContent = answer.text;

    const pts = document.createElement('span');
    pts.className = 'points-box';
    pts.textContent = String(answer.points);

    front.append(badge, text, pts);
    inner.append(back, front);
    tile.append(inner);

    // Accessibility: the board announces reveals, not the blank state.
    tile.setAttribute('role', 'group');
    tile.setAttribute('aria-label', `Answer ${rank}, hidden`);

    rootEl.append(tile);
    return { tile, answer, rank, revealed: false };
  });

  return {
    question,
    tiles,

    /** Reveals a 1-indexed rank. Returns the points awarded, or 0 if it was a no-op. */
    reveal(rank) {
      const t = tiles[rank - 1];
      if (!t || t.revealed) return 0;
      t.revealed = true;
      t.tile.classList.add('revealed');
      t.tile.setAttribute('aria-label', `Answer ${t.rank}, ${t.answer.text}, ${t.answer.points} points`);
      return t.answer.points;
    },

    /** Reveals everything still hidden, staggered. Resolves when the last one starts. */
    revealAll(stepMs = 260) {
      const hidden = tiles.filter((t) => !t.revealed);
      let gained = 0;
      hidden.forEach((t, i) => {
        setTimeout(() => this.reveal(t.rank), i * stepMs);
        gained += t.answer.points;
      });
      return { count: hidden.length, points: gained };
    },

    get revealedCount() { return tiles.filter((t) => t.revealed).length; },
    get isCleared()     { return tiles.every((t) => t.revealed); },
  };
}
