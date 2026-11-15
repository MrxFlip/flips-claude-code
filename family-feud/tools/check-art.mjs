#!/usr/bin/env node
// Reports which of the twelve generated images the game can actually use.
// Drop files into family-feud/img/ and run this to see what is still missing
// or misnamed. Exits 0 always — missing art is a valid state, not a failure.

import { existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const imgDir = resolve(here, '../img');

const EXPECTED = [
  ['splash.png',       '01  Title / splash key art',        '1920x1080'],
  ['backdrop.png',     '02  Stage backdrop',                '2560x1440'],
  ['board-frame.png',  '03  Answer board bezel',            '1600x900, transparent'],
  ['strike-x.png',     '04  Strike X',                      '1024x1024, transparent'],
  ['bella-idle.png',   '05  Bella, neutral',                '1200x1600, transparent'],
  ['bella-win.png',    '06  Bella celebrating',             '1200x1600, transparent'],
  ['bella-strike.png', '07  Bella reacting to a strike',    '1200x1600, transparent'],
  ['podiums.png',      '08  Contestant podiums',            '1920x1080, transparent'],
  ['round-card.png',   '09  Round transition background',   '1920x1080'],
  ['fastmoney-bg.png', '10  Fast Money bumper',             '1920x1080'],
  ['winner.png',       '11  Big winner frame',              '1920x1080'],
  ['tile.png',         '12  Arcade tile / thumbnail',       '1200x1200'],
];

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

if (!existsSync(imgDir)) {
  console.log(`img/ does not exist yet. Create family-feud/img/ and put the files there.`);
  process.exit(0);
}

const present = new Set(readdirSync(imgDir));
const expectedNames = new Set(EXPECTED.map(([n]) => n));

let found = 0, total = 0;
console.log('\nExpected files in family-feud/img/\n');
for (const [name, label, spec] of EXPECTED) {
  const path = resolve(imgDir, name);
  if (existsSync(path)) {
    const size = statSync(path).size;
    total += size;
    found++;
    console.log(`  OK      ${name.padEnd(18)} ${kb(size).padStart(8)}   ${label}`);
  } else {
    console.log(`  MISSING ${name.padEnd(18)} ${''.padStart(8)}   ${label}  (${spec})`);
  }
}

// Anything in img/ that the game will never look at is almost always a
// filename mismatch, which is the single most common way art "doesn't work".
const strays = [...present].filter((f) => !expectedNames.has(f) && !f.startsWith('.'));
if (strays.length) {
  console.log('\nFiles in img/ the game does not use (check the spelling):');
  for (const f of strays) console.log(`  ?       ${f}`);
}

console.log(`\n${found}/${EXPECTED.length} assets in place, ${kb(total)} total (budget: 4096 KB).`);
if (total > 4 * 1024 * 1024) console.log('WARNING: over the 4 MB budget for the arcade page.');
if (found < EXPECTED.length) console.log('Missing art falls back to the CSS-drawn stage — the game still runs.');
