// BELLAFOX FEUD — presentation layer.
//
// src/game.js owns the rules and returns events; this file turns those events
// into screens, animation and sound. Nothing here decides game outcomes, which
// is why the whole match can be tested headlessly in tools/test-game.mjs.

import { initStage } from './src/stage.js';
import { loadSurveys } from './src/data.js';
import { createBoard } from './src/board.js';
import { createGame, PHASE, FM_TIME, FM_TARGET } from './src/game.js';
import { createAudio } from './src/audio.js';
import { initArt, setCutinSource } from './src/art.js';
import { confetti } from './src/confetti.js';
import { hostLine } from './src/host-lines.js';

const $ = (id) => document.getElementById(id);
const el = {
  stage: $('stage'),
  question: $('question'), board: $('board'),
  plates: $('plates'), strikes: $('strikes'),
  answerForm: $('answerForm'), answerInput: $('answerInput'), answerPrompt: $('answerPrompt'),
  choiceRow: $('choiceRow'),
  pot: $('pot'), potMult: $('potMult'),
  rcLabel: $('rcLabel'), rcSub: $('rcSub'),
  nameGrid: $('nameGrid'), playerCount: $('playerCount'),
  fmMode: $('fmMode'), targetMode: $('targetMode'), startBtn: $('startBtn'),
  fmWho: $('fmWho'), fmTimer: $('fmTimer'), fmTimerText: $('fmTimerText'),
  fmQuestion: $('fmQuestion'), fmRows: $('fmRows'),
  fmForm: $('fmForm'), fmInput: $('fmInput'), fmTotal: $('fmTotal'),
  resultKicker: $('resultKicker'), resultName: $('resultName'), resultDetail: $('resultDetail'),
  strikeOverlay: $('strikeOverlay'), cutin: $('cutin'), cutinImg: $('cutinImg'),
  curtain: $('curtain'), curtainTitle: $('curtainTitle'),
  curtainSub: $('curtainSub'), curtainCount: $('curtainCount'),
  toast: $('toast'), subtitle: $('subtitle'), keyhelp: $('keyhelp'),
  muteBtn: $('muteBtn'), confetti: $('confetti'),
};

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const delay = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? Math.min(ms, 260) : ms));

const audio = createAudio();
let surveys = null;
let game = null;
let boardView = null;
let advanceAction = null;      // what Space does right now
let pendingInput = null;       // { context, who, masked }
let queuedSubmit = null;       // an answer typed before the box went live
let awaitingChoice = false;    // true only while PLAY/PASS is actually on screen
let fmTimerHandle = null;
let stopConfetti = null;
let cutinAvailable = { win: false, strike: false };

const setup = { count: 2, names: ['Player 1', 'Player 2', 'Player 3', 'Player 4'], fmMode: 'both', target: 'off' };

// ------------------------------------------------------------------ screens

const SCREEN_FOR_PHASE = {
  [PHASE.SETUP]: 'setup',
  [PHASE.ROUND_CARD]: 'roundcard',
  [PHASE.FACEOFF]: 'play',
  [PHASE.PLAY_OR_PASS]: 'play',
  [PHASE.BOARD_PLAY]: 'play',
  [PHASE.STEAL]: 'play',
  [PHASE.ROUND_END]: 'play',
  [PHASE.MAIN_RESULT]: 'result',
  [PHASE.FM_INTRO]: 'fm',
  [PHASE.FM_LOOKAWAY]: 'fm',
  [PHASE.FM_PLAY]: 'fm',
  [PHASE.FM_REVEAL]: 'fm',
  [PHASE.FM_DUPLICATE]: 'fm',
  [PHASE.FM_RESULT]: 'result',
};

function showScreen(name) {
  el.stage.dataset.screen = name;
  if (name !== 'result' && stopConfetti) { stopConfetti(); stopConfetti = null; }
}

// ------------------------------------------------------------------ chrome

