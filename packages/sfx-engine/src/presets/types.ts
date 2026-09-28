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
   * The exact set of `seededRange` calls this model's `compile()` is
   * allowed to make, machine-checked by `test/seed-jitter-coverage.test.mjs`
   * (which compiles every preset and every one of `examples` above,
   * instruments `seededRange` and fails if any captured `(label, min, max)`
   * does not both start with one of these `label` prefixes AND carry that
   * entry's exact `min`/`max`). `label` is a prefix rather than an exact
   * label so one entry can cover a dynamically-indexed family of calls
   * (e.g. `sparkleLayer`'s `${label}-g${i}` grain-gain labels). `affects` is
   * the plain-English quantity a jittered seed changes (e.g. "laser sweep
   * start frequency"); `min`/`max` are the exact multiplicative offsets
   * passed to `seededRange` (e.g. `-0.1`/`0.1` for +-10%), so an LLM reading
   * this metadata sees both what varies and by how much, not just a label.
   *
   * One exception: a `label` ending in `-t` (`sparkleLayer`'s grain-onset-
   * time sub-jitter) has a `min`/`max` expressed as a fraction of the cue's
   * own compiled `duration`, not raw seconds - a fixed seconds figure would
   * be wrong for any duration other than the one it was measured at. The
   * coverage test scales such an entry's declared bounds by that render's
   * actual `duration` before comparing.
   *
   * Human-readable "which quantity, by how much" prose for a jitter tied to
   * one specific param still lives on that param's `ModelParamMeta.seedJitter`
   * above; this field is the mechanically-enforced, model-level source of
   * truth for the exact numbers, not a replacement for that prose.
   */
  seedJitter?: readonly { label: string; affects: string; min: number; max: number }[];
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
