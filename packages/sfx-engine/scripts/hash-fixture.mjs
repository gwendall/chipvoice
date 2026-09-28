#!/usr/bin/env node
/**
 * A regression fixture: SHA-256 of every registered preset's rendered PCM
 * (stereo, left+right concatenated as raw float64 bytes), at 3 seeds each.
 * `--write` (re)generates `test/fixtures/hash-fixture.json`; `--check` (the
 * default, and what CI runs) re-renders everything and fails loudly on any
 * hash that drifted - a change to any DSP primitive, model or preset that
 * silently altered its output. This is a same-process (Node) regression
 * check, not the cross-engine determinism check - that is `parity/`, a
 * separate, local-only script that runs the same recipes through Chromium/
 * Firefox/WebKit as well.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRESETS, recipeForPreset, renderRecipe } from '../dist/index.js';

const SEEDS = [1, 2, 3];
const fixturePath = fileURLToPath(new URL('../test/fixtures/hash-fixture.json', import.meta.url));
const mode = process.argv.includes('--write') ? 'write' : 'check';

function hashOf(rendered) {
  const hash = createHash('sha256');
  hash.update(Buffer.from(rendered.left.buffer, rendered.left.byteOffset, rendered.left.byteLength));
  hash.update(Buffer.from(rendered.right.buffer, rendered.right.byteOffset, rendered.right.byteLength));
  return hash.digest('hex');
}

function renderAll() {
  const out = {};
  for (const p of PRESETS) {
    out[p.id] = {};
    for (const seed of SEEDS) {
      const recipe = recipeForPreset(p.id, seed, 48000);
      const rendered = renderRecipe(recipe);
      out[p.id][String(seed)] = hashOf(rendered);
    }
  }
  return out;
}

const current = renderAll();

if (mode === 'write') {
  mkdirSync(fileURLToPath(new URL('../test/fixtures/', import.meta.url)), { recursive: true });
  writeFileSync(fixturePath, JSON.stringify(current, null, 2) + '\n');
  console.log(`hash-fixture: wrote ${Object.keys(current).length} presets x ${SEEDS.length} seeds to ${fixturePath}`);
  process.exit(0);
}

if (!existsSync(fixturePath)) {
  console.error(`hash-fixture: no fixture at ${fixturePath}. Run "pnpm hash-fixture:write" first and commit it.`);
  process.exit(1);
}
const expected = JSON.parse(readFileSync(fixturePath, 'utf8'));

let drift = 0;
let missing = 0;
for (const p of PRESETS) {
  for (const seed of SEEDS) {
    const key = String(seed);
    const expectedHash = expected[p.id]?.[key];
    const actualHash = current[p.id][key];
    if (expectedHash === undefined) { missing++; console.error(`hash-fixture: no expected hash for ${p.id}/seed${seed} (fixture out of date?)`); continue; }
    if (expectedHash !== actualHash) { drift++; console.error(`hash-fixture: DRIFT ${p.id}/seed${seed}: expected ${expectedHash}, got ${actualHash}`); }
  }
}

if (drift > 0 || missing > 0) {
  console.error(`hash-fixture: ${drift} drifted, ${missing} missing, out of ${PRESETS.length * SEEDS.length} checked.`);
  console.error('If this drift is intentional (a deliberate DSP/preset change), run "pnpm hash-fixture:write" and commit the updated fixture.');
  process.exit(1);
}
console.log(`hash-fixture: ${PRESETS.length * SEEDS.length} hashes match (${PRESETS.length} presets x ${SEEDS.length} seeds).`);
