import { loadChromium, BASE_URL, RELAY_URL, SHOTS, TIMEOUT } from './harness.mjs';
const chromium = await loadChromium();

const OUT = SHOTS;
const URL = BASE_URL;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
// Missing img/ and audio/ files are the designed fallback path, not failures.
const expected404 = [];
page.on('response', r => {
  try { if (r.status() === 404) expected404.push(new URL(r.url()).pathname); } catch {}
});
page.on('console', m => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/.test(m.text())) return;   // counted via responses
  errors.push(`console: ${m.text()}`);
});
page.on('dialog', d => d.accept());

const T = TIMEOUT;
const screen = () => page.evaluate(() => document.getElementById('stage').dataset.screen);
const gs = () => page.evaluate(() => {
  const g = window.__feud?.game;
  if (!g) return null;
  const s = g.state;
  return {
    phase: s.phase, pot: s.pot, strikes: s.strikes, controller: s.controller,
    stealer: s.stealer, revealed: s.revealed, roundIndex: s.roundIndex,
    multiplier: s.round?.multiplier, scores: s.players.map(p => p.score),
    names: s.players.map(p => p.name),
    answers: s.question?.answers.map(a => ({ text: a.text, points: a.points })) ?? [],
  };
});

// Wait on what the UI is actually ready for, not on the engine's phase —
// the engine moves synchronously, the screen catches up afterwards.
const waitInput = (ctx) => page.waitForFunction(
  c => { const u = window.__feud?.ui; return !!u?.pendingInput && (!c || u.pendingInput.context === c); },
  ctx, { timeout: T });
const waitChoice = () => page.waitForFunction(() => window.__feud?.ui?.awaitingChoice === true, null, { timeout: T });
const waitAdvance = () => page.waitForFunction(() => window.__feud?.ui?.awaitingAdvance === true, null, { timeout: T });
const waitIdle = () => page.waitForFunction(() => window.__feud?.ui?.busy === false, null, { timeout: T });

async function answer(text) {
  await waitInput();
  await page.fill('#answerInput', text);
  await page.keyboard.press('Enter');
}

await page.goto(URL, { waitUntil: 'networkidle' });

