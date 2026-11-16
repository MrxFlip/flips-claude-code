// BELLAFOX FEUD — presentation layer.
//
// src/game.js owns the rules and returns events; this file turns those events
// into screens, animation and sound. Nothing here decides game outcomes, which
// is why the whole match can be tested headlessly in tools/test-game.mjs.
//
// Flow, as the player sees it:
//   title -> setup -> [round card -> face-off -> board -> round summary] x N
//         -> winner -> Fast Money -> final result -> play again / menu
// Every step that waits on a person shows exactly one control in one place
// (the console under the board, or a single primary button), so nobody ever
// has to ask "what do I press now?".

import { initStage } from './src/stage.js?v=20261116-feud5';
import { loadSurveys } from './src/data.js?v=20261116-feud5';
import { createBoard } from './src/board.js?v=20261116-feud5';
import { createGame, PHASE, FM_TIME } from './src/game.js?v=20261116-feud5';
import { createAudio } from './src/audio.js?v=20261116-feud5';
import { initArt } from './src/art.js?v=20261116-feud5';
import { confetti } from './src/confetti.js?v=20261116-feud5';
import { hostLine } from './src/host-lines.js?v=20261116-feud5';
import { createNet, resolveRelayUrl, snapshotFor, eventsFor } from './src/net.js?v=20261116-feud5';

const $ = (id) => document.getElementById(id);
const el = {
  stage: $('stage'),
  // title + setup
  playBtn: $('playBtn'), howBtn: $('howBtn'), titleFoot: $('titleFoot'),
  nameGrid: $('nameGrid'), playerCount: $('playerCount'), countNote: $('countNote'),
  optRounds: $('optRounds'), optFaceoff: $('optFaceoff'), optClock: $('optClock'), optFm: $('optFm'),
  optFaceoffRow: $('optFaceoffRow'), optFmRow: $('optFmRow'),
  startBtn: $('startBtn'), setupBackBtn: $('setupBackBtn'), setupHowBtn: $('setupHowBtn'),
  // online lobby
  modeSeg: $('modeSeg'), lobby: $('lobby'), lobbyChoice: $('lobbyChoice'), lobbyRoom: $('lobbyRoom'),
  lobbyCode: $('lobbyCode'), lobbyHint: $('lobbyHint'), lobbyPlayers: $('lobbyPlayers'),
  lobbyError: $('lobbyError'), createRoomBtn: $('createRoomBtn'), joinRoomBtn: $('joinRoomBtn'),
  joinCode: $('joinCode'), leaveRoomBtn: $('leaveRoomBtn'), rulesPanel: $('rulesPanel'),
  netBadge: $('netBadge'),
  // round card
  rcKicker: $('rcKicker'), rcLabel: $('rcLabel'), rcSub: $('rcSub'), rcPips: $('rcPips'), rcVersus: $('rcVersus'),
  // play
  roundChipLabel: $('roundChipLabel'), roundChipMult: $('roundChipMult'), roundChipSub: $('roundChipSub'),
  potBox: $('potBox'), pot: $('pot'), potSub: $('potSub'),
  questionBanner: $('questionBanner'), question: $('question'), board: $('board'),
  podiumsLeft: $('podiumsLeft'), podiumsRight: $('podiumsRight'),
  strikes: $('strikes'),
  console: $('console'), consoleStatus: $('consoleStatus'),
  buzzA: $('buzzA'), buzzB: $('buzzB'), buzzAKey: $('buzzAKey'), buzzBKey: $('buzzBKey'), buzzAName: $('buzzAName'), buzzBName: $('buzzBName'),
  answerForm: $('answerForm'), answerInput: $('answerInput'),
  clock: $('clock'), clockText: $('clockText'),
  choiceRow: $('choiceRow'), continueBtn: $('continueBtn'),
  host: $('host'),
  // fast money
  fmWho: $('fmWho'), fmTimer: $('fmTimer'), fmTimerText: $('fmTimerText'),
  fmQuestion: $('fmQuestion'), fmRows: $('fmRows'), fmColA: $('fmColA'), fmColB: $('fmColB'),
  fmForm: $('fmForm'), fmInput: $('fmInput'), fmPassBtn: $('fmPassBtn'),
  fmContinue: $('fmContinue'), fmContinueBtn: $('fmContinueBtn'),
  fmTotal: $('fmTotal'), fmTarget: $('fmTarget'), fmBar: $('fmBar'),
  // result
  resultKicker: $('resultKicker'), resultName: $('resultName'), resultDetail: $('resultDetail'),
  standings: $('standings'), resultPrimary: $('resultPrimary'),
  resultAgain: $('resultAgain'), resultSetup: $('resultSetup'), resultMenu: $('resultMenu'),
  confetti: $('confetti'),
  // overlays
  guess: $('guess'), guessWho: $('guessWho'), guessText: $('guessText'),
  strikeOverlay: $('strikeOverlay'), strikeSet: $('strikeSet'),
  curtain: $('curtain'), curtainTitle: $('curtainTitle'), curtainSub: $('curtainSub'), curtainCount: $('curtainCount'),
  toast: $('toast'), subtitle: $('subtitle'), wipe: $('wipe'),
  menuBtn: $('menuBtn'), muteBtn: $('muteBtn'),
  menu: $('menu'), volume: $('volume'),
  howto: $('howto'), howClose: $('howClose'),
  keyhelp: $('keyhelp'), keysClose: $('keysClose'),
};

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// ------------------------------------------------------------- persistence

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`bfeud.${key}`);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`bfeud.${key}`, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

const setup = {
  count: 2,
  names: ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
  rounds: 3,
  faceoff: 'buzz',     // 'buzz' | 'turns'
  clock: 30,           // seconds, 0 = off
  fmMode: 'both',      // 'both' | 'solo'
  ...store.get('setup', {}),
};

// -------------------------------------------------------- cancellable time
//
// Quitting to the menu or restarting must not let a half-finished animation
// from the old match scribble on the new one. Every match gets an epoch; a
// wait that wakes up in a different epoch throws CANCEL, which unwinds the
// event handler it was in.

let epoch = 0;
const CANCEL = Symbol('cancelled');

function delay(ms, { exact = false } = {}) {
  const born = epoch;
  const wait = reduceMotion && !exact ? Math.min(ms, 260) : ms;
  return new Promise((resolve, reject) => {
    setTimeout(() => (born === epoch ? resolve() : reject(CANCEL)), wait);
  });
}

async function live(promise) {
  const born = epoch;
  const value = await promise;
  if (born !== epoch) throw CANCEL;
  return value;
}

const swallow = (err) => { if (err !== CANCEL) console.error(err); };

// ------------------------------------------------------------------ state

const audio = createAudio();
let surveys = null;
let game = null;
let boardView = null;
let artUrls = new Map();

let advance = null;            // { fn } — what the primary button / Space does right now
let pendingInput = null;       // { context, who } — a person at THIS screen owes an answer
let engineAwait = null;        // { context, who } — what the engine is waiting on, whoever
                               // owns it. Only meaningful on the machine with the engine.
let choiceWho = null;          // seat the engine wants PLAY/PASS from, ours or not
let actingWho = null;          // display only: whose podium is lit
let queuedSubmit = null;       // an answer typed before the box went live
let awaitingChoice = false;    // PLAY/PASS is on screen
let awaitingBuzz = null;       // { slots: [playerId, playerId] }
let guessing = false;          // the "survey says" beat is playing
let paused = false;            // pause menu is open: clocks hold
let shownScores = [];          // scores as displayed (they count up after the engine banks)
let podiumEls = [];
let missedAnnounced = false;
let fmShownTotal = 0;
let fmTimerHandle = null;
let clockHandle = null;
let stopConfetti = null;
let hostTimer = 0;

const PLAYER_COLORS = ['#49d5ff', '#ff8a5c', '#c39bff', '#6fe39a'];

// ------------------------------------------------------------------ online
//
// One browser runs the engine and posts the events it produces; the others
// render them through the same handle(). See src/net.js. `online` stays false
// for a same-screen game and every branch below collapses to plain local play.
const net = createNet();
let relayUrl = null;
let mode = 'local';            // what the setup screen is set to: 'local' | 'online'
let online = false;            // true once this browser is in a room
let mySeat = 0;
const isHost = () => !online || mySeat === 0;
/** True when this screen owns the input the engine is currently waiting for. */
const myTurn = (who) => !online || who === mySeat;
const hostName = () => net.players.find((pl) => pl.seat === 0)?.name ?? 'the host';
const BUZZ_KEYS = ['A', 'L'];

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
  [PHASE.FM_RESULT]: 'fm',      // stay on the board; the result screen follows the reveal
};

