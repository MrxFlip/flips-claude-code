#!/usr/bin/env node
/**
 * Adds a pack of new questions to data/surveys.json.
 *
 *   node tools/add-questions.mjs data/question-pack-2026-11-17-main.txt main
 *   node tools/add-questions.mjs data/question-pack-2026-11-17-fastmoney.txt fastMoney
 *
 * Pack format (one question per block, answers most popular first):
 *
 *   ## T1 | Name something people do on a lazy Sunday.
 *   Sleep in | sleep, sleeping in, stay in bed
 *   Watch TV | tv, netflix
 *
 * The template name picks the points, so a pack never has to be hand-summed.
 * A prompt that is already in surveys.json is skipped, which makes the tool
 * safe to run twice. Run tools/test-all.mjs afterwards: validate-surveys
 * catches an alias claimed by two answers of the same question.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SURVEYS = resolve(here, '../data/surveys.json');

// Main-game templates total exactly 100 over six answers.
const TEMPLATES = {
  T1: [34, 22, 16, 12, 9, 7],
  T2: [30, 24, 18, 13, 9, 6],
  T3: [38, 21, 15, 11, 9, 6],
  T4: [27, 23, 19, 14, 10, 7],
  T5: [32, 25, 17, 12, 8, 6],
  T6: [29, 22, 18, 14, 10, 7],
  T7: [36, 20, 16, 13, 9, 6],
  T8: [25, 22, 19, 15, 11, 8],
  F1: [36, 24, 17, 12, 8],
  F2: [33, 25, 18, 13, 9],
  F3: [40, 22, 15, 11, 7],
  F4: [31, 26, 19, 12, 9],
  F5: [35, 23, 18, 14, 10],
};

const [packPath, bucket] = process.argv.slice(2);
if (!packPath || !['main', 'fastMoney'].includes(bucket)) {
  console.error('usage: node tools/add-questions.mjs <pack.txt> <main|fastMoney>');
  process.exit(2);
}

const data = JSON.parse(readFileSync(SURVEYS, 'utf8'));
const list = data[bucket];
const prefix = bucket === 'main' ? 'q' : 'f';
const known = new Set([...data.main, ...data.fastMoney].map((q) => q.prompt.toLowerCase()));
let nextId = Math.max(0, ...list.map((q) => Number(q.id.slice(1)) || 0)) + 1;

const blocks = readFileSync(resolve(process.cwd(), packPath), 'utf8')
  .replace(/\r\n/g, '\n')
  .split(/^## /m)
  .slice(1);

let added = 0;
let skipped = 0;
for (const block of blocks) {
  const lines = block.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const [tpl, prompt] = lines[0].split('|').map((x) => x.trim());
  const points = TEMPLATES[tpl];
  if (!points) throw new Error(`unknown template "${tpl}" for: ${prompt}`);
  const rows = lines.slice(1);
  if (rows.length !== points.length) {
    throw new Error(`"${prompt}" has ${rows.length} answers, template ${tpl} needs ${points.length}`);
  }
  if (known.has(prompt.toLowerCase())) { skipped += 1; continue; }

  const answers = rows.map((row, i) => {
    const bar = row.indexOf('|');
    const text = (bar < 0 ? row : row.slice(0, bar)).trim();
    const seen = new Set([text.toLowerCase()]);
    const aliases = [];
    for (const raw of (bar < 0 ? '' : row.slice(bar + 1)).split(',')) {
      const alias = raw.trim();
      if (!alias || seen.has(alias.toLowerCase())) continue;
      seen.add(alias.toLowerCase());
      aliases.push(alias);
    }
    return { text, points: points[i], aliases };
  });

  list.push({ id: `${prefix}${String(nextId).padStart(3, '0')}`, prompt, readAs: prompt, answers });
  known.add(prompt.toLowerCase());
  nextId += 1;
  added += 1;
}

writeFileSync(SURVEYS, `${JSON.stringify(data, null, 2)}\n`);
console.log(`${bucket}: added ${added}, skipped ${skipped} already present, now ${list.length}`);
