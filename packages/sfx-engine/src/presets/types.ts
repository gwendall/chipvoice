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