function showScreen(name) {
  const from = el.stage.dataset.screen;
  if (from === name) return;
  el.stage.dataset.screen = name;
  if (name !== 'result' && stopConfetti) { stopConfetti(); stopConfetti = null; }
  // A light streak crosses the stage on every cut, so screens change like a
  // broadcast transition instead of popping.
  if (!reduceMotion) {
    el.wipe.classList.remove('go');
    void el.wipe.offsetWidth;
    el.wipe.classList.add('go');
    audio.sfx('whoosh');
  }
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

/** Speak a host line and wait for it. Throws CANCEL if the match ended meanwhile. */
function say(bucket, priority = 'queue') {
  const { key, text, index } = hostLine(bucket);
  return live(audio.speak(key, text, { index, priority }));
}
/**
 * Speak a host line without holding the game up for it. Reactions default to
 * 'chatter': dropped if Bella is already mid-line rather than queued behind it.
 */
const sayBg = (bucket, priority = 'chatter') => { say(bucket, priority).catch(swallow); };

/** Swap Bella's pose in the corner of the play screen, then settle back. */
function setHost(pose, ms = 0) {
  const src = artUrls.get(`bella-${pose}`) ?? artUrls.get('bella-idle');
  clearTimeout(hostTimer);
  if (!src) return;
  if (!el.host.src.endsWith(src)) {
    el.host.src = src;
    el.host.classList.remove('pop');
    void el.host.offsetWidth;
    el.host.classList.add('pop');
  }
  if (ms) hostTimer = setTimeout(() => setHost('idle'), ms);
}

function setAdvance(label, fn) {
  // Online, the host moves the show along, the way a real host does. Guests
  // see the same button, parked, saying who they are waiting for.
  const guest = online && !isHost();
  advance = guest ? null : { fn };
  for (const btn of [el.continueBtn, el.fmContinueBtn, el.resultPrimary]) {
    btn.innerHTML = '';
    btn.disabled = guest;
    if (guest) { btn.append(`WAITING FOR ${hostName().toUpperCase()}`); continue; }
    btn.append(`${label} `);
    const k = document.createElement('kbd');
    k.textContent = 'SPACE';
    btn.append(k);
  }
  el.fmContinue.hidden = false;
  el.resultPrimary.hidden = false;
}

function clearAdvance() {
  advance = null;
  el.fmContinue.hidden = true;
}

function fireAdvance() {
  if (!advance || paused) return;
  const { fn } = advance;
  clearAdvance();
  audio.sfx('click');
  fn();
}

// ------------------------------------------------------------- play screen

const name = (i) => game.state.players[i].name;

function buildPodiums() {
  const s = game.state;
  el.podiumsLeft.replaceChildren();
  el.podiumsRight.replaceChildren();
  podiumEls = s.players.map((p, i) => {
    const d = document.createElement('div');
    d.className = 'podium';
    d.style.setProperty('--pc', PLAYER_COLORS[i]);
    d.innerHTML =
      '<span class="podium-avatar"></span>' +
      '<span class="podium-name"></span>' +
      '<span class="podium-score">0</span>' +
      '<span class="podium-tag"></span>';
    d.querySelector('.podium-avatar').textContent = /^player \d$/i.test(p.name.trim())
      ? String(i + 1) : (p.name.trim()[0] ?? '?').toUpperCase();
    d.querySelector('.podium-name').textContent = p.name;
    if (online && i === mySeat) d.classList.add('you');
    (i % 2 === 0 ? el.podiumsLeft : el.podiumsRight).append(d);
    return d;
  });

  if (s.solo) {
    const best = store.get('best', 0);
    const d = document.createElement('div');
    d.className = 'podium podium-best';
    d.innerHTML =
      '<span class="podium-avatar">★</span>' +
      '<span class="podium-name">Best run</span>' +
      `<span class="podium-score">${best}</span>` +
      '<span class="podium-tag">Beat it</span>';
    el.podiumsRight.append(d);
  }
  el.stage.dataset.players = String(s.players.length);
}

function updatePodiums() {
  if (!game) return;
  const s = game.state;
  const acting = actingWho;
  const top = Math.max(...shownScores);
  s.players.forEach((p, i) => {
    const d = podiumEls[i];
    if (!d) return;
    let tag = '';
    if (awaitingBuzz) {
      const slot = awaitingBuzz.slots.indexOf(i);
      if (slot >= 0) tag = online ? 'At the buzzer' : `Buzzer: ${BUZZ_KEYS[slot]}`;
    } else if (s.phase === PHASE.FACEOFF && s.faceoff?.pair.includes(i)) tag = 'Face-off';
    else if (s.phase === PHASE.PLAY_OR_PASS && i === s.controller) tag = 'Has control';
    else if (s.phase === PHASE.BOARD_PLAY && i === s.controller) tag = s.solo ? 'Playing' : 'Playing the board';
    else if (s.phase === PHASE.BOARD_PLAY && i === s.stealer) tag = 'Waiting to steal';
    else if (s.phase === PHASE.STEAL && i === s.stealer) tag = 'Stealing!';
    else if (s.phase === PHASE.STEAL && i === s.controller) tag = 'Struck out';

    d.classList.toggle('active', acting === i || (awaitingBuzz?.slots.includes(i) ?? false));
    d.classList.toggle('stealing', s.phase === PHASE.STEAL && i === s.stealer);
    d.classList.toggle('leader', !s.solo && top > 0 && shownScores[i] === top);
    d.querySelector('.podium-score').textContent = String(shownScores[i] ?? 0);
    d.querySelector('.podium-tag').textContent = tag;
  });
}

function renderStrikes() {
  const slots = el.strikes.querySelectorAll('.strike-slot');
  slots.forEach((slot, i) => slot.classList.toggle('on', i < game.state.strikes));
}

function renderPot(bump = false) {
  const s = game.state;
  const mult = s.round?.multiplier ?? 1;
  el.pot.textContent = String(s.pot);
  el.potSub.textContent = mult > 1 && s.pot > 0 ? `×${mult} = ${s.pot * mult} points` : 'up for grabs';
  if (bump) {
    el.potBox.classList.remove('bump');
    void el.potBox.offsetWidth;
    el.potBox.classList.add('bump');
  }
}

function renderRoundChip() {
  const s = game.state;
  if (!s.round) return;
  el.roundChipLabel.textContent = s.suddenDeath
    ? 'SUDDEN DEATH'
    : `ROUND ${s.roundIndex + 1} OF ${s.totalRounds}`;
  el.roundChipMult.textContent = `×${s.round.multiplier}`;
  el.roundChipSub.textContent = s.round.sub;
}

/**
 * The console under the board. One mode at a time:
 * idle | buzz | input | choice | continue
 */
function setConsole(mode, status = '', who = null) {
  el.console.dataset.mode = mode;
  el.consoleStatus.textContent = status || ' ';
  el.console.style.setProperty('--pc', who != null ? PLAYER_COLORS[who] : 'var(--gold)');
  const typing = mode === 'input';
  el.answerInput.disabled = !typing;
  if (typing) setTimeout(() => { if (el.console.dataset.mode === 'input') el.answerInput.focus(); }, 20);
  else el.answerInput.blur();
}

// ---------------------------------------------------------------- answer clock

function stopClock() {
  if (clockHandle) { clearInterval(clockHandle); clockHandle = null; }
  el.clock.hidden = true;
  el.clock.classList.remove('urgent');
}

function startClock(seconds, onExpire) {
  stopClock();
  if (!seconds) return;
  let left = seconds;
  let lastWhole = Math.ceil(left);
  const paint = () => {
    el.clockText.textContent = String(Math.max(0, Math.ceil(left)));
    el.clock.style.setProperty('--t', String(Math.max(0, left / seconds)));
    el.clock.classList.toggle('urgent', left <= 5);
  };
  el.clock.hidden = false;
  paint();
  clockHandle = setInterval(() => {
    if (paused) return;
    left -= 0.1;
    paint();
    const whole = Math.ceil(left);
    if (whole !== lastWhole) {
      lastWhole = whole;
      if (whole <= 5 && whole > 0) audio.sfx('tickUrgent');
    }
    if (left <= 0) { stopClock(); onExpire(); }
  }, 100);
}

function answerTimedOut() {
  // A guest's clock is a display of the host's; only the engine's owner acts.
  if (!isHost() || !engineAwait || guessing) return;
  engineAwait = null;
  pendingInput = null;
  run([{ type: 'timeUp' }]);
  run(game.timeout());
}

// ------------------------------------------------------------------ driver

// The engine mutates state synchronously but presentation is async, so a fast
// key press can hand us a second batch while the first is still animating.
// Batches are therefore queued and drained one at a time — otherwise two event
// streams interleave and the screen ends up describing neither of them.
let draining = false;
const batchQueue = [];

async function run(events) {
  // The host posts each batch as the engine produces it, with the state that
  // batch has already left behind. Guests adopt the state and then render the
  // events, which is the same order the host sees them in.
  if (online && isHost() && Array.isArray(events) && events.some((e) => e.type !== 'noop')) broadcast(events);
  batchQueue.push({ born: epoch, events });
  if (draining) return;
  draining = true;
  try {
    while (batchQueue.length) {
      const batch = batchQueue.shift();
      if (batch.born !== epoch) continue;        // left over from a match that was quit
      try {
        for (const e of batch.events) await handle(e);
      } catch (err) {
        if (err !== CANCEL) throw err;
      }
    }
  } finally {
    draining = false;
  }
}

function broadcast(events) {
  if (!game) return;
  const bySeat = {};
  for (const pl of net.players) {
    if (pl.seat === 0) continue;
    bySeat[pl.seat] = { events: eventsFor(events, pl.seat), state: snapshotFor(game.state, pl.seat) };
  }
  if (Object.keys(bySeat).length) net.relay({ k: 'events', bySeat });
}

async function handle(e) {
  const s = game.state;

  switch (e.type) {
    case 'phase':
      showScreen(SCREEN_FOR_PHASE[e.to] ?? 'play');
      el.stage.classList.toggle('steal-mode', e.to === PHASE.STEAL);
      updatePodiums();
      renderStrikes();
      renderPot();
      break;

    case 'roundCard': {
      renderRoundChip();
      el.rcKicker.textContent = e.suddenDeath ? 'ALL TIED UP'
        : e.isFinal ? 'FINAL ROUND'
        : `ROUND ${e.roundNumber} OF ${e.totalRounds}`;
      el.rcLabel.textContent = e.round.label;
      el.rcSub.textContent = e.round.sub;
      el.rcPips.replaceChildren();
      if (!e.suddenDeath) {
        for (let i = 0; i < e.totalRounds; i++) {
          const pip = document.createElement('i');
          if (i < e.roundNumber - 1) pip.className = 'done';
          if (i === e.roundNumber - 1) pip.className = 'now';
          el.rcPips.append(pip);
        }
      }
      el.rcVersus.replaceChildren();
      if (e.pair) {
        const [a, b] = e.pair;
        const mk = (i) => {
          const sp = document.createElement('span');
          sp.textContent = name(i);
          sp.style.color = PLAYER_COLORS[i];
          return sp;
        };
        el.rcVersus.append(mk(a), ' vs ', mk(b), ' at the buzzers');
      } else {
        el.rcVersus.textContent = 'Three strikes and the board is closed';
      }
      audio.sfx(e.roundNumber === 1 ? 'theme' : 'roundStart');
      if (e.suddenDeath) sayBg('suddenDeath', 'queue');
      else if (e.isFinal && e.round.multiplier === 3) sayBg('finalRound', 'queue');
      else if (e.roundNumber > 1) sayBg('roundOpen', 'queue');
      else if (s.solo) sayBg('soloOpen', 'queue');
      await delay(e.roundNumber === 1 ? 2900 : 2300);
      // The host drives; a guest just waits for the next batch to arrive.
      if (isHost()) await run(game.beginFaceoff());
      break;
    }

    case 'readQuestion': {
      el.board.classList.remove('no-enter');
      boardView = createBoard(el.board, e.question);
      missedAnnounced = false;
      el.question.textContent = e.question.prompt;
      el.questionBanner.classList.remove('enter');
      void el.questionBanner.offsetWidth;
      el.questionBanner.classList.add('enter');
      markSeen(e.question.id);
      renderRoundChip();
      renderPot();
      renderStrikes();
      setHost('idle');
      actingWho = null;
      // A read that opens a face-off gets a lead-in line; both are queued so
      // the question follows it. Any other read cuts off whatever is playing.
      if (e.lead) sayBg('faceoff', 'queue');
      const reading = live(audio.speak(`q:${e.question.id}`, e.question.readAs ?? e.question.prompt,
        { priority: e.lead ? 'queue' : 'interrupt' }));
      if (e.faceoff && e.buzz) {
        // Buzzers are live while Bella is still reading, like the real thing.
        reading.catch(swallow);
        setConsole('idle', 'Face-off — listen for the question…');
        await delay(650);
      } else if (online) {
        setConsole('idle', 'Bella is reading the question…');
        await reading;
      } else {
        // Typing ahead is allowed: the box is open while she reads.
        setConsole('input', 'Bella is reading the question — type as soon as you know');
        await reading;
      }
      break;
    }

    case 'awaitBuzz': {
      const slots = [...e.pair].sort((a, b) => a - b);
      awaitingBuzz = { slots };
      pendingInput = null;
      engineAwait = null;
      actingWho = null;
      [el.buzzA, el.buzzB].forEach((btn, i) => btn.style.setProperty('--pc', PLAYER_COLORS[slots[i]]));
      el.buzzAName.textContent = name(slots[0]);
      el.buzzBName.textContent = name(slots[1]);
      // Same screen: two buzzers, one keyboard. Online: everyone has their own
      // screen, so each player sees only their own buzzer and the rest watch.
      const mine = online ? slots.indexOf(mySeat) : -1;
      el.buzzA.hidden = online && mine !== 0;
      el.buzzB.hidden = online && mine !== 1;
      el.buzzAKey.textContent = online ? 'SPACE' : BUZZ_KEYS[0];
      el.buzzBKey.textContent = online ? 'SPACE' : BUZZ_KEYS[1];
      if (online && mine < 0) setConsole('idle', `${name(slots[0])} and ${name(slots[1])} are at the buzzers`);
      else setConsole('buzz', online ? 'Know one? Buzz in before they do' : 'Know one? First to buzz answers first');
      updatePodiums();
      break;
    }

    case 'buzzed':
      awaitingBuzz = null;
      audio.stopVoice();                 // Bella stops reading on every screen
      if (online && e.player !== mySeat) audio.sfx('buzzIn');
      toast(`${name(e.player)} buzzed in!`, false, 1300);
      podiumEls[e.player]?.classList.add('flash');
      setTimeout(() => podiumEls[e.player]?.classList.remove('flash'), 700);
      updatePodiums();
      await delay(350);
      break;

    case 'awaitInput': {
      engineAwait = { context: e.context, who: e.who };
      // pendingInput means "a person at THIS screen owes an answer", which is
      // not the same question as "the engine is waiting". Conflating them lets
      // one player's words be submitted as another's.
      pendingInput = myTurn(e.who) ? { context: e.context, who: e.who } : null;
      actingWho = e.who;
      awaitingChoice = false;
      choiceWho = null;
      awaitingBuzz = null;
      clearAdvance();
      const who = name(e.who);
      let label;
      if (e.context === 'faceoff') {
        const first = s.faceoff.results[0];
        if (s.faceoff.turn === 0) label = `${who} — what’s your answer?`;
        else if (first?.rank) label = `${who} — beat that answer to take control`;
        else label = `${who} — get on the board and control is yours`;
      } else if (e.context === 'steal') {
        label = `${who} — ONE guess to steal ${s.pot * s.round.multiplier} points`;
      } else {
        const left = s.revealed.filter((r) => !r).length;
        label = `${who} — ${left} answer${left === 1 ? '' : 's'} still hidden`;
      }
      if (myTurn(e.who)) {
        setConsole('input', label, e.who);
        el.answerInput.placeholder = 'Type your answer and press Enter';
      } else {
        // Online: that player has their own keyboard. This screen watches.
        setConsole('idle', e.context === 'steal' ? `${who} can steal — waiting for their guess`
          : `Waiting for ${who}…`, e.who);
      }
      setHost('think');
      updatePodiums();
      startClock(s.clock ?? setup.clock, answerTimedOut);
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
      break;

    // UI-only events. They come from this file, not the engine, and travel to
    // guests in the same stream so every screen plays the same beat.
    case 'guess':
      stopClock();
      await showGuess(e.who, e.text);
      break;

    case 'timeUp':
      stopClock();
      pendingInput = null;
      el.answerInput.value = '';
      setConsole('idle');
      toast('OUT OF TIME', true, 1500);
      sayBg('timeUp');
      break;

    case 'faceoffRetry':
      // The question stays up. Both players go again, as many times as it
      // takes — there are no strikes in the face-off.
      actingWho = null;
      toast('Nothing on the board — go again', true, 2000);
      await delay(1300);
      break;

    case 'questionSkipped':
      toast('New question', false, 1600);
      await delay(600);
      break;

    case 'reveal': {
      boardView?.reveal(e.rank, e.text, e.points);
      // The entrance animation is over by now; retire it so nothing can replay
      // it (see the .no-enter note in styles.css).
      el.board.classList.add('no-enter');
      const tile = el.board.querySelector(`.tile[data-rank="${e.rank}"]`);
      if (e.missed) {
        if (!missedAnnounced) {
          missedAnnounced = true;
          setConsole('idle', 'Still on the board…');
          sayBg('missedAnswers');
          await delay(700);
        }
        tile?.classList.add('missed');
        audio.sfx('flip');
        setTimeout(() => audio.sfx('miss'), 140);
        await delay(680);
        break;
      }
      tile?.classList.add('just-revealed');
      setTimeout(() => tile?.classList.remove('just-revealed'), 900);
      // The ding lands as the tile finishes turning, not as it starts.
      audio.sfx('flip');
      setTimeout(() => audio.sfx('ding'), 360);
      renderPot(e.awarded);
      if (e.awarded) {
        setHost('win', 1500);
        if (e.rank === 1) sayBg('topAnswer');
        else if (Math.random() < 0.5) sayBg('goodAnswer');
      }
      await delay(e.awarded ? 950 : 350);
      break;
    }

    case 'already':
      audio.sfx('nudge');
      // Name it: "already on the board" alone is baffling when the matcher
      // resolved your words to something you would not have guessed.
      toast(`“${e.text}” is already up — no strike`, false, 2200);
      await delay(500);
      break;

    case 'faceoffMiss':
    case 'strike': {
      actingWho = null;
      setConsole('idle');
      showStrike(e.type === 'strike' ? e.count : 1);
      renderStrikes();
      setHost('strike', 1500);
      if (e.type === 'strike' && !e.timedOut) sayBg('strike');
      await delay(1150);
      break;
    }

    case 'faceoffWon':
      toast(`${name(e.player)} wins the face-off`, false, 1700);
      updatePodiums();
      await delay(1100);
      break;

    case 'awaitChoice':
      pendingInput = null;
      engineAwait = null;
      choiceWho = e.who;
      actingWho = e.who;
      awaitingChoice = myTurn(e.who);
      clearAdvance();
      stopClock();
      if (awaitingChoice) setConsole('choice', `${name(e.who)} — play or pass?`, e.who);
      else setConsole('idle', `${name(e.who)} is choosing: play or pass`, e.who);
      setHost('idle');
      sayBg('playOrPass');
      updatePodiums();
      break;

    case 'played':
      choiceWho = null; awaitingChoice = false;
      toast(`${name(e.player)} will play`, false, 1300);
      await delay(700);
      break;

    case 'passed':
      choiceWho = null; awaitingChoice = false;
      toast(`${name(e.from)} passes — ${name(e.to)} must play`, false, 1900);
      await delay(1100);
      break;

    case 'stealOffered':
      stopClock();
      setConsole('idle', 'Three strikes!');
      audio.sfx('steal');
      updatePodiums();
      actingWho = e.player;
      await say('threeStrikes');
      toast(`${name(e.player)} can steal ${e.pot * s.round.multiplier} points`, false, 2200);
      break;

    case 'stealSuccess':
      sayBg('stealWin', 'queue');
      toast('STOLEN!', false, 2200);
      setHost('win', 1800);
      await delay(900);
      break;

    case 'stealFailed':
      setConsole('idle');
      showStrike(1);
      sayBg('stealFail', 'queue');
      toast('No steal — the points stay put', true, 2200);
      setHost('strike', 1500);
      await delay(1200);
      break;

    case 'bank': {
      stopClock();
      pendingInput = null;
      engineAwait = null;
      actingWho = null;
      el.stage.classList.remove('steal-mode');
      const who = name(e.player);
      const sum = e.multiplier > 1 ? `${e.pot} × ${e.multiplier} = ${e.awarded}` : `${e.awarded}`;
      setConsole('idle', e.awarded > 0 ? `${who} banks ${sum} points` : 'Nothing in the pot this round', e.player);
      if (e.reason === 'cleared') sayBg('boardCleared');
      else if (e.reason === 'struckOut') sayBg('struckOut');
      else if (e.reason !== 'steal' && e.reason !== 'stealFailed') sayBg('bank');
      if (e.awarded > 0) {
        audio.sfx('bank');
        audio.sfx('applause');
        await countScore(e.player, s.players[e.player].score, e.awarded);
      }
      el.potSub.textContent = e.awarded > 0 ? `banked by ${who}` : 'nobody scored';
      updatePodiums();
      await delay(700);
      break;
    }

    case 'roundEnd': {
      const who = name(e.player);
      let status = e.awarded > 0 ? `${who} +${e.awarded}` : 'No points banked';
      let label = 'NEXT ROUND';
      if (e.next === 'suddenDeath') { status += ' · all tied — sudden death decides it'; label = 'SUDDEN DEATH'; }
      else if (e.next === 'result') { label = s.solo ? 'SEE YOUR SCORE' : 'AND THE WINNER IS…'; }
      else if (!s.solo) {
        const top = Math.max(...e.scores);
        const leaders = e.scores.filter((v) => v === top).length;
        status += leaders > 1 ? ' · all square' : ` · ${name(e.scores.indexOf(top))} leads`;
      }
      setHost('idle');
      setConsole('continue', status, e.awarded > 0 ? e.player : null);
      setAdvance(label, () => run(game.advanceRound()));
      break;
    }

    case 'hostOverride':
      toast('Host override', false, 1100);
      break;

    case 'undo':
      await restoreAfterUndo();
      break;

    case 'mainResult': {
      const winner = s.players[e.winner];
      shownScores = s.players.map((p) => p.score);
      el.resultKicker.textContent = s.solo ? 'MAIN GAME COMPLETE' : 'YOUR WINNER';
      el.resultName.textContent = s.solo ? String(winner.score) : winner.name;
      el.resultName.classList.toggle('is-number', s.solo);
      el.resultDetail.textContent = s.solo
        ? 'points on the board. One round left: Fast Money.'
        : `takes the match with ${winner.score} points`;
      renderStandings();
      setResultButtons(false);
      setAdvance('ON TO FAST MONEY', () => run(game.startFastMoney()));
      showScreen('result');
      audio.sfx('win');
      sayBg('winner', 'queue');
      if (!reduceMotion) stopConfetti = confetti(el.confetti, { duration: 5000 });
      break;
    }

    // ------------------------------------------------------------ fast money

    case 'fmIntro': {
      const fm = s.fm;
      fmShownTotal = 0;
      buildFmRows();
      for (const q of fm.questions) markSeen(q.id);
      markSeen(fm.spare?.id);
      el.fmTotal.textContent = '0';
      el.fmTarget.textContent = `/ ${e.target}`;
      el.fmBar.style.width = '0%';
      el.fmBar.classList.remove('won');
      el.fmTimer.style.visibility = 'visible';
      el.fmTimerText.textContent = String(FM_TIME[0]);
      el.fmTimer.style.setProperty('--t', '1');
      el.fmWho.textContent = e.mode === 'solo' || e.order.length === 1
        ? `${name(e.order[0])} plays for ${e.target}`
        : `${e.order.map(name).join(' + ')} · ${e.target} to win`;
      el.fmQuestion.textContent = e.order.length === 1
        ? `Five questions, ${FM_TIME[0]} seconds. Score ${e.target} to win.`
        : `Five questions each, against the clock. Reach ${e.target} together to win.`;
      el.fmForm.hidden = true;
      clearAdvance();
      audio.sfx('bell');
      await say('fmIntro');
      setAdvance(`${name(e.order[0]).toUpperCase()} IS READY`, () => run(game.fmBeginTurn()));
      break;
    }

    case 'fmTurnStart': {
      clearAdvance();
      el.fmTimer.style.visibility = 'visible';
      el.fmTimerText.textContent = String(e.seconds);
      el.fmTimer.style.setProperty('--t', '1');
      el.fmWho.textContent = `${name(e.player)} — ${e.seconds} seconds`;
      el.fmQuestion.textContent = 'Get ready…';
      await say('fmGo');
      const mine = myTurn(e.player);
      el.fmForm.hidden = !mine;
      el.fmInput.disabled = !mine;
      el.fmInput.value = '';
      if (mine) setTimeout(() => el.fmInput.focus(), 30);
      startFmTimer(e.seconds);
      break;
    }

    case 'fmQuestion': {
      markFmCurrent(e.index);
      // Online, a player still waiting for their own turn is not shown the
      // questions early — on the show they would be offstage in headphones.
      const active = s.fm.order[s.fm.turn];
      if (online && s.fm.order.indexOf(mySeat) > s.fm.order.indexOf(active)) {
        el.fmQuestion.textContent = `${name(active)} is answering. You are up next — no peeking.`;
        break;
      }
      el.fmQuestion.textContent = e.question.prompt;
      el.fmInput.value = '';
      if (!el.fmInput.disabled && !el.fmForm.hidden) el.fmInput.focus();
      live(audio.speak(`q:${e.question.id}`, e.question.readAs ?? e.question.prompt,
        { priority: 'interrupt' })).catch(swallow);
      break;
    }

    case 'fmAnswer':
      // Visible while it is still this player's turn; masked the moment it ends.
      // Online, another player's answer never reaches this screen at all.
      if (online && e.player !== mySeat) setFmCell(e.turn, e.index, 'x', { masked: true });
      else setFmCell(e.turn, e.index, e.text || 'PASS', { masked: false });
      audio.sfx('click');
      break;

    case 'fmLookaway':
      stopFmTimer();
      el.fmForm.hidden = true;
      markFmCurrent(-1);
      await say('fmTimeUp');
      // The curtain is for a shared screen. Online nobody can see anyone
      // else's answers anyway, so there is nothing to look away from.
      if (!online) {
        maskFmCells();
        sayBg('fmLookaway', 'queue');
        await showCurtain(
          'LOOK AWAY',
          `${name(e.nextPlayer)} is up next. Their answers have to be different — no peeking back.`,
          4
        );
      }
      el.fmQuestion.textContent = `${name(e.nextPlayer)}: same five questions. Matching an answer scores nothing.`;
      el.fmWho.textContent = `${name(e.nextPlayer)} is up`;
      setAdvance(`${name(e.nextPlayer).toUpperCase()} IS READY`, () => run(game.fmBeginTurn()));
      break;

    case 'fmRevealReady':
      stopFmTimer();
      el.fmTimer.style.visibility = 'hidden';
      el.fmForm.hidden = true;
      maskFmCells();
      markFmCurrent(-1);
      el.fmWho.textContent = 'Time for the reveal';
      el.fmQuestion.textContent = `Survey says… you need ${s.fm.target}.`;
      await say('fmTimeUp');
      setAdvance('REVEAL THE ANSWERS', () => run(game.fmReveal()));
      break;

    case 'fmRevealEntry': {
      if (e.index === 0) {
        el.fmWho.textContent = `${name(e.player)}’s answers`;
        if (e.turn > 0) await delay(900);
      }
      el.fmQuestion.textContent = s.fm.questions[e.index].prompt;
      markFmCurrent(e.index);
      const cell = fmCell(e.turn, e.index);
      if (cell) {
        cell.textContent = e.text || 'PASS';
        cell.classList.remove('hidden-answer');
        cell.classList.add('shown');
      }
      audio.sfx('flip');
      await delay(850);
      await showFmPoints(e.turn, e.index, e.points, e.duplicate);
      await delay(550);
      break;
    }

    case 'fmDuplicate': {
      const slot = s.fm.duplicates[0];
      markFmCurrent(slot?.index ?? -1);
      await say('fmDuplicate');
      toast('Duplicate answer — one replacement question', true, 2600);
      el.fmWho.textContent = `${name(e.player)} — replacement question`;
      el.fmQuestion.textContent = e.question.prompt;
      clearAdvance();
      const mine = myTurn(e.player);
      el.fmForm.hidden = !mine;
      el.fmInput.disabled = !mine;
      el.fmInput.value = '';
      if (mine) el.fmInput.focus();
      live(audio.speak(`q:${e.question.id}`, e.question.readAs ?? e.question.prompt)).catch(swallow);
      break;
    }

    case 'fmSpareResult': {
      el.fmForm.hidden = true;
      const cell = fmCell(e.turn, e.index);
      if (cell) {
        cell.textContent = e.text || 'PASS';
        cell.classList.remove('dupe', 'hidden-answer');
      }
      audio.sfx('flip');
      await delay(700);
      await showFmPoints(e.turn, e.index, e.points, false);
      await delay(500);
      break;
    }

    case 'fmResult': {
      markFmCurrent(-1);
      el.fmForm.hidden = true;
      el.fmWho.textContent = e.won ? 'They did it!' : 'Just short';
      el.fmQuestion.textContent = e.won
        ? `${e.total} points — over the ${e.target} target!`
        : `${e.total} points — ${e.target - e.total} short of ${e.target}.`;
      el.fmBar.classList.toggle('won', e.won);
      audio.sfx(e.won ? 'win' : 'lose');
      sayBg(e.won ? 'fmWin' : 'fmLose', 'queue');
      await delay(2600);

      const main = s.players[s.winner];
      let detail = e.won
        ? `Fast Money: ${e.total} points, over the ${e.target} target.`
        : `Fast Money: ${e.total} points, ${e.target - e.total} short of ${e.target}.`;
      if (s.solo) {
        const final = main.score + e.total;
        const best = store.get('best', 0);
        if (final > best) { store.set('best', final); detail += ' New best run!'; }
        else detail += ` Best run: ${best}.`;
        el.resultKicker.textContent = e.won ? 'BIG WINNER' : 'FINAL SCORE';
        el.resultName.textContent = String(final);
        el.resultName.classList.add('is-number');
      } else {
        el.resultKicker.textContent = e.won ? 'BIG WINNERS' : 'SO CLOSE';
        el.resultName.textContent = main.name;
        el.resultName.classList.remove('is-number');
      }
      el.resultDetail.textContent = detail;
      renderStandings();
      setResultButtons(true);
      setAdvance('PLAY AGAIN', rematch);
      showScreen('result');
      refreshTitleFoot();
      if (e.won && !reduceMotion) stopConfetti = confetti(el.confetti, { duration: 7000 });
      break;
    }

    case 'noop':
      if (e.reason) toast(e.reason, true, 1400);
      break;
  }
}

// -------------------------------------------------------------- play helpers

function showStrike(count) {
  const src = artUrls.get('strike-x');
  el.strikeSet.replaceChildren();
  for (let i = 0; i < Math.max(1, Math.min(3, count)); i++) {
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      el.strikeSet.append(img);
    } else {
      const x = document.createElement('span');
      x.className = 'strike-css';
      x.textContent = '✕';
      el.strikeSet.append(x);
    }
  }
  audio.sfx('strike');
  el.strikeOverlay.classList.remove('show');
  void el.strikeOverlay.offsetWidth;        // restart the animation
  el.strikeOverlay.classList.add('show');
}

/** Roll a podium's score up to its new value, with a floating "+N". */
async function countScore(player, to, gained) {
  const d = podiumEls[player];
  const from = shownScores[player] ?? 0;
  if (d) {
    const chip = document.createElement('span');
    chip.className = 'podium-gain';
    chip.textContent = `+${gained}`;
    d.append(chip);
    setTimeout(() => chip.remove(), 1900);
    d.classList.add('scoring');
  }
  const steps = Math.min(22, Math.max(1, to - from));
  for (let k = 1; k <= steps; k++) {
    shownScores[player] = Math.round(from + ((to - from) * k) / steps);
    if (d) d.querySelector('.podium-score').textContent = String(shownScores[player]);
    audio.sfx('count');
    await delay(38);
  }
  shownScores[player] = to;
  d?.classList.remove('scoring');
}

/** The "survey says…" beat: show what was typed, hold, then let the board answer. */
async function showGuess(who, text) {
  guessing = true;
  try {
    el.guessWho.textContent = `${name(who)} says`;
    el.guessWho.style.color = PLAYER_COLORS[who];
    el.guessText.textContent = `“${text}”`;
    el.guess.classList.add('show');
    setHost('point');
    audio.sfx('drumroll');
    await delay(1050);
  } finally {
    el.guess.classList.remove('show');
    guessing = false;
  }
}

async function restoreAfterUndo() {
  const s = game.state;
  toast('Undo', false, 1100);
  stopClock();
  clearAdvance();
  pendingInput = null;
  engineAwait = null;
  choiceWho = null;
  actingWho = null;
  awaitingChoice = false;
  awaitingBuzz = null;
  shownScores = s.players.map((p) => p.score);
  if (s.question) {
    boardView = createBoard(el.board, s.question);
    el.board.classList.add('no-enter');
    s.revealed.forEach((on, i) => {
      if (on) boardView.reveal(i + 1, s.question.answers[i].text, s.question.answers[i].points);
    });
    el.question.textContent = s.question.prompt;
  }
  renderRoundChip(); updatePodiums(); renderStrikes(); renderPot();

  if (s.phase === PHASE.BOARD_PLAY) {
    await handle({ type: 'awaitInput', who: s.controller, context: 'board' });
  } else if (s.phase === PHASE.STEAL) {
    await handle({ type: 'awaitInput', who: s.stealer, context: 'steal' });
  } else if (s.phase === PHASE.PLAY_OR_PASS) {
    await handle({ type: 'awaitChoice', who: s.controller });
  } else if (s.phase === PHASE.FACEOFF) {
    const fo = s.faceoff;
    if (s.buzzIn && fo.buzzed == null) await handle({ type: 'awaitBuzz', pair: fo.pair });
    else await handle({ type: 'awaitInput', who: fo.pair[fo.turn], context: 'faceoff' });
  } else if (s.phase === PHASE.ROUND_END) {
    setConsole('continue', 'Round over');
    setAdvance('CONTINUE', () => run(game.advanceRound()));
  } else if (s.phase === PHASE.ROUND_CARD) {
    if (isHost()) await run(game.beginFaceoff());
  }
}

// -------------------------------------------------------------- result screen

function renderStandings() {
  const s = game.state;
  el.standings.replaceChildren();
  if (s.solo) return;
  const top = Math.max(1, ...s.players.map((p) => p.score));
  [...s.players].sort((a, b) => b.score - a.score).forEach((p, place) => {
    const row = document.createElement('div');
    row.className = 'standing';
    row.style.setProperty('--pc', PLAYER_COLORS[p.id]);
    row.style.setProperty('--w', `${Math.round((p.score / top) * 100)}%`);
    row.style.animationDelay = `${0.25 + place * 0.12}s`;
    row.innerHTML =
      `<span class="standing-place">${place + 1}</span>` +
      '<span class="standing-name"></span>' +
      '<span class="standing-bar"><i></i></span>' +
      `<span class="standing-score">${p.score}</span>`;
    row.querySelector('.standing-name').textContent = p.name;
    el.standings.append(row);
  });
}

function setResultButtons(final) {
  el.resultAgain.hidden = true;            // the primary button already says PLAY AGAIN
  // Online, "change players" would mean leaving the room, which is what the
  // other button already does.
  el.resultSetup.hidden = !final || online;
  el.resultMenu.hidden = !final;
  el.resultMenu.textContent = online ? 'LEAVE GAME' : 'MAIN MENU';
}

// ------------------------------------------------------------- fast money UI

function buildFmRows() {
  const fm = game.state.fm;
  const solo = fm.order.length === 1;
  el.stage.classList.toggle('fm-solo', solo);
  el.fmColA.textContent = name(fm.order[0]);
  el.fmColA.style.color = PLAYER_COLORS[fm.order[0]];
  el.fmColB.textContent = solo ? '' : name(fm.order[1]);
  if (!solo) el.fmColB.style.color = PLAYER_COLORS[fm.order[1]];
  el.fmRows.replaceChildren();
  fm.questions.forEach((_, i) => {
    const row = document.createElement('div');
    row.className = 'fm-row';
    row.innerHTML =
      `<span class="fm-num">${i + 1}</span>` +
      '<span class="fm-a hidden-answer"></span><span class="fm-pts fm-pa"></span>' +
      '<span class="fm-b hidden-answer"></span><span class="fm-pts fm-pb"></span>';
    el.fmRows.append(row);
  });
}

const fmCell = (turn, index) =>
  el.fmRows.children[index]?.querySelector(turn === 0 ? '.fm-a' : '.fm-b');
const fmPtsCell = (turn, index) =>
  el.fmRows.children[index]?.querySelector(turn === 0 ? '.fm-pa' : '.fm-pb');

function setFmCell(turn, index, text, { masked = true } = {}) {
  const cell = fmCell(turn, index);
  if (!cell) return;
  cell.dataset.text = text || '';
  cell.textContent = masked ? '' : (text || '—');
  cell.classList.toggle('hidden-answer', masked);
  cell.classList.toggle('locked', masked && !!text);
}

/** Hide every answer already given (between turns, and before the reveal). */
function maskFmCells() {
  for (const cell of el.fmRows.querySelectorAll('.fm-a, .fm-b')) {
    if (cell.classList.contains('shown')) continue;
    const had = cell.dataset.text != null;
    cell.textContent = '';
    cell.classList.add('hidden-answer');
    cell.classList.toggle('locked', had);
  }
}

function markFmCurrent(index) {
  [...el.fmRows.children].forEach((r, i) => r.classList.toggle('current', i === index));
}

async function showFmPoints(turn, index, points, duplicate) {
  const pts = fmPtsCell(turn, index);
  const cell = fmCell(turn, index);
  if (pts) {
    pts.textContent = duplicate ? 'DUP' : String(points);
    pts.classList.add('shown');
    pts.classList.toggle('zero', points === 0);
  }
  cell?.classList.toggle('dupe', !!duplicate);
  audio.sfx(points > 0 && !duplicate ? 'ding' : 'buzz');
  if (points > 0) {
    const from = fmShownTotal;
    const to = from + points;
    const steps = Math.min(14, points);
    for (let k = 1; k <= steps; k++) {
      fmShownTotal = Math.round(from + ((to - from) * k) / steps);
      paintFmTotal();
      await delay(28);
    }
    fmShownTotal = to;
  }
  paintFmTotal();
}

function paintFmTotal() {
  const target = game.state.fm.target;
  el.fmTotal.textContent = String(fmShownTotal);
  el.fmBar.style.width = `${Math.min(100, (fmShownTotal / target) * 100)}%`;
  el.fmBar.classList.toggle('won', fmShownTotal >= target);
}

function startFmTimer(seconds) {
  stopFmTimer();
  let left = seconds;
  let lastWhole = Math.ceil(left);
  const paint = () => {
    el.fmTimerText.textContent = String(Math.max(0, Math.ceil(left)));
    el.fmTimer.style.setProperty('--t', String(Math.max(0, left / seconds)));
    el.fmTimer.classList.toggle('urgent', left <= 5);
  };
  paint();
  fmTimerHandle = setInterval(() => {
    if (paused) return;
    left -= 0.1;
    paint();
    const whole = Math.ceil(left);
    if (whole !== lastWhole) {
      lastWhole = whole;
      if (whole > 0 && whole <= 10) audio.sfx(whole <= 5 ? 'tickUrgent' : 'tick');
    }
    if (left <= 0) {
      stopFmTimer();
      // Out of time: bank whatever is left as blanks. A guest's clock is a
      // display of the host's, so only the host acts on it running out.
      if (!isHost()) return;
      const fm = game.state.fm;
      const remaining = fm.questions.length - fm.qIndex;
      el.fmInput.value = '';
      for (let i = 0; i < remaining; i++) run(game.fmSubmit(null));
    }
  }, 100);
}

function stopFmTimer() {
  if (fmTimerHandle) { clearInterval(fmTimerHandle); fmTimerHandle = null; }
  el.fmTimer.classList.remove('urgent');
}

async function showCurtain(title, sub, seconds) {
  el.curtainTitle.textContent = title;
  el.curtainSub.textContent = sub;
  el.curtain.classList.add('show');
  try {
    for (let n = seconds; n > 0; n--) {
      el.curtainCount.textContent = String(n);
      audio.sfx('tick');
      await delay(1000, { exact: true });
    }
  } finally {
    el.curtain.classList.remove('show');
    el.curtainCount.textContent = '';
  }
}

function fmSubmit(text) {
  if (!game || paused) return;
  el.fmInput.value = '';
  if (online && !isHost()) {
    if (el.fmForm.hidden) return;
    net.relay({ k: 'input', kind: 'fm', text: text ?? '', pass: text == null });
    return;
  }
  applyFm(text);
}

/** Feed a Fast Money answer to the engine. Only runs where the engine is. */
function applyFm(text) {
  if (game.state.phase === PHASE.FM_DUPLICATE) run(game.fmSubmitSpare(text));
  else if (game.state.phase === PHASE.FM_PLAY) run(game.fmSubmit(text));
}

// ------------------------------------------------------------------ input

async function submitText(text) {
  const clean = String(text ?? '').trim();
  if (!clean || !game || paused) return;
  if (!pendingInput) {
    // Typed ahead of the host. Hold it and fire the moment the box goes live.
    if (!online && el.console.dataset.mode === 'input') {
      queuedSubmit = clean;
      el.answerInput.value = '';
      el.consoleStatus.textContent = `Locked in: “${clean}”`;
    }
    return;
  }
  const { context, who } = pendingInput;
  pendingInput = null;
  el.answerInput.value = '';
  setConsole('idle');
  if (online && !isHost()) {
    // A guest has no engine. The host validates the turn and runs it.
    net.relay({ k: 'input', kind: 'answer', ctx: context, text: clean });
    return;
  }
  applyAnswer(context, who, clean);
}

/**
 * Feed an answer to the engine. Only ever runs on the machine that has one.
 * The "survey says" beat goes out first as its own batch, so every screen —
 * local or remote — holds on the typed words before the board answers.
 */
function applyAnswer(context, who, text) {
  engineAwait = null;
  stopClock();
  run([{ type: 'guess', who, text }]);
  if (context === 'faceoff') run(game.submitFaceoff(text));
  else if (context === 'board') run(game.submitBoard(text));
  else if (context === 'steal') run(game.submitSteal(text));
}

el.answerForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  submitText(el.answerInput.value);
});

