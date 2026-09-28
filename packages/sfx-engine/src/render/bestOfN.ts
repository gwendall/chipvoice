/**
 * Renders the same recipe under N different seeds and returns the
 * highest-scoring one: signal-sanity checks (analysis/signal-checks.ts)
 * always run; an optional external `score` function (e.g. a CLAP similarity
 * score against a text prompt, computed out of process - this package has
 * no ML runtime dependency) can be blended in. Deterministic: for a fixed
 * base recipe and `seeds` list, the winner and every candidate's scores are
 * always the same (no randomness beyond the recipe's own seeded PRNG, and
 * seeds are consumed in the order given, not drawn fresh).
 */
import type { Recipe } from '../recipe/types.js';
import { renderRecipe, type RenderedSound } from './renderRecipe.js';
import { runSignalChecks, scoreReport } from '../analysis/signal-checks.js';

export interface BestOfNCandidate {
  seed: number;
  rendered: RenderedSound;
  signalScore: number;
  externalScore?: number;
  totalScore: number;
}

export interface BestOfNResult {
  best: BestOfNCandidate;
  candidates: BestOfNCandidate[];
}

export interface BestOfNOptions {
  /** Seeds to try, in order. */
  seeds: number[];
  /** Optional external scorer (e.g. CLAP text-audio similarity), 0..1
   * higher-is-better. Called once per candidate, after it renders. */
  score?(rendered: RenderedSound): number | Promise<number>;
  /** How much weight the external score gets vs. the signal-sanity score,
   * 0..1. Default 0.6 (external score, when present, dominates - it is the
   * closer proxy for "does this sound like the prompt"). */
  externalWeight?: number;
}

export async function bestOfN(baseRecipe: Recipe, options: BestOfNOptions): Promise<BestOfNResult> {
  const externalWeight = options.externalWeight ?? 0.6;
  const candidates: BestOfNCandidate[] = [];

  for (const seed of options.seeds) {
    const recipe: Recipe = { ...baseRecipe, seed };
    const rendered = renderRecipe(recipe);
    const mono = mixDownForChecks(rendered);
    const signalScore = scoreReport(runSignalChecks(mono, rendered.sampleRate));
    const externalScore = options.score ? await options.score(rendered) : undefined;
    const totalScore = externalScore === undefined ? signalScore : (1 - externalWeight) * signalScore + externalWeight * externalScore;
    candidates.push({ seed, rendered, signalScore, externalScore, totalScore });
  }

  let best = candidates[0];
  for (const c of candidates) if (c.totalScore > best.totalScore) best = c;
  return { best, candidates };
}

/** Signal checks are defined on a mono buffer; a rendered sound is stereo
 * (post-pan, dsp/mix.ts's equal-power panToStereo). Using the left channel
 * alone (rather than summing both) is deliberate: at centre pan each
 * channel is the pre-pan mono signal scaled by a constant ~0.707, which
 * keeps every check's scale-dependent threshold meaningful; summing both
 * channels would double-count energy and could read as clipping a signal
 * that never actually clipped. */
function mixDownForChecks(rendered: RenderedSound): Float64Array {
  return rendered.left;
}
