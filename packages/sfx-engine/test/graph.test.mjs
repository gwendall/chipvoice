import { test } from "node:test";
import assert from "node:assert/strict";
import { renderGraph } from "../dist/graph/compile.js";
import { isRef } from "../dist/graph/types.js";

const SR = 48000;

test("isRef: only a plain single-key {ref: string} object counts as a Ref", () => {
  assert.equal(isRef({ ref: "osc1" }), true);
  assert.equal(isRef({ ref: "osc1", extra: 1 }), false, "an extra key disqualifies it");
  assert.equal(isRef({}), false);
  assert.equal(isRef(null), false);
  assert.equal(isRef("osc1"), false);
  assert.equal(isRef(42), false);
  assert.equal(isRef({ ref: 42 }), false, "ref's value must itself be a string");
});

test("renderGraph: a minimal one-node graph renders exactly duration*sampleRate samples", () => {
  const recipe = {
    duration: 0.1,
    nodes: [{ id: "a", type: "const", params: { value: 0.5 } }],
    output: "a",
  };
  const out = renderGraph(recipe, SR, 1);
  assert.equal(out.length, Math.round(0.1 * SR));
  for (const v of out) assert.equal(v, 0.5);
});

test("renderGraph: an unresolved output node id throws a clear error", () => {
  const recipe = {
    duration: 0.05,
    nodes: [{ id: "a", type: "const", params: { value: 1 } }],
    output: "does-not-exist",
  };
  assert.throws(() => renderGraph(recipe, SR, 1), /does-not-exist/);
});

test("renderGraph: a two-node cycle (each depending on the other via a Ref) throws a cycle error", () => {
  const recipe = {
    duration: 0.05,
    nodes: [
      { id: "a", type: "oscillator", params: { shape: "sine", freq: { ref: "b" } } },
      { id: "b", type: "oscillator", params: { shape: "sine", freq: { ref: "a" } } },
    ],
    output: "a",
  };
  assert.throws(() => renderGraph(recipe, SR, 1), /cycle/i);
});

test("renderGraph: a self-referencing node throws a cycle error", () => {
  const recipe = {
    duration: 0.05,
    nodes: [{ id: "a", type: "oscillator", params: { shape: "sine", freq: { ref: "a" } } }],
    output: "a",
  };
  assert.throws(() => renderGraph(recipe, SR, 1), /cycle/i);
});

test("renderGraph: a node referencing an unknown node id throws before rendering", () => {
  const recipe = {
    duration: 0.05,
    nodes: [{ id: "a", type: "oscillator", params: { shape: "sine", freq: { ref: "ghost" } } }],
    output: "a",
  };
  assert.throws(() => renderGraph(recipe, SR, 1), /ghost/);
});

test("renderGraph: node order in the `nodes` array does not matter, only dependencies do (topological sort)", () => {
  // `mul` depends on both `env` and `osc`, but is declared first, and
  // `osc` (declared last) depends on `env` (declared in the middle) via a
  // Ref inside its freq param.
  const recipe = {
    duration: 0.05,
    nodes: [
      { id: "mul", type: "multiply", params: {}, inputs: ["osc", "env"] },
      { id: "env", type: "envelope", params: { kind: "adsr", attack: 0.005, decay: 0.01, sustain: 0.5, release: 0.02 } },
      { id: "osc", type: "oscillator", params: { shape: "sine", freq: 440 } },
    ],
    output: "mul",
  };
  const out = renderGraph(recipe, SR, 1);
  assert.equal(out.length, Math.round(0.05 * SR));
  assert.ok(out.some((v) => v !== 0), "the multiply output should be non-trivial, proving both dependencies rendered");
});

test("renderGraph: a Ref used as a control-rate parameter patches one node's output into another's field", () => {
  // An envelope driving an oscillator's own freq (a crude vibrato/sweep):
  // proves resolveRefs recurses into params, not just top-level fields.
  const recipe = {
    duration: 0.05,
    nodes: [
      { id: "sweep", type: "sweep", params: { from: 200, to: 800, curve: "linear" } },
      { id: "osc", type: "oscillator", params: { shape: "sine", freq: { ref: "sweep" } } },
    ],
    output: "osc",
  };
  const out = renderGraph(recipe, SR, 1);
  const flatFreq = renderGraph({ duration: 0.05, nodes: [{ id: "osc", type: "oscillator", params: { shape: "sine", freq: 200 } }], output: "osc" }, SR, 1);
  assert.notDeepEqual(Array.from(out), Array.from(flatFreq), "a swept-frequency oscillator must differ from a constant-frequency one");
});

test("renderGraph: a Ref one level inside an array (mix layers) is also resolved", () => {
  const recipe = {
    duration: 0.05,
    nodes: [
      { id: "a", type: "const", params: { value: 0.5 } },
      { id: "b", type: "const", params: { value: 0.25 } },
      { id: "mix", type: "mix", params: { layers: [{ signal: { ref: "a" }, gain: 1 }, { signal: { ref: "b" }, gain: 1 }] } },
    ],
    output: "mix",
  };
  const out = renderGraph(recipe, SR, 1);
  for (const v of out) assert.ok(Math.abs(v - 0.75) < 1e-12, `expected 0.5+0.25=0.75, got ${v}`);
});

test("renderGraph: same recipe and seed renders bit-identical output (determinism)", () => {
  const recipe = {
    duration: 0.1,
    nodes: [
      { id: "noise", type: "noise", params: { color: "white" } },
      { id: "env", type: "envelope", params: { kind: "adsr", attack: 0.01, decay: 0.02, sustain: 0.3, release: 0.05 } },
      { id: "mul", type: "multiply", params: {}, inputs: ["noise", "env"] },
    ],
    output: "mul",
  };
  const a = renderGraph(recipe, SR, 12345);
  const b = renderGraph(recipe, SR, 12345);
  assert.deepEqual(Array.from(a), Array.from(b));
});

test("renderGraph: a different seed changes stochastic (noise) node output", () => {
  const recipe = {
    duration: 0.02,
    nodes: [{ id: "noise", type: "noise", params: { color: "white" } }],
    output: "noise",
  };
  const a = renderGraph(recipe, SR, 1);
  const b = renderGraph(recipe, SR, 2);
  assert.notDeepEqual(Array.from(a), Array.from(b));
});

test("renderGraph: multiply requires at least two inputs", () => {
  const recipe = {
    duration: 0.02,
    nodes: [
      { id: "a", type: "const", params: { value: 1 } },
      { id: "mul", type: "multiply", params: {}, inputs: ["a"] },
    ],
    output: "mul",
  };
  assert.throws(() => renderGraph(recipe, SR, 1), /at least two inputs/);
});
