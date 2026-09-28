import { PRESETS, recipeForPreset } from '../dist/index.js';

/**
 * The fixed, small set of inputs `check.mjs` compares across Node,
 * Chromium, Firefox and WebKit: every named preset at its reference seed
 * (so every model and every taxonomy family renders in this check), one
 * representative preset per family at three more seeds each (so the seeded
 * PRNG paths - jitter, noise, modal-mode spread - get cross-engine coverage
 * too, not just each model's default), plus a handful of hand-written raw
 * "graph" recipes exercising the node types/filter-shaper kinds no named
 * preset happens to reach (see `rawGraphInputs` below). Every entry is
 * `{ id, recipe }`: a plain, already-JSON-safe `Recipe` object (unlike
 * chipvoice's `PerformancePlan`, nothing here needs packing/base64 - see
 * scores/render-parity/serialize.mjs's doc comment for why that one does
 * and this one does not), so `browser-render.mjs` can hand `inputs` straight
 * to Playwright's `page.evaluate` and get the same object back out.
 */
export function buildInputs() {
  const inputs = [];

  for (const p of PRESETS) inputs.push({ id: p.id, recipe: recipeForPreset(p.id, p.seed, 48000) });

  const families = [...new Set(PRESETS.map((p) => p.family))];
  for (const family of families) {
    const rep = PRESETS.find((p) => p.family === family);
    for (const seed of [2, 3, 4]) {
      inputs.push({ id: `${rep.id}-seed${seed}`, recipe: recipeForPreset(rep.id, seed, 48000) });
    }
  }

  inputs.push(...rawGraphInputs());
  return inputs;
}

/**
 * Direct-graph-recipe authors (an agent building its own low-level recipe
 * from this package's `GraphNode` types, not going through a named preset)
 * are a real caller this package supports - `schema/recipe-1.json` and
 * `docs/GAMESOUNDS-ENGINE.md`'s node reference document the full low-level
 * surface. No named preset happens to reach `karplus`, the `comb` or
 * `allpass-delay` filter kinds, or the `srr` shaper kind, and only one
 * (`footstep-water-puddle`) reaches `bubble`; this fills those gaps so
 * parity covers every node type and every filter/shaper kind at least
 * once, not just what the presets exercise.
 */
function rawGraphInputs() {
  const engine = 'sfx-engine@1';
  const sampleRate = 48000;
  const graph = (id, seed, duration, nodes, output) => ({ id, recipe: { engine, model: 'graph', params: { duration, nodes, output }, seed, sampleRate } });

  return [
    graph('raw-karplus-pluck', 101, 0.6, [
      { id: 'k', type: 'karplus', params: { freq: 220, decay: 0.7, brightness: 0.6, pluckPosition: 0.15 } },
    ], 'k'),

    graph('raw-comb-filter', 102, 0.4, [
      { id: 'n', type: 'noise', params: { color: 'white' } },
      { id: 'f', type: 'filter', params: { kind: 'comb', delayMs: 3.5, feedback: 0.7, mix: 0.6 }, inputs: ['n'] },
    ], 'f'),

    graph('raw-allpass-delay-filter', 103, 0.4, [
      { id: 'n', type: 'noise', params: { color: 'white' } },
      { id: 'f', type: 'filter', params: { kind: 'allpass-delay', delayMs: 5, feedback: 0.6 }, inputs: ['n'] },
    ], 'f'),

    graph('raw-srr-shaper', 104, 0.3, [
      { id: 'o', type: 'oscillator', params: { shape: 'sine', freq: 440 } },
      { id: 's', type: 'shaper', params: { kind: 'srr', factor: 12 }, inputs: ['o'] },
    ], 's'),

    graph('raw-damped-delay', 105, 0.5, [
      { id: 'o', type: 'oscillator', params: { shape: 'saw', freq: 300 } },
      { id: 'e', type: 'envelope', params: { kind: 'adsr', attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 } },
      { id: 'm', type: 'multiply', params: {}, inputs: ['o', 'e'] },
      { id: 'd', type: 'delay', params: { timeMs: 90, feedback: 0.5, mix: 0.5, loopFilterCutoff: 2000 }, inputs: ['m'] },
    ], 'd'),
  ];
}
