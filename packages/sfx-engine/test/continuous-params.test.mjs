import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS } from "../dist/presets/index.js";
import { renderRecipe } from "../dist/render/renderRecipe.js";
import { runSignalChecks, zeroCrossingRate } from "../dist/analysis/signal-checks.js";

// Directional coverage for every continuous param added to scifi, magic,
// pickup, footstep and explosion (pitch/duration/brightness/intensity/
// distance/debrisAmount): each is rendered at its declared min, default
// and max (read straight from ModelMetadata, so this test tracks the
// source of truth rather than a second hardcoded copy of it), asserted to
// pass the engine's own signal-sanity checks at every point, and asserted
// to move a real audio-domain metric in the documented direction between
// its min and max. A closing pair of negative tests proves the two
// directional-assertion helpers below would actually fail on a
// "param wired to nothing" regression, so the positive tests aren't
// vacuous.

function render(model, params, seed = 1) {
  return renderRecipe({ engine: "sfx-engine@1", model, params, seed, sampleRate: 48000 });
}

function meanSquare(signal, sampleRate, fromMs, toMs) {
  const from = Math.max(0, Math.floor((fromMs / 1000) * sampleRate));
  const to = Math.min(signal.length, Math.floor((toMs / 1000) * sampleRate));
  let sum = 0, n = 0;
  for (let i = from; i < to; i++) { sum += signal[i] * signal[i]; n++; }
  return n > 0 ? sum / n : 0;
}

function paramBounds(modelId, paramName) {
  const meta = MODELS[modelId].metadata.params[paramName];
  assert.ok(meta, `${modelId}: no metadata for param "${paramName}"`);
  assert.equal(typeof meta.min, "number", `${modelId}.${paramName}: metadata is missing a numeric min`);
  assert.equal(typeof meta.max, "number", `${modelId}.${paramName}: metadata is missing a numeric max`);
  return { min: meta.min, max: meta.max, default: meta.default };
}

/** Renders at a param value and asserts the engine's own signal-sanity
 * checks pass (not silent/clipping/non-finite, onsets promptly). */
function assertRendersCleanly(model, params, label) {
  const rendered = render(model, params);
  const report = runSignalChecks(rendered.left, rendered.sampleRate);
  assert.equal(report.clipping, false, `${label}: unexpected clipping`);
  assert.equal(report.silent, false, `${label}: unexpectedly silent`);
  assert.equal(report.finite, true, `${label}: non-finite PCM`);
  assert.equal(report.onsetWithin10ms, true, `${label}: onset not within 10ms`);
  return rendered;
}

/** The directional-assertion helper for a "raising this param raises
 * metric(rendered)" claim - shared by both the real per-param tests below
 * and their own negative test, so the negative test exercises the exact
 * assertion logic the positive tests rely on. */
function assertMetricIncreases(metricAtMin, metricAtMax, label) {
  assert.ok(metricAtMax > metricAtMin, `${label}: expected the metric to increase from min (${metricAtMin}) to max (${metricAtMax}), it did not`);
}

function zcr(rendered) { return zeroCrossingRate(rendered.left, rendered.sampleRate); }

// --- pitch: raising pitch must raise the rendered signal's zero-crossing rate ---

for (const [modelId, params] of [
  ["scifi", { kind: "laser" }],
  ["magic", { kind: "cast" }],
  ["pickup", { kind: "coin" }],
  ["footstep", { surface: "metal" }],
]) {
  test(`${modelId}.pitch: renders cleanly at min/default/max and raises ZCR from min to max (${JSON.stringify(params)})`, () => {
    const { min, max, default: def } = paramBounds(modelId, "pitch");
    const atMin = assertRendersCleanly(modelId, { ...params, pitch: min }, `${modelId} pitch=min`);
    assertRendersCleanly(modelId, { ...params, pitch: def }, `${modelId} pitch=default`);
    const atMax = assertRendersCleanly(modelId, { ...params, pitch: max }, `${modelId} pitch=max`);
    assertMetricIncreases(zcr(atMin), zcr(atMax), `${modelId} pitch ZCR`);
  });
}

test("footstep.pitch has no audible effect on grass (documented limitation: filtered noise has no pitched component to transpose)", () => {
  const { min, max } = paramBounds("footstep", "pitch");
  const atMin = render("footstep", { surface: "grass", pitch: min });
  const atMax = render("footstep", { surface: "grass", pitch: max });
  assert.equal(atMin.left.length, atMax.left.length);
  let identical = true;
  for (let i = 0; i < atMin.left.length; i++) if (atMin.left[i] !== atMax.left[i]) { identical = false; break; }
  assert.ok(identical, "expected footstep grass to be bit-identical across pitch values (pitch is documented as inert here)");
});

// --- duration: raising duration must raise the render's length ---