console.log('\n=== boot + attract ===');
check('attract screen shown', await screen() === 'attract');
check('logo rendered', (await page.textContent('.logo-bottom')).trim() === 'FEUD');
const art = await page.evaluate(() => ({
  classes: [...document.documentElement.classList].filter(c => c.startsWith('art-')),
  bellaVisible: getComputedStyle(document.querySelector('.bella-attract')).display !== 'none',
  splashBg: getComputedStyle(document.querySelector('.screen-attract')).backgroundImage,
}));
check('splash art applied to the attract screen', art.classes.includes('art-splash'), art.classes.join(','));
check('splash background resolved', /url\(/.test(art.splashBg), art.splashBg.slice(0, 60));
check('host not doubled on the splash', art.bellaVisible === false);
console.log(`  note: art classes = ${art.classes.join(', ') || '(none)'}`);

console.log('\n=== setup ===');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('enter goes to setup', await screen() === 'setup');
await page.evaluate(() => window.__feud.audio.setMuted(true));
check('two name fields by default', (await page.$$('#nameGrid input')).length === 2);
await page.click('#playerCount button[data-n="3"]');
check('three players adds a field', (await page.$$('#nameGrid input')).length === 3);
await page.click('#playerCount button[data-n="2"]');
const nameInputs = await page.$$('#nameGrid input');
await nameInputs[0].fill('ALEX');
await nameInputs[1].fill('BEA');

console.log('\n=== round 1: face-off ===');
await page.click('#startBtn');
await waitInput('faceoff');
check('play screen during face-off', await screen() === 'play');
let s = await gs();
check('player names carried through', s.names[0] === 'ALEX' && s.names[1] === 'BEA', JSON.stringify(s.names));
check('board starts blank', s.revealed.every(r => !r));
check('question rendered', (await page.textContent('#question')).length > 10);
check('face-off input is masked', await page.$eval('#answerInput', e => e.classList.contains('masked')));
check('prompt names the face-off player', (await page.textContent('#answerPrompt')).includes('ALEX'));

await answer(s.answers[0].text);
await waitChoice();
s = await gs();
check('top answer ends the face-off', s.phase === 'PLAY_OR_PASS');
check('rank 1 revealed', s.revealed[0] === true);
check('pot holds the top answer', s.pot === s.answers[0].points, String(s.pot));
check('choice buttons visible', await page.$eval('#choiceRow', e => !e.hidden));
await page.screenshot({ path: `${OUT}/e2e-faceoff.png` });

console.log('\n=== round 1: board play ===');
await page.keyboard.press('p');
await waitInput('board');
check('P plays the board', (await gs()).controller === 0);
check('input unmasked for board play', !(await page.$eval('#answerInput', e => e.classList.contains('masked'))));

await answer('zzzqqqwww');
await page.waitForFunction(() => window.__feud.game.state.strikes === 1, null, { timeout: T });
check('a miss costs a strike', (await gs()).strikes === 1);
check('strike slot lit', await page.$eval('.strike-slot', e => e.classList.contains('on')));
await page.screenshot({ path: `${OUT}/e2e-strike.png` });

await answer(s.answers[0].text);          // repeat an answer already on the board
await page.waitForTimeout(800);
check('repeating an answer costs no strike', (await gs()).strikes === 1, String((await gs()).strikes));

for (let i = 1; i < s.answers.length; i++) await answer(s.answers[i].text);
await waitAdvance();
let after = await gs();
check('board cleared banks the round', after.phase === 'ROUND_END');
check('all tiles revealed', after.revealed.every(Boolean));
check('100 points banked at x1', after.scores[0] === 100, JSON.stringify(after.scores));
check('every tile revealed in the DOM',
  await page.$$eval('.tile.revealed', els => els.length) === s.answers.length);
await page.screenshot({ path: `${OUT}/e2e-cleared.png` });

console.log('\n=== round 2: multiplier, pass, steal ===');
await page.keyboard.press('Space');
await waitInput('faceoff');
after = await gs();
check('round 2 reached', after.roundIndex === 1, String(after.roundIndex));
check('round 2 is double points', after.multiplier === 2, String(after.multiplier));
check('face-off lead alternates to BEA', (await page.textContent('#answerPrompt')).includes('BEA'));

s = await gs();
await answer(s.answers[1].text);          // BEA takes rank 2
await answer('qqqzzzxxx');                // ALEX misses
await waitChoice();
check('better rank wins control', (await gs()).controller === 1, String((await gs()).controller));

await page.keyboard.press('s');           // pass
await waitInput('board');
after = await gs();
check('pass swaps control', after.controller === 0, String(after.controller));
check('passer becomes the stealer', after.stealer === 1, String(after.stealer));

for (const bad of ['aaazzz', 'bbbzzz', 'cccqqq']) await answer(bad);
await waitInput('steal');
check('three strikes opens the steal', (await gs()).phase === 'STEAL');
check('stealer plate highlighted', await page.$$eval('.plate.stealing', e => e.length) === 1);
await page.screenshot({ path: `${OUT}/e2e-steal.png` });

s = await gs();
await answer(s.answers[s.revealed.findIndex(r => !r)].text);
await waitAdvance();
after = await gs();
check('successful steal banks to the stealer', after.scores[1] > 0, JSON.stringify(after.scores));
check('steal doubled in round 2', after.scores[1] % 2 === 0, String(after.scores[1]));

console.log('\n=== typing ahead of the host ===');
await page.keyboard.press('Space');
await page.waitForFunction(() => window.__feud.game.state.phase === 'ROUND_CARD', null, { timeout: T });
s = await gs();
// Type and submit while the host is still reading — must be queued, not lost.
await page.waitForTimeout(100);
await page.evaluate(() => { document.getElementById('answerInput').focus(); });
await page.fill('#answerInput', s.answers[0].text);
await page.keyboard.press('Enter');
await waitChoice();
check('an answer typed early is queued, not dropped', (await gs()).revealed[0] === true);

console.log('\n=== host keys ===');
await page.keyboard.press('p');
await waitInput('board');
await page.keyboard.press('3');
await waitIdle();
check('host key 3 force-reveals', (await gs()).revealed[2] === true);
await page.keyboard.press('x');
await page.waitForFunction(() => window.__feud.game.state.strikes === 1, null, { timeout: T });
check('host key X forces a strike', (await gs()).strikes === 1);
await page.keyboard.press('z');
await page.waitForFunction(() => window.__feud.game.state.strikes === 0, null, { timeout: T });
check('host key Z undoes the strike', (await gs()).strikes === 0);

await waitInput('board');
await page.fill('#answerInput', 'abc');
await page.keyboard.press('4');
await page.waitForTimeout(300);
check('digits type normally when the box has text', (await gs()).revealed[3] === false);
check('the digit reached the input', (await page.$eval('#answerInput', e => e.value)) === 'abc4');
await page.fill('#answerInput', '');

console.log('\n=== errors ===');
check('no console or page errors', errors.length === 0, errors.join(' | '));
const unexpected = expected404.filter(p => !/^\/(img|audio)\/|voice-manifest\.json$/.test(p));
check('only art/audio probes 404', unexpected.length === 0, unexpected.join(', '));
console.log(`  note: ${expected404.length} expected 404(s) from absent art/audio probes`);

await browser.close();
console.log(fail === 0 ? '\nALL E2E CHECKS PASSED' : `\n${fail} E2E CHECK(S) FAILED`);
process.exit(fail ? 1 : 0);