el.fmForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const text = el.fmInput.value.trim();
  if (text) fmSubmit(text);
});
el.fmPassBtn.addEventListener('click', () => { fmSubmit(null); el.fmInput.focus(); });

function makeChoice(which) {
  if (!awaitingChoice || paused) return;      // ignore keys pressed before the prompt is up
  awaitingChoice = false;
  audio.sfx('click');
  setConsole('idle');
  if (online && !isHost()) { net.relay({ k: 'input', kind: 'choice', which }); return; }
  choiceWho = null;
  run(game.choose(which));
}

el.choiceRow.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-choice]');
  if (btn) makeChoice(btn.dataset.choice);
});

function doBuzz(slot) {
  if (!awaitingBuzz || paused) return;
  // Online a screen can only ever buzz for its own seat.
  const player = online ? mySeat : awaitingBuzz.slots[slot];
  if (!awaitingBuzz.slots.includes(player)) return;
  awaitingBuzz = null;
  audio.stopVoice();                 // Bella stops reading the instant someone buzzes
  audio.sfx('buzzIn');
  setConsole('idle');
  if (online && !isHost()) { net.relay({ k: 'input', kind: 'buzz' }); return; }
  run(game.buzz(player));
}
el.buzzA.addEventListener('click', () => doBuzz(0));
el.buzzB.addEventListener('click', () => doBuzz(1));

