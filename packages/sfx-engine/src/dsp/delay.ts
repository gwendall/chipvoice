/**
 * A feedback delay line with linear-interpolated (fractional-sample) reads,
 * an optional one-pole lowpass inside the feedback loop (its `loopFilter`),
 * and dry/wet mix: the general-purpose echo/comb-with-damping primitive the
 * low-level graph exposes (used directly by presets for slap-back and
 * metallic-echo textures). It is the same family as Karplus & Strong's
 * plucked string - a delay loop with a damping filter inside the feedback
 * path - but `models/karplus.ts` implements that model with its own tight,
 * exactly-one-period circular buffer rather than reusing this node: this
 * delay's read always looks back into a much larger history buffer (so
 * ordinary echo effects can change their delay time smoothly), which does
 * not give Karplus-Strong's classic "the buffer's initial content is the
 * pluck" behavior in the plucked string's own first period.
 */
import { exp, PI } from './math.js';
import type { ModulatableNumber } from './oscillator.js';

function at(value: ModulatableNumber, i: number): number {
  return typeof value === 'number' ? value : value[i];
}

export interface DelayParams {
  kind: 'delay';
  timeMs: ModulatableNumber;
  feedback?: number; // 0..0.999
  mix?: number; // 0..1, default 0.5
  /** A one-pole lowpass cutoff (Hz) applied to the signal each time it goes
   * around the feedback loop; omit for a plain (undamped) delay. */
  loopFilterCutoff?: number;
}

const MAX_DELAY_SECONDS = 3;

export function renderDelay(input: Float64Array, sampleRate: number, params: DelayParams): Float64Array {
  const maxSamples = Math.max(4, Math.round(MAX_DELAY_SECONDS * sampleRate));
  const line = new Float64Array(maxSamples);
  let writeHead = 0;
  const feedback = Math.max(0, Math.min(0.999, params.feedback ?? 0));
  const mix = params.mix ?? 0.5;
  const loopA = params.loopFilterCutoff !== undefined ? exp((-2 * PI * params.loopFilterCutoff) / sampleRate) : null;
  let loopState = 0;
  const out = new Float64Array(input.length);

  for (let i = 0; i < input.length; i++) {
    const delayMs = Math.max(0, at(params.timeMs, i));
    const delaySamplesFloat = Math.min(maxSamples - 2, (delayMs / 1000) * sampleRate);
    const readPos = (writeHead - delaySamplesFloat + maxSamples * 4) % maxSamples;
    const i0 = Math.floor(readPos);
    const frac = readPos - i0;
    const i1 = (i0 + 1) % maxSamples;
    const delayed = line[i0] * (1 - frac) + line[i1] * frac;

    let fedBack = delayed;
    if (loopA !== null) {
      loopState = (1 - loopA) * delayed + loopA * loopState;
      fedBack = loopState;
    }

    const x = input[i];
    line[writeHead] = x + feedback * fedBack;
    out[i] = (1 - mix) * x + mix * delayed;
    writeHead = (writeHead + 1) % maxSamples;
  }
  return out;
}
