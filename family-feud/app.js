// BELLAFOX FEUD — Phase 0 board harness.
// Scope: fixed stage + board rendered from surveys.json + host reveal keys.
// Game logic (face-off, strikes, steal, scoring) is phase 1; typing is phase 2.

import { initStage } from './src/stage.js';
import { loadSurveys } from './src/data.js';
import { createBoard } from './src/board.js';

const els = {
  question: document.getElementById('question'),
  board:    document.getElementById('board'),
  pot:      document.getElementById('pot'),
  qcount:   document.getElementById('qcount'),
  hint:     document.getElementById('hint'),
};

const state = {
  questions: [],
  index: 0,
  board: null,
  pot: 0,
};

function paintHud() {
  els.pot.textContent = String(state.pot);
  els.qcount.textContent = `${state.index + 1}/${state.questions.length}`;
}

function loadQuestion(i) {
  const q = state.questions[i];
  if (!q) return;
  state.index = i;
  state.pot = 0;
  els.question.textContent = q.prompt;
  state.board = createBoard(els.board, q);
  paintHud();
}

function reveal(rank) {
  if (!state.board) return;
  const points = state.board.reveal(rank);
  if (points > 0) {
    state.pot += points;
    paintHud();
  }
}

function revealAll() {
  if (!state.board) return;
  const { points } = state.board.revealAll();
  state.pot += points;
  paintHud();
}

function nextQuestion(step = 1) {
  const n = state.questions.length;
  loadQuestion((state.index + step + n) % n);
}

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // Host keys 1-8 reveal by rank (plan 5.3).
  if (e.key >= '1' && e.key <= '8') {
    reveal(Number(e.key));
    return;
  }

  switch (e.key.toLowerCase()) {
    case 'r': revealAll(); break;
    case 'n': nextQuestion(1); break;
    case 'p': nextQuestion(-1); break;
    case 'c': loadQuestion(state.index); break;
    default: return;
  }
  e.preventDefault();
}

async function main() {
  initStage();

  try {
    const data = await loadSurveys();
    state.questions = data.main;
    loadQuestion(0);
  } catch (err) {
    console.error(err);
    els.question.textContent = 'Could not load survey data';
    els.hint.textContent = err.message;
    return;
  }

  window.addEventListener('keydown', onKey);

  // Clicking a tile reveals it too — faster than the keyboard when testing.
  els.board.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (tile) reveal(Number(tile.dataset.rank));
  });

  // Exposed for the smoke test and for poking at it in devtools.
  window.__feud = { state, reveal, revealAll, nextQuestion, loadQuestion };
}

main();
