/**
 * Final cleanup applied to every rendered mono signal before loudness
 * normalization and panning: remove any DC offset, then fade the last few
 * milliseconds to true zero so a sound never ends on a hard edge (a click
 * at the cut). Both are unconditional, cheap, and safe for any recipe (they
 * do not move a sound's onset or change its perceived timing) - unlike
 * trimming leading silence, which this engine deliberately does NOT do (see
 * docs/GAMESOUNDS-ENGINE.md): a recipe's authored timing (e.g. an
 * explosion's delayed debris layer) stays exactly as written, and
 * `analysis/signal-checks.ts`'s onsetWithinMs is instead a check every
 * preset must pass by being authored to start immediately, not a
 * post-process that silently rewrites what was asked for.
 */

/** Subtracts the signal's mean, removing any DC offset in one pass. */
export function removeDcOffset(signal: Float64Array): Float64Array {
  if (signal.length === 0) return signal;
  let sum = 0;
  for (let i = 0; i < signal.length; i++) sum += signal[i];
  const mean = sum / signal.length;
  if (mean === 0) return signal;
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] - mean;
  return out;
}

/** Linearly fades the last `fadeMs` milliseconds to exactly 0, so
 * `analysis/signal-checks.ts`'s endsAtZero always passes regardless of how
 * a recipe's own envelope ends. Default 6 ms: short enough to be inaudible
 * as a fade on a percussive SFX, long enough to guarantee no audible click. */
export function fadeToZero(signal: Float64Array, sampleRate: number, fadeMs = 6): Float64Array {
  const fadeSamples = Math.min(signal.length, Math.round((fadeMs / 1000) * sampleRate));
  if (fadeSamples <= 0) return signal;
  const out = Float64Array.from(signal);
  const start = out.length - fadeSamples;
  for (let i = 0; i < fadeSamples; i++) {
    const g = 1 - (i + 1) / fadeSamples; // 1 down to 0, reaching exactly 0 at the last sample
    out[start + i] *= g;
  }
  out[out.length - 1] = 0;
  return out;
}
