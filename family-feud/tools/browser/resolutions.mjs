import { loadChromium, BASE_URL, RELAY_URL, SHOTS, TIMEOUT } from './harness.mjs';
const chromium = await loadChromium();
const OUT = SHOTS;
const T = TIMEOUT;
const sizes = [
  { name: '1366x768',  width: 1366, height: 768 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

let fail = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch();

for (const s of sizes) {
  console.log(`\n=== ${s.name} ===`);
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Walk to a live board with tiles revealed, which is the densest layout.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__feud.audio.setMuted(true));
  await page.click('#startBtn');
  await page.waitForFunction(() => !!window.__feud?.ui?.pendingInput, null, { timeout: T });
  const answers = await page.evaluate(() => window.__feud.game.state.question.answers.map(a => a.text));
  await page.fill('#answerInput', answers[0]);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__feud?.ui?.awaitingChoice === true, null, { timeout: T });
  await page.keyboard.press('p');
  await page.waitForFunction(() => !!window.__feud?.ui?.pendingInput, null, { timeout: T });
  for (let i = 1; i < Math.min(4, answers.length); i++) {
    await page.waitForFunction(() => !!window.__feud?.ui?.pendingInput, null, { timeout: T });
    await page.fill('#answerInput', answers[i]);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(400);

  const m = await page.evaluate(() => {
    const stage = document.getElementById('stage');
    const b = stage.getBoundingClientRect();
    const inside = (el) => {
      const r = el.getBoundingClientRect();
      return r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
    };
    const named = {
      banner: document.querySelector('.question-banner'),
      board: document.getElementById('board'),
      plates: document.getElementById('plates'),
      input: document.getElementById('answerInput'),
      pot: document.querySelector('.pot-box'),
      strikes: document.getElementById('strikes'),
    };
    const outside = Object.entries(named).filter(([, el]) => el && !inside(el)).map(([k]) => k);
    return {
      scale: Number(stage.dataset.scale),
      stage: { w: Math.round(b.width), h: Math.round(b.height) },
      fitsViewport: b.width <= innerWidth + 1 && b.height <= innerHeight + 1,
      noPageScroll: document.documentElement.scrollWidth <= innerWidth &&
                    document.documentElement.scrollHeight <= innerHeight,
      outside,
      tiles: document.querySelectorAll('.tile').length,
      revealed: document.querySelectorAll('.tile.revealed').length,
      artClasses: [...document.documentElement.classList].filter(c => c.startsWith('art-')).length,
    };
  });

  check('stage fits the viewport', m.fitsViewport, `${m.stage.w}x${m.stage.h}`);
  check('no page scrollbars', m.noPageScroll);
  check('all key elements inside the stage', m.outside.length === 0, `outside: ${m.outside.join(', ')}`);
  check('board rendered', m.tiles >= 5 && m.revealed >= 3, `${m.revealed}/${m.tiles} revealed`);
  check('artwork applied', m.artClasses > 0, String(m.artClasses));
  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`    scale ${m.scale}`);

  await page.screenshot({ path: `${OUT}/res-${s.name}.png` });
  await page.close();
}

await browser.close();
console.log(fail === 0 ? '\nALL RESOLUTION CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail ? 1 : 0);
