/**
 * The top-level entry point: a `Recipe` in, a finished stereo PCM sound out.
 * Steps: validate, compile (a named high-level model's params to a
 * `GraphRecipeParams`, or use a `"graph"` recipe's params directly), render
 * the graph (graph/compile.ts), finalize (DC removal + fade to zero,
 * render/finalize.ts), normalize loudness to the house convention
 * (loudness/normalize.ts), then pan to stereo once at the very end
 * (dsp/mix.ts).
 */
import type { Recipe } from '../recipe/types.js';
import { assertValidRecipe } from '../recipe/validate.js';
import type { GraphRecipeParams } from '../graph/types.js';
import { renderGraph } from '../graph/compile.js';
import { removeDcOffset, fadeToZero } from './finalize.js';
import { normalizeLoudness, type NormalizeResult } from '../loudness/normalize.js';
import { panToStereo } from '../dsp/mix.js';
import { MODELS } from '../presets/index.js';

export interface RenderedSound {
  left: Float64Array;
  right: Float64Array;
  sampleRate: number;
  durationSeconds: number;
  renderTimeMs: number;
  loudness: NormalizeResult;
  recipe: Recipe;
}

function compileRecipe(recipe: Recipe, sampleRate: number): GraphRecipeParams {
  if (recipe.model === 'graph') return recipe.params as GraphRecipeParams;
  const model = MODELS[recipe.model];
  if (!model) throw new Error(`sfx-engine: unknown model "${recipe.model}" (not "graph" and not in the model registry)`);
  return model.compile(recipe.params as Record<string, unknown>, recipe.seed, sampleRate);
}

/** Renders a recipe end to end. Deterministic: the same recipe object
 * (same JSON) renders to bit-identical PCM every time, in every engine
 * (see docs/GAMESOUNDS-ENGINE.md's determinism section and `parity/`). */
export function renderRecipe(recipeInput: unknown): RenderedSound {
  const t0 = performance.now();
  const recipe = assertValidRecipe(recipeInput);
  const sampleRate = recipe.sampleRate;

  const graphParams = compileRecipe(recipe, sampleRate);
  let mono = renderGraph(graphParams, sampleRate, recipe.seed);
  mono = removeDcOffset(mono);
  mono = fadeToZero(mono, sampleRate);

  const loudness = normalizeLoudness(mono, sampleRate);
  const { left, right } = panToStereo(loudness.signal, graphParams.pan ?? 0);
  const renderTimeMs = performance.now() - t0;

  return {
    left,
    right,
    sampleRate,
    durationSeconds: left.length / sampleRate,
    renderTimeMs,
    loudness,
    recipe,
  };
}
