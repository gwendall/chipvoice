#!/usr/bin/env node
/**
 * A performance regression budget: renders every preset once (seed 1),
 * timing each with `performance.now()` (already captured as
 * `RenderedSound.renderTimeMs`), and compares against a committed baseline
 * (`test/fixtures/perf-baseline.json`). `--check` (the default, what CI
 * runs) fails if any preset takes more than 3x its committed baseline -
 * generous on purpose (this machine's load, not the engine's own
 * regression, is often the reason a single run is slow) but tight enough to
 * catch an accidentally-quadratic change. `--write` (re)records the
 * baseline from the current machine's timings; a real regression should be
 * caught by CI's 3x check before anyone needs to re-baseline.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRESETS, recipeForPreset, renderRecipe } from '../dist/index.js';

const REGRESSION_FACTOR = 3;
const baselinePath = fileURLToPath(new URL('../test/fixtures/perf-baseline.json', import.meta.url));
const mode = process.argv.includes('--write') ? 'write' : 'check';

function renderAllTimings() {
  const timings = {};
  // A warm-up pass per preset (JIT warmup) before the timed pass, so the
  // budget reflects steady-state performance, not first-call compilation.
  for (const p of PRESETS) renderRecipe(recipeForPreset(p.id, 1, 48000));
  for (const p of PRESETS) {
    const rendered = renderRecipe(recipeForPreset(p.id, 1, 48000));
    timings[p.id] = rendered.renderTimeMs;
  }
  return timings;
}

const current = renderAllTimings();

if (mode === 'write') {
  mkdirSync(fileURLToPath(new URL('../test/fixtures/', import.meta.url)), { recursive: true });
  writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n');
  const total = Object.values(current).reduce((a, b) => a + b, 0);
  console.log(`perf-budget: wrote baseline for ${PRESETS.length} presets (total ${total.toFixed(1)} ms) to ${baselinePath}`);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error(`perf-budget: no baseline at ${baselinePath}. Run "pnpm perf-budget:write" first and commit it.`);
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

let regressions = 0;
for (const p of PRESETS) {
  const base = baseline[p.id];
  const now = current[p.id];
  if (base === undefined) { console.error(`perf-budget: no baseline entry for "${p.id}" (baseline out of date? run "pnpm perf-budget:write")`); regressions++; continue; }
  const limit = Math.max(base * REGRESSION_FACTOR, base + 5); // +5ms floor so a sub-millisecond baseline is not treated as regressed by rounding noise
  if (now > limit) {
    console.error(`perf-budget: REGRESSION ${p.id}: ${now.toFixed(1)} ms > ${limit.toFixed(1)} ms budget (baseline ${base.toFixed(1)} ms x ${REGRESSION_FACTOR})`);
    regressions++;
  }
}

const total = Object.values(current).reduce((a, b) => a + b, 0);
if (regressions > 0) {
  console.error(`perf-budget: ${regressions} preset(s) regressed beyond ${REGRESSION_FACTOR}x their baseline.`);
  process.exit(1);
}
console.log(`perf-budget: all ${PRESETS.length} presets within ${REGRESSION_FACTOR}x budget (total ${total.toFixed(1)} ms this run).`);
