// Shared plumbing for the browser suites.
//
// These run a real Chromium against a real copy of the game. The headless
// suites in tools/ prove the rules; these prove the screen, which is where
// every fault from the first play-through actually lived.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const BASE_URL = process.env.FEUD_URL ?? 'http://127.0.0.1:8099/';
export const RELAY_URL = process.env.FEUD_RELAY ?? 'ws://127.0.0.1:8787/ws';
export const SHOTS = process.env.FEUD_SHOTS ?? resolve(here, '../../../.feud-shots');
export const TIMEOUT = Number(process.env.FEUD_TIMEOUT ?? 25000);

mkdirSync(SHOTS, { recursive: true });

/**
 * Find Playwright.
 *
 * It is normally not a dependency of this project — the game itself has none,
 * and keeping it that way matters more than the convenience of `npm test`. So
 * look where it tends to be, and say something useful when it is nowhere.
 */
export async function loadChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    '/opt/node-tools/node_modules/playwright/index.js',
  ].filter(Boolean);

  for (const spec of candidates) {
    try {
      const mod = await import(spec);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    } catch { /* try the next one */ }
  }
  throw new Error(
    'Playwright not found. Install it (npm i -D playwright && npx playwright install chromium) ' +
    'or point PLAYWRIGHT_MODULE at an existing copy.',
  );
}

/** A tiny assertion recorder. Keeps the suites readable and self-reporting. */
export function createChecker() {
  let failures = 0;
  const check = (label, ok, detail = '') => {
    if (!ok) failures += 1;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` - ${detail}`}`);
    return ok;
  };
  const section = (name) => console.log(`\n=== ${name} ===`);
  const done = (name) => {
    console.log(failures === 0 ? `\nALL ${name} CHECKS PASSED` : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures ? 1 : 0);
  };
  return { check, section, done, get failures() { return failures; } };
}

/**
 * Collect the errors a page reports.
 *
 * This is not decoration. A dead import once broke the entire page while every
 * headless check stayed green, and nothing found it until the console was read.
 */
export function watchErrors(page, label = '') {
  const errors = [];
  const tag = label ? `${label}: ` : '';
  page.on('pageerror', (e) => errors.push(`${tag}${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;   // art/audio probes
    errors.push(`${tag}${m.text()}`);
  });
  return errors;
}

/** Walk the attract screen, mute, and land on the setup screen. */
export async function toSetup(page, { mute = true } = {}) {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  if (mute) await page.evaluate(() => window.__feud.audio.setMuted(true));
}

export const ui = {
  input: (page) => page.waitForFunction(
    () => !!window.__feud?.ui?.pendingInput, null, { timeout: TIMEOUT }),
  choice: (page) => page.waitForFunction(
    () => window.__feud?.ui?.awaitingChoice === true, null, { timeout: TIMEOUT }),
  advance: (page) => page.waitForFunction(
    () => window.__feud?.ui?.awaitingAdvance === true, null, { timeout: TIMEOUT }),
  idle: (page) => page.waitForFunction(
    () => window.__feud?.ui?.busy === false, null, { timeout: TIMEOUT }),
  phase: (page, phase) => page.waitForFunction(
    (p) => window.__feud?.game?.state.phase === p, phase, { timeout: TIMEOUT }),
};
