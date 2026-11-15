// Regression suite for the faults found in the first real play-through.
import { loadChromium, BASE_URL, RELAY_URL, SHOTS, TIMEOUT } from './harness.mjs';
const chromium = await loadChromium();
const OUT = SHOTS;
const URL = BASE_URL;
const T = TIMEOUT;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` - ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});

const waitInput = () => page.waitForFunction(() => !!window.__feud?.ui?.pendingInput, null, { timeout: T });
const waitChoice = () => page.waitForFunction(() => window.__feud?.ui?.awaitingChoice === true, null, { timeout: T });
const waitAdvance = () => page.waitForFunction(() => window.__feud?.ui?.awaitingAdvance === true, null, { timeout: T });
const gs = () => page.evaluate(() => {
  const s = window.__feud.game.state;
  return {
    phase: s.phase, qid: s.question?.id, attempt: s.faceoff?.attempt,
    strikes: s.strikes, pot: s.pot, roundIndex: s.roundIndex,
    scores: s.players.map((p) => p.score),
    answers: s.question?.answers.map((a) => a.text) ?? [],
    revealed: s.revealed,
  };
});
// The advance button that is actually on screen, if any.
const visibleAdvance = () => page.evaluate(() => {
  const btn = [...document.querySelectorAll('.advance-btn')]
    .find((b) => !b.hidden && b.getBoundingClientRect().width > 0);
  return btn ? btn.textContent.replace(/\s+/g, ' ').trim() : null;
});
async function answer(text) {
  await waitInput();
  await page.fill('#answerInput', text);
  await page.keyboard.press('Enter');
}

await page.goto(URL, { waitUntil: 'networkidle' });
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
await page.evaluate(() => window.__feud.audio.setMuted(true));
const names = await page.$$('#nameGrid input');
await names[0].fill('FLIP');
await names[1].fill('BELLA');
await page.click('#startBtn');

console.log('\n=== 1. both face-off answers are masked ===');
await waitInput();
const q1 = await gs();
check('player 1 box is masked', await page.$eval('#answerInput', (e) => e.classList.contains('masked')));
await page.fill('#answerInput', 'zzzqqqwww');
await page.keyboard.press('Enter');
await waitInput();
check('player 2 box is masked too', await page.$eval('#answerInput', (e) => e.classList.contains('masked')));
check('player 2 box starts empty', (await page.$eval('#answerInput', (e) => e.value)) === '');

console.log('\n=== 2. a double miss keeps the question ===');
await page.fill('#answerInput', 'qqqzzzwww');
await page.keyboard.press('Enter');
await waitInput();
let s = await gs();
check('same question still up', s.qid === q1.qid, `${q1.qid} then ${s.qid}`);
check('still in the face-off', s.phase === 'FACEOFF', s.phase);
check('attempt counter advanced', s.attempt === 2, String(s.attempt));
check('board still blank', s.revealed.every((r) => !r));
check('question banner unchanged', (await page.textContent('#question')).length > 10);
check('retry box is masked', await page.$eval('#answerInput', (e) => e.classList.contains('masked')));
await page.screenshot({ path: `${OUT}/rep-faceoff-retry.png` });

// and a third time, to prove it is not a one-shot retry
await page.fill('#answerInput', 'aaazzzqqq');
await page.keyboard.press('Enter');
await waitInput();
await page.fill('#answerInput', 'bbbzzzqqq');
await page.keyboard.press('Enter');
await waitInput();
s = await gs();
check('a second double miss also keeps it', s.qid === q1.qid && s.attempt === 3, `${s.qid} attempt ${s.attempt}`);

console.log('\n=== 3. host key N bins the question ===');
await page.keyboard.press('n');
await waitInput();
s = await gs();
check('N loads a new question', s.qid !== q1.qid, `${q1.qid} then ${s.qid}`);
check('N resets the attempt count', s.attempt === 1, String(s.attempt));
check('N stays in the face-off', s.phase === 'FACEOFF');

console.log('\n=== 4. failed steal leaves a way forward ===');
s = await gs();
await answer(s.answers[0]);          // FLIP takes the top answer
await waitChoice();
await page.keyboard.press('s');           // pass, so BELLA plays and FLIP steals
await waitInput();
for (const bad of ['zzzqqqa', 'zzzqqqb', 'zzzqqqc']) await answer(bad);
await page.waitForFunction(() => window.__feud.game.state.phase === 'STEAL', null, { timeout: T });
await page.screenshot({ path: `${OUT}/rep-steal-offered.png` });
await answer('definitely not on this board');
await waitAdvance();
const label = await visibleAdvance();
check('an advance button is on screen after a failed steal', label !== null, String(label));
check('it says what it does', /NEXT ROUND/.test(label ?? ''), String(label));
check('the answer form is hidden', await page.$eval('#answerForm', (e) => e.hidden));
await page.screenshot({ path: `${OUT}/rep-steal-failed.png` });

const before = await gs();
await page.click('.advance-btn:not([hidden])');      // the user's "nowhere to click"
await waitInput();
s = await gs();
check('clicking it moves the game on', s.roundIndex === before.roundIndex + 1, `${before.roundIndex} then ${s.roundIndex}`);
check('round 2 is in the face-off', s.phase === 'FACEOFF');
check('the button is gone once spent', (await visibleAdvance()) === null);

console.log('\n=== 5. "already on the board" names the answer ===');
s = await gs();
await answer(s.answers[0]);
await waitChoice();
await page.keyboard.press('p');
await waitInput();
const strikesBefore = (await gs()).strikes;
await answer(s.answers[0]);          // say it again
await page.waitForTimeout(700);
const toastText = await page.textContent('#toast');
check('the toast names the matched answer', toastText.includes(s.answers[0]), toastText);
check('the toast gives the row', /row \d/.test(toastText), toastText);
check('it still costs no strike', (await gs()).strikes === strikesBefore);
await page.screenshot({ path: `${OUT}/rep-already.png` });

console.log('\n=== 6. the advance button appears at the bank ===');
s = await gs();
for (let i = 1; i < s.answers.length; i++) await answer(s.answers[i]);
await waitAdvance();
check('bank shows an advance button', (await visibleAdvance()) !== null);
await page.screenshot({ path: `${OUT}/rep-bank.png` });

console.log('\n=== 7. audio survives the page being backgrounded ===');
await page.evaluate(() => window.__feud.audio.setMuted(false));
await page.evaluate(() => window.__feud.audio.sfx('ding'));
const ctxBefore = await page.evaluate(() => window.__feud.audio.contextState);
// Opening another page in the same browser backgrounds this one, which is what
// suspends an AudioContext.
const other = await browser.newPage();
await other.goto('about:blank');
await page.waitForTimeout(600);
await other.close();
await page.bringToFront();
await page.waitForTimeout(500);
await page.evaluate(() => window.__feud.audio.sfx('ding'));
await page.waitForTimeout(300);
const ctxAfter = await page.evaluate(() => window.__feud.audio.contextState);
check('audio context is running again after refocus', ctxAfter === 'running', `${ctxBefore} then ${ctxAfter}`);

console.log('\n=== errors ===');
check('no console or page errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(fail === 0 ? '\nALL REPORTED-BUG CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail ? 1 : 0);
