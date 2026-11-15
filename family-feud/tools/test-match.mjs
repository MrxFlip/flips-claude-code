#!/usr/bin/env node
// Fixture suite for src/match.js. Must be 100% green before any commit that
// touches match.js or synonyms.js.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { matchAnswer, normalize } from '../src/match.js';

const here = dirname(fileURLToPath(import.meta.url));
const surveys = JSON.parse(readFileSync(resolve(here, '../data/surveys.json'), 'utf8'));
const { cases } = JSON.parse(readFileSync(resolve(here, '../fixtures/match-cases.json'), 'utf8'));

const byId = new Map([...surveys.main, ...surveys.fastMoney].map((q) => [q.id, q]));

let pass = 0;
const failures = [];

for (const c of cases) {
  const q = byId.get(c.q);
  if (!q) { failures.push({ c, got: `unknown question ${c.q}` }); continue; }

  const revealed = [];
  for (const rank of c.revealed ?? []) revealed[rank - 1] = true;

  const r = matchAnswer(c.in, q, revealed);

  let ok;
  if (c.expect === 'MISS') ok = r.status === 'MISS';
  else if (c.expect === 'ALREADY') ok = r.status === 'ALREADY';
  else ok = r.status === 'HIT' && r.rank === c.expect;

  if (ok) pass++;
  else {
    failures.push({
      c,
      got: r.status === 'MISS'
        ? `MISS (${r.via})`
        : `${r.status} rank ${r.rank} "${r.answer?.text}" via ${r.via}${r.score ? ` ${r.score.toFixed(3)}` : ''}`,
      normalized: r.normalized,
    });
  }
}

for (const f of failures) {
  console.error(
    `FAIL [${f.c.q}] "${f.c.in}" -> expected ${f.c.expect}, got ${f.got}` +
    (f.normalized !== undefined ? `  (normalized: "${f.normalized}")` : '')
  );
}

console.log(`\n${failures.length ? 'FAIL' : 'PASS'} — ${pass}/${cases.length} matcher cases`);
process.exit(failures.length ? 1 : 0);