let toastTimer = 0;
function toast(text, bad = false, ms = 1800) {
  el.toast.textContent = text;
  el.toast.classList.toggle('bad', bad);
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms);
}

audio.onSubtitle((text) => {
  el.subtitle.textContent = text || '';
  el.subtitle.classList.toggle('show', !!text);
});

function say(bucket) {
  const { key, text } = hostLine(bucket);
  return audio.speak(key, text);
}

async function cutIn(kind) {
  if (!cutinAvailable[kind]) return;
  el.cutinImg.src = kind === 'win' ? 'img/bella-win.png' : 'img/bella-strike.png';
  el.cutin.classList.add('show');
  await delay(1500);
  el.cutin.classList.remove('show');
}

// ------------------------------------------------------------------ board UI

function renderPlates() {
  const s = game.state;
  el.plates.replaceChildren();
  s.players.forEach((p) => {
    const d = document.createElement('div');
    d.className = 'plate';
    if (p.id === s.controller) d.classList.add('active');
    if (s.phase === PHASE.STEAL && p.id === s.stealer) d.classList.add('stealing');
    d.innerHTML = `<span class="plate-name"></span><span class="plate-score">${p.score}</span>`;
    d.querySelector('.plate-name').textContent = p.name;
    el.plates.append(d);
  });
}

function renderStrikes() {
  const slots = el.strikes.querySelectorAll('.strike-slot');
  slots.forEach((slot, i) => slot.classList.toggle('on', i < game.state.strikes));
}

function renderPot() {
  el.pot.textContent = String(game.state.pot);
  el.potMult.textContent = `×${game.state.round?.multiplier ?? 1}`;
}

function setInputEnabled(on, { prompt = '', masked = false, placeholder, clear = false } = {}) {
  el.answerInput.disabled = !on;
  el.answerInput.classList.toggle('masked', masked);
  el.answerPrompt.textContent = prompt;
  if (placeholder !== undefined) el.answerInput.placeholder = placeholder;
  el.answerForm.hidden = !on;
  if (clear) el.answerInput.value = '';
  if (on) setTimeout(() => el.answerInput.focus(), 20);
}

// ------------------------------------------------------------------ driver

// The engine mutates state synchronously but presentation is async, so a fast
// key press can hand us a second batch while the first is still animating.
// Batches are therefore queued and drained one at a time — otherwise two event
// streams interleave and the screen ends up describing neither of them.
let draining = false;
const batchQueue = [];

async function run(events) {
  batchQueue.push(events);
  if (draining) return;
  draining = true;
  try {
    while (batchQueue.length) {
      const batch = batchQueue.shift();
      for (const e of batch) await handle(e);
    }
  } finally {
    draining = false;
  }
}

