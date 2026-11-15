// Direct test of the suspend/resume fix: force the context into the state the
// browser puts it in when the tab is backgrounded, and prove the game recovers.
import { loadChromium, BASE_URL, RELAY_URL, SHOTS, TIMEOUT } from './harness.mjs';
const chromium = await loadChromium();

let fail = 0;
const check = (label, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` - ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.keyboard.press('Enter');          // the gesture that unlocks audio
await page.waitForTimeout(300);

check('context is running after the first gesture',
  (await page.evaluate(() => window.__feud.audio.contextState)) === 'running');

// Park it, the way a tab switch or an output-device change does.
await page.evaluate(async () => {
  const a = window.__feud.audio;
  // reach the context the same way the page does, through a forced suspend
  await a.__suspendForTest();
});
check('context reports suspended once parked',
  (await page.evaluate(() => window.__feud.audio.contextState)) === 'suspended');

// This is the exact call the game makes on every single sound effect.
await page.evaluate(() => window.__feud.audio.sfx('ding'));
await page.waitForFunction(
  () => window.__feud.audio.contextState === 'running', null, { timeout: 5000 },
).catch(() => {});
check('a sound effect resumes it',
  (await page.evaluate(() => window.__feud.audio.contextState)) === 'running');

// And speaking a line resumes it too.
await page.evaluate(async () => { await window.__feud.audio.__suspendForTest(); });
await page.evaluate(() => window.__feud.audio.speak(null, 'testing one two'));
await page.waitForFunction(
  () => window.__feud.audio.contextState === 'running', null, { timeout: 5000 },
).catch(() => {});
check('speaking a line resumes it',
  (await page.evaluate(() => window.__feud.audio.contextState)) === 'running');

console.log('\n=== voice queue ===');
// Three lines at once: they must play one after another, not cut each other off.
const order = await page.evaluate(async () => {
  const a = window.__feud.audio;
  const seen = [];
  a.onSubtitle((t) => { if (t) seen.push(t); });
  await Promise.all([
    a.speak(null, 'first line'),
    a.speak(null, 'second line'),
    a.speak(null, 'third line'),
  ]);
  return seen;
});
check('every queued line gets its turn', order.length === 3, JSON.stringify(order));
check('they run in the order they were asked for',
  order.join('|') === 'first line|second line|third line', JSON.stringify(order));

const chatter = await page.evaluate(async () => {
  const a = window.__feud.audio;
  const slow = a.speak(null, 'a long line that is still going');
  const dropped = await a.speak(null, 'a reaction', { priority: 'chatter' });
  await slow;
  return dropped;
});
check('chatter is dropped rather than talking over her', chatter === 'skipped', String(chatter));

await browser.close();
console.log(fail === 0 ? '\nALL AUDIO CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail ? 1 : 0);
