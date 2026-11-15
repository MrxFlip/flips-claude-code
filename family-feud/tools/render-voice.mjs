#!/usr/bin/env node
/**
 * Renders every spoken line to audio/ with ElevenLabs and writes
 * data/voice-manifest.json, which src/audio.js reads at runtime.
 *
 *   export ELEVENLABS_API_KEY=...          # never committed, never written to disk
 *   export ELEVENLABS_VOICE_ID=...         # Bella's voice id
 *   node tools/render-voice.mjs --dry-run  # what WOULD render, and how many clips
 *   node tools/render-voice.mjs            # render only what changed
 *   node tools/render-voice.mjs --force    # re-render everything
 *
 * Each line is content-hashed over (text, voiceId, modelId, settings), so
 * adding ten questions costs ten renders rather than re-rendering the lot.
 * Hashes live in data/voice-hashes.json; delete it to force a full rebuild.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { HOST_LINES } from '../src/host-lines.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const FORCE = args.has('--force');

const MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? '';
const API_KEY = process.env.ELEVENLABS_API_KEY ?? '';

// Game-show delivery: a little less stability than default for liveliness,
// high similarity so Bella stays recognisably herself across ~600 clips.
const VOICE_SETTINGS = {
  stability: 0.38,
  similarity_boost: 0.85,
  style: 0.45,
  use_speaker_boost: true,
};

const MANIFEST = resolve(root, 'data/voice-manifest.json');
const HASHES = resolve(root, 'data/voice-hashes.json');

const surveys = JSON.parse(readFileSync(resolve(root, 'data/surveys.json'), 'utf8'));

/** Every clip the game can ask for: { key, file, text }. */
function buildJobs() {
  const jobs = [];

  for (const q of [...surveys.main, ...surveys.fastMoney]) {
    jobs.push({
      key: `q:${q.id}`,
      file: `audio/questions/${q.id}.mp3`,
      text: q.readAs ?? q.prompt,
    });
  }

  for (const [bucket, lines] of Object.entries(HOST_LINES)) {
    lines.forEach((text, i) => {
      jobs.push({
        key: `host:${bucket}`,
        file: `audio/host/${bucket}-${String(i + 1).padStart(2, '0')}.mp3`,
        text,
      });
    });
  }

  return jobs;
}

const hashOf = (text) =>
  createHash('sha256')
    .update(JSON.stringify([text, VOICE_ID, MODEL_ID, VOICE_SETTINGS]))
    .digest('hex')
    .slice(0, 16);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function render(text, outPath, attempt = 1) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
  });

  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 4) {
      const wait = 1200 * attempt;
      console.warn(`  retry ${attempt} in ${wait}ms (HTTP ${res.status})`);
      await sleep(wait);
      return render(text, outPath, attempt + 1);
    }
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const jobs = buildJobs();
  const oldHashes = existsSync(HASHES) && !FORCE
    ? JSON.parse(readFileSync(HASHES, 'utf8'))
    : {};

  const todo = jobs.filter((j) => {
    const fresh = oldHashes[j.file] === hashOf(j.text);
    return !(fresh && existsSync(resolve(root, j.file)));
  });

  console.log(`${jobs.length} clip(s) total, ${todo.length} to render, ${jobs.length - todo.length} up to date.`);

  if (DRY) {
    for (const j of todo.slice(0, 25)) console.log(`  would render ${j.file}  "${j.text.slice(0, 64)}"`);
    if (todo.length > 25) console.log(`  ... and ${todo.length - 25} more`);
    console.log('\nDry run — nothing rendered, nothing spent.');
    return;
  }

  if (!API_KEY || !VOICE_ID) {
    console.error(
      '\nELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID must both be set.\n' +
      'Export them in your shell; do not put them in a file in this folder.\n' +
      'Run with --dry-run to see the clip count without credentials.'
    );
    process.exit(1);
  }

  const hashes = { ...oldHashes };
  let done = 0, failed = 0;

  for (const job of todo) {
    const out = resolve(root, job.file);
    try {
      await render(job.text, out);
      hashes[job.file] = hashOf(job.text);
      done++;
      console.log(`  [${done}/${todo.length}] ${job.file}`);
    } catch (e) {
      failed++;
      console.error(`  FAILED ${job.file}: ${e.message}`);
    }
    await sleep(420);   // stay well under the rate limit
  }

  // The manifest always describes what is actually on disk, so a partial
  // render still produces a usable game rather than keys pointing at nothing.
  const manifest = {};
  for (const job of jobs) {
    if (!existsSync(resolve(root, job.file))) continue;
    (manifest[job.key] ??= []).push(job.file);
  }

  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(HASHES, JSON.stringify(hashes, null, 2) + '\n');

  console.log(`\nRendered ${done}, failed ${failed}.`);
  console.log(`Manifest: ${Object.keys(manifest).length} key(s) -> data/voice-manifest.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
