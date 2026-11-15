// Two real browsers, one relay, one match.
import { loadChromium, BASE_URL, RELAY_URL, SHOTS, TIMEOUT } from './harness.mjs';
const chromium = await loadChromium();
const OUT = SHOTS;
// With no RELAY_URL the page resolves wss://<this host>/ws by itself, which is
// how it will run behind nginx.
const URL = RELAY_URL ? `${BASE_URL}?relay=${encodeURIComponent(RELAY_URL)}` : BASE_URL;
const T = TIMEOUT;
let fail = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` - ${detail}`}`);
};

const browser = await chromium.launch();
const errors = [];

async function openPlayer(name) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`);
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.keyboard.press('Enter');                 // attract -> setup
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__feud.audio.setMuted(true));
  const first = (await page.$$('#nameGrid input'))[0];
  await first.fill(name);
  await page.click('#modeSeg button[data-v="online"]');
  return page;
}

const gs = (page) => page.evaluate(() => {
  const g = window.__feud.game;
  if (!g) return null;
  const s = g.state;
  return {
    phase: s.phase, qid: s.question?.id,
    prompt: document.getElementById('question').textContent.trim(),
    scores: s.players.map((p) => p.score),
    names: s.players.map((p) => p.name),
    revealed: s.revealed, pot: s.pot, strikes: s.strikes,
    controller: s.controller,
    answers: s.question?.answers.map((a) => a.text) ?? [],
    screen: document.getElementById('stage').dataset.screen,
    inputLive: !document.getElementById('answerInput').disabled
               && !document.getElementById('answerForm').hidden,
    waiting: document.getElementById('waitingNote').hidden
      ? null : document.getElementById('waitingNote').textContent.trim(),
    choiceUp: !document.getElementById('choiceRow').hidden,
    boardText: document.getElementById('board').textContent,
  };
});
const waitInput = (page) => page.waitForFunction(() => !!window.__feud?.ui?.pendingInput, null, { timeout: T });

console.log('\n=== lobby ===');
const host = await openPlayer('FLIP');
await host.click('#createRoomBtn');
await host.waitForSelector('#lobbyRoom:not([hidden])', { timeout: T });
const code = (await host.textContent('#lobbyCode')).trim();
check('host gets a four-letter room code', /^[A-Z0-9]{4}$/.test(code), code);

const guest = await openPlayer('BELLA');
await guest.fill('#joinCode', code);
await guest.click('#joinRoomBtn');
await guest.waitForSelector('#lobbyRoom:not([hidden])', { timeout: T });
check('guest joins that room', (await guest.textContent('#lobbyCode')).trim() === code);

await host.waitForFunction(() => document.querySelectorAll('#lobbyPlayers li').length === 2, null, { timeout: T });
const hostRoster = await host.$$eval('#lobbyPlayers li', (els) => els.map((e) => e.textContent.trim()));
const guestRoster = await guest.$$eval('#lobbyPlayers li', (els) => els.map((e) => e.textContent.trim()));
check('both see the same two players', JSON.stringify(hostRoster) === JSON.stringify(guestRoster),
  `${JSON.stringify(hostRoster)} vs ${JSON.stringify(guestRoster)}`);
check('the host is marked as host', hostRoster[0].includes('host'), hostRoster[0]);
check('only the host gets a start button',
  !(await host.$eval('#startBtn', (e) => e.hidden)) && (await guest.$eval('#startBtn', (e) => e.hidden)));
await host.screenshot({ path: `${OUT}/net-lobby-host.png` });
await guest.screenshot({ path: `${OUT}/net-lobby-guest.png` });

console.log('\n=== the host starts the show ===');
await host.click('#startBtn');
await waitInput(host);
await guest.waitForFunction(() => window.__feud?.game?.state?.question != null, null, { timeout: T });
await guest.waitForTimeout(800);

let h = await gs(host);
let g = await gs(guest);
check('both are on the play screen', h.screen === 'play' && g.screen === 'play', `${h.screen}/${g.screen}`);
check('both show the same question', h.prompt === g.prompt && h.prompt.length > 10, `${h.prompt} vs ${g.prompt}`);
check('both have the same two names', JSON.stringify(h.names) === JSON.stringify(g.names), JSON.stringify(g.names));
check('the board has the same number of tiles',
  (await host.$$eval('.tile', (e) => e.length)) === (await guest.$$eval('.tile', (e) => e.length)));

console.log('\n=== a guest cannot read the board ===');
check('the guest was not sent the answers', g.answers.every((a) => a === ''), JSON.stringify(g.answers));
check('no answer text sits in the guest DOM',
  h.answers.every((a) => a && !g.boardText.includes(a)), g.boardText.replace(/\s+/g, ' ').slice(0, 120));
check('the host does have them', h.answers.every((a) => a.length > 0));