for (const btn of [el.continueBtn, el.fmContinueBtn, el.resultPrimary]) {
  btn.addEventListener('click', fireAdvance);
}

// ------------------------------------------------------------------ net

/**
 * A message from another browser in this room.
 *
 * Nothing that arrives here is trusted to be in turn. The host checks every
 * guest input against what the engine is actually waiting for, because the
 * relay will happily forward a message sent at the wrong moment — by a stale
 * tab, a double click, or someone poking at the console.
 */
net.on('relay', ({ from, body }) => {
  if (!body || typeof body !== 'object') return;
  if (isHost()) {
    if (body.k === 'input') applyGuestInput(from, body);
    return;
  }
  if (body.k !== 'events') return;
  const mine = body.bySeat?.[mySeat];
  if (!mine || !game) return;
  // State first, then the events: that is the order the host sees them in,
  // because the engine has already finished mutating by the time it hands the
  // batch over.
  game.state = mine.state;
  run(mine.events);
});

function applyGuestInput(seat, body) {
  const st = game?.state;
  if (!st || game.guest) return;
  const text = String(body.text ?? '').slice(0, 120);

  if (body.kind === 'buzz') {
    if (st.phase !== PHASE.FACEOFF) return;
    const events = game.buzz(seat);                 // a late or out-of-pair buzz is a noop
    if (events[0]?.type === 'noop') return;
    awaitingBuzz = null;
    run(events);
    return;
  }

  if (body.kind === 'answer') {
    if (!engineAwait || engineAwait.who !== seat || engineAwait.context !== body.ctx) return;
    if (!text.trim()) return;
    const ctx = engineAwait.context;
    pendingInput = null;
    applyAnswer(ctx, seat, text.trim());
    return;
  }

  if (body.kind === 'choice') {
    if (choiceWho !== seat || st.phase !== PHASE.PLAY_OR_PASS) return;
    if (body.which !== 'play' && body.which !== 'pass') return;
    choiceWho = null;
    run(game.choose(body.which));
    return;
  }

  if (body.kind === 'fm') {
    const fm = st.fm;
    if (!fm) return;
    if (st.phase === PHASE.FM_PLAY && fm.order[fm.turn] !== seat) return;
    if (st.phase === PHASE.FM_DUPLICATE && fm.order[fm.duplicates[0]?.turn] !== seat) return;
    if (st.phase !== PHASE.FM_PLAY && st.phase !== PHASE.FM_DUPLICATE) return;
    applyFm(body.pass || !text.trim() ? null : text.trim());
  }
}

