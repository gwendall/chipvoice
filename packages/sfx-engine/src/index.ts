/**
 * sfx-engine's public API. See docs/GAMESOUNDS-ENGINE.md for the full
 * architecture, the recipe format, the model/param reference and the
 * determinism/loudness guarantees.
 */
export type { Recipe } from './recipe/types.js';
export { isGraphRecipe } from './recipe/types.js';
export { validateRecipe, assertValidRecipe, type ValidationResult } from './recipe/validate.js';

export type { GraphNode, GraphRecipeParams, NodeType, Ref } from './graph/types.js';
export { isRef } from './graph/types.js';
export { renderGraph } from './graph/compile.js';

export { renderRecipe, type RenderedSound } from './render/renderRecipe.js';
export { bestOfN, type BestOfNOptions, type BestOfNResult, type BestOfNCandidate } from './render/bestOfN.js';
export { removeDcOffset, fadeToZero } from './render/finalize.js';

export { MODELS, PRESETS, getPreset, recipeForPreset } from './presets/index.js';
export type { SfxModel, ModelMetadata, ModelParamMeta, ModelExample, NamedPreset, TaxonomyFamily } from './presets/types.js';

export {
  runSignalChecks, scoreReport,
  hasClipping, isSilent, onsetSampleIndex, onsetWithinMs,
  dcOffset, hasNoDcOffset, endsAtZero, isFinitePcm, countDiscontinuities,
  zeroCrossingRate,
  type SignalCheckReport,
} from './analysis/signal-checks.js';

export { momentaryLoudnessMax, integratedLoudness, measureBlocks, type LoudnessBlock } from './loudness/loudness.js';
export { truePeakDb, truePeakLinear } from './loudness/truepeak.js';
export { normalizeLoudness, TARGET_MOMENTARY_LUFS, TARGET_TRUE_PEAK_DB, type NormalizeResult } from './loudness/normalize.js';

export { createPrng, deriveSeed, type Prng } from './rng/prng.js';

// The DSP primitives and physically-informed models are exported too, for
// callers building their own graph recipes by hand (an agent writing a
// low-level "graph" recipe from this package's TypeScript types rather than
// raw JSON).
export * as dsp from './dsp/index.js';
export * as models from './models/index.js';
