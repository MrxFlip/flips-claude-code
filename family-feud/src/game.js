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
export const SUDDEN_DEATH = { label: 'SUDDEN DEATH', sub: 'QUADRUPLE POINTS', multiplier: 4 };

export const FM_QUESTION_COUNT = 5;
export const FM_TARGET = 200;
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
    ...settings,
  };

  const rand = rng(seed);
  const mainPool = shuffle(mainQuestions, rand);
  const fmPool = shuffle(fmQuestions, rand);
  let mainCursor = 0;

  const state = {
    seed,
    phase: PHASE.SETUP,
    players: players.map((name, i) => ({ id: i, name, score: 0 })),
    roundIndex: 0,
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
    return state.suddenDeath ? SUDDEN_DEATH : ROUNDS[state.roundIndex];
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
    const a = state.roundIndex % n;
    const b = (state.roundIndex + 1) % n;
    state.faceoff = { pair: [a, b], turn: 0, results: [null, null], winner: null };

    state.phase = PHASE.ROUND_CARD;
    // phase first: the roundCard handler drives on into the face-off, so a
    // trailing phase event would snap the screen back to the round card.
    events.push({ type: 'phase', to: state.phase });
    events.push({ type: 'roundCard', round: state.round, roundNumber: state.roundIndex + 1 });
    return events;
  }

  /** ROUND_CARD -> FACEOFF (the host reads the question). */
  function beginFaceoff() {
    snapshot();
    state.phase = PHASE.FACEOFF;
    return [
      { type: 'phase', to: state.phase },
      { type: 'readQuestion', question: state.question },
      { type: 'awaitInput', who: state.faceoff.pair[0], context: 'faceoff', masked: true },
    ];
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
      events.push({ type: 'awaitInput', who: fo.pair[1], context: 'faceoff', masked: false });
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
      // Nobody found anything. Fresh question, same pair, pot resets.
      state.pot = 0;
      loadQuestion(nextMainQuestion());
      fo.turn = 0;
      fo.results = [null, null];
      events.push({ type: 'faceoffFailed' });
      events.push({ type: 'readQuestion', question: state.question });
      events.push({ type: 'awaitInput', who: fo.pair[0], context: 'faceoff', masked: true });
      return events;
    }

    const winnerSlot = r0 <= r1 ? 0 : 1;
    fo.winner = fo.pair[winnerSlot];
    state.controller = fo.winner;
    state.stealer = fo.pair[winnerSlot === 0 ? 1 : 0];
    state.phase = PHASE.PLAY_OR_PASS;

    events.push({ type: 'faceoffWon', player: fo.winner });
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

    const remaining = [];
    state.revealed.forEach((done, i) => { if (!done) remaining.push(i + 1); });
    for (const rank of remaining) revealRank(rank, events, { award: false });

    state.phase = PHASE.ROUND_END;
    events.push({
      type: 'bank',
      player: playerId,
      pot: state.pot,
      multiplier,
      awarded,
      reason,
      scores: state.players.map((p) => p.score),
    });
    events.push({ type: 'phase', to: state.phase });
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
    const playedAll = state.suddenDeath || state.roundIndex + 1 >= ROUNDS.length;

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
    };
    state.phase = PHASE.FM_INTRO;
    return [
      { type: 'phase', to: state.phase },
      { type: 'fmIntro', order, target: FM_TARGET, mode: state.fm.mode },
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
    const won = fm.total >= FM_TARGET;
    return [
      { type: 'phase', to: state.phase },
      { type: 'fmResult', total: fm.total, target: FM_TARGET, won },
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

  function forceStrike() {
    if (state.phase !== PHASE.BOARD_PLAY) return [{ type: 'noop' }];
    return submitBoard('\u0000__host_forced_strike__');
  }

  return {
    state,
    get config() { return cfg; },
    startRound, beginFaceoff, submitFaceoff, choose, submitBoard, submitSteal,
    advanceRound, startFastMoney, fmBeginTurn, fmSubmit, fmReveal, fmSubmitSpare,
    forceReveal, forceStrike, undo,
    get canUndo() { return history.length > 0; },
  };
}
