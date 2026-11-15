#!/usr/bin/env node
/**
 * Self-consistency check across the whole question bank: every answer's own
 * text, and every alias written for it, must resolve back to that answer.
 *
 * The validator already catches two answers claiming the same alias, but it
 * normalizes without the synonym map. This runs the real matcher, so it also
 * catches an alias made unreachable by a synonym collision (e.g. two answers
 * that both collapse to "phone") or by the fuzzy cascade preferring a
 * different answer.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { matchAnswer } from '../src/match.js';

const here = dirname(fileURLToPath(import.meta.url));
const surveys = JSON.parse(readFileSync(resolve(here, '../data/surveys.json'), 'utf8'));

let checked = 0;
const failures = [];

for (const [bucket, questions] of Object.entries({ main: surveys.main, fastMoney: surveys.fastMoney })) {
  for (const q of questions) {
    q.answers.forEach((answer, i) => {
      const inputs = [answer.text, ...(answer.aliases ?? [])];
      for (const input of inputs) {
        checked++;
        const r = matchAnswer(input, q, []);
        if (r.status !== 'HIT' || r.rank !== i + 1) {
          failures.push(
            `[${bucket} ${q.id}] "${input}" should hit #${i + 1} "${answer.text}" ` +
            `but got ${r.status}${r.rank ? ` #${r.rank} "${r.answer.text}"` : ''} (via ${r.via})`
          );
        }
      }
    });
  }
}

for (const f of failures) console.error(`FAIL ${f}`);
console.log(`\n${failures.length ? 'FAIL' : 'PASS'} — ${checked - failures.length}/${checked} answer/alias round-trips`);
process.exit(failures.length ? 1 : 0);