for (const [modelId, params] of [
  ["scifi", { kind: "laser" }],
  ["magic", { kind: "cast" }],
  ["pickup", { kind: "coin" }],
  ["explosion", { size: "big" }],
]) {
  test(`${modelId}.duration: renders cleanly at min/default/max and raises render length from min to max (${JSON.stringify(params)})`, () => {
    const { min, max, default: def } = paramBounds(modelId, "duration");
    const atMin = assertRendersCleanly(modelId, { ...params, duration: min }, `${modelId} duration=min`);
    assertRendersCleanly(modelId, { ...params, duration: def }, `${modelId} duration=default`);
    const atMax = assertRendersCleanly(modelId, { ...params, duration: max }, `${modelId} duration=max`);
    assertMetricIncreases(atMin.durationSeconds, atMax.durationSeconds, `${modelId} duration length`);
  });
}

// --- brightness: raising brightness (less lowpassing) must raise ZCR ---

for (const [modelId, params] of [
  ["scifi", { kind: "zap" }],
  ["magic", { kind: "cast" }],
  ["pickup", { kind: "coin" }],
]) {
  test(`${modelId}.brightness: renders cleanly at min/default/max and raises ZCR from min to max (${JSON.stringify(params)})`, () => {
    const { min, max, default: def } = paramBounds(modelId, "brightness");
    const atMin = assertRendersCleanly(modelId, { ...params, brightness: min }, `${modelId} brightness=min`);
    assertRendersCleanly(modelId, { ...params, brightness: def }, `${modelId} brightness=default`);
    const atMax = assertRendersCleanly(modelId, { ...params, brightness: max }, `${modelId} brightness=max`);
    assertMetricIncreases(zcr(atMin), zcr(atMax), `${modelId} brightness ZCR`);
  });
}

// --- footstep.intensity: raising intensity must raise render length (on a surface whose duration depends on it) ---

test("footstep.intensity: renders cleanly at min/default/max and raises render length from min to max (surface: metal)", () => {
  const { min, max, default: def } = paramBounds("footstep", "intensity");
  const atMin = assertRendersCleanly("footstep", { surface: "metal", intensity: min }, "footstep intensity=min");
  assertRendersCleanly("footstep", { surface: "metal", intensity: def }, "footstep intensity=default");
  const atMax = assertRendersCleanly("footstep", { surface: "metal", intensity: max }, "footstep intensity=max");
  assertMetricIncreases(atMin.durationSeconds, atMax.durationSeconds, "footstep intensity length");
});

// --- explosion.distance: raising distance must raise render length (the reverb-tail bonus) ---

test("explosion.distance: renders cleanly at min/default/max and raises render length from min to max (size: big)", () => {
  const { min, max, default: def } = paramBounds("explosion", "distance");
  const atMin = assertRendersCleanly("explosion", { size: "big", distance: min }, "explosion distance=min");
  assertRendersCleanly("explosion", { size: "big", distance: def }, "explosion distance=default");
  const atMax = assertRendersCleanly("explosion", { size: "big", distance: max }, "explosion distance=max");
  assertMetricIncreases(atMin.durationSeconds, atMax.durationSeconds, "explosion distance length");
});

// --- explosion.debrisAmount: raising it must raise energy in the window the debris layer lands in ---

test("explosion.debrisAmount: renders cleanly at min/default/max and raises energy in the 100-400ms debris window from min to max (size: big)", () => {
  const { min, max, default: def } = paramBounds("explosion", "debrisAmount");
  const atMin = assertRendersCleanly("explosion", { size: "big", debrisAmount: min }, "explosion debrisAmount=min");
  assertRendersCleanly("explosion", { size: "big", debrisAmount: def }, "explosion debrisAmount=default");
  const atMax = assertRendersCleanly("explosion", { size: "big", debrisAmount: max }, "explosion debrisAmount=max");
  const energyAtMin = meanSquare(atMin.left, atMin.sampleRate, 100, 400);
  const energyAtMax = meanSquare(atMax.left, atMax.sampleRate, 100, 400);
  assertMetricIncreases(energyAtMin, energyAtMax, "explosion debrisAmount 100-400ms energy");
});

// --- negative tests: prove the directional-assertion helpers themselves would catch a param wired to nothing ---

test("negative: assertMetricIncreases catches a metric that does not move (simulates a param wired to nothing)", () => {
  assert.throws(
    () => assertMetricIncreases(1727.27, 1727.27, "synthetic no-op param"),
    /expected the metric to increase/,
    "identical min/max metrics must be reported as a failure, not silently pass",
  );
  assert.throws(
    () => assertMetricIncreases(1727.27, 1000, "synthetic reversed param"),
    /expected the metric to increase/,
    "a metric that moves the WRONG way must also be reported as a failure",
  );
  assert.doesNotThrow(
    () => assertMetricIncreases(863.6, 3440.9, "synthetic genuinely-wired param"),
    "a metric that genuinely increases must not be reported as a failure",
  );
});

test("negative: a ZCR-based directional check on two identical renders (simulating pitch wired to nothing) fails as expected", () => {
  const a = render("scifi", { kind: "laser", pitch: -12 });
  const bIdentical = render("scifi", { kind: "laser", pitch: -12 }); // same params - stands in for "pitch had no effect"
  assert.throws(() => assertMetricIncreases(zcr(a), zcr(bIdentical), "synthetic identical-render pitch check"));
});
