import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateRecipe } from "../dist/recipe/validate.js";
import { PRESETS, recipeForPreset } from "../dist/presets/index.js";

// This package has zero runtime dependencies, so there is no ajv to
// validate against schema/recipe-1.json directly - `validate.ts` is this
// package's own hand-rolled enforcement of the same contract. This file's
// job is to check the two stay in agreement: a small, independent
// re-implementation of schema/recipe-1.json's own required/type/enum/
// additionalProperties constraints (read from the actual schema file on
// disk, not hardcoded twice from memory), run against the same example
// recipes as validateRecipe(), on both the positive and negative side.

const schemaPath = fileURLToPath(new URL("../schema/recipe-1.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

function isPlainObject(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }

/** A minimal, schema-specific structural check (not a general JSON Schema
 * engine): reads schema.required/properties/$defs directly off the loaded
 * schema object, so a future edit to schema/recipe-1.json's required list
 * or node-type enum is picked up here without editing this file. */
function checkAgainstSchema(recipe) {
  const errors = [];
  if (!isPlainObject(recipe)) return ["recipe must be an object"];
  for (const key of schema.required) if (!(key in recipe)) errors.push(`missing required top-level key: ${key}`);
  for (const key of Object.keys(recipe)) if (!(key in schema.properties)) errors.push(`unknown top-level key: ${key} (schema has additionalProperties: false)`);
  if (recipe.engine !== schema.properties.engine.const) errors.push(`engine must be ${schema.properties.engine.const}`);
  if (typeof recipe.model !== "string") errors.push("model must be a string");
  if (!isPlainObject(recipe.params)) errors.push("params must be an object");
  if (!Number.isInteger(recipe.seed) || recipe.seed < schema.properties.seed.minimum || recipe.seed > schema.properties.seed.maximum) errors.push("seed out of range");
  if (!schema.properties.sampleRate.enum.includes(recipe.sampleRate)) errors.push("sampleRate not in schema's enum");

  if (recipe.model === "graph" && isPlainObject(recipe.params)) {
    const gp = schema.$defs.graphRecipeParams;
    const params = recipe.params;
    for (const key of gp.required) if (!(key in params)) errors.push(`graph params missing required key: ${key}`);
    for (const key of Object.keys(params)) if (!(key in gp.properties)) errors.push(`graph params has unknown key: ${key}`);
    if (typeof params.duration !== "number" || !(params.duration > 0)) errors.push("graph params.duration must be a positive number");
    if (!Array.isArray(params.nodes)) errors.push("graph params.nodes must be an array");
    else {
      const nodeTypeEnum = schema.$defs.graphNode.properties.type.enum;
      const ids = new Set();
      for (const node of params.nodes) {
        if (!isPlainObject(node)) { errors.push("a graph node must be an object"); continue; }
        for (const key of schema.$defs.graphNode.required) if (!(key in node)) errors.push(`graph node missing required key: ${key}`);
        for (const key of Object.keys(node)) if (!(key in schema.$defs.graphNode.properties)) errors.push(`graph node has unknown key: ${key}`);
        if (!nodeTypeEnum.includes(node.type)) errors.push(`graph node type "${node.type}" not in schema's enum`);
        if (ids.has(node.id)) errors.push(`duplicate node id "${node.id}"`);
        ids.add(node.id);
      }
      if (typeof params.output !== "string" || !ids.has(params.output)) errors.push("graph params.output must name a declared node");
    }
    if (params.pan !== undefined && (typeof params.pan !== "number" || params.pan < -1 || params.pan > 1)) errors.push("graph params.pan out of [-1,1]");
  }
  return errors;
}

test("schema/recipe-1.json parses and declares the expected top-level shape", () => {
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.required.sort(), ["engine", "model", "params", "sampleRate", "seed"]);
  assert.equal(schema.properties.engine.const, "sfx-engine@1");
  assert.deepEqual(schema.properties.sampleRate.enum, [44100, 48000]);
});

test("a hand-written valid graph recipe passes both the schema-shape check and validateRecipe()", () => {
  const recipe = {
    engine: "sfx-engine@1",
    model: "graph",
    params: {
      duration: 0.2,
      nodes: [
        { id: "osc", type: "oscillator", params: { shape: "sine", freq: 440 } },
        { id: "env", type: "envelope", params: { kind: "adsr", attack: 0.01, decay: 0.02, sustain: 0.5, release: 0.1 } },
        { id: "mul", type: "multiply", params: {}, inputs: ["osc", "env"] },
      ],
      output: "mul",
      pan: 0,
    },
    seed: 1,
    sampleRate: 48000,
  };
  assert.deepEqual(checkAgainstSchema(recipe), []);
  const result = validateRecipe(recipe);
  assert.equal(result.ok, true, `validateRecipe errors: ${result.errors.join(", ")}`);
});

test("every registered preset's Recipe (via recipeForPreset) passes both checks", () => {
  for (const p of PRESETS) {
    const recipe = recipeForPreset(p.id, p.seed, 48000);
    const result = validateRecipe(recipe);
    assert.equal(result.ok, true, `${p.id}: validateRecipe errors: ${result.errors.join(", ")}`);
    // High-level model recipes (model !== "graph") are only schema-shape
    // checked at the envelope level here - their own params are that
    // model's business, exactly as schema/recipe-1.json itself documents.
    const envelopeErrors = checkAgainstSchema({ ...recipe, model: "graph", params: { duration: 0.01, nodes: [{ id: "x", type: "const", params: { value: 0 } }], output: "x" } });
    assert.deepEqual(envelopeErrors, [], `${p.id}: envelope-shape check should pass once model/params are substituted for a trivially valid graph`);
  }
});

for (const [name, breakRecipe] of [
  ["wrong engine string", (r) => { r.engine = "sfx-engine@2"; }],
  ["missing seed", (r) => { delete r.seed; }],
  ["seed out of range (negative)", (r) => { r.seed = -1; }],
  ["seed out of range (too large)", (r) => { r.seed = 5000000000; }],
  ["seed not an integer", (r) => { r.seed = 1.5; }],
  ["sampleRate not in the enum", (r) => { r.sampleRate = 22050; }],
  ["params not an object", (r) => { r.params = "not an object"; }],
  ["unknown top-level key", (r) => { r.extra = true; }],
]) {
  test(`invalid recipe (${name}) is rejected by both checks`, () => {
    const recipe = {
      engine: "sfx-engine@1",
      model: "graph",
      params: { duration: 0.05, nodes: [{ id: "a", type: "const", params: { value: 0 } }], output: "a" },
      seed: 1,
      sampleRate: 48000,
    };
    breakRecipe(recipe);
    assert.ok(checkAgainstSchema(recipe).length > 0, `${name}: schema-shape check should have found an error`);
    const result = validateRecipe(recipe);
    assert.equal(result.ok, false, `${name}: validateRecipe should reject this recipe`);
  });
}

for (const [name, breakParams] of [
  ["missing duration", (p) => { delete p.duration; }],
  ["negative duration", (p) => { p.duration = -1; }],
  ["empty nodes array", (p) => { p.nodes = []; }],
  ["unknown node type", (p) => { p.nodes[0].type = "not-a-real-type"; }],
  ["duplicate node id", (p) => { p.nodes.push({ id: "a", type: "const", params: { value: 1 } }); }],
  ["output references an unknown node", (p) => { p.output = "ghost"; }],
  ["pan out of range", (p) => { p.pan = 2; }],
]) {
  test(`invalid graph params (${name}) is rejected by both checks`, () => {
    const recipe = {
      engine: "sfx-engine@1",
      model: "graph",
      params: { duration: 0.05, nodes: [{ id: "a", type: "const", params: { value: 0 } }], output: "a" },
      seed: 1,
      sampleRate: 48000,
    };
    breakParams(recipe.params);
    assert.ok(checkAgainstSchema(recipe).length > 0, `${name}: schema-shape check should have found an error`);
    const result = validateRecipe(recipe);
    assert.equal(result.ok, false, `${name}: validateRecipe should reject this recipe`);
  });
}

test("validateRecipe reports every error, not just the first (assertValidRecipe's message joins them all)", () => {
  const broken = { engine: "wrong", model: "", params: null, seed: -5, sampleRate: 1 };
  const result = validateRecipe(broken);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 4, `expected multiple errors, got ${result.errors.length}: ${JSON.stringify(result.errors)}`);
});