async function handle(e) {
  const s = game.state;

  switch (e.type) {
    case 'phase':
      showScreen(SCREEN_FOR_PHASE[e.to] ?? 'play');
      renderPlates();
      renderStrikes();
      renderPot();
      break;

    case 'roundCard':
      el.rcLabel.textContent = e.round.label;
      el.rcSub.textContent = e.round.sub;
      audio.sfx('roundStart');
      await delay(1500);
      await run(game.beginFaceoff());
      break;

    case 'readQuestion':
      boardView = createBoard(el.board, e.question);
      el.question.textContent = e.question.prompt;
      renderPot();
      renderStrikes();
      await audio.speak(`q:${e.question.id}`, e.question.readAs ?? e.question.prompt);
      break;

    case 'awaitInput': {
      pendingInput = { context: e.context, who: e.who, masked: !!e.masked };
      awaitingChoice = false;
      const name = s.players[e.who].name;
      const label = e.context === 'faceoff' ? `${name} — face-off`
        : e.context === 'steal' ? `${name} — one guess to steal`
        : `${name} — your answer`;
      el.choiceRow.hidden = true;
      setInputEnabled(true, {
        prompt: label,
        masked: e.masked,
        // A face-off always starts from a blank box so the second player can
        // never see what the first one typed.
        clear: !!e.masked,
        placeholder: e.masked ? 'Hidden so the next player can’t copy' : 'Type your answer and press Enter',
      });
      renderPlates();
      // Impatient players type over the host reading the question. Rather than
      // wiping that answer when the box goes live, submit it.
      if (queuedSubmit != null) {
        const queued = queuedSubmit;
        queuedSubmit = null;
        setTimeout(() => submitText(queued), 0);
      }
      break;
    }

    case 'faceoffEntry':
      setInputEnabled(false, { clear: true });
      break;

    case 'reveal': {
      boardView?.reveal(e.rank);
      const tile = el.board.querySelector(`.tile[data-rank="${e.rank}"]`);
      tile?.classList.add('just-revealed');
      setTimeout(() => tile?.classList.remove('just-revealed'), 700);
      audio.sfx('flip');
      setTimeout(() => audio.sfx('ding'), 120);
      renderPot();
      if (e.awarded) {
        if (e.rank === 1) { say('topAnswer'); cutIn('win'); }
        else if (Math.random() < 0.45) say('goodAnswer');
      }
      await delay(e.awarded ? 620 : 300);
      break;
    }

    case 'already':
      audio.sfx('nudge');
      toast(`Already on the board — no strike`, false, 1600);
      await delay(400);
      break;

    case 'faceoffMiss':
    case 'strike': {
      setInputEnabled(false);
      audio.sfx('strike');
      el.strikeOverlay.classList.remove('show');
      void el.strikeOverlay.offsetWidth;        // restart the animation
      el.strikeOverlay.classList.add('show');
      el.answerForm.classList.add('shake');
      setTimeout(() => el.answerForm.classList.remove('shake'), 450);
      renderStrikes();
      if (e.type === 'strike') { say('strike'); cutIn('strike'); }
      await delay(820);
      break;
    }

    case 'faceoffFailed':
      toast('Nobody found one — new question', true, 2000);
      await delay(900);
      break;

    case 'faceoffWon':
      toast(`${s.players[e.player].name} wins the face-off`);
      await delay(900);
      break;

    case 'awaitChoice':
      pendingInput = null;
      awaitingChoice = true;
      setInputEnabled(false);
      el.choiceRow.hidden = false;
      el.answerPrompt.textContent = `${s.players[e.who].name} — play or pass?`;
      el.answerForm.hidden = false;
      el.answerInput.hidden = true;
      renderPlates();
      break;

    case 'played':
      el.answerInput.hidden = false;
      toast(`${s.players[e.player].name} plays`);
      await delay(600);
      break;

    case 'passed':
      el.answerInput.hidden = false;
      toast(`Passed to ${s.players[e.to].name}`);
      await delay(900);
      break;

    case 'stealOffered':
      audio.sfx('steal');
      await say('threeStrikes');
      toast(`${s.players[e.player].name} can steal ${e.pot} points`, false, 2200);
      renderPlates();
      break;

    case 'stealSuccess':
      say('stealWin');
      toast('STOLEN!', false, 2200);
      await delay(700);
      break;

    case 'stealFailed':
      say('stealFail');
      toast('No steal — board stays', true, 2200);
      await delay(700);
      break;

    case 'bank': {
      setInputEnabled(false);
      el.choiceRow.hidden = true;
      audio.sfx('bank');
      renderPlates();
      renderPot();
      const who = s.players[e.player].name;
      toast(`${who} banks ${e.pot} × ${e.multiplier} = ${e.awarded}`, false, 3200);
      if (e.reason === 'cleared') say('boardCleared'); else say('bank');
      await delay(1400);
      el.answerPrompt.textContent = 'Press SPACE to continue';
      advanceAction = () => run(game.advanceRound());
      break;
    }

    case 'hostOverride':
      toast('Host override', false, 1100);
      break;

    case 'undo':
      toast('Undo', false, 1100);
      boardView = createBoard(el.board, s.question);
      s.revealed.forEach((on, i) => { if (on) boardView.reveal(i + 1); });
      el.question.textContent = s.question?.prompt ?? '';
      renderPlates(); renderStrikes(); renderPot();
      if (s.phase === PHASE.BOARD_PLAY) {
        await handle({ type: 'awaitInput', who: s.controller, context: 'board', masked: false });
      } else if (s.phase === PHASE.STEAL) {
        await handle({ type: 'awaitInput', who: s.stealer, context: 'steal', masked: false });
      }
      break;

    case 'mainResult': {
      const winner = s.players[e.winner];
      el.resultKicker.textContent = 'MAIN GAME WINNER';
      el.resultName.textContent = winner.name;
      el.resultDetail.textContent = s.players.map((p) => `${p.name} ${p.score}`).join('   ·   ');
      showScreen('result');
      audio.sfx('win');
      say('winner');
      if (!reduceMotion) stopConfetti = confetti(el.confetti, { duration: 5000 });
      await delay(1800);
      advanceAction = () => run(game.startFastMoney());
      el.resultKicker.textContent = 'MAIN GAME WINNER · SPACE FOR FAST MONEY';
      break;
    }

    // ------------------------------------------------------------ fast money

    case 'fmIntro':
      el.fmRows.replaceChildren();
      el.fmTotal.textContent = '0';
      el.fmWho.textContent = e.mode === 'solo'
        ? `${s.players[e.order[0]].name} plays for ${e.target}`
        : `${e.order.map((i) => s.players[i].name).join(' + ')} — target ${e.target}`;
      el.fmQuestion.textContent = 'Press SPACE when the first player is ready';
      el.fmForm.hidden = true;
      audio.sfx('bell');
      await say('fmIntro');
      advanceAction = () => run(game.fmBeginTurn());
      break;

    case 'fmTurnStart':
      renderFmRows();
      el.fmTimer.style.visibility = 'visible';
      el.fmWho.textContent = `${s.players[e.player].name} — ${e.seconds}s`;
      el.fmForm.hidden = false;
      el.fmInput.disabled = false;
      el.fmInput.value = '';
      setTimeout(() => el.fmInput.focus(), 30);
      await say('fmGo');
      startFmTimer(e.seconds);
      break;

    case 'fmQuestion':
      el.fmQuestion.textContent = e.question.prompt;
      markFmCurrent(e.index);
      el.fmInput.value = '';
      el.fmInput.focus();
      audio.speak(`q:${e.question.id}`, e.question.readAs ?? e.question.prompt);
      break;

    case 'fmAnswer':
      setFmCell(e.turn, e.index, e.text || '—');
      break;

    case 'fmLookaway':
      stopFmTimer();
      el.fmForm.hidden = true;
      await say('fmTimeUp');
      await showCurtain(
        'LOOK AWAY',
        `${s.players[e.nextPlayer].name} steps up — everyone else, eyes off the screen`,
        5
      );
      advanceAction = () => run(game.fmBeginTurn());
      el.fmQuestion.textContent = 'Press SPACE when ready';
      break;

    case 'fmRevealReady':
      stopFmTimer();
      el.fmTimer.style.visibility = 'hidden';
      el.fmWho.textContent = 'Revealing the answers';
      el.fmForm.hidden = true;
      el.fmQuestion.textContent = 'Press SPACE to reveal the answers';
      await say('fmTimeUp');
      advanceAction = () => run(game.fmReveal());
      break;

    case 'fmRevealEntry': {
      const cell = fmCell(e.turn, e.index);
      if (cell) {
        cell.textContent = e.text || '—';
        cell.classList.toggle('dupe', e.duplicate);
        cell.classList.remove('hidden-answer');
      }
      const row = el.fmRows.children[e.index];
      const pts = row?.querySelector('.fm-pts');
      if (pts) pts.textContent = String(Number(pts.textContent || 0) + e.points);
      audio.sfx(e.points > 0 && !e.duplicate ? 'ding' : 'buzz');
      el.fmTotal.textContent = String(
        [...el.fmRows.querySelectorAll('.fm-pts')].reduce((n, p) => n + Number(p.textContent || 0), 0)
      );
      await delay(620);
      break;
    }

    case 'fmDuplicate':
      await say('fmDuplicate');
      toast('Duplicate answer — one more question', true, 2600);
      el.fmQuestion.textContent = e.question.prompt;
      el.fmForm.hidden = false;
      el.fmInput.disabled = false;
      el.fmInput.value = '';
      el.fmInput.focus();
      audio.speak(`q:${e.question.id}`, e.question.readAs ?? e.question.prompt);
      break;

    case 'fmSpareResult':
      setFmCell(e.turn, e.index, e.text, { masked: false });
      fmCell(e.turn, e.index)?.classList.remove('dupe');
      audio.sfx(e.points > 0 ? 'ding' : 'buzz');
      await delay(500);
      break;

    case 'fmResult': {
      el.resultKicker.textContent = e.won ? 'BIG WINNERS' : 'SO CLOSE';
      el.resultName.textContent = `${e.total}`;
      el.resultDetail.textContent = e.won
        ? `Over the ${e.target} point target!`
        : `${e.target - e.total} points short of ${e.target}.`;
      showScreen('result');
      audio.sfx(e.won ? 'win' : 'lose');
      say(e.won ? 'fmWin' : 'fmLose');
      if (e.won && !reduceMotion) stopConfetti = confetti(el.confetti, { duration: 7000 });
      await delay(1500);
      advanceAction = () => location.reload();
      break;
    }

    case 'noop':
      if (e.reason) toast(e.reason, true, 1400);
      break;
  }
}

