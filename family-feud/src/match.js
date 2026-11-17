// Answer matching. Pure, DOM-free, importable in Node for tests.
//
// Design bias: a party game dies when it rejects an answer the room agrees is
// right. But accepting a WRONG answer is worse, because the host can override a
// rejection with the number keys and cannot take back a bad reveal. So the
// cascade is generous about spelling and phrasing, strict about meaning.

import { SYNONYMS, PHRASES, WEAK_WORDS } from './synonyms.js?v=20261116-feud6';

const ARTICLES = /^(a|an|the)\s+/;
const FILLER = /^(my|your|his|her|their|our|some|any|going to|gonna|wanna|want to|like)\s+/;

/** Strip accents, punctuation, case, and collapse whitespace. */
function baseNormalize(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Apostrophes vanish rather than becoming a space, so "didn't", "didnt"
    // and "I'm" / "im" are one spelling. As a space, "didn't" became "didn t"
    // and could never equal the alias a person would naturally type.
    .replace(/['‘’`]/g, '')
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

  const mapped = s
    .split(' ')
    .filter(Boolean)
    .map((t) => SYNONYMS.get(singular(t)) ?? singular(t));

  // Collapse an adjacent repeat. Two different words can map to the same
  // canonical token — "nintendo switch" becomes "gameconsole gameconsole" —
  // and that doubling is an artefact of the synonym map, not something the
  // player typed. Leaving it in made the token counts disagree with the
  // answer's own form.
  const out = mapped.filter((t, i) => t !== mapped[i - 1]);

  return out.join(' ').trim();
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

/**
 * Edit distance with transposition (optimal string alignment), early-exit
 * above `max`.
 *
 * Swapping two adjacent characters is the commonest typing mistake there is,
 * and plain Levenshtein charges two edits for it. That put "spidres" two away
 * from "spiders" — outside the budget for a word that length — so an obvious
 * typo was scored as a wrong answer and cost a strike.
 */
export function levenshtein(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

export const FUZZY_THRESHOLD = 0.86;

/**
 * True when every token of `inner` appears in `outer` and each `outer` token
 * left unaccounted for is a non-content word.
 *
 * Multiset, not set: tokens are consumed as they are matched, so "dog dog"
 * needs two of them in `outer` rather than one.
 */
function subsetModuloWeak(inner, outer) {
  if (!inner.length || inner.length > outer.length) return false;
  const pool = [...outer];
  for (const t of inner) {
    const i = pool.indexOf(t);
    if (i === -1) return false;
    pool.splice(i, 1);
  }
  return pool.every((t) => WEAK_WORDS.has(t));
}

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

  // 2 — token-set containment, for phrasing differences:
  //     "check phone" vs "check their phone"; "scissors" vs "the scissors".
  //
  // Containment is only safe while the words left over are noise. The old rule
  // accepted any input that merely CONTAINED a short form, so the one-word
  // alias "tape" swallowed "measuring tape" — a different object, scored as
  // the alias's answer. Every leftover token now has to be a non-content word
  // (see WEAK_WORDS); a real word left over means a real difference in meaning
  // and the decision passes on to the fuzzy stage.
  const inputTokens = tokens(normalized);
  for (const c of candidates) {
    for (const form of c.forms) {
      const formTokens = tokens(form);
      if (subsetModuloWeak(formTokens, inputTokens)) return decide(c, 'contains-alias', 0.95);
      if (subsetModuloWeak(inputTokens, formTokens)) return decide(c, 'alias-contains', 0.93);
    }
  }

  // 2b — a known phrasing plus words this answer already owns.
  //
  // Stage 2 refuses any leftover content word, which is right in general
  // ("measuring tape" is not "tape") but rejects answers that only COMBINE two
  // accepted phrasings: "doomscrolling on my phone" is "doomscrolling" plus
  // "phone", "lower back pain" is "lower back" plus "pain", and both halves are
  // already listed for the same answer. So a leftover word is allowed here
  // when it comes from that answer's own vocabulary — the words used across
  // all of its accepted phrasings. A word from nowhere still blocks the match,
  // and so does a tie: if two answers on the board both qualify, the input is
  // ambiguous and it is left to the fuzzy pass and the host.
  const owned = [];
  for (const c of candidates) {
    const vocab = new Set(c.forms.flatMap(tokens));
    const covers = c.forms.some((form) => {
      const formTokens = tokens(form);
      if (!formTokens.length || formTokens.length > inputTokens.length) return false;
      const pool = [...inputTokens];
      for (const t of formTokens) {
        const i = pool.indexOf(t);
        if (i === -1) return false;
        pool.splice(i, 1);
      }
      return pool.every((t) => WEAK_WORDS.has(t) || vocab.has(t));
    });
    if (covers) owned.push(c);
  }
  if (owned.length === 1) return decide(owned[0], 'own-words', 0.92);

  // 3 — fuzzy, for typos
  let best = null;
  for (const c of candidates) {
    for (const form of c.forms) {
      const formTokens = tokens(form);
      const d = dice(normalized, form);
      if (d >= FUZZY_THRESHOLD && (!best || d > best.score)) {
        best = { c, score: d, via: 'dice' };
      }
      // Edit distance, but only where it is safe. On short words lev<=1 maps
      // soap->soup and cat->hat, so it is disabled below 6 characters and the
      // budget only widens once the string is long enough for a typo to be the
      // likelier explanation than a different word.
      const minLen = Math.min(normalized.length, form.length);
      let budget = minLen >= 9 ? 2 : minLen >= 6 ? 1 : 0;
      // One edit less across a phrase. Two edits inside a long single word is
      // a typo; two edits spread over several words is usually a different
      // word doing the same job — "back pain" reaches "neck pain" in exactly
      // two, and they are different answers on the same board.
      if (budget > 1 && (inputTokens.length > 1 || formTokens.length > 1)) budget -= 1;
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
