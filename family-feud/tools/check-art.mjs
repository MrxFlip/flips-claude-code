#!/usr/bin/env node
// Reports which of the twelve generated images the game can actually use.
// Drop files into family-feud/img/ and run this to see what is still missing
// or misnamed. Exits 0 always — missing art is a valid state, not a failure.

import { existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const imgDir = resolve(here, '../img');

// Any of these extensions works; src/art.js probes them in this order.
const EXTENSIONS = ['.webp', '.png', '.jpg'];

const EXPECTED = [
  ['splash',       '01  Title / splash key art',     '1920x1080'],
  ['backdrop',     '02  Stage backdrop',             '2560x1440'],
  ['board-frame',  '03  Answer board bezel',         '1600x900, transparent'],
  ['strike-x',     '04  Strike X',                   '1024x1024, transparent'],
  ['bella-idle',   '05  Bella, neutral',             '1200x1600, transparent'],
  ['bella-win',    '06  Bella celebrating',          '1200x1600, transparent'],
  ['bella-strike', '07  Bella reacting to a strike', '1200x1600, transparent'],
  ['podiums',      '08  Contestant podiums',         '1920x1080, transparent'],
  ['round-card',   '09  Round transition background','1920x1080'],
  ['fastmoney-bg', '10  Fast Money bumper',          '1920x1080'],
  ['winner',       '11  Big winner frame',           '1920x1080'],
  ['tile',         '12  Arcade tile / thumbnail',    '1200x1200'],  // Optional 2.0 extras (docs/bellafox-feud-2-art-and-voice.md). The game
  // draws a stand-in for each, so these are upgrades rather than requirements.
  ['bella-think',  '13  Bella thinking (optional)',  '1024x1536, transparent'],
  ['bella-point',  '14  Bella presenting (optional)','1024x1536, transparent'],
  ['buzzer',       '15  Buzzer dome (optional)',     '1024x1024, transparent'],
  ['crowd',        '16  Audience silhouette (optional)', '1920x400, transparent'],
  ['trophy',       '17  Trophy (optional)',          '1024x1024, transparent'],
  ['logo-marquee', '18  Title marquee frame (optional)', '1960x1800, transparent'],
];

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

if (!existsSync(imgDir)) {
  console.log(`img/ does not exist yet. Create family-feud/img/ and put the files there.`);
  process.exit(0);
}

const present = readdirSync(imgDir).filter((f) => !f.startsWith('.'));
const used = new Set();

let found = 0, total = 0;
console.log('\nExpected files in family-feud/img/\n');
for (const [base, label, spec] of EXPECTED) {
  const hit = EXTENSIONS
    .map((ext) => base + ext)
    .find((name) => existsSync(resolve(imgDir, name)));

  if (hit) {
    const size = statSync(resolve(imgDir, hit)).size;
    total += size;
    found++;
    used.add(hit);
    console.log(`  OK      ${hit.padEnd(20)} ${kb(size).padStart(8)}   ${label}`);
  } else {
    console.log(`  MISSING ${(base + '.*').padEnd(20)} ${''.padStart(8)}   ${label}  (${spec})`);
  }
}

// Anything in img/ that the game will never look at is almost always a
// filename mismatch, which is the single most common way art "doesn't work".
const strays = present.filter((f) => !used.has(f));
if (strays.length) {
  console.log('\nFiles in img/ the game does not use (check the spelling):');
  for (const f of strays) console.log(`  ?       ${f}`);
}

console.log(`\n${found}/${EXPECTED.length} assets in place, ${kb(total)} total (budget: 4096 KB).`);
if (total > 4 * 1024 * 1024) console.log('WARNING: over the 4 MB budget for the arcade page.');
if (found < EXPECTED.length) console.log('Missing art falls back to the CSS-drawn stage — the game still runs.');