net.on('closed', (reason) => {
  const wasPlaying = !!game;
  leaveRoom({ silent: true });
  if (wasPlaying) toMenu();
  toast(reason, true, 6000);
  lobbyError(reason);
});
net.on('roster', () => { renderRoster(); renderNetBadge(); });
net.on('error', (message) => lobbyError(message));
// A guest's match begins (and begins again, on a rematch) when the host says so.
net.on('start', () => { if (online && !isHost()) startMatch(); });

function renderNetBadge() {
  if (!online) { el.netBadge.hidden = true; return; }
  const me = net.players.find((pl) => pl.seat === mySeat);
  el.netBadge.hidden = false;
  el.netBadge.textContent =
    `Online · room ${net.code} · you are ${me?.name ?? `seat ${mySeat + 1}`}${isHost() ? ' (host)' : ''}`;
}

// ------------------------------------------------------------------ lobby

function lobbyError(message) {
  el.lobbyError.textContent = message ?? '';
  el.lobbyError.hidden = !message;
}

const myName = () => (setup.names[0] ?? '').trim() || 'Player 1';

function setMode(value) {
  if (mode === 'online' && value !== 'online' && online) leaveRoom();
  mode = value;
  lobbyError('');
  syncSetupForMode();
}

/** Show the parts of the setup screen that apply to this mode and role. */
function syncSetupForMode() {
  const isOnline = mode === 'online';
  const guest = isOnline && online && !isHost();
  el.lobby.hidden = !isOnline;
  el.playerCount.hidden = isOnline;      // online seats are filled by whoever joins
  el.lobbyChoice.hidden = online;
  el.lobbyRoom.hidden = !online;
  // Match rules belong to whoever runs the engine.
  el.rulesPanel.classList.toggle('locked', guest);
  renderNameInputs();
  if (isOnline) {
    const enough = net.players.length >= 2;
    el.startBtn.hidden = !online || guest;
    el.startBtn.disabled = !enough;
    el.startBtn.textContent = enough ? 'START THE SHOW' : 'WAITING FOR PLAYERS';
  } else {
    el.startBtn.hidden = false;
    el.startBtn.disabled = false;
    el.startBtn.textContent = 'START THE SHOW';
  }
}

