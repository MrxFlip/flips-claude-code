// Game engine. Pure logic: no DOM, no audio, no timers.
//
// Every action returns an ordered list of events describing what happened.
// app.js turns those events into animation and sound. Keeping the two apart
// is what makes the whole match testable in Node without a browser.

import { matchAnswer } from './match.js';

export const PHASE = {
  SETUP: 'SETUP',
  ROUND_CARD: 'ROUND_CARD',
  FACEOFF: 'FACEOFF',
  PLAY_OR_PASS: 'PLAY_OR_PASS',
  BOARD_PLAY: 'BOARD_PLAY',
  STEAL: 'STEAL',
  ROUND_END: 'ROUND_END',
  MAIN_RESULT: 'MAIN_RESULT',
  FM_INTRO: 'FM_INTRO',
  FM_LOOKAWAY: 'FM_LOOKAWAY',
  FM_PLAY: 'FM_PLAY',
  FM_REVEAL: 'FM_REVEAL',
  FM_DUPLICATE: 'FM_DUPLICATE',
  FM_RESULT: 'FM_RESULT',
};

export const ROUNDS = [
  { label: 'ROUND 1', sub: 'SINGLE POINTS', multiplier: 1 },
  { label: 'ROUND 2', sub: 'DOUBLE POINTS', multiplier: 2 },
  { label: 'ROUND 3', sub: 'TRIPLE POINTS', multiplier: 3 },
];
/**
 * Round list for a match of `count` scoring rounds. Three is the quick game
 * (x1, x2, x3); longer matches add single-point rounds up front, the way the
 * show does (x1, x1, x2, x3).
 */
export function roundsFor(count = 3) {
  const n = Math.max(1, Math.min(6, count | 0));
  const mults = n <= 3 ? [1, 2, 3].slice(0, n) : [...new Array(n - 2).fill(1), 2, 3];
  const SUBS = { 1: 'SINGLE POINTS', 2: 'DOUBLE POINTS', 3: 'TRIPLE POINTS' };
  return mults.map((m, i) => ({ label: `ROUND ${i + 1}`, sub: SUBS[m], multiplier: m }));
}

const TIMEOUT_TEXT = '\u0000__timed_out__';

export const SUDDEN_DEATH = { label: 'SUDDEN DEATH', sub: 'QUADRUPLE POINTS', multiplier: 4 };

export const FM_QUESTION_COUNT = 5;
export const FM_TARGET = 200;      // two players answering together
// One player cannot reach 200: five top answers total roughly 165. A solo
// Fast Money plays to a target that is hard but actually winnable.
export const FM_TARGET_SOLO = 100;
export const FM_TIME = [20, 25]; // seconds for player 1 / player 2

