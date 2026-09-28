import { test } from "node:test";
import assert from "node:assert/strict";
import { MODELS, PRESETS } from "../dist/presets/index.js";
import { __setSeedJitterListener } from "../dist/presets/helpers.js";

// Mechanical enforcement for ModelMetadata.seedJitter: every `seededRange`
// call a model's `compile()` makes (directly, or indirectly via a helper
// like sparkleLayer) must be captured here and shown to both match a
// declared entry's `label` prefix AND carry that entry's exact `min`/`max`.
// This is the machine-checked half of the "which quantity, by how much"
// story - see presets/types.ts's ModelMetadata.seedJitter doc comment for
// the full design, including the `-t`-suffix duration-fraction convention
// sparkleLayer's grain-onset-time entries use.

/** The same "is this label covered by a declared prefix" predicate the
 * real coverage check below uses, pulled out so the negative test can
 * exercise it directly against a synthetic input without needing a real
 * undeclared jitter to exist anywhere in the codebase. */
function isLabelCovered(label, declared) {
  return declared.some((entry) => label.startsWith(entry.label));
}

/** The declared entry (if any) whose `label` is a prefix of `label`. */
function findDeclaredEntry(label, declared) {
  return declared.find((entry) => label.startsWith(entry.label));
}

/**
 * The bounds a captured call under `entry` is expected to carry. Every
 * entry's min/max is an absolute, duration-independent constant, with one
 * exception: sparkleLayer's grain-onset-time sub-jitter (`${label}-t${i}`,
 * declared with a `label` ending in `-t`) is expressed as a fraction of the
 * cue's own compiled `duration` (e.g. `max: 0.8` means "up to 80% of this
 * render's duration"), so its declared bounds must be scaled by that
 * render's actual `duration` before comparing against the raw seconds
 * `seededRange` was actually called with.
 */
function expectedBounds(entry, duration) {
  if (entry.label.endsWith('-t')) {
    return { min: entry.min * duration, max: entry.max * duration };
  }
  return { min: entry.min, max: entry.max };
}

/** Compiles every registered preset AND every one of a model's own
 * metadata examples, capturing every `(label, min, max)` passed to
 * `seededRange` while doing so, alongside that render's own compiled
 * `duration` (needed to check a `-t`-suffixed entry's duration-relative
 * bounds). Returns { modelId -> Array<{ label, min, max, duration }> }. */
function captureAllJitterCalls() {
  const captured = {};
  const push = (modelId, rec) => {
    if (!captured[modelId]) captured[modelId] = [];
    captured[modelId].push(rec);
  };

  __setSeedJitterListener(null); // ensure a clean slate regardless of test order
  try {
    for (const p of PRESETS) {
      const model = MODELS[p.model];
      const calls = [];
      __setSeedJitterListener((label, min, max) => calls.push({ label, min, max }));
      const result = model.compile(p.params, p.seed, 48000);
      for (const c of calls) push(p.model, { ...c, duration: result.duration });
    }
    for (const [modelId, model] of Object.entries(MODELS)) {
      for (const ex of model.metadata.examples) {
        const calls = [];
        __setSeedJitterListener((label, min, max) => calls.push({ label, min, max }));
        const result = model.compile(ex.params, ex.seed, 48000);
        for (const c of calls) push(modelId, { ...c, duration: result.duration });
      }
    }
  } finally {
    __setSeedJitterListener(null);
  }
  return captured;
}

function labelsOf(calls) {
  return new Set(calls.map((c) => c.label));
}

/**
 * The real "does every captured call match a declared entry" check,
 * factored out of the test body so the negative test below can exercise
 * this exact function against synthetic input, instead of re-deriving its
 * own copy of the min/max comparison (which would only prove that `!==`
 * works, not that this check catches a real declaration/behavior drift).
 * `capturedByModel`/`declaredByModel` are both `{ modelId -> Array<...> }`;
 * returns an array of problem strings, empty when everything matches.
 */
function findJitterProblems(capturedByModel, declaredByModel) {
  const problems = [];
  for (const [modelId, calls] of Object.entries(capturedByModel)) {
    const declared = declaredByModel[modelId] ?? [];
    for (const call of calls) {
      const entry = findDeclaredEntry(call.label, declared);
      if (!entry) {
        problems.push(`model "${modelId}": label "${call.label}" captured but not covered by any declared seedJitter entry (declared: ${JSON.stringify(declared.map((e) => e.label))})`);
        continue;
      }
      const expected = expectedBounds(entry, call.duration);
      if (call.min !== expected.min || call.max !== expected.max) {
        problems.push(`model "${modelId}": label "${call.label}" called with [${call.min}, ${call.max}] but declared entry "${entry.label}" expects [${expected.min}, ${expected.max}] (duration ${call.duration})`);
      }
    }
  }
  return problems;
}

