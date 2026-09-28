/**
 * The top-level recipe: a versioned engine tag, a model name, that model's
 * params, a seed and a sample rate - a few hundred bytes of JSON an agent
 * can write by hand. Mirrors `schema/recipe-1.json`; that JSON Schema file
 * is the documented, language-agnostic source of truth (for an external
 * agent or a non-TypeScript caller), this type is its TypeScript shape for
 * this package's own code.
 */
import type { GraphRecipeParams } from '../graph/types.js';

export interface Recipe {
  engine: 'sfx-engine@1';
  /** "graph" for a low-level recipe (params is a GraphRecipeParams), or a
   * high-level model id registered in presets/index.ts's model registry. */
  model: string;
  params: GraphRecipeParams | Record<string, unknown>;
  /** 32-bit unsigned integer. */
  seed: number;
  sampleRate: 44100 | 48000;
}

export function isGraphRecipe(recipe: Recipe): recipe is Recipe & { params: GraphRecipeParams } {
  return recipe.model === 'graph';
}
