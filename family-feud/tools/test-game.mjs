#!/usr/bin/env node
// Headless end-to-end tests for src/game.js. No browser, no DOM.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createGame, PHASE, ROUNDS, FM_TARGET } from '../src/game.js';

const here = dirname(fileURLToPath(import.meta.url));
const surveys = JSON.parse(readFileSync(resolve(here, '../data/surveys.json'), 'utf8'));

let passed = 0;
const failures = [];
const check = (label, cond, detail = '') => {
  if (cond) passed++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const newGame = (settings = {}, players = ['Alex', 'Bea']) => createGame({
  mainQuestions: surveys.main,
  fmQuestions: surveys.fastMoney,
  players,
  seed: 12345,
  settings,
});

const GARBAGE = ['qqqqzzz', 'wwwwxyz', 'vvvvbbb', 'jjjjkkk'];
const last = (evts, type) => [...evts].reverse().find((e) => e.type === type);
const has = (evts, type) => evts.some((e) => e.type === type);

// ---------------------------------------------------------------- A: clear the board
{
  const g = newGame();
  g.startRound();
  g.beginFaceoff();
  const answers = g.state.question.answers;

  const fo = g.submitFaceoff(answers[0].text);
  check('A: top answer on first try ends the face-off', g.state.phase === PHASE.PLAY_OR_PASS, g.state.phase);
  check('A: face-off winner takes control', g.state.controller === 0, String(g.state.controller));
  check('A: rank 1 revealed', g.state.revealed[0] === true);
  check('A: no second face-off entry requested', !has(fo.slice(fo.indexOf(fo.find((e) => e.type === 'faceoffWon'))), 'faceoffEntry'));

  g.choose('play');
  check('A: play puts the winner on the board', g.state.phase === PHASE.BOARD_PLAY);

  let bank = null;
  for (let i = 1; i < answers.length; i++) {
    const evts = g.submitBoard(answers[i].text);
    if (has(evts, 'bank')) bank = last(evts, 'bank');
  }
  check('A: clearing the board banks', bank !== null);
  check('A: pot is the full 100', bank?.pot === 100, String(bank?.pot));
  check('A: round 1 multiplier is 1', bank?.multiplier === 1);
  check('A: awarded 100', bank?.awarded === 100, String(bank?.awarded));
  check('A: score credited to the controller', g.state.players[0].score === 100);
  check('A: opponent scored nothing', g.state.players[1].score === 0);
  check('A: phase is ROUND_END', g.state.phase === PHASE.ROUND_END);
}

// ---------------------------------------------------------------- B: strike out, steal succeeds
{
  const g = newGame();
  g.startRound();
  g.beginFaceoff();
  const answers = g.state.question.answers;

  g.submitFaceoff(answers[2].text);       // player 0 takes rank 3
  check('B: second player still gets a face-off turn', g.state.phase === PHASE.FACEOFF, g.state.phase);
  g.submitFaceoff(GARBAGE[0]);            // player 1 misses
  check('B: better rank wins control', g.state.controller === 0);
  check('B: the other player is the stealer', g.state.stealer === 1);

  g.choose('play');
  const potBefore = g.state.pot;
  check('B: face-off answer is already in the pot', potBefore === answers[2].points, String(potBefore));

  g.submitBoard(GARBAGE[0]);
  g.submitBoard(GARBAGE[1]);
  check('B: two strikes does not end the turn', g.state.phase === PHASE.BOARD_PLAY);
  check('B: strike count is 2', g.state.strikes === 2);
  const third = g.submitBoard(GARBAGE[2]);
  check('B: three strikes offers the steal', g.state.phase === PHASE.STEAL, g.state.phase);
  check('B: steal is offered to the stealer', last(third, 'stealOffered')?.player === 1);

  const steal = g.submitSteal(answers[0].text);
  const bank = last(steal, 'bank');
  check('B: successful steal banks to the stealer', bank?.player === 1, String(bank?.player));
  check('B: stolen pot includes the stolen answer',
    bank?.pot === answers[2].points + answers[0].points, String(bank?.pot));
  check('B: controller got nothing', g.state.players[0].score === 0);
  check('B: board fully revealed after the steal', g.state.revealed.every(Boolean));
}

// ---------------------------------------------------------------- C: steal fails
{
  const g = newGame();
  g.startRound(); g.beginFaceoff();
  const answers = g.state.question.answers;
  g.submitFaceoff(answers[1].text);
  g.submitFaceoff(GARBAGE[0]);
  g.choose('play');
  g.submitBoard(GARBAGE[0]); g.submitBoard(GARBAGE[1]); g.submitBoard(GARBAGE[2]);
  const evts = g.submitSteal(GARBAGE[3]);
  const bank = last(evts, 'bank');
  check('C: failed steal banks to the controller', bank?.player === 0, String(bank?.player));
  check('C: stealer scored nothing', g.state.players[1].score === 0);
  check('C: failure reason recorded', bank?.reason === 'stealFailed');
}

// ---------------------------------------------------------------- D: pass swaps roles
{
  const g = newGame();
  g.startRound(); g.beginFaceoff();
  const answers = g.state.question.answers;
  g.submitFaceoff(answers[1].text);
  g.submitFaceoff(GARBAGE[0]);
  check('D: player 0 won the face-off', g.state.controller === 0);
  g.choose('pass');
  check('D: pass hands control to the opponent', g.state.controller === 1, String(g.state.controller));
  check('D: the passer becomes the stealer', g.state.stealer === 0, String(g.state.stealer));
}

// ---------------------------------------------------------------- E: both miss the face-off
{
  const g = newGame();
  g.startRound(); g.beginFaceoff();
  const firstQ = g.state.question.id;
  g.submitFaceoff(GARBAGE[0]);
  const evts = g.submitFaceoff(GARBAGE[1]);
  check('E: both missing re-asks instead of soft-locking', has(evts, 'faceoffRetry'));
  // The question is deliberately KEPT. Discarding a board nobody had seen on
  // the first double miss is the behaviour this replaced.
  check('E: the same question stays up', g.state.question.id === firstQ, g.state.question.id);
  check('E: the lead player is asked again', g.state.faceoff.turn === 0);
  check('E: the attempt is counted', g.state.faceoff.attempt === 2, String(g.state.faceoff.attempt));
  check('E: still in the face-off', g.state.phase === PHASE.FACEOFF);
  check('E: pot still empty', g.state.pot === 0);
  check('E: board blank again', g.state.revealed.every((r) => !r));

  // It can go round as many times as it needs to.
  g.submitFaceoff(GARBAGE[2] ?? 'qqqzzz');
  g.submitFaceoff('wwwqqqzzz');
  check('E: a second double miss keeps going', g.state.phase === PHASE.FACEOFF);
  check('E: attempt counted again', g.state.faceoff.attempt === 3, String(g.state.faceoff.attempt));
  check('E: still the same question', g.state.question.id === firstQ);

  // ...and the host can bin it.
  const skipped = g.skipQuestion();
  check('E: host skip loads a new question', g.state.question.id !== firstQ, g.state.question.id);
  check('E: host skip re-reads', has(skipped, 'readQuestion'));
  check('E: host skip resets the attempt count', g.state.faceoff.attempt === 1);
  check('E: host skip stays in the face-off', g.state.phase === PHASE.FACEOFF);

  // A real answer still ends it.
  const good = g.state.question.answers[0].text;
  g.submitFaceoff(good);
  check('E: a hit after retries resolves the face-off', g.state.phase === PHASE.PLAY_OR_PASS);
}

// ------------------------------------------------- E2: both face-off answers are masked
{
  const g = newGame();
  g.startRound();
  const open = g.beginFaceoff();
  const first = open.find((e) => e.type === 'awaitInput');
  check('E2: the lead face-off answer is masked', first.masked === true);
  const second = g.submitFaceoff('zzzqqqwww').find((e) => e.type === 'awaitInput');
  check('E2: the second face-off answer is masked too', second.masked === true);
  const retry = g.submitFaceoff('qqqzzzwww').find((e) => e.type === 'awaitInput');
  check('E2: a retry is masked as well', retry.masked === true);
}

// ---------------------------------------------------------------- F: already-revealed costs nothing
{
  const g = newGame();
  g.startRound(); g.beginFaceoff();
  const answers = g.state.question.answers;
  g.submitFaceoff(answers[0].text);
  g.choose('play');
  const potBefore = g.state.pot;
  const evts = g.submitBoard(answers[0].text);  // say it again
  check('F: repeat answer reports ALREADY', has(evts, 'already'));
  check('F: repeat answer costs no strike', g.state.strikes === 0, String(g.state.strikes));
  check('F: repeat answer awards no points twice', g.state.pot === potBefore);
}

// ---------------------------------------------------------------- G: multipliers across rounds
{
  const g = newGame();
  const multipliers = [];
  for (let r = 0; r < ROUNDS.length; r++) {
    g.startRound();
    multipliers.push(g.state.round.multiplier);
    g.beginFaceoff();
    const answers = g.state.question.answers;
    g.submitFaceoff(answers[0].text);
    g.choose('play');
    for (let i = 1; i < answers.length; i++) g.submitBoard(answers[i].text);
    if (r < ROUNDS.length - 1) g.advanceRound();
  }
  check('G: multipliers are 1, 2, 3', JSON.stringify(multipliers) === '[1,2,3]', JSON.stringify(multipliers));
  const evts = g.advanceRound();
  check('G: main game ends after round 3', g.state.phase === PHASE.MAIN_RESULT, g.state.phase);
  // The face-off lead alternates, and in this script the lead player always wins,
  // so round 2's 200 goes to player 1: 100 + 300 vs 200.
  const total = g.state.players.reduce((n, p) => n + p.score, 0);
  check('G: all three pots awarded (100+200+300)', total === 600, String(total));
  check('G: rounds 1 and 3 to player 0', g.state.players[0].score === 400, String(g.state.players[0].score));
  check('G: round 2 to player 1', g.state.players[1].score === 200, String(g.state.players[1].score));
  check('G: winner reported', last(evts, 'mainResult')?.winner === 0);
}

// ---------------------------------------------------------------- H: face-off pair alternates who goes first
{
  const g = newGame();
  g.startRound();
  check('H: round 1 player 0 leads off', g.state.faceoff.pair[0] === 0);
  g.beginFaceoff();
  const a1 = g.state.question.answers;
  g.submitFaceoff(a1[0].text); g.choose('play');
  for (let i = 1; i < a1.length; i++) g.submitBoard(a1[i].text);
  g.advanceRound();
  check('H: round 2 player 1 leads off', g.state.faceoff.pair[0] === 1, String(g.state.faceoff.pair));
}

// ---------------------------------------------------------------- I: undo
{
  const g = newGame();
  g.startRound(); g.beginFaceoff();
  const answers = g.state.question.answers;
  g.submitFaceoff(answers[0].text);
  g.choose('play');
  g.submitBoard(GARBAGE[0]);
  check('I: strike registered', g.state.strikes === 1);
  g.undo();
  check('I: undo removes the strike', g.state.strikes === 0, String(g.state.strikes));
  check('I: undo restores the phase', g.state.phase === PHASE.BOARD_PLAY);

  const potBefore = g.state.pot;
  g.submitBoard(answers[1].text);
  check('I: reveal added points', g.state.pot > potBefore);
  g.undo();
  check('I: undo removes the reveal', g.state.revealed[1] === false);
  check('I: undo restores the pot', g.state.pot === potBefore, String(g.state.pot));
}

// ---------------------------------------------------------------- J: host override
{
  const g = newGame();
  g.startRound(); g.beginFaceoff();
  const answers = g.state.question.answers;
  g.submitFaceoff(answers[0].text);
  g.choose('play');
  const evts = g.forceReveal(3);
  check('J: force-reveal works', g.state.revealed[2] === true);
  check('J: force-reveal awards points', last(evts, 'reveal')?.points === answers[2].points);
  check('J: force-reveal is flagged as an override', has(evts, 'hostOverride'));
  const noop = g.forceReveal(3);
  check('J: force-revealing twice is a no-op', has(noop, 'noop'));
  g.forceStrike();
  check('J: force-strike registers', g.state.strikes === 1, String(g.state.strikes));
}

// ---------------------------------------------------------------- K: target score ends early
{
  const g = newGame({ targetScore: 150 });
  g.startRound(); g.beginFaceoff();
  const a1 = g.state.question.answers;
  g.submitFaceoff(a1[0].text); g.choose('play');
  for (let i = 1; i < a1.length; i++) g.submitBoard(a1[i].text);
  g.advanceRound();  // 100 < 150, play on
  check('K: below target, the match continues', g.state.phase === PHASE.ROUND_CARD, g.state.phase);
  g.beginFaceoff();
  const a2 = g.state.question.answers;
  g.submitFaceoff(a2[0].text); g.choose('play');
  for (let i = 1; i < a2.length; i++) g.submitBoard(a2[i].text);
  const who = g.state.roundResult.playerId;
  g.advanceRound();
  check('K: crossing the target ends the main game', g.state.phase === PHASE.MAIN_RESULT, g.state.phase);
  check('K: leader is the winner', g.state.winner === who);
}

// ---------------------------------------------------------------- L: tie forces sudden death
{
  const g = newGame();
  g.state.players[0].score = 300;
  g.state.players[1].score = 300;
  g.state.roundIndex = ROUNDS.length - 1;
  g.state.phase = PHASE.ROUND_END;
  g.state.round = ROUNDS[ROUNDS.length - 1];
  g.advanceRound();
  check('L: a tie triggers sudden death', g.state.suddenDeath === true);
  check('L: sudden death is x4', g.state.round.multiplier === 4, String(g.state.round?.multiplier));
  check('L: sudden death starts a fresh round', g.state.phase === PHASE.ROUND_CARD);
}

// ---------------------------------------------------------------- M: fast money, duplicate handling
{
  const g = newGame();
  g.state.winner = 0;
  g.state.phase = PHASE.MAIN_RESULT;
  g.startFastMoney();
  check('M: fast money takes both players', g.state.fm.order.length === 2, JSON.stringify(g.state.fm.order));

  g.fmBeginTurn();
  check('M: fast money play phase', g.state.phase === PHASE.FM_PLAY);
  const qs = g.state.fm.questions;
  for (let i = 0; i < qs.length; i++) g.fmSubmit(qs[i].answers[0].text);
  check('M: after 5 answers the second player looks away', g.state.phase === PHASE.FM_LOOKAWAY, g.state.phase);

  g.fmBeginTurn();
  // Player 2 deliberately duplicates question 1 and answers the rest differently.
  g.fmSubmit(qs[0].answers[0].text);
  for (let i = 1; i < qs.length; i++) g.fmSubmit(qs[i].answers[1].text);
  check('M: both turns done -> reveal', g.state.phase === PHASE.FM_REVEAL, g.state.phase);

  const evts = g.fmReveal();
  const dupEntry = evts.find((e) => e.type === 'fmRevealEntry' && e.duplicate);
  check('M: duplicate detected', !!dupEntry);
  check('M: duplicate scores zero', dupEntry?.points === 0);
  check('M: duplicate triggers the spare question', g.state.phase === PHASE.FM_DUPLICATE, g.state.phase);

  const spare = g.state.fm.spare;
  const done = g.fmSubmitSpare(spare.answers[0].text);
  const result = last(done, 'fmResult');
  check('M: spare answer finishes fast money', g.state.phase === PHASE.FM_RESULT, g.state.phase);
  check('M: a total is reported', typeof result?.total === 'number');
  check('M: target is 200', result?.target === FM_TARGET);
  check('M: win flag matches the total', result?.won === (result.total >= FM_TARGET));

  const expected = g.state.fm.entries.flat().reduce((n, e) => n + e.points, 0);
  check('M: total equals the sum of the entries', result?.total === expected, `${result?.total} vs ${expected}`);
}

// ---------------------------------------------------------------- N: timeout / pass
{
  const g = newGame();
  g.state.winner = 0;
  g.startFastMoney();
  g.fmBeginTurn();
  const evts = g.fmSubmit(null);
  check('N: a timeout records a blank answer', has(evts, 'fmAnswer'));
  check('N: blank scores zero', g.state.fm.entries[0][0].points === 0);
  check('N: play moves to the next question', g.state.fm.qIndex === 1);
}

// ---------------------------------------------------------------- O: 4 players
{
  const g = newGame({}, ['A', 'B', 'C', 'D']);
  g.startRound();
  check('O: round 1 pairs players 0 and 1', JSON.stringify(g.state.faceoff.pair) === '[0,1]');
  g.beginFaceoff();
  const answers = g.state.question.answers;
  g.submitFaceoff(answers[0].text);
  g.choose('play');
  for (let i = 1; i < answers.length; i++) g.submitBoard(answers[i].text);
  g.advanceRound();
  check('O: round 2 pairs players 1 and 2', JSON.stringify(g.state.faceoff.pair) === '[1,2]', JSON.stringify(g.state.faceoff.pair));
}

for (const f of failures) console.error(`FAIL ${f}`);
console.log(`\n${failures.length ? 'FAIL' : 'PASS'} — ${passed}/${passed + failures.length} game checks`);
process.exit(failures.length ? 1 : 0);
