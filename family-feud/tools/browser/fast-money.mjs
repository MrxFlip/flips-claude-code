import { loadChromium, BASE_URL, RELAY_URL, SHOTS, TIMEOUT } from './harness.mjs';
const chromium = await loadChromium();

const OUT = SHOTS;
const URL = BASE_URL;
const T = TIMEOUT;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
await page.evaluate(() => window.__feud.audio.setMuted(true));
await page.click('#startBtn');
await page.waitForFunction(() => !!window.__feud?.ui?.pendingInput, null, { timeout: T });

// Jump the main game: Fast Money is what we're testing here.
await page.evaluate(() => {
  const g = window.__feud.game;
  g.state.players[0].score = 400;
  g.state.players[1].score = 220;
  g.state.winner = 0;
  g.state.phase = 'MAIN_RESULT';
  window.__feud.run(g.startFastMoney());
});

const waitAdvance = () => page.waitForFunction(() => window.__feud?.ui?.awaitingAdvance === true, null, { timeout: T });
const waitFmInput = () => page.waitForSelector('#fmForm:not([hidden]) #fmInput:not([disabled])', { timeout: T });
const fmState = () => page.evaluate(() => {
  const fm = window.__feud.game.state.fm;
  return {
    phase: window.__feud.game.state.phase,
    turn: fm.turn, qIndex: fm.qIndex, order: fm.order,
    total: fm.total,
    questions: fm.questions.map(q => q.answers.map(a => a.text)),
    entries: fm.entries.map(list => list.map(e => ({ text: e.text, points: e.points, dup: !!e.duplicate }))),
  };
});

console.log('\n=== fast money intro ===');
await waitAdvance();
check('fast money screen shown', await page.evaluate(() => document.getElementById('stage').dataset.screen) === 'fm');
check('target shown in the header', (await page.textContent('#fmWho')).includes('200'));
await page.screenshot({ path: `${OUT}/e2e-fm-intro.png` });

console.log('\n=== player 1 turn ===');
await page.keyboard.press('Space');
await waitFmInput();
let fm = await fmState();
check('five rows rendered', await page.$$eval('.fm-row', e => e.length) === 5, String(await page.$$eval('.fm-row', e => e.length)));
check('timer visible', (await page.textContent('#fmTimerText')).length > 0);
check('player 1 is first', fm.order[0] === 0 && fm.turn === 0);

for (let i = 0; i < 5; i++) {
  await waitFmInput();
  const st = await fmState();
  await page.fill('#fmInput', st.questions[st.qIndex][0]);   // top answer each time
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
}
await page.waitForFunction(() => window.__feud.game.state.phase === 'FM_LOOKAWAY', null, { timeout: T });
check('player 1 turn ends after 5 answers', (await fmState()).entries[0].length === 5);
check('player 1 answers all masked during play',
  await page.$$eval('.fm-a', els => els.every(e => e.classList.contains('hidden-answer'))));
check('all five of player 1 rows are ticked, including the last',
  await page.$$eval('.fm-a', els => els.filter(e => e.textContent === '\u2713').length) === 5,
  await page.$$eval('.fm-a', els => els.map(e => e.textContent).join('|')));
check('nothing leaked into player 2 column',
  await page.$$eval('.fm-b', els => els.every(e => e.textContent.startsWith('\u2022'))),
  await page.$$eval('.fm-b', els => els.map(e => e.textContent).join('|')));
await page.screenshot({ path: `${OUT}/e2e-fm-p1.png` });

console.log('\n=== look-away curtain ===');
await page.waitForSelector('#curtain.show', { timeout: T });
check('curtain shown', await page.$eval('#curtain', e => e.classList.contains('show')));
check('curtain names the next player', (await page.textContent('#curtainSub')).includes('BEA') || (await page.textContent('#curtainSub')).length > 5);
await page.screenshot({ path: `${OUT}/e2e-fm-curtain.png` });
await page.waitForFunction(() => !document.getElementById('curtain').classList.contains('show'), null, { timeout: T });
await waitAdvance();

console.log('\n=== player 2 turn (with a deliberate duplicate) ===');
await page.keyboard.press('Space');
await waitFmInput();
check('player 2 is up', (await fmState()).turn === 1);

for (let i = 0; i < 5; i++) {
  await waitFmInput();
  const st = await fmState();
  // Question 1 duplicates player 1 on purpose; the rest take the second answer.
  const pick = st.qIndex === 0 ? st.questions[0][0] : st.questions[st.qIndex][1];
  await page.fill('#fmInput', pick);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
}
await page.waitForFunction(() => window.__feud.game.state.phase === 'FM_REVEAL', null, { timeout: T });
check('both turns complete', (await fmState()).entries[1].length === 5);
check('player 2 answers masked until the reveal',
  await page.$$eval('.fm-b', els => els.every(e => e.classList.contains('hidden-answer'))),
  await page.$$eval('.fm-b', els => els.map(e => e.textContent).join('|')));

console.log('\n=== reveal ===');
await waitAdvance();
await page.keyboard.press('Space');
await page.waitForFunction(() => ['FM_DUPLICATE', 'FM_RESULT'].includes(window.__feud.game.state.phase), null, { timeout: T });
fm = await fmState();
check('duplicate detected', fm.phase === 'FM_DUPLICATE', fm.phase);
check('duplicate scored zero', fm.entries[1][0].points === 0 && fm.entries[1][0].dup === true);
check('answers now visible', await page.$eval('.fm-row .fm-a', e => !e.classList.contains('hidden-answer')));
await page.screenshot({ path: `${OUT}/e2e-fm-reveal.png` });

console.log('\n=== spare question ===');
await waitFmInput();
const spare = await page.evaluate(() => window.__feud.game.state.fm.spare.answers[0].text);
await page.fill('#fmInput', spare);
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__feud.game.state.phase === 'FM_RESULT', null, { timeout: T });
await waitAdvance();   // the result handler finishes by arming the rematch key
check('spare question finishes fast money', (await fmState()).phase === 'FM_RESULT');
check('result screen shown', await page.evaluate(() => document.getElementById('stage').dataset.screen) === 'result');

const shown = Number(await page.textContent('#resultName'));
const real = await page.evaluate(() =>
  window.__feud.game.state.fm.entries.flat().reduce((n, e) => n + e.points, 0));
check('displayed total matches the entries', shown === real, `${shown} vs ${real}`);
check('result detail mentions the target', (await page.textContent('#resultDetail')).includes('200'));
await page.screenshot({ path: `${OUT}/e2e-fm-result.png` });

console.log('\n=== errors ===');
check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(fail === 0 ? '\nALL FAST MONEY CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail ? 1 : 0);