function renderRoster() {
  el.lobbyPlayers.replaceChildren();
  for (const pl of net.players) {
    const li = document.createElement('li');
    li.style.setProperty('--pc', PLAYER_COLORS[pl.seat] ?? '#fff');
    li.textContent = pl.name + (pl.seat === 0 ? ' · host' : '') + (pl.seat === mySeat ? ' · you' : '');
    el.lobbyPlayers.append(li);
  }
  const enough = net.players.length >= 2;
  el.lobbyHint.textContent = !isHost() ? `Waiting for ${hostName()} to start the show.`
    : enough ? 'Everyone in? Start when you are ready. Up to 4 can play.'
    : 'Give this code to the other players.';
  if (mode === 'online' && !game) syncSetupForMode();
}

async function withRelay(fn) {
  lobbyError('');
  audio.unlock();
  try {
    if (relayUrl === null) relayUrl = await resolveRelayUrl();
    if (!relayUrl) throw new Error('Online play is not set up for this copy of the game.');
    if (!net.online) await net.connect(relayUrl);
    await fn();
  } catch (err) {
    lobbyError(err?.message ?? 'Could not reach the game server.');
    return false;
  }
  return true;
}

function enterRoom(code, seat) {
  online = true;
  mySeat = seat;
  el.lobbyCode.textContent = code;
  store.set('setup', setup);
  syncSetupForMode();
  renderRoster();
  renderNetBadge();
}