test("isLabelCovered: the coverage predicate correctly flags an undeclared label (negative test, proves the check itself isn't vacuous)", () => {
  const declared = [{ label: "laser-pitch" }, { label: "zap-mod" }];
  assert.equal(isLabelCovered("laser-pitch", declared), true, "an exact declared label must be covered");
  assert.equal(isLabelCovered("zap-mod", declared), true);
  assert.equal(isLabelCovered("cast-sparkle-t3", [{ label: "cast-sparkle-t" }]), true, "a dynamically-indexed grain label must match its declared prefix");
  assert.equal(isLabelCovered("totally-undeclared-jitter", declared), false, "an undeclared label must NOT be reported as covered");
  assert.equal(isLabelCovered("laser-pitch-extra", [{ label: "laser-pitch-exact-only" }]), false, "startsWith is directional: a longer label isn't covered by a longer declared prefix it doesn't start with");
});

test("findJitterProblems flags a drifted range, an undeclared label, and a drifted -t duration-scaled range, but not a clean input (negative test, proves the real check - the same function the coverage test below calls - isn't vacuous)", () => {
  // A drifted range: declared +-0.08, called +-0.10 -> exactly one problem.
  {
    const declared = { m: [{ label: "laser-pitch", affects: "test", min: -0.08, max: 0.08 }] };
    const captured = { m: [{ label: "laser-pitch", min: -0.1, max: 0.1, duration: 1 }] };
    const problems = findJitterProblems(captured, declared);
    assert.equal(problems.length, 1, "a drifted range must produce exactly one problem");
    assert.match(problems[0], /laser-pitch/);
  }

  // An undeclared label -> exactly one problem.
  {
    const declared = { m: [{ label: "laser-pitch", affects: "test", min: -0.08, max: 0.08 }] };
    const captured = { m: [{ label: "totally-undeclared", min: -0.1, max: 0.1, duration: 1 }] };
    const problems = findJitterProblems(captured, declared);
    assert.equal(problems.length, 1, "an undeclared label must produce exactly one problem");
    assert.match(problems[0], /not covered by any declared/);
  }

  // A `-t` entry's declared bounds are a fraction of duration: a call whose
  // bounds equal that fraction times the render's own duration must pass;
  // one that drifted from it must fail.
  {
    const declared = { m: [{ label: "cast-sparkle-t", affects: "test", min: 0, max: 0.8 }] };
    const matchingCall = { m: [{ label: "cast-sparkle-t0", min: 0, max: 0.8 * 2.5, duration: 2.5 }] };
    const driftedCall = { m: [{ label: "cast-sparkle-t0", min: 0, max: 0.9 * 2.5, duration: 2.5 }] };
    assert.deepEqual(findJitterProblems(matchingCall, declared), [], "a call whose bounds exactly equal the declared fraction times duration must NOT be flagged");
    const problems = findJitterProblems(driftedCall, declared);
    assert.equal(problems.length, 1, "a call whose bounds do not match the duration-scaled declaration must be flagged");
  }

  // A clean input with no mismatches -> zero problems.
  {
    const declared = { m: [{ label: "laser-pitch", affects: "test", min: -0.08, max: 0.08 }] };
    const captured = { m: [{ label: "laser-pitch", min: -0.08, max: 0.08, duration: 1 }] };
    assert.deepEqual(findJitterProblems(captured, declared), [], "matching calls must produce zero problems");
  }
});

test("every seededRange call's (label, min, max) matches a declared seedJitter entry's prefix and exact bounds", () => {
  const captured = captureAllJitterCalls();
  const declaredByModel = Object.fromEntries(
    Object.keys(captured).map((modelId) => [modelId, MODELS[modelId].metadata.seedJitter ?? []]),
  );
  const problems = findJitterProblems(captured, declaredByModel);
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("no model declares a seedJitter label that is a prefix of another of its own declared labels (ambiguity guard: findDeclaredEntry's Array.prototype.find takes the FIRST matching prefix, so two declared labels in a prefix relationship would resolve by declaration order, not by which is actually correct)", () => {
  const problems = [];
  for (const [modelId, model] of Object.entries(MODELS)) {
    const declared = model.metadata.seedJitter ?? [];
    for (const a of declared) {
      for (const b of declared) {
        if (a === b) continue;
        if (b.label !== a.label && b.label.startsWith(a.label)) {
          problems.push(`model "${modelId}": declared label "${a.label}" is a prefix of declared label "${b.label}" - a captured call for "${b.label}" would ambiguously resolve to whichever entry comes first in the array`);
        }
      }
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("every model that actually uses seededRange declares at least one seedJitter entry", () => {
  const captured = captureAllJitterCalls();
  for (const [modelId, calls] of Object.entries(captured)) {
    const labels = labelsOf(calls);
    if (labels.size === 0) continue; // this model never jitters via seededRange - nothing to declare
    const declared = MODELS[modelId].metadata.seedJitter ?? [];
    assert.ok(declared.length > 0, `model "${modelId}" calls seededRange (labels: ${[...labels].join(", ")}) but declares no seedJitter entries`);
  }
});

test("no model declares a seedJitter entry whose label prefix is never actually used (a stale/dead declaration)", () => {
  const captured = captureAllJitterCalls();
  const problems = [];
  for (const [modelId, model] of Object.entries(MODELS)) {
    const declared = model.metadata.seedJitter ?? [];
    const labels = labelsOf(captured[modelId] ?? []);
    for (const entry of declared) {
      const used = [...labels].some((label) => label.startsWith(entry.label));
      if (!used) problems.push(`model "${modelId}": declared seedJitter entry "${entry.label}" is never used by any compiled preset or example`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});
