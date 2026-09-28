/**
 * Waveshapers and digital-degradation effects: tanh saturation, wavefolding,
 * hard clipping, bitcrush (quantization) and sample-rate reduction
 * (zero-order hold). `tanh` comes from dsp/math.ts's own exp-based
 * implementation, never `Math.tanh`.
 */
import { tanh, pow } from './math.js';

export interface WaveshaperParams {
  kind: 'waveshaper';
  shape: 'tanh' | 'fold' | 'hardclip';
  /** Pre-gain applied before shaping, >= 1 drives the shaper harder. */
  drive?: number;
}

function foldSample(x: number): number {
  // Reflects x back into [-1, 1] repeatedly (triangular wavefolding), a
  // standard West Coast-style folder. Bounded loop: drive is capped by the
  // caller well before this could iterate meaningfully long.
  let v = x;
  let guard = 0;
  while ((v > 1 || v < -1) && guard < 64) {
    if (v > 1) v = 2 - v;
    else if (v < -1) v = -2 - v;
    guard++;
  }
  return v;
}

export function renderWaveshaper(input: Float64Array, params: WaveshaperParams): Float64Array {
  const drive = Math.max(0.0001, params.drive ?? 1);
  const out = new Float64Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const x = input[i] * drive;
    switch (params.shape) {
      case 'tanh': out[i] = tanh(x); break;
      case 'fold': out[i] = foldSample(x); break;
      case 'hardclip': out[i] = Math.max(-1, Math.min(1, x)); break;
    }
  }
  return out;
}

export interface BitcrushParams {
  kind: 'bitcrush';
  /** Effective bit depth, e.g. 4-8 for a crushed sound; fractional values
   * are allowed (a smooth crush-amount knob). */
  bits: number;
}

export function renderBitcrush(input: Float64Array, params: BitcrushParams): Float64Array {
  const levels = pow(2, Math.max(1, Math.min(16, params.bits)));
  const step = 2 / levels;
  const out = new Float64Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = Math.round(input[i] / step) * step;
  }
  return out;
}

export interface SampleRateReduceParams {
  kind: 'srr';
  /** How many input samples each held output sample stands in for. 1 = no
   * reduction. */
  factor: number;
}

/** Zero-order hold: the classic "lo-fi" sample-rate reducer, holding the
 * last sampled value for `factor` input samples before sampling again. */
export function renderSampleRateReduce(input: Float64Array, params: SampleRateReduceParams): Float64Array {
  const factor = Math.max(1, Math.round(params.factor));
  const out = new Float64Array(input.length);
  let held = 0;
  for (let i = 0; i < input.length; i++) {
    if (i % factor === 0) held = input[i];
    out[i] = held;
  }
  return out;
}