// ------------------------------------------------------------- fast money UI

function renderFmRows() {
  const fm = game.state.fm;
  if (el.fmRows.children.length === fm.questions.length) return;
  el.fmRows.replaceChildren();
  fm.questions.forEach((_, i) => {
    const row = document.createElement('div');
    row.className = 'fm-row';
    row.innerHTML =
      `<span class="fm-num">${i + 1}</span>` +
      `<span class="fm-a hidden-answer">•••••</span>` +
      `<span class="fm-b hidden-answer">•••••</span>` +
      `<span class="fm-pts">0</span>`;
    if (fm.order.length === 1) row.querySelector('.fm-b').style.visibility = 'hidden';
    el.fmRows.append(row);
  });
}

const fmCell = (turn, index) =>
  el.fmRows.children[index]?.querySelector(turn === 0 ? '.fm-a' : '.fm-b');

function setFmCell(turn, index, text, { masked = true } = {}) {
  const cell = fmCell(turn, index);
  if (!cell) return;
  // Masking is explicit rather than inferred from the phase: the engine has
  // already moved on by the time the last answer of a turn is handled, which
  // used to leak that answer onto the screen.
  cell.textContent = masked ? '\u2713' : (text || '\u2014');
  cell.classList.toggle('hidden-answer', masked);
}

