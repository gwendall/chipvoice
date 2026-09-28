import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS, PRESETS } from "../dist/presets/index.js";
import { __setSeedJitterListener } from "../dist/presets/helpers.js";

// Mechanical enforcement for ModelMetadata.seedJitterLabels: every
// `seededRange` call a model's `compile()` makes (directly, or indirectly
// via a helper like sparkleLayer) must be captured here and shown to match
// a declared prefix. This is the machine-checked half of the "which
// quantity, by how much" prose that ModelParamMeta.seedJitter (or a
// model's own file comment) documents in English - see presets/types.ts's
// ModelMetadata.seedJitterLabels doc comment for the full design.

/** The same "is this label covered by a declared prefix" predicate the
 * real coverage check below uses, pulled out so the negative test can
 * exercise it directly against a synthetic input without needing a real
 * undeclared jitter to exist anywhere in the codebase. */
function isLabelCovered(label, declaredPrefixes) {
  return declaredPrefixes.some((prefix) => label.startsWith(prefix));
}

/** Compiles every registered preset AND every one of a model's own
 * metadata examples, capturing every label passed to `seededRange` while
 * doing so. Returns { modelId -> Set<label> }. */
function captureAllJitterLabels() {
  const captured = {};
  const capture = (modelId) => {
    if (!captured[modelId]) captured[modelId] = new Set();
    return captured[modelId];
  };

  __setSeedJitterListener(null); // ensure a clean slate regardless of test order
  try {
    for (const p of PRESETS) {
      const model = MODELS[p.model];
      const labels = capture(p.model);
      __setSeedJitterListener((label) => labels.add(label));
      model.compile(p.params, p.seed, 48000);
    }
    for (const [modelId, model] of Object.entries(MODELS)) {
      const labels = capture(modelId);
      for (const ex of model.metadata.examples) {
        __setSeedJitterListener((label) => labels.add(label));
        model.compile(ex.params, ex.seed, 48000);
      }
    }
  } finally {
    __setSeedJitterListener(null);
  }
  return captured;
}

test("isLabelCovered: the coverage predicate correctly flags an undeclared label (negative test, proves the check itself isn't vacuous)", () => {
  const declared = ["laser-pitch", "zap-mod"];
  assert.equal(isLabelCovered("laser-pitch", declared), true, "an exact declared label must be covered");
  assert.equal(isLabelCovered("zap-mod", declared), true);
  assert.equal(isLabelCovered("cast-sparkle-t3", ["cast-sparkle"]), true, "a dynamically-indexed grain label must match its declared prefix");
  assert.equal(isLabelCovered("totally-undeclared-jitter", declared), false, "an undeclared label must NOT be reported as covered");
  assert.equal(isLabelCovered("laser-pitch-extra", ["laser-pitch-exact-only"]), false, "startsWith is directional: a longer label isn't covered by a longer declared prefix it doesn't start with");
});

test("every seededRange label used while compiling every preset and every model example matches a declared seedJitterLabels prefix", () => {
  const captured = captureAllJitterLabels();
  const problems = [];
  for (const [modelId, labels] of Object.entries(captured)) {
    const declared = MODELS[modelId].metadata.seedJitterLabels ?? [];
    for (const label of labels) {
      if (!isLabelCovered(label, declared)) {
        problems.push(`model "${modelId}": label "${label}" captured but not covered by declared seedJitterLabels ${JSON.stringify(declared)}`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("every model that actually uses seededRange declares at least one seedJitterLabels prefix", () => {
  const captured = captureAllJitterLabels();
  for (const [modelId, labels] of Object.entries(captured)) {
    if (labels.size === 0) continue; // this model never jitters via seededRange - nothing to declare
    const declared = MODELS[modelId].metadata.seedJitterLabels ?? [];
    assert.ok(declared.length > 0, `model "${modelId}" calls seededRange (labels: ${[...labels].join(", ")}) but declares no seedJitterLabels`);
  }
});

test("no model declares a seedJitterLabels prefix that is never actually used (a stale/dead declaration)", () => {
  const captured = captureAllJitterLabels();
  const problems = [];
  for (const [modelId, model] of Object.entries(MODELS)) {
    const declared = model.metadata.seedJitterLabels ?? [];
    const labels = captured[modelId] ?? new Set();
    for (const prefix of declared) {
      const used = [...labels].some((label) => label.startsWith(prefix));
      if (!used) problems.push(`model "${modelId}": declared seedJitterLabels prefix "${prefix}" is never used by any compiled preset or example`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});
