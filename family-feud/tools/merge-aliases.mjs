#!/usr/bin/env node
// Merge a pack of extra accepted answers into data/surveys.json.
//
//   node tools/merge-aliases.mjs pack1.txt [pack2.txt ...] [--write]
//
// Pack format, one answer per line (rank is 1-based):
//
//   q001.1: check my phone | doom scrolling | grab phone
//   f005.3: read a book | reading in bed
//
// An alias is dropped, and reported, when:
//   - it already resolves to this answer exactly (nothing to add);
//   - it normalizes to the same thing as a form of ANOTHER answer on the same
//     board. Two answers cannot share a phrasing; the one already there wins,
//     then the lower rank.
//
// Without --write it only reports. Run tools/test-all.mjs afterwards: the
// fixtures are what catch an alias that makes a WRONG answer start matching.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { normalize } from '../src/match.js';

const here = dirname(fileURLToPath(import.meta.url));
const surveysPath = resolve(here, '../data/surveys.json');
const args = process.argv.slice(2);
const write = args.includes('--write');
const packs = args.filter((a) => !a.startsWith('--'));
if (!packs.length) { console.error('usage: merge-aliases.mjs <pack.txt>... [--write]'); process.exit(2); }

const surveys = JSON.parse(readFileSync(surveysPath, 'utf8'));
const byId = new Map([...surveys.main, ...surveys.fastMoney].map((q) => [q.id, q]));

/** id -> rank index -> [alias] */
const wanted = new Map();
let bad = 0;
for (const file of packs) {
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([qf]\d{3})\.(\d):\s*(.*)$/.exec(line);
    if (!m) { console.error(`unparseable line: ${line.slice(0, 60)}`); bad++; continue; }
    const q = byId.get(m[1]);
    const idx = Number(m[2]) - 1;
    if (!q || !q.answers[idx]) { console.error(`no such answer: ${m[1]}.${m[2]}`); bad++; continue; }
    if (!wanted.has(q.id)) wanted.set(q.id, q.answers.map(() => []));
    wanted.get(q.id)[idx].push(...m[3].split('|').map((s) => s.trim()).filter(Boolean));
  }
}
if (bad) process.exit(1);

let added = 0, dupOwn = 0, dupSibling = 0;
const clashes = [];

for (const [id, lists] of wanted) {
  const q = byId.get(id);
  // normalized form -> owning answer index, existing phrasings first
  const owner = new Map();
  q.answers.forEach((a, i) => {
    for (const f of [a.text, ...(a.aliases ?? [])]) {
      const n = normalize(f);
      if (n && !owner.has(n)) owner.set(n, i);
    }
  });
  lists.forEach((aliases, i) => {
    const a = q.answers[i];
    a.aliases ??= [];
    for (const alias of aliases) {
      const n = normalize(alias);
      if (!n) continue;
      const who = owner.get(n);
      if (who === i) { dupOwn++; continue; }
      if (who !== undefined) {
        dupSibling++;
        clashes.push(`${id}: "${alias}" wanted by #${i + 1} (${a.text}) but belongs to #${who + 1} (${q.answers[who].text})`);
        continue;
      }
      owner.set(n, i);
      a.aliases.push(alias);
      added++;
    }
  });
}

for (const c of clashes) console.log(`  clash  ${c}`);
const total = [...byId.values()].reduce((n, q) => n + q.answers.reduce((m, a) => m + (a.aliases?.length ?? 0), 0), 0);
const answers = [...byId.values()].reduce((n, q) => n + q.answers.length, 0);
console.log(`\n${added} added, ${dupOwn} already accepted, ${dupSibling} dropped as clashes.`);
console.log(`Bank now has ${total} accepted phrasings over ${answers} answers (${(total / answers).toFixed(1)} each).`);

if (write) {
  writeFileSync(surveysPath, JSON.stringify(surveys, null, 2) + '\n');
  console.log(`wrote ${surveysPath}`);
} else {
  console.log('dry run — pass --write to save');
}