function markFmCurrent(index) {
  [...el.fmRows.children].forEach((r, i) => r.classList.toggle('current', i === index));
}

function startFmTimer(seconds) {
  stopFmTimer();
  let left = seconds;
  const total = seconds;
  const paint = () => {
    el.fmTimerText.textContent = String(Math.ceil(left));
    el.fmTimer.style.setProperty('--t', String(Math.max(0, left / total)));
    el.fmTimer.classList.toggle('urgent', left <= 5);
  };
  paint();
  fmTimerHandle = setInterval(() => {
    left -= 0.1;
    paint();
    const whole = Math.ceil(left);
    if (left > 0 && Math.abs(left - whole) < 0.05 && whole <= 10) {
      audio.sfx(whole <= 5 ? 'tickUrgent' : 'tick');
    }
    if (left <= 0) {
      stopFmTimer();
      // Out of time: bank whatever is left as blanks.
      const fm = game.state.fm;
      const remaining = fm.questions.length - fm.qIndex;
      (async () => {
        for (let i = 0; i < remaining; i++) await run(game.fmSubmit(null));
      })();
    }
  }, 100);
}

function stopFmTimer() {
  if (fmTimerHandle) { clearInterval(fmTimerHandle); fmTimerHandle = null; }
  el.fmTimer.classList.remove('urgent');
}

