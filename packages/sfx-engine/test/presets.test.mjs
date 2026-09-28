import { test } from "node:test";
import assert from "node:assert/strict";
import { PRESETS, MODELS, getPreset, recipeForPreset } from "../dist/presets/index.js";
import { renderRecipe } from "../dist/render/renderRecipe.js";
import { runSignalChecks } from "../dist/analysis/signal-checks.js";
import { TARGET_MOMENTARY_LUFS, TARGET_TRUE_PEAK_DB } from "../dist/loudness/normalize.js";

// This is the coverage test: every registered preset actually renders and
// passes the engine's own signal-sanity checks and house loudness
// convention - the same "0/53 failures" smoke test run manually during
// development, formalized so CI catches a regression in any one preset.

test("PRESETS covers the required taxonomy families with the brief's stated counts", () => {
  const counts = {};
  for (const p of PRESETS) counts[p.family] = (counts[p.family] ?? 0) + 1;
  assert.equal(counts.ui, 9);
  assert.equal(counts.impact, 12);
  assert.equal(counts.footstep, 7);
  assert.equal(counts.whoosh, 4);
  assert.equal(counts.explosion, 3);
  assert.equal(counts.scifi, 8);
  assert.equal(counts.magic, 5);
  assert.equal(counts.pickup, 5);
  assert.equal(PRESETS.length, 53);
});

test("every preset id is unique", () => {
  const ids = new Set(PRESETS.map((p) => p.id));
  assert.equal(ids.size, PRESETS.length);
});

test("getPreset() finds every registered preset by id and throws on an unknown one", () => {
  for (const p of PRESETS) assert.equal(getPreset(p.id), p);
  assert.throws(() => getPreset("not-a-real-preset"), /unknown preset/);
});

test("every preset's model is registered in MODELS", () => {
  for (const p of PRESETS) assert.ok(MODELS[p.model], `${p.id} references unregistered model "${p.model}"`);
});

test("every model publishes metadata with at least 2 examples, each with a description", () => {
  for (const [id, model] of Object.entries(MODELS)) {
    assert.equal(model.metadata.id, id);
    assert.ok(model.metadata.description.length > 10, `${id}: description too short`);
    assert.ok(model.metadata.examples.length >= 2, `${id}: needs at least 2 examples`);
    for (const ex of model.metadata.examples) {
      assert.ok(ex.name, `${id}: an example is missing a name`);
      assert.ok(ex.description, `${id}: an example is missing a description`);
      assert.ok(Number.isInteger(ex.seed), `${id}: an example is missing an integer seed`);
    }
  }
});

test("every preset renders without throwing, at its reference seed, at both sample rates", () => {
  for (const p of PRESETS) {
    for (const sampleRate of [44100, 48000]) {
      const rendered = renderRecipe(recipeForPreset(p.id, p.seed, sampleRate));
      assert.equal(rendered.sampleRate, sampleRate);
      assert.ok(rendered.left.length > 0, `${p.id} @ ${sampleRate}Hz rendered an empty buffer`);
      assert.equal(rendered.left.length, rendered.right.length);
    }
  }
});

test("every preset passes the engine's own signal-sanity checks (clipping, silence, onset, DC, finiteness)", () => {
  const failures = [];
  for (const p of PRESETS) {
    const rendered = renderRecipe(recipeForPreset(p.id, p.seed, 48000));
    // Left channel alone, not left+right summed - see render/bestOfN.ts's
    // mixDownForChecks doc comment for why summing would false-positive on
    // clipping at centre pan.
    const report = runSignalChecks(rendered.left, rendered.sampleRate);
    if (report.clipping) failures.push(`${p.id}: clipping`);
    if (report.silent) failures.push(`${p.id}: silent`);
    if (!report.onsetWithin10ms) failures.push(`${p.id}: onset not within 10ms`);
    if (!report.noDcOffset) failures.push(`${p.id}: DC offset ${report.dcOffset}`);
    if (!report.endsAtZero) failures.push(`${p.id}: does not end at zero`);
    if (!report.finite) failures.push(`${p.id}: non-finite PCM`);
  }
  assert.deepEqual(failures, [], `${failures.length} preset(s) failed a signal check:\n${failures.join("\n")}`);
});

test("every preset respects the house loudness convention: <= -18 LUFS momentary or peak-capped, and never over -1 dBTP", () => {
  const failures = [];
  for (const p of PRESETS) {
    const rendered = renderRecipe(recipeForPreset(p.id, p.seed, 48000));
    const { momentaryLufsAfter, truePeakDbAfter } = rendered.loudness;
    // A small epsilon for floating-point/measurement rounding, not a
    // loosened requirement - normalize.ts's own gain solve targets these
    // exactly and "peak cap wins" is one of the two branches, never a
    // reason to exceed either ceiling.
    if (truePeakDbAfter > TARGET_TRUE_PEAK_DB + 0.05) failures.push(`${p.id}: true peak ${truePeakDbAfter} dBTP exceeds ${TARGET_TRUE_PEAK_DB} dBTP`);
    if (momentaryLufsAfter > TARGET_MOMENTARY_LUFS + 0.05) failures.push(`${p.id}: momentary ${momentaryLufsAfter} LUFS exceeds ${TARGET_MOMENTARY_LUFS} LUFS`);
  }
  assert.deepEqual(failures, [], `${failures.length} preset(s) violated the loudness convention:\n${failures.join("\n")}`);
});

test("every preset's declared seedJitter params actually vary preset output across seeds (variety is real, not decorative)", () => {
  // Not every model uses seed jitter on every kind, so this checks in
  // aggregate: across all presets, most seeds 1 vs 2 should differ. A
  // model with zero jitter anywhere would be a real coverage gap.
  let varied = 0;
  for (const p of PRESETS) {
    const a = renderRecipe(recipeForPreset(p.id, 1, 48000));
    const b = renderRecipe(recipeForPreset(p.id, 2, 48000));
    let differs = false;
    for (let i = 0; i < Math.min(a.left.length, b.left.length); i++) if (a.left[i] !== b.left[i]) { differs = true; break; }
    if (differs || a.left.length !== b.left.length) varied++;
  }
  assert.ok(varied === PRESETS.length, `expected every preset to vary across seeds, only ${varied}/${PRESETS.length} did`);
});

test("recipeForPreset() defaults to the preset's own reference seed and 48000Hz when unspecified", () => {
  const p = PRESETS[0];
  const recipe = recipeForPreset(p.id);
  assert.equal(recipe.seed, p.seed);
  assert.equal(recipe.sampleRate, 48000);
});

test("rendering the same preset id and seed twice is bit-identical (end-to-end determinism, not just the graph layer)", () => {
  const a = renderRecipe(recipeForPreset("impact-metal-heavy", 7, 48000));
  const b = renderRecipe(recipeForPreset("impact-metal-heavy", 7, 48000));
  assert.deepEqual(Array.from(a.left), Array.from(b.left));
  assert.deepEqual(Array.from(a.right), Array.from(b.right));
  assert.equal(a.renderTimeMs >= 0, true);
});
