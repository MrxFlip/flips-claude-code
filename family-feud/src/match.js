// Answer matching. Pure, DOM-free, importable in Node for tests.
//
// Design bias: a party game dies when it rejects an answer the room agrees is
// right. But accepting a WRONG answer is worse, because the host can override a
// rejection with the number keys and cannot take back a bad reveal. So the
// cascade is generous about spelling and phrasing, strict about meaning.

import { SYNONYMS, PHRASES } from './synonyms.js';

const ARTICLES = /^(a|an|the)\s+/;
const FILLER = /^(my|your|his|her|their|our|some|any|going to|gonna|wanna|want to|like)\s+/;

/** Strip accents, punctuation, case, and collapse whitespace. */
function baseNormalize(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Naive de-pluralization. Deliberately conservative. */
function singular(token) {
  if (token.length <= 3) return token;
  if (token.endsWith('ss')) return token;
  if (token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (/(ch|sh|s|x|z)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

/**
 * Full normalization: the canonical form both inputs and aliases are compared in.
 * Exported so tools/validate-surveys.mjs can detect unreachable aliases.
 */
export function normalize(input) {
  let s = baseNormalize(input);
  if (!s) return '';

  for (const [re, replacement] of PHRASES) s = s.replace(re, replacement);

  // Strip leading articles/filler repeatedly ("the my job" -> "job").
  let prev;
  do {
    prev = s;
    s = s.replace(ARTICLES, '').replace(FILLER, '');
  } while (s !== prev && s.length);

  return s
    .split(' ')
    .filter(Boolean)
    .map((t) => SYNONYMS.get(singular(t)) ?? singular(t))
    .join(' ')
    .trim();
}

function tokens(s) {
  return s.split(' ').filter(Boolean);
}

/** Sørensen–Dice over character bigrams. 1 = identical. */
export function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = bigrams.get(g) ?? 0;
    if (n > 0) { bigrams.set(g, n - 1); hits++; }
  }
  return (2 * hits) / (a.length + b.length - 2);
}

/** Levenshtein distance, early-exit above `max`. */
export function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export const FUZZY_THRESHOLD = 0.86;

/** All normalized forms that should resolve to a given answer. */
function formsFor(answer) {
  const raw = [answer.text, ...(answer.aliases ?? [])];
  const out = new Set();
  for (const r of raw) {
    const n = normalize(r);
    if (n) out.add(n);
  }
  return [...out];
}

/**
 * @returns {{status:'HIT'|'ALREADY'|'MISS', rank?:number, answer?:object,
 *            via?:string, score?:number, input:string, normalized:string}}
 * `revealed` is an array of booleans indexed by rank-1.
 */
export function matchAnswer(input, question, revealed = []) {
  const normalized = normalize(input);
  const result = { input: String(input ?? ''), normalized };

  if (!normalized) return { ...result, status: 'MISS', via: 'empty' };

  const candidates = question.answers.map((answer, i) => ({
    answer, index: i, forms: formsFor(answer),
  }));

  // 1 — exact
  for (const c of candidates) {
    if (c.forms.includes(normalized)) return decide(c, 'exact', 1);
  }

  // 2 — token-set containment, for short aliases only.
  //     "check phone" vs "check their phone"; "phone" vs "check phone".
  const inputTokens = tokens(normalized);
  for (const c of candidates) {
    for (const form of c.forms) {
      const formTokens = tokens(form);
      const short = formTokens.length <= 3 ? formTokens : null;
      if (short && short.every((t) => inputTokens.includes(t))) {
        return decide(c, 'contains-alias', 0.95);
      }
      if (inputTokens.length <= 3 && inputTokens.every((t) => formTokens.includes(t))) {
        return decide(c, 'alias-contains', 0.93);
      }
    }
  }

  // 3 — fuzzy, for typos
  let best = null;
  for (const c of candidates) {
    for (const form of c.forms) {
      const d = dice(normalized, form);
      if (d >= FUZZY_THRESHOLD && (!best || d > best.score)) {
        best = { c, score: d, via: 'dice' };
      }
      // Edit distance, but only where it is safe. On short words lev<=1 maps
      // soap->soup and cat->hat, so it is disabled below 6 characters and the
      // budget only widens once the string is long enough for a typo to be the
      // likelier explanation than a different word.
      const minLen = Math.min(normalized.length, form.length);
      const budget = minLen >= 9 ? 2 : minLen >= 6 ? 1 : 0;
      if (budget > 0 && Math.abs(normalized.length - form.length) <= budget) {
        const lev = levenshtein(normalized, form, budget);
        if (lev <= budget && (!best || best.score < 0.9)) {
          best = { c, score: 0.9, via: 'levenshtein' };
        }
      }
    }
  }
  if (best) return decide(best.c, best.via, best.score);

  return { ...result, status: 'MISS', via: 'no-match' };

  function decide(c, via, score) {
    const base = { ...result, rank: c.index + 1, answer: c.answer, via, score };
    // An already-revealed answer is a typing accident, not a wrong guess.
    // It must never cost a strike and never award points twice.
    if (revealed[c.index]) return { ...base, status: 'ALREADY' };
    return { ...base, status: 'HIT' };
  }
}