function showCurtain(title, sub, seconds) {
  return new Promise((resolve) => {
    el.curtainTitle.textContent = title;
    el.curtainSub.textContent = sub;
    el.curtain.classList.add('show');
    let n = seconds;
    el.curtainCount.textContent = String(n);
    const t = setInterval(() => {
      n -= 1;
      el.curtainCount.textContent = n > 0 ? String(n) : '';
      audio.sfx('tick');
      if (n <= 0) {
        clearInterval(t);
        el.curtain.classList.remove('show');
        resolve();
      }
    }, 1000);
  });
}

// ------------------------------------------------------------------ input

function submitText(text) {
  const clean = String(text ?? '').trim();
  if (!clean) return;
  if (!pendingInput) {
    // Typed ahead of the host. Hold it and fire the moment the box goes live.
    queuedSubmit = clean;
    el.answerInput.value = '';
    return;
  }
  const ctx = pendingInput.context;
  pendingInput = null;
  el.answerInput.value = '';
  if (ctx === 'faceoff') run(game.submitFaceoff(clean));
  else if (ctx === 'board') run(game.submitBoard(clean));
  else if (ctx === 'steal') run(game.submitSteal(clean));
}

el.answerForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  submitText(el.answerInput.value);
});

el.fmForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const text = el.fmInput.value.trim();
  if (!text) return;
  el.fmInput.value = '';
  if (game.state.phase === PHASE.FM_DUPLICATE) run(game.fmSubmitSpare(text));
  else if (game.state.phase === PHASE.FM_PLAY) run(game.fmSubmit(text));
});

function makeChoice(which) {
  if (!awaitingChoice) return;      // ignore keys pressed before the prompt is up
  awaitingChoice = false;
  el.choiceRow.hidden = true;
  run(game.choose(which));
}

el.choiceRow.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-choice]');
  if (btn) makeChoice(btn.dataset.choice);
});

// ------------------------------------------------------------------ keys