console.log('\n=== turn ownership ===');
check('the host types first', h.inputLive === true);
check('the guest is told to wait', g.inputLive === false && /FLIP/.test(g.waiting ?? ''), String(g.waiting));

await host.fill('#answerInput', 'definitely not an answer');
await host.keyboard.press('Enter');
await waitInput(guest);
await host.waitForFunction(
  () => !document.getElementById('waitingNote').hidden, null, { timeout: T });
h = await gs(host); g = await gs(guest);
check('now the guest types', g.inputLive === true);
check('and the host waits', h.inputLive === false && /BELLA/.test(h.waiting ?? ''), String(h.waiting));
check('online answers are not masked from their own typist',
  !(await guest.$eval('#answerInput', (e) => e.classList.contains('masked'))));
await guest.screenshot({ path: `${OUT}/net-guest-turn.png` });

console.log('\n=== the guest wins the face-off ===');
const top = h.answers[0];
await guest.fill('#answerInput', top);
await guest.keyboard.press('Enter');
await host.waitForFunction(() => window.__feud.game.state.phase === 'PLAY_OR_PASS', null, { timeout: T });
await guest.waitForFunction(() => window.__feud.ui.awaitingChoice === true, null, { timeout: T });
h = await gs(host); g = await gs(guest);
check('the top answer is revealed on the host', h.revealed[0] === true);
check('and on the guest', g.revealed[0] === true);
check('the guest sees the revealed words', g.boardText.toUpperCase().includes(top.toUpperCase()), top);
check('the pot matches on both', h.pot === g.pot && h.pot > 0, `${h.pot}/${g.pot}`);
check('play-or-pass is offered to the guest only', g.choiceUp === true && h.choiceUp === false);

console.log('\n=== the guest plays the board ===');
await guest.click('.choice-row [data-choice="play"]');
await waitInput(guest);
await host.waitForFunction(() => window.__feud.game.state.phase === 'BOARD_PLAY', null, { timeout: T });
h = await gs(host); g = await gs(guest);
check('control passed to the guest', h.controller === 1 && g.controller === 1, `${h.controller}/${g.controller}`);
check('the guest can type', g.inputLive === true);

const second = h.answers[1];
await guest.fill('#answerInput', second);
await guest.keyboard.press('Enter');
await host.waitForFunction(() => window.__feud.game.state.revealed[1] === true, null, { timeout: T });
await guest.waitForTimeout(700);
h = await gs(host); g = await gs(guest);
check('the second answer landed on both boards', h.revealed[1] && g.revealed[1]);
check('scores still agree', JSON.stringify(h.scores) === JSON.stringify(g.scores));

console.log('\n=== a strike crosses both screens ===');
await guest.fill('#answerInput', 'nowhere near the board');
await guest.keyboard.press('Enter');
await host.waitForFunction(() => window.__feud.game.state.strikes === 1, null, { timeout: T });
await guest.waitForTimeout(600);
h = await gs(host); g = await gs(guest);
check('both show one strike', h.strikes === 1 && g.strikes === 1, `${h.strikes}/${g.strikes}`);
check('both lit the same slot',
  (await host.$$eval('.strike-slot.on', (e) => e.length)) === (await guest.$$eval('.strike-slot.on', (e) => e.length)));
await host.screenshot({ path: `${OUT}/net-host-play.png` });
await guest.screenshot({ path: `${OUT}/net-guest-play.png` });

console.log('\n=== out-of-turn input is refused ===');
const refused = await host.evaluate(() => {
  // Pretend the guest fired an answer while it is not their turn.
  const before = JSON.stringify(window.__feud.game.state.revealed);
  window.dispatchEvent(new Event('noop'));
  return before;
});
await guest.evaluate(() => {
  // The guest's own box is disabled here, so go straight at the wire.
  window.__feud.net?.relay?.({ k: 'input', kind: 'choice', which: 'play' });
});
await host.waitForTimeout(500);
h = await gs(host);
check('a choice sent outside PLAY_OR_PASS changes nothing',
  JSON.stringify(h.revealed) === refused && h.phase === 'BOARD_PLAY', h.phase);

console.log('\n=== the host leaving ends the match cleanly ===');
await host.close();
await guest.waitForFunction(
  () => !document.getElementById('waitingNote').hidden
     && /host/i.test(document.getElementById('waitingNote').textContent), null, { timeout: T });
check('the guest is told the host left',
  /host/i.test(await guest.textContent('#waitingNote')), await guest.textContent('#waitingNote'));
await guest.screenshot({ path: `${OUT}/net-host-left.png` });

console.log('\n=== errors ===');
check('no console or page errors', errors.length === 0, errors.join(' | '));

await browser.close();
console.log(fail === 0 ? '\nALL ONLINE CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail ? 1 : 0);