function leaveRoom({ silent = false } = {}) {
  if (!silent) net.disconnect();
  online = false;
  mySeat = 0;
  renderNetBadge();
  lobbyError('');
  syncSetupForMode();
}

el.createRoomBtn.addEventListener('click', () => withRelay(async () => {
  const { code, seat } = await net.create(myName());
  enterRoom(code, seat);
}));
el.joinRoomBtn.addEventListener('click', () => withRelay(async () => {
  const code = el.joinCode.value.trim().toUpperCase();
  if (code.length !== 4) throw new Error('A room code is four characters.');
  const res = await net.join(code, myName());
  enterRoom(res.code, res.seat);
}));
el.joinCode.addEventListener('input', () => {
  el.joinCode.value = el.joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});
el.joinCode.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); el.joinRoomBtn.click(); }
});
el.leaveRoomBtn.addEventListener('click', () => leaveRoom());

/** Enough shape for a guest's screen to render before the first batch lands. */
function emptyMirror() {
  return {
    phase: PHASE.SETUP,
    players: net.players.slice().sort((a, b) => a.seat - b.seat)
      .map((pl, i) => ({ id: i, name: pl.name, score: 0 })),
    revealed: [], strikes: 0, pot: 0, round: { multiplier: 1, sub: '' },
    roundIndex: 0, totalRounds: 3, solo: false, buzzIn: true,
    controller: null, stealer: null, question: null, faceoff: null, fm: null,
  };
}

// ------------------------------------------------------------------ modals

const anyModalOpen = () => !el.menu.hidden || !el.howto.hidden || !el.keyhelp.hidden;

function openMenu() {
  if (!game) return;
  paused = true;
  el.menu.hidden = false;
  el.menu.querySelector('[data-menu="restart"]').hidden = online && !isHost();
  el.menu.querySelector('[data-menu="quit"]').textContent = online ? 'Leave the game' : 'Quit to main menu';
  el.volume.value = String(Math.round(audio.volume * 100));
}
function closeMenu() {
  el.menu.hidden = true;
  paused = !el.howto.hidden || !el.keyhelp.hidden;
  if (!paused && el.console.dataset.mode === 'input') el.answerInput.focus();
}
function openModal(node) { node.hidden = false; paused = true; }
function closeModal(node) {
  node.hidden = true;
  paused = anyModalOpen();
  if (!paused && el.console.dataset.mode === 'input') el.answerInput.focus();
}

el.menu.addEventListener('click', (ev) => {
  const item = ev.target.closest('[data-menu]');
  if (!item) { if (ev.target === el.menu) closeMenu(); return; }
  audio.sfx('click');
  switch (item.dataset.menu) {
    case 'resume': closeMenu(); break;
    case 'how': el.menu.hidden = true; openModal(el.howto); break;
    case 'keys': el.menu.hidden = true; openModal(el.keyhelp); break;
    case 'restart': closeMenu(); rematch(); break;
    case 'quit': closeMenu(); toMenu(); break;
  }
});
el.volume.addEventListener('input', () => {
  audio.setVolume(Number(el.volume.value) / 100);
  store.set('volume', audio.volume);
});
el.howClose.addEventListener('click', () => closeModal(el.howto));
el.keysClose.addEventListener('click', () => closeModal(el.keyhelp));
for (const modal of [el.howto, el.keyhelp]) {
  modal.addEventListener('click', (ev) => { if (ev.target === modal) closeModal(modal); });
}
el.menuBtn.addEventListener('click', () => (el.menu.hidden ? openMenu() : closeMenu()));

// ------------------------------------------------------------------ keys

function inTextField(target) {
  return target instanceof HTMLInputElement && target.type === 'text';
}

window.addEventListener('keydown', (ev) => {
  audio.unlock();

  const screen = el.stage.dataset.screen;
  const typing = inTextField(ev.target);
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;

  // --- modals take the keyboard first
  if (!el.howto.hidden || !el.keyhelp.hidden) {
    if (key === 'Escape' || key === 'Enter' || key === ' ') {
      ev.preventDefault();
      closeModal(el.howto.hidden ? el.keyhelp : el.howto);
    }
    return;
  }
  if (!el.menu.hidden) {
    if (key === 'Escape') { ev.preventDefault(); closeMenu(); }
    return;
  }

  if (key === 'Escape') {
    if (game) openMenu();
    else if (screen === 'setup') showScreen('attract');
    return;
  }

  if (key === '?' && !typing) { openModal(el.keyhelp); ev.preventDefault(); return; }

  const onButton = ev.target instanceof HTMLButtonElement;

  if (screen === 'attract') {
    if ((key === 'Enter' || key === ' ') && !onButton) { ev.preventDefault(); gotoSetup(); }
    return;
  }
  if (screen === 'setup') {
    if (key === 'Enter' && !onButton) { ev.preventDefault(); startMatch(); }
    return;
  }

  // Online buzz: one buzzer per screen, so any of the obvious keys works.
  if (awaitingBuzz && online && !typing && (key === ' ' || key === 'Enter' || key === 'a' || key === 'l')) {
    ev.preventDefault();
    doBuzz(0);
    return;
  }

  // Fast Money: Tab passes on the current question.
  if (key === 'Tab' && ev.target === el.fmInput) { ev.preventDefault(); fmSubmit(null); return; }

  if ((key === ' ' || key === 'Enter') && !typing) {
    if (advance && !onButton) { ev.preventDefault(); fireAdvance(); }
    return;
  }

  // Single-letter keys. In a text box they are just letters — an answer can
  // start with M, X or Z — so there they need Alt. Outside one they work bare.
  if (typing && !ev.altKey) return;
  if (ev.ctrlKey || ev.metaKey) return;
  const code = ev.code;                         // Alt changes ev.key on some layouts
  const letter = code.startsWith('Key') ? code.slice(3).toLowerCase() : key;
  const digit = code.startsWith('Digit') ? Number(code.slice(5)) : NaN;

  if (letter === 'm') { ev.preventDefault(); toggleMute(); return; }
  if (!game) return;

  if (awaitingBuzz) {
    if (letter === 'a') { ev.preventDefault(); doBuzz(0); return; }
    if (letter === 'l') { ev.preventDefault(); doBuzz(1); return; }
  }
  if (awaitingChoice) {
    if (letter === 'p') { ev.preventDefault(); makeChoice('play'); return; }
    if (letter === 's') { ev.preventDefault(); makeChoice('pass'); return; }
  }
  if (screen !== 'play' || guessing) return;
  // Force-reveal, strike, undo and skip all act on the engine, and in an
  // online match only one browser has one.
  if (online && !isHost()) return;

  if (letter === 'n') { ev.preventDefault(); hostAction(() => game.skipQuestion()); return; }
  if (digit >= 1 && digit <= 8) {
    ev.preventDefault();
    hostAction(() => game.forceReveal(digit));
    return;
  }
  if (letter === 'x') { ev.preventDefault(); hostAction(() => game.forceStrike()); return; }
  if (letter === 'z') { ev.preventDefault(); hostAction(() => game.undo()); return; }
});

/** Host overrides replace whatever the console was waiting for. */
function hostAction(fn) {
  const events = fn();
  if (events.length === 1 && events[0].type === 'noop') { run(events); return; }
  stopClock();
  engineAwait = null;
  pendingInput = null;
  run(events);
}

