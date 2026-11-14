#!/usr/bin/env node
// Validates data/surveys.json. Exits non-zero on any error.
// Usage: node tools/validate-surveys.mjs [path]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? resolve(here, '../data/surveys.json');

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

let data;
try {
  data = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`FATAL: cannot parse ${file}\n  ${e.message}`);
  process.exit(2);
}

// Mirrors the normalization in src/match.js closely enough to catch
// aliases that can never be reached because they collide.
const norm = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(a|an|the)\s+/, '');

const seenIds = new Set();

function checkQuestion(q, bucket, idx, { requireHundred }) {
  const where = `${bucket}[${idx}]${q?.id ? ` (${q.id})` : ''}`;

  if (!q || typeof q !== 'object') return err(`${where}: not an object`);
  if (!q.id || typeof q.id !== 'string') err(`${where}: missing string "id"`);
  else if (seenIds.has(q.id)) err(`${where}: duplicate id "${q.id}"`);
  else seenIds.add(q.id);

  if (!q.prompt || typeof q.prompt !== 'string') err(`${where}: missing "prompt"`);
  if (!q.readAs || typeof q.readAs !== 'string') {
    warn(`${where}: no "readAs" — the spoken line will fall back to "prompt"`);
  }

  if (!Array.isArray(q.answers) || q.answers.length === 0) {
    return err(`${where}: "answers" must be a non-empty array`);
  }
  if (requireHundred && (q.answers.length < 5 || q.answers.length > 8)) {
    err(`${where}: has ${q.answers.length} answers; main questions need 5-8`);
  }

  let total = 0;
  const aliasOwners = new Map();

  q.answers.forEach((a, ai) => {
    const aw = `${where}.answers[${ai}]`;
    if (!a || typeof a !== 'object') return err(`${aw}: not an object`);
    if (!a.text || typeof a.text !== 'string') err(`${aw}: missing "text"`);
    if (!Number.isInteger(a.points) || a.points <= 0) {
      err(`${aw}: "points" must be a positive integer (got ${JSON.stringify(a.points)})`);
    } else {
      total += a.points;
    }
    if (a.aliases !== undefined && !Array.isArray(a.aliases)) {
      err(`${aw}: "aliases" must be an array when present`);
    }
    const aliases = Array.isArray(a.aliases) ? a.aliases : [];
    if (a.text && aliases.length < 2) {
      warn(`${aw}: "${a.text}" has ${aliases.length} alias(es); 3-6 is the target`);
    }
    for (const raw of [a.text, ...aliases]) {
      if (typeof raw !== 'string' || !raw.trim()) {
        err(`${aw}: empty alias entry`);
        continue;
      }
      const n = norm(raw);
      if (!n) { err(`${aw}: alias "${raw}" normalizes to nothing`); continue; }
      if (aliasOwners.has(n) && aliasOwners.get(n) !== ai) {
        err(`${where}: "${raw}" is claimed by both answer ${aliasOwners.get(n) + 1} and ${ai + 1} — unreachable`);
      } else {
        aliasOwners.set(n, ai);
      }
    }
  });

  // Descending point order keeps board rank == array index.
  for (let i = 1; i < q.answers.length; i++) {
    const prev = q.answers[i - 1]?.points, cur = q.answers[i]?.points;
    if (Number.isInteger(prev) && Number.isInteger(cur) && cur > prev) {
      err(`${where}: answers must be ordered highest points first (index ${i} is ${cur} after ${prev})`);
      break;
    }
  }

  if (requireHundred && total !== 100) {
    err(`${where}: points total ${total}, must be exactly 100`);
  }
}

if (!Array.isArray(data.main)) err('top level: "main" must be an array');
else data.main.forEach((q, i) => checkQuestion(q, 'main', i, { requireHundred: true }));

if (!Array.isArray(data.fastMoney)) err('top level: "fastMoney" must be an array');
else data.fastMoney.forEach((q, i) => checkQuestion(q, 'fastMoney', i, { requireHundred: false }));

const mainCount = Array.isArray(data.main) ? data.main.length : 0;
const fmCount = Array.isArray(data.fastMoney) ? data.fastMoney.length : 0;
if (mainCount < 40) warn(`only ${mainCount} main questions — 40 is the ship minimum, 80 the target`);
if (fmCount < 20) warn(`only ${fmCount} Fast Money questions — 20 is the ship minimum, 40 the target`);

for (const w of warnings) console.log(`WARN  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);

console.log(
  `\n${errors.length ? 'FAIL' : 'PASS'} — ${mainCount} main, ${fmCount} fast money, ` +
  `${errors.length} error(s), ${warnings.length} warning(s)`
);
process.exit(errors.length ? 1 : 0);