function inTextField(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

window.addEventListener('keydown', (ev) => {
  audio.unlock();

  const screen = el.stage.dataset.screen;
  const typing = inTextField(ev.target);
  const hasText = typing && ev.target.value.length > 0;

  // Host keys work when the box is empty or unfocused. With text in it, hold
  // Alt — otherwise "3" would reveal an answer mid-word.
  const hostKeysLive = (!typing || !hasText || ev.altKey) && game;

  if (ev.key === '?' || (ev.key === '/' && ev.shiftKey)) {
    el.keyhelp.hidden = !el.keyhelp.hidden;
    ev.preventDefault();
    return;
  }

  if (screen === 'attract' && ev.key === 'Enter') { gotoSetup(); return; }

  if (screen === 'setup' && ev.key === 'Enter' && !typing) { startMatch(); return; }

  if (ev.key === 'Escape') {
    if (!el.keyhelp.hidden) { el.keyhelp.hidden = true; return; }
    if (game && confirm('Leave the match and return to the menu?')) location.reload();
    return;
  }

  if (ev.key === ' ' || ev.code === 'Space') {
    if (advanceAction && !hasText) {
      ev.preventDefault();
      const fn = advanceAction;
      advanceAction = null;
      fn();
    }
    return;
  }

  if (ev.key.toLowerCase() === 'm' && !hasText) {
    toggleMute();
    if (!typing) ev.preventDefault();
    return;
  }

  if (!hostKeysLive) return;

  if (awaitingChoice) {
    if (ev.key.toLowerCase() === 'p') { ev.preventDefault(); makeChoice('play'); return; }
    if (ev.key.toLowerCase() === 's') { ev.preventDefault(); makeChoice('pass'); return; }
  }

  if (ev.key >= '1' && ev.key <= '8') {
    ev.preventDefault();
    run(game.forceReveal(Number(ev.key)));
    return;
  }
  if (ev.key.toLowerCase() === 'x') { ev.preventDefault(); run(game.forceStrike()); return; }
  if (ev.key.toLowerCase() === 'z') { ev.preventDefault(); run(game.undo()); return; }
});

function toggleMute() {
  audio.setMuted(!audio.isMuted);
  el.muteBtn.classList.toggle('muted', audio.isMuted);
  el.muteBtn.textContent = audio.isMuted ? '✕' : '♫';
}
el.muteBtn.addEventListener('click', toggleMute);

// ------------------------------------------------------------------ setup UI

function renderNameInputs() {
  el.nameGrid.replaceChildren();
  for (let i = 0; i < setup.count; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 18;
    input.value = setup.names[i];
    input.setAttribute('aria-label', `Player ${i + 1} name`);
    input.addEventListener('input', () => { setup.names[i] = input.value; });
    el.nameGrid.append(input);
  }
}

function wireSegment(root, onPick, attr) {
  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    [...root.querySelectorAll('button')].forEach((b) => b.classList.toggle('on', b === btn));
    onPick(btn.dataset[attr]);
  });
}

wireSegment(el.playerCount, (n) => { setup.count = Number(n); renderNameInputs(); }, 'n');
wireSegment(el.fmMode, (v) => { setup.fmMode = v; }, 'v');
wireSegment(el.targetMode, (v) => { setup.target = v; }, 'v');
el.startBtn.addEventListener('click', startMatch);

function gotoSetup() {
  audio.unlock();
  showScreen('setup');
  say('showOpen');
}

function startMatch() {
  const names = setup.names.slice(0, setup.count).map((n, i) => n.trim() || `Player ${i + 1}`);
  game = createGame({
    mainQuestions: surveys.main,
    fmQuestions: surveys.fastMoney,
    players: names,
    seed: Date.now(),
    settings: {
      fastMoneyMode: setup.fmMode,
      targetScore: setup.target === 'on' ? 300 : null,
    },
  });
  Object.assign(window.__feud, { game, run });
  el.answerInput.hidden = false;
  run(game.startRound());
}

// ------------------------------------------------------------------ boot

async function main() {
  initStage();
  // Readiness flags: the engine's phase changes synchronously but the screen
  // catches up asynchronously, so "what is the UI actually waiting for" is a
  // different question from "what phase is the game in". Tests and devtools
  // need the former.
  window.__feud = {
    audio, game: null, run: null,
    ui: {
      get pendingInput() { return pendingInput; },
      get awaitingChoice() { return awaitingChoice; },
      get awaitingAdvance() { return !!advanceAction; },
      get busy() { return draining; },
    },
  };

  try {
    surveys = await loadSurveys();
  } catch (err) {
    console.error(err);
    showScreen('attract');
    document.querySelector('.tagline').textContent = err.message;
    return;
  }

  const found = await initArt();
  cutinAvailable.win = found.some((s) => s.includes('bella-win'));
  cutinAvailable.strike = found.some((s) => s.includes('bella-strike'));
  console.info(`[art] ${found.length} asset(s) loaded; CSS fallbacks cover the rest`);

  // Browsers block audio until a gesture; the attract screen is that gesture.
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, { once: true });

  renderNameInputs();
  showScreen('attract');
}

main();