function toggleMute() {
  audio.setMuted(!audio.isMuted);
  el.muteBtn.classList.toggle('muted', audio.isMuted);
  el.muteBtn.textContent = audio.isMuted ? '✕' : '♫';
  store.set('muted', audio.isMuted);
}
el.muteBtn.addEventListener('click', toggleMute);

// ------------------------------------------------------------------ setup UI

const COUNT_NOTES = {
  1: 'Solo run: no face-off and no steal. Three strikes closes the board. Chase your best score.',
  2: 'Head to head. You face off every round.',
  3: 'Two players face off each round, rotating so everyone gets a turn at the buzzers.',
  4: 'Two players face off each round, rotating so everyone gets a turn at the buzzers.',
};

function renderNameInputs() {
  el.nameGrid.replaceChildren();
  // Online you name yourself and nobody else; the other seats introduce
  // themselves when they join.
  const onlineMode = mode === 'online';
  const count = onlineMode ? 1 : setup.count;
  for (let i = 0; i < count; i++) {
    const row = document.createElement('label');
    row.className = 'name-row';
    row.style.setProperty('--pc', PLAYER_COLORS[i]);
    const chip = document.createElement('span');
    chip.className = 'name-chip';
    chip.textContent = String(i + 1);
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 14;
    input.value = setup.names[i];
    input.setAttribute('aria-label', onlineMode ? 'Your name' : `Player ${i + 1} name`);
    if (onlineMode) {
      chip.textContent = '★';
      input.placeholder = 'Your name';
      // The name is sent when the room is created or joined; editing it after
      // that would only disagree with what everyone else can see.
      input.disabled = online;
    }
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => { setup.names[i] = input.value; });
    row.append(chip, input);
    el.nameGrid.append(row);
  }
  let note = COUNT_NOTES[setup.count];
  const best = store.get('best', 0);
  if (setup.count === 1 && best > 0) note += ` Best so far: ${best}.`;
  if (onlineMode) {
    note = online ? '' : 'Everyone plays on their own screen. One player creates a game and shares the code; 2-4 can play.';
  }
  el.countNote.textContent = note;
  el.optFaceoffRow.hidden = !onlineMode && setup.count === 1;
  el.optFmRow.hidden = !onlineMode && setup.count === 1;
}

function syncSegment(root, value, attr) {
  for (const b of root.querySelectorAll('button')) b.classList.toggle('on', b.dataset[attr] === String(value));
  const note = root.closest('.opt')?.querySelector('.opt-note');
  const text = note?.dataset[`note${String(value)[0].toUpperCase()}${String(value).slice(1)}`];
  if (text) note.textContent = text;
}

function wireSegment(root, attr, read, write) {
  syncSegment(root, read(), attr);
  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    audio.sfx('click');
    write(btn.dataset[attr]);
    syncSegment(root, read(), attr);
  });
}

wireSegment(el.modeSeg, 'v', () => mode, (v) => setMode(v));
wireSegment(el.playerCount, 'n', () => setup.count, (v) => { setup.count = Number(v); renderNameInputs(); });
wireSegment(el.optRounds, 'v', () => setup.rounds, (v) => { setup.rounds = Number(v); });
wireSegment(el.optFaceoff, 'v', () => setup.faceoff, (v) => { setup.faceoff = v; });
wireSegment(el.optClock, 'v', () => setup.clock, (v) => { setup.clock = Number(v); });
wireSegment(el.optFm, 'v', () => setup.fmMode, (v) => { setup.fmMode = v; });

el.startBtn.addEventListener('click', startMatch);
el.playBtn.addEventListener('click', gotoSetup);
el.howBtn.addEventListener('click', () => { audio.unlock(); openModal(el.howto); });
el.setupHowBtn.addEventListener('click', () => openModal(el.howto));
el.setupBackBtn.addEventListener('click', () => { if (online) leaveRoom(); showScreen('attract'); });
el.resultAgain.addEventListener('click', rematch);
el.resultSetup.addEventListener('click', () => { resetMatch(); syncSetupForMode(); showScreen('setup'); });
el.resultMenu.addEventListener('click', toMenu);

function refreshTitleFoot() {
  const best = store.get('best', 0);
  el.titleFoot.textContent = best > 0
    ? `1–4 players · same screen or online · best solo run ${best}`
    : '1–4 players · same screen or online · hosted by Bella';
}

function gotoSetup() {
  audio.unlock();
  syncSetupForMode();
  showScreen('setup');
  audio.sfx('theme');
  sayBg('showOpen', 'queue');
}

// ------------------------------------------------------------ match lifecycle

function markSeen(id) {
  if (!id) return;
  const seen = store.get('seen', []);
  if (!seen.includes(id)) { seen.push(id); store.set('seen', seen); }
}

/** Shuffle, then put questions this browser has not seen yet at the front. */
function freshFirst(list, need) {
  const pool = [...list];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let seen = new Set(store.get('seen', []));
  const ids = new Set(list.map((q) => q.id));
  const unseen = pool.filter((q) => !seen.has(q.id));
  if (unseen.length < need) {
    // The bank is used up: forget this pool's history and start it over.
    store.set('seen', [...seen].filter((id) => !ids.has(id)));
    return pool;
  }
  return [...unseen, ...pool.filter((q) => seen.has(q.id))];
}

/** Tear down everything a match leaves running. Safe to call with no match. */
function resetMatch() {
  epoch += 1;
  batchQueue.length = 0;
  stopClock();
  stopFmTimer();
  audio.stopVoice();
  clearTimeout(hostTimer);
  if (stopConfetti) { stopConfetti(); stopConfetti = null; }
  clearAdvance();
  pendingInput = null;
  engineAwait = null;
  choiceWho = null;
  actingWho = null;
  queuedSubmit = null;
  awaitingChoice = false;
  awaitingBuzz = null;
  guessing = false;
  paused = false;
  game = null;
  window.__feud.game = null;
  for (const node of [el.guess, el.curtain, el.strikeOverlay, el.toast]) node.classList.remove('show');
  el.stage.classList.remove('steal-mode', 'fm-solo');
  el.menu.hidden = true;
  el.answerInput.value = '';
  el.fmInput.value = '';
  el.board.replaceChildren();
  el.question.textContent = ' ';
  setConsole('idle');
}

function toMenu() {
  resetMatch();
  if (online) leaveRoom();               // leaving the match online means leaving the room
  refreshTitleFoot();
  showScreen('attract');
}

function rematch() {
  resetMatch();
  startMatch();
}

function startMatch() {
  if (!surveys) return;
  if (mode === 'online' && !online) return;                    // no room yet
  if (online && isHost() && net.players.length < 2) return;    // nobody to play against
  audio.unlock();
  if (game) resetMatch();

  if (online && !isHost()) {
    // A guest has no engine at all. `state` is replaced wholesale by each
    // batch the host sends; everything in this file reads it through
    // game.state, so the rest of the UI cannot tell the difference.
    game = { state: emptyMirror(), guest: true };
    shownScores = game.state.players.map(() => 0);
    buildPodiums();
    setConsole('idle', `Waiting for ${hostName()} to start the first round`);
    Object.assign(window.__feud, { game, run });
    return;
  }

  const names = online
    ? net.players.slice().sort((a, b) => a.seat - b.seat).map((pl) => pl.name)
    : setup.names.slice(0, setup.count).map((n, i) => n.trim() || `Player ${i + 1}`);
  store.set('setup', setup);

  game = createGame({
    mainQuestions: freshFirst(surveys.main, setup.rounds + 3),
    fmQuestions: freshFirst(surveys.fastMoney, 6),
    players: names,
    seed: Date.now(),
    settings: {
      fastMoneyMode: names.length === 1 ? 'solo' : setup.fmMode,
      rounds: setup.rounds,
      buzzIn: setup.faceoff === 'buzz' && names.length > 1,
      preshuffled: true,
    },
  });
  // The answer clock is the host's setting; it rides in state so every
  // screen in an online match counts down from the same number.
  game.state.clock = setup.clock;
  shownScores = names.map(() => 0);
  buildPodiums();
  setConsole('idle');
  Object.assign(window.__feud, { game, run });
  if (online) net.start();               // tells the guests to reset and get ready
  run(game.startRound());
}

// ------------------------------------------------------------------ boot

async function main() {
  initStage();
  // Published before any await: art probing spans many assets across three
  // extensions, so anything reading this during boot would otherwise race it.
  // Readiness flags: the engine's phase changes synchronously but the screen
  // catches up asynchronously, so "what is the UI actually waiting for" is a
  // different question from "what phase is the game in". Tests and devtools
  // need the former.
  window.__feud = {
    audio, net, game: null, run: null, setup,
    ui: {
      get pendingInput() { return pendingInput; },
      get awaitingChoice() { return awaitingChoice; },
      get awaitingBuzz() { return awaitingBuzz; },
      get awaitingAdvance() { return !!advance; },
      get busy() { return draining || guessing; },
      get online() { return online; },
      get seat() { return mySeat; },
      get screen() { return el.stage.dataset.screen; },
    },
    actions: { startMatch, toMenu, rematch, submitText, doBuzz, makeChoice, fireAdvance, fmSubmit },
  };

  audio.setVolume(store.get('volume', 0.8));
  if (store.get('muted', false)) toggleMute();
  refreshTitleFoot();
  syncSetupForMode();

  try {
    surveys = await loadSurveys();
  } catch (err) {
    console.error(err);
    el.titleFoot.textContent = err.message;
    el.playBtn.disabled = true;
    return;
  }

  artUrls = await initArt();
  console.info(`[art] ${artUrls.size} asset(s) loaded; CSS fallbacks cover the rest`);

  // Browsers block audio until a gesture; the title screen is that gesture.
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
}

main();
