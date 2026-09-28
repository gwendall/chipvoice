#!/usr/bin/env node
/**
 * Renders the two audio sets the CLAP eval (docs/GAMESOUNDS-ENGINE.md,
 * quality evidence; `eval/clap_eval.py`) needs, as mono 48kHz WAV files
 * under `.artifacts/audio/`:
 *  - `real/<id>-seed<seed>.wav`: every named preset, rendered normally (the
 *    engine as shipped), at each of `SEEDS` below - not just each preset's
 *    own reference seed, so the eval's per-item hit/miss statistics pool
 *    several independent renders per prompt instead of one.
 *  - `degraded/<id>-seed<seed>.wav`: the same preset/seed, rendered from a
 *    graph put through `clap-degrade-graph.mjs` (filters/envelopes
 *    bypassed, physically-informed generators replaced with raw noise) -
 *    the "must score clearly worse" control.
 * Both go through the same finalize + loudness-normalize pipeline as a
 * normal render (`renderRecipe` itself, via a `model: "graph"` recipe for
 * the degraded set), so the comparison isn't confounded by one set being
 * quieter or clipped.
 *
 *   pnpm --filter sfx-engine exec node scripts/build-clap-audio.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRESETS, MODELS, getPreset, renderRecipe } from '../dist/index.js';
import { degradeGraph } from './clap-degrade-graph.mjs';

const SEEDS = [1, 2, 3, 4];

const OUT_DIR = join(import.meta.dirname, '..', '.artifacts', 'audio');
const REAL_DIR = join(OUT_DIR, 'real');
const DEGRADED_DIR = join(OUT_DIR, 'degraded');
mkdirSync(REAL_DIR, { recursive: true });
mkdirSync(DEGRADED_DIR, { recursive: true });

function f64ToMonoWav(samples, sampleRate) {
  const dataLen = samples.length * 4;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(32, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) buf.writeFloatLE(samples[i], 44 + i * 4);
  return buf;
}

let identicalCount = 0;
let fileCount = 0;
for (const p of PRESETS) {
  const preset = getPreset(p.id);
  for (const seed of SEEDS) {
    const realRendered = renderRecipe({
      engine: 'sfx-engine@1', model: preset.model, params: preset.params, seed, sampleRate: 48000,
    });
    writeFileSync(join(REAL_DIR, `${p.id}-seed${seed}.wav`), f64ToMonoWav(realRendered.loudness.signal, realRendered.sampleRate));

    const graph = MODELS[preset.model].compile(preset.params, seed, 48000);
    const degradedGraph = degradeGraph(graph);
    const degradedRendered = renderRecipe({
      engine: 'sfx-engine@1', model: 'graph', params: degradedGraph, seed, sampleRate: 48000,
    });
    writeFileSync(join(DEGRADED_DIR, `${p.id}-seed${seed}.wav`), f64ToMonoWav(degradedRendered.loudness.signal, degradedRendered.sampleRate));
    fileCount += 2;

    if (realRendered.loudness.signal.length === degradedRendered.loudness.signal.length) {
      let identical = true;
      for (let i = 0; i < realRendered.loudness.signal.length; i++) {
        if (realRendered.loudness.signal[i] !== degradedRendered.loudness.signal[i]) { identical = false; break; }
      }
      if (identical) { identicalCount++; console.log(`NOTE  ${p.id} seed=${seed}: degraded render is bit-identical to the real one (nothing in its graph was stripped)`); }
    }
  }
}

console.log(`\nWrote ${fileCount} WAVs (${PRESETS.length} presets x ${SEEDS.length} seeds x 2 conditions) to ${OUT_DIR}`);
if (identicalCount > 0) console.log(`${identicalCount}/${PRESETS.length * SEEDS.length} preset/seed render(s) had nothing to degrade (see NOTE lines above) - reported honestly in docs/GAMESOUNDS-ENGINE.md, not hidden.`);
