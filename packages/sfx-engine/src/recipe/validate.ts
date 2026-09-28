/**
 * A hand-rolled validator for `schema/recipe-1.json`'s essential
 * constraints. Zero runtime dependencies means no ajv: this implements the
 * schema's own required/type/enum/range checks directly rather than a
 * general-purpose JSON Schema engine. `schema/recipe-1.json` stays the
 * documented, versioned source of truth for the format (what an external
 * agent or a non-TypeScript caller reads); this function is this package's
 * own fast, dependency-free enforcement of the same contract, and
 * `test/recipe-schema.test.mjs` checks the two stay in agreement on a set
 * of example recipes.
 */
import type { Recipe } from './types.js';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const NODE_TYPES = new Set([
  'const', 'oscillator', 'noise', 'envelope', 'sweep', 'filter', 'shaper',
  'delay', 'reverb', 'mix', 'multiply', 'modal', 'phisem', 'karplus', 'bubble',
]);

/** schema/recipe-1.json's own top-level `properties` keys - kept as a
 * literal list here (not imported from the JSON file, to avoid this
 * package's build needing JSON module resolution) and cross-checked against
 * the schema itself by `test/recipe-schema.test.mjs`. Mirrors the schema's
 * `additionalProperties: false`. */
const TOP_LEVEL_KEYS = new Set(['engine', 'model', 'params', 'seed', 'sampleRate']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates a graph recipe's `params` (a `GraphRecipeParams`): duration,
 * nodes[], output, optional pan. Node-internal `params` are intentionally
 * NOT deep-validated here (they are per-node-type, documented in
 * docs/GAMESOUNDS-ENGINE.md's node reference, and already type-checked at
 * compile time in TypeScript callers) - this validator's job is to catch a
 * malformed recipe (the shape an external, non-TypeScript caller such as an
 * LLM agent is most likely to get wrong), not to re-typecheck every DSP
 * param. */
function validateGraphParams(params: unknown, errors: string[]): void {
  if (!isPlainObject(params)) { errors.push('params: must be an object for model "graph"'); return; }
  if (typeof params.duration !== 'number' || !(params.duration > 0)) errors.push('params.duration: must be a positive number (seconds)');
  if (!Array.isArray(params.nodes)) { errors.push('params.nodes: must be an array'); return; }
  if (params.nodes.length === 0) errors.push('params.nodes: must not be empty');
  const ids = new Set<string>();
  for (let i = 0; i < params.nodes.length; i++) {
    const node = params.nodes[i];
    if (!isPlainObject(node)) { errors.push(`params.nodes[${i}]: must be an object`); continue; }
    if (typeof node.id !== 'string' || node.id.length === 0) errors.push(`params.nodes[${i}].id: must be a non-empty string`);
    else if (ids.has(node.id)) errors.push(`params.nodes[${i}].id: duplicate node id "${node.id}"`);
    else ids.add(node.id);
    if (typeof node.type !== 'string' || !NODE_TYPES.has(node.type)) errors.push(`params.nodes[${i}].type: "${String(node.type)}" is not a known node type`);
    if (!isPlainObject(node.params)) errors.push(`params.nodes[${i}].params: must be an object`);
    if (node.inputs !== undefined && !(Array.isArray(node.inputs) && node.inputs.every((x: unknown) => typeof x === 'string'))) {
      errors.push(`params.nodes[${i}].inputs: must be an array of strings when present`);
    }
  }
  if (typeof params.output !== 'string' || params.output.length === 0) errors.push('params.output: must be a non-empty string');
  else if (!ids.has(params.output)) errors.push(`params.output: "${params.output}" does not name any node in params.nodes`);
  if (params.pan !== undefined && (typeof params.pan !== 'number' || params.pan < -1 || params.pan > 1)) errors.push('params.pan: must be a number in [-1, 1] when present');
}

/** Validates the top-level recipe envelope against `schema/recipe-1.json`'s
 * required/type/enum/range constraints. For `model: "graph"`, also
 * validates `params`' shape; for a named high-level model, `params` is left
 * to that model's own compiler to reject (see presets/index.ts). */
export function validateRecipe(recipe: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(recipe)) return { ok: false, errors: ['recipe: must be an object'] };

  for (const key of Object.keys(recipe)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`${key}: unknown top-level property (schema/recipe-1.json declares additionalProperties: false)`);
  }
  if (recipe.engine !== 'sfx-engine@1') errors.push(`engine: must be "sfx-engine@1", got ${JSON.stringify(recipe.engine)}`);
  if (typeof recipe.model !== 'string' || recipe.model.length === 0) errors.push('model: must be a non-empty string');
  if (!isPlainObject(recipe.params)) errors.push('params: must be an object');
  if (typeof recipe.seed !== 'number' || !Number.isInteger(recipe.seed) || recipe.seed < 0 || recipe.seed > 4294967295) {
    errors.push('seed: must be an integer in [0, 4294967295]');
  }
  if (recipe.sampleRate !== 44100 && recipe.sampleRate !== 48000) errors.push(`sampleRate: must be 44100 or 48000, got ${JSON.stringify(recipe.sampleRate)}`);

  if (recipe.model === 'graph' && errors.length === 0) validateGraphParams(recipe.params, errors);

  return { ok: errors.length === 0, errors };
}

/** Throws with every error joined (not just the first) if the recipe is
 * invalid; returns the recipe narrowed to `Recipe` otherwise. */
export function assertValidRecipe(recipe: unknown): Recipe {
  const result = validateRecipe(recipe);
  if (!result.ok) throw new Error(`invalid sfx-engine recipe:\n- ${result.errors.join('\n- ')}`);
  return recipe as Recipe;
}
