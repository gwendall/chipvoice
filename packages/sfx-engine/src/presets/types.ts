/**
 * The shape every high-level model (impact, footstep, whoosh, ...) exports:
 * a `compile` function from (params, seed, sampleRate) to a low-level
 * `GraphRecipeParams` (what `graph/compile.ts`'s renderGraph actually
 * runs), plus machine-readable `metadata` written for an LLM reader - a
 * plain-English description of what the model is and of each param, its
 * type/unit/range/default, and which params seed a random jitter and by how
 * much, so an agent can pick sensible values without reading this package's
 * source. `presets/index.ts` is the registry of every model and of the
 * named presets built from them.
 */
import type { GraphRecipeParams } from '../graph/types.js';

export type TaxonomyFamily =
  | 'ui' | 'impact' | 'footstep' | 'whoosh' | 'explosion' | 'scifi' | 'magic' | 'pickup';

export interface ModelExample {
  /** A short, human name, e.g. "heavy metal hit". */
  name: string;
  description: string;
  params: Record<string, unknown>;
  seed: number;
}

export interface ModelParamMeta {
  type: 'number' | 'integer' | 'string' | 'boolean' | 'enum';
  unit?: string;
  min?: number;
  max?: number;
  default?: unknown;
  enumValues?: readonly string[];
  /** Plain-English meaning of this param, written for an LLM reader
   * choosing values without seeing this file's source. */
  description: string;
  /** If set, this param's value (or lack of one) controls a random jitter
   * applied internally (e.g. modal.ts's per-mode +-1.5% frequency jitter) -
   * a plain-English note on what varies and by how much, so an agent knows
   * a seed change on this model will actually sound different. */
  seedJitter?: string;
}

export interface ModelMetadata {
  id: string;
  family: TaxonomyFamily;
  description: string;
  params: Record<string, ModelParamMeta>;
  /** 2-4 named, ready-to-render examples spanning the model's range. */
  examples: ModelExample[];
  /**
   * The exact set of `seededRange` label prefixes this model's `compile()`
   * is allowed to use, machine-checked by
   * `test/seed-jitter-coverage.test.mjs` (which compiles every preset and
   * every one of `examples` above, instruments `seededRange` and fails if
   * any captured label does not start with one of these prefixes). A prefix
   * rather than an exact label so one entry can cover a dynamically-indexed
   * family of labels (e.g. `sparkleLayer`'s `${label}-t${i}` grain labels).
   * Human-readable "which quantity, by how much" prose for each jitter
   * still lives on the relevant `ModelParamMeta.seedJitter` above (or, for a
   * jitter with no single owning param, in this model's own file comment) -
   * this field is the mechanical enforcement half, not a replacement for it.
   */
  seedJitterLabels?: readonly string[];
}

export interface SfxModel {
  metadata: ModelMetadata;
  compile(params: Record<string, unknown>, seed: number, sampleRate: number): GraphRecipeParams;
}

export interface NamedPreset {
  /** The taxonomy event this covers, e.g. "impact-metal-heavy". */
  id: string;
  family: TaxonomyFamily;
  /** The registered model id in presets/index.ts's MODELS map. */
  model: string;
  params: Record<string, unknown>;
  seed: number;
  /** One line: what game moment this is for. */
  description: string;
}