/** Mulberry32 — small seeded PRNG so a match can be replayed exactly. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createGame({
  mainQuestions,
  fmQuestions,
  players,
  seed = Date.now(),
  settings = {},
}) {
  const cfg = {
    targetScore: settings.targetScore ?? null,   // e.g. 300, or null for "play all rounds"
    fastMoneyMode: settings.fastMoneyMode ?? 'both', // 'both' | 'solo'
    strikesAllowed: settings.strikesAllowed ?? 3,
    rounds: settings.rounds ?? ROUNDS.length,        // scoring rounds before the finale
    buzzIn: settings.buzzIn ?? false,                // face-off: race to buzz vs. fixed order
    preshuffled: settings.preshuffled ?? false,      // caller already ordered the question pool
    ...settings,
  };
  const roundList = cfg.rounds === ROUNDS.length ? ROUNDS : roundsFor(cfg.rounds);

  const rand = rng(seed);
  const mainPool = cfg.preshuffled ? [...mainQuestions] : shuffle(mainQuestions, rand);
  const fmPool = cfg.preshuffled ? [...fmQuestions] : shuffle(fmQuestions, rand);
  let mainCursor = 0;

  const state = {
    seed,
    phase: PHASE.SETUP,
    players: players.map((name, i) => ({ id: i, name, score: 0 })),
    roundIndex: 0,
    totalRounds: roundList.length,
    solo: players.length === 1,
    buzzIn: !!cfg.buzzIn,          // in state so an online guest's mirror has it
    round: null,
    pot: 0,
    question: null,
    revealed: [],
    strikes: 0,
    controller: null,
    stealer: null,
    faceoff: null,
    roundResult: null,
    suddenDeath: false,
    fm: null,
    winner: null,
  };

  const history = [];
  const MAX_HISTORY = 40;

  function snapshot() {
    history.push(JSON.stringify({ state, mainCursor }));
    if (history.length > MAX_HISTORY) history.shift();
  }

  function undo() {
    const prev = history.pop();
    if (!prev) return [{ type: 'noop', reason: 'nothing to undo' }];
    const restored = JSON.parse(prev);
    Object.keys(state).forEach((k) => delete state[k]);
    Object.assign(state, restored.state);
    mainCursor = restored.mainCursor;
    return [{ type: 'undo' }, { type: 'phase', to: state.phase }];
  }

  const playerCount = () => state.players.length;
  const nextMainQuestion = () => mainPool[mainCursor++ % mainPool.length];
  const allRevealed = () => state.revealed.length === state.question.answers.length
    && state.revealed.every(Boolean);

  function loadQuestion(q) {
    state.question = q;
    state.revealed = new Array(q.answers.length).fill(false);
  }

  function revealRank(rank, events, { award = true } = {}) {
    const i = rank - 1;
    if (state.revealed[i]) return 0;
    state.revealed[i] = true;
    const pts = state.question.answers[i].points;
    if (award) state.pot += pts;
    events.push({
      type: 'reveal',
      rank,
      text: state.question.answers[i].text,
      points: pts,
      awarded: award,
      pot: state.pot,
    });
    return pts;
  }

  // ---------------------------------------------------------------- rounds

  function roundConfig() {
    return state.suddenDeath ? SUDDEN_DEATH : roundList[state.roundIndex];
  }

  function startRound() {
    snapshot();
    const events = [];
    state.round = roundConfig();
    state.pot = 0;
    state.strikes = 0;
    state.controller = null;
    state.stealer = null;
    state.roundResult = null;
    loadQuestion(nextMainQuestion());

    const n = playerCount();
    if (state.solo) {
      // One player: no face-off, no steal. They simply play every board.
      state.faceoff = null;
      state.controller = 0;
    } else {
      const a = state.roundIndex % n;
      const b = (state.roundIndex + 1) % n;
      state.faceoff = { pair: [a, b], turn: 0, results: [null, null], winner: null, buzzed: null, attempt: 1 };
    }

    state.phase = PHASE.ROUND_CARD;
    // phase first: the roundCard handler drives on into the face-off, so a
    // trailing phase event would snap the screen back to the round card.
    events.push({ type: 'phase', to: state.phase });
    events.push({
      type: 'roundCard',
      round: state.round,
      roundNumber: state.roundIndex + 1,
      totalRounds: roundList.length,
      isFinal: !state.suddenDeath && state.roundIndex + 1 >= roundList.length,
      suddenDeath: state.suddenDeath,
      pair: state.faceoff ? [...state.faceoff.pair] : null,
    });
    return events;
  }

  /** ROUND_CARD -> FACEOFF (the host reads the question). */
  function beginFaceoff() {
    snapshot();
    if (state.solo) {
      state.phase = PHASE.BOARD_PLAY;
      return [
        { type: 'phase', to: state.phase },
        { type: 'readQuestion', question: state.question },
        { type: 'awaitInput', who: 0, context: 'board', masked: false },
      ];
    }
    state.phase = PHASE.FACEOFF;
    return [
      { type: 'phase', to: state.phase },
      // lead: this is the read that opens a face-off, so the host has a line
      // before it. A re-read after a skipped question does not.
      { type: 'readQuestion', question: state.question, faceoff: true, buzz: cfg.buzzIn, lead: true },
      faceoffOpener(),
    ];
  }

  /** What the face-off waits for first: a buzz, or the first player's answer. */
  function faceoffOpener() {
    const fo = state.faceoff;
    if (cfg.buzzIn) return { type: 'awaitBuzz', pair: [...fo.pair] };
    return { type: 'awaitInput', who: fo.pair[0], context: 'faceoff', masked: true };
  }

  /** Buzz-in face-off: whoever buzzes answers first. */
  function buzz(playerId) {
    const fo = state.faceoff;
    if (state.phase !== PHASE.FACEOFF || !fo) return [{ type: 'noop' }];
    if (fo.buzzed != null || fo.turn !== 0 || fo.results[0]) return [{ type: 'noop' }];
    if (!fo.pair.includes(playerId)) return [{ type: 'noop' }];
    snapshot();
    if (fo.pair[0] !== playerId) fo.pair = [fo.pair[1], fo.pair[0]];
    fo.buzzed = playerId;
    return [
      { type: 'buzzed', player: playerId },
      { type: 'awaitInput', who: playerId, context: 'faceoff', masked: false },
    ];
  }

  /** The answer clock ran out on whoever is up. */
  function timeout() {
    let events;
    if (state.phase === PHASE.FACEOFF) events = submitFaceoff(TIMEOUT_TEXT);
    else if (state.phase === PHASE.BOARD_PLAY) events = submitBoard(TIMEOUT_TEXT);
    else if (state.phase === PHASE.STEAL) events = submitSteal(TIMEOUT_TEXT);
    else return [{ type: 'noop' }];
    for (const e of events) {
      if (e.type === 'strike' || e.type === 'faceoffMiss' || e.type === 'stealFailed' || e.type === 'faceoffEntry') {
        e.timedOut = true;
        if ('text' in e) e.text = '';
      }
    }
    return events;
  }

  function submitFaceoff(text) {
    if (state.phase !== PHASE.FACEOFF) return [{ type: 'noop' }];
    snapshot();
    const events = [];
    const fo = state.faceoff;
    const who = fo.pair[fo.turn];

    const r = matchAnswer(text, state.question, state.revealed);
    const hit = r.status === 'HIT';
    fo.results[fo.turn] = { player: who, text, rank: hit ? r.rank : null };

    events.push({ type: 'faceoffEntry', player: who, text, hit, rank: hit ? r.rank : null });

    if (hit) revealRank(r.rank, events, { award: true });
    else events.push({ type: 'faceoffMiss', player: who });

    // Top answer on the first try ends the face-off immediately.
    if (hit && r.rank === 1 && fo.turn === 0) return [...events, ...resolveFaceoff()];

    if (fo.turn === 0) {
      fo.turn = 1;
      // Masked for both players, not just the first. The box being hidden for
      // one and open for the other read as a glitch, and the second player is
      // sitting next to the first either way.
      events.push({ type: 'awaitInput', who: fo.pair[1], context: 'faceoff', masked: true });
      return events;
    }
    return [...events, ...resolveFaceoff()];
  }

  function resolveFaceoff() {
    const events = [];
    const fo = state.faceoff;
    const rankOf = (r) => (r && r.rank ? r.rank : Infinity);
    const r0 = rankOf(fo.results[0]);
    const r1 = rankOf(fo.results[1]);

    if (r0 === Infinity && r1 === Infinity) {
      // Nobody found anything. The question STAYS and the pair keeps guessing:
      // throwing it away on the first double miss meant two wrong answers
      // deleted a board nobody had seen yet. There are no strikes in the
      // face-off, so this can go round as long as it needs to; the host has
      // skipQuestion() as the escape hatch.
      fo.turn = 0;
      fo.results = [null, null];
      fo.buzzed = null;
      fo.attempt += 1;
      events.push({ type: 'faceoffRetry', attempt: fo.attempt, pair: [...fo.pair] });
      events.push(faceoffOpener());
      return events;
    }

    const winnerSlot = r0 <= r1 ? 0 : 1;
    fo.winner = fo.pair[winnerSlot];
    state.controller = fo.winner;
    state.stealer = fo.pair[winnerSlot === 0 ? 1 : 0];
    state.phase = PHASE.PLAY_OR_PASS;

    events.push({
      type: 'faceoffWon',
      player: fo.winner,
      loser: state.stealer,
      rank: Math.min(r0, r1),
    });
    events.push({ type: 'phase', to: state.phase });
    events.push({ type: 'awaitChoice', who: fo.winner });
    return events;
  }

  function choose(playOrPass) {
    if (state.phase !== PHASE.PLAY_OR_PASS) return [{ type: 'noop' }];
    snapshot();
    const events = [];
    if (playOrPass === 'pass') {
      const was = state.controller;
      state.controller = state.stealer;
      state.stealer = was;
      events.push({ type: 'passed', from: was, to: state.controller });
    } else {
      events.push({ type: 'played', player: state.controller });
    }
    state.phase = PHASE.BOARD_PLAY;
    events.push({ type: 'phase', to: state.phase });
    events.push({ type: 'awaitInput', who: state.controller, context: 'board', masked: false });
    return events;
  }

  function submitBoard(text) {
    if (state.phase !== PHASE.BOARD_PLAY) return [{ type: 'noop' }];
    snapshot();
    const events = [];
    const r = matchAnswer(text, state.question, state.revealed);

    if (r.status === 'ALREADY') {
      // A typing accident, not a wrong guess: never costs a strike.
      events.push({ type: 'already', rank: r.rank, text: r.answer.text });
      events.push({ type: 'awaitInput', who: state.controller, context: 'board', masked: false });
      return events;
    }

    if (r.status === 'HIT') {
      revealRank(r.rank, events);
      if (allRevealed()) return [...events, ...bankTo(state.controller, 'cleared')];
      events.push({ type: 'awaitInput', who: state.controller, context: 'board', masked: false });
      return events;
    }

    state.strikes += 1;
    events.push({ type: 'strike', count: state.strikes, text });
    if (state.strikes >= cfg.strikesAllowed) {
      // Solo: nobody to steal, so three strikes simply ends the board and the
      // player keeps what they found.
      if (state.solo) return [...events, ...bankTo(0, 'struckOut')];
      state.phase = PHASE.STEAL;
      events.push({ type: 'phase', to: state.phase });
      events.push({ type: 'stealOffered', player: state.stealer, pot: state.pot });
      events.push({ type: 'awaitInput', who: state.stealer, context: 'steal', masked: false });
      return events;
    }
    events.push({ type: 'awaitInput', who: state.controller, context: 'board', masked: false });
    return events;
  }

  function submitSteal(text) {
    if (state.phase !== PHASE.STEAL) return [{ type: 'noop' }];
    snapshot();
    const events = [];
    const r = matchAnswer(text, state.question, state.revealed);

    if (r.status === 'HIT') {
      revealRank(r.rank, events);
      events.push({ type: 'stealSuccess', player: state.stealer });
      return [...events, ...bankTo(state.stealer, 'steal')];
    }
    events.push({ type: 'stealFailed', player: state.stealer, text });
    return [...events, ...bankTo(state.controller, 'stealFailed')];
  }

  /** Award the pot and sweep the rest of the board. */
  function bankTo(playerId, reason) {
    const events = [];
    const multiplier = state.round.multiplier;
    const awarded = state.pot * multiplier;
    state.players[playerId].score += awarded;
    state.roundResult = { playerId, pot: state.pot, multiplier, awarded, reason };

    // Bank first, then sweep: the points land while the moment is hot, and the
    // answers nobody found are shown afterwards, smallest first.
    events.push({
      type: 'bank',
      player: playerId,
      pot: state.pot,
      multiplier,
      awarded,
      reason,
      scores: state.players.map((p) => p.score),
    });

    const remaining = [];
    state.revealed.forEach((done, i) => { if (!done) remaining.push(i + 1); });
    remaining.reverse();
    for (const rank of remaining) {
      revealRank(rank, events, { award: false });
      events[events.length - 1].missed = true;
    }

    state.phase = PHASE.ROUND_END;
    events.push({ type: 'phase', to: state.phase });

    const scores = state.players.map((p) => p.score);
    const top = Math.max(...scores);
    const tied = scores.filter((s) => s === top).length > 1;
    const lastRound = state.suddenDeath || state.roundIndex + 1 >= roundList.length;
    events.push({
      type: 'roundEnd',
      player: playerId,
      awarded,
      reason,
      missedCount: remaining.length,
      scores,
      next: !lastRound ? 'round' : tied ? 'suddenDeath' : 'result',
    });
    return events;
  }

  /** ROUND_END -> next round, or the end of the main game. */
  function advanceRound() {
    if (state.phase !== PHASE.ROUND_END) return [{ type: 'noop' }];
    snapshot();

    const scores = state.players.map((p) => p.score);
    const top = Math.max(...scores);
    const leaders = scores.filter((s) => s === top).length;

    const hitTarget = cfg.targetScore != null && top >= cfg.targetScore && leaders === 1;
    const playedAll = state.suddenDeath || state.roundIndex + 1 >= roundList.length;

    if (hitTarget || playedAll) {
      // A tie always plays another sudden-death round, including a tie that
      // came out of one. Picking an arbitrary "first" leader would hand the
      // match to whoever happened to be player 1.
      if (leaders > 1) {
        state.suddenDeath = true;
        state.roundIndex += 1;
        return startRound();
      }
      state.winner = scores.indexOf(top);
      state.phase = PHASE.MAIN_RESULT;
      return [
        { type: 'phase', to: state.phase },
        { type: 'mainResult', winner: state.winner, scores, reason: hitTarget ? 'target' : 'rounds' },
      ];
    }

    state.roundIndex += 1;
    return startRound();
  }

  // ------------------------------------------------------------ fast money

  function startFastMoney() {
    snapshot();
    // Runner-up is the highest-scoring non-winner, not simply "the other one" —
    // that distinction matters once there are 3+ players.
    const runnerUp = state.players
      .filter((p) => p.id !== state.winner)
      .sort((a, b) => b.score - a.score)[0];
    const order = cfg.fastMoneyMode === 'solo' || !runnerUp
      ? [state.winner]
      : [state.winner, runnerUp.id];

    state.fm = {
      mode: cfg.fastMoneyMode,
      order,
      turn: 0,
      qIndex: 0,
      questions: fmPool.slice(0, FM_QUESTION_COUNT),
      spare: fmPool[FM_QUESTION_COUNT] ?? fmPool[0],
      entries: order.map(() => []),
      duplicates: [],
      total: 0,
      target: order.length === 1 ? FM_TARGET_SOLO : FM_TARGET,
    };
    state.phase = PHASE.FM_INTRO;
    return [
      { type: 'phase', to: state.phase },
      { type: 'fmIntro', order, target: state.fm.target, mode: state.fm.mode },
    ];
  }

  function fmBeginTurn() {
    snapshot();
    const fm = state.fm;
    fm.qIndex = 0;
    state.phase = PHASE.FM_PLAY;
    return [
      { type: 'phase', to: state.phase },
      {
        type: 'fmTurnStart',
        player: fm.order[fm.turn],
        seconds: FM_TIME[Math.min(fm.turn, FM_TIME.length - 1)],
        questionCount: fm.questions.length,
      },
      { type: 'fmQuestion', index: 0, question: fm.questions[0] },
    ];
  }

  /** One Fast Money answer. Pass null for a pass/timeout. */
  function fmSubmit(text) {
    if (state.phase !== PHASE.FM_PLAY) return [{ type: 'noop' }];
    const fm = state.fm;
    const events = [];
    const q = fm.questions[fm.qIndex];
    const r = text == null ? { status: 'MISS' } : matchAnswer(text, q, []);
    const hit = r.status === 'HIT';

    fm.entries[fm.turn].push({
      text: text ?? '',
      rank: hit ? r.rank : null,
      points: hit ? r.answer.points : 0,
      answerText: hit ? r.answer.text : null,
    });
    events.push({
      type: 'fmAnswer',
      turn: fm.turn,                 // captured BEFORE fm.turn can advance below
      player: fm.order[fm.turn],
      index: fm.qIndex,
      text: text ?? '',
    });

    fm.qIndex += 1;
    if (fm.qIndex < fm.questions.length) {
      events.push({ type: 'fmQuestion', index: fm.qIndex, question: fm.questions[fm.qIndex] });
      return events;
    }

    // Turn over.
    if (fm.turn + 1 < fm.order.length) {
      fm.turn += 1;
      state.phase = PHASE.FM_LOOKAWAY;
      events.push({ type: 'phase', to: state.phase });
      events.push({ type: 'fmLookaway', nextPlayer: fm.order[fm.turn] });
      return events;
    }
    state.phase = PHASE.FM_REVEAL;
    events.push({ type: 'phase', to: state.phase });
    events.push({ type: 'fmRevealReady' });
    return events;
  }

  /** Reveal every answer with its points, flagging duplicates. */
  function fmReveal() {
    snapshot();
    const fm = state.fm;
    const events = [];
    let total = 0;

    fm.entries.forEach((list, turn) => {
      list.forEach((entry, i) => {
        let dup = false;
        if (turn > 0 && entry.rank != null) {
          dup = fm.entries.slice(0, turn).some((other) => other[i]?.rank === entry.rank);
        }
        entry.duplicate = dup;
        if (dup) { entry.points = 0; fm.duplicates.push({ turn, index: i }); }
        total += entry.points;
        events.push({
          type: 'fmRevealEntry',
          turn, index: i,
          player: fm.order[turn],
          text: entry.text,
          matched: entry.answerText,
          points: entry.points,
          duplicate: dup,
        });
      });
    });

    fm.total = total;

    if (fm.duplicates.length) {
      state.phase = PHASE.FM_DUPLICATE;
      events.push({ type: 'phase', to: state.phase });
      events.push({
        type: 'fmDuplicate',
        player: fm.order[fm.duplicates[0].turn],
        question: fm.spare,
        count: fm.duplicates.length,
      });
      return events;
    }
    return [...events, ...fmFinish()];
  }

  /** Answer to the spare question that replaces a duplicate. */
  function fmSubmitSpare(text) {
    if (state.phase !== PHASE.FM_DUPLICATE) return [{ type: 'noop' }];
    snapshot();
    const fm = state.fm;
    const events = [];
    const slot = fm.duplicates.shift();
    const r = text == null ? { status: 'MISS' } : matchAnswer(text, fm.spare, []);
    const pts = r.status === 'HIT' ? r.answer.points : 0;

    fm.entries[slot.turn][slot.index] = {
      text: text ?? '', rank: r.rank ?? null, points: pts,
      answerText: r.answer?.text ?? null, duplicate: false, replaced: true,
    };
    fm.total += pts;
    events.push({ type: 'fmSpareResult', ...slot, text: text ?? '', points: pts });

    if (fm.duplicates.length) {
      events.push({ type: 'fmDuplicate', player: fm.order[fm.duplicates[0].turn], question: fm.spare, count: fm.duplicates.length });
      return events;
    }
    return [...events, ...fmFinish()];
  }

  function fmFinish() {
    const fm = state.fm;
    state.phase = PHASE.FM_RESULT;
    const won = fm.total >= fm.target;
    return [
      { type: 'phase', to: state.phase },
      { type: 'fmResult', total: fm.total, target: fm.target, won },
    ];
  }

  // ------------------------------------------------------------ host override

  function forceReveal(rank) {
    if (!state.question || rank < 1 || rank > state.question.answers.length) return [{ type: 'noop' }];
    if (state.revealed[rank - 1]) return [{ type: 'noop', reason: 'already revealed' }];
    snapshot();
    const events = [{ type: 'hostOverride', action: 'reveal', rank }];
    revealRank(rank, events);
    if (state.phase === PHASE.BOARD_PLAY && allRevealed()) {
      return [...events, ...bankTo(state.controller, 'cleared')];
    }
    return events;
  }

  /**
   * Host override: bin the current face-off question and read a new one. The
   * face-off no longer discards a question by itself, so this is the only way
   * past one the room cannot crack.
   */
  function skipQuestion() {
    if (state.phase !== PHASE.FACEOFF) return [{ type: 'noop', reason: 'only during the face-off' }];
    snapshot();
    const events = [{ type: 'hostOverride', action: 'skipQuestion' }];
    const fo = state.faceoff;
    state.pot = 0;
    loadQuestion(nextMainQuestion());
    fo.turn = 0;
    fo.results = [null, null];
    fo.attempt = 1;
    fo.buzzed = null;
    events.push({ type: 'questionSkipped' });
    events.push({ type: 'readQuestion', question: state.question, faceoff: true, buzz: cfg.buzzIn });
    events.push(faceoffOpener());
    return events;
  }

  function forceStrike() {
    if (state.phase !== PHASE.BOARD_PLAY) return [{ type: 'noop' }];
    return submitBoard('\u0000__host_forced_strike__');
  }

  return {
    state,
    get config() { return cfg; },
    startRound, beginFaceoff, buzz, timeout, submitFaceoff, choose, submitBoard, submitSteal,
    advanceRound, startFastMoney, fmBeginTurn, fmSubmit, fmReveal, fmSubmitSpare,
    forceReveal, forceStrike, skipQuestion, undo,
    get canUndo() { return history.length > 0; },
  };
}
