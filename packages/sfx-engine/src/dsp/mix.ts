/**
 * Mixing: summing several mono buffers with per-layer gain and a start-time
 * offset (layering, e.g. an explosion's noise burst plus a delayed debris
 * layer), and a final equal-power pan to stereo. The engine's internal
 * graph stays mono end-to-end (see graph/types.ts); panning is applied once,
 * at the recipe's output stage, which keeps every DSP primitive above
 * simple and keeps a recipe's node count small.
 */
import { sin, cos, HALF_PI } from './math.js';

export interface MixLayer {
  buffer: Float64Array;
  gain?: number;
  /** Samples into the output buffer where this layer's sample 0 lands;
   * negative values are clamped to 0 (a layer cannot start before the
   * mix's own start). */
  offsetSamples?: number;
}

/** Sums layers into a buffer of exactly `length` samples, each layer gained
 * and time-shifted; samples that fall outside `[0, length)` are dropped. */
export function mixLayers(length: number, layers: MixLayer[]): Float64Array {
  const out = new Float64Array(length);
  for (const layer of layers) {
    const gain = layer.gain ?? 1;
    const offset = Math.max(0, Math.round(layer.offsetSamples ?? 0));
    const n = Math.min(layer.buffer.length, length - offset);
    for (let i = 0; i < n; i++) out[offset + i] += layer.buffer[i] * gain;
  }
  return out;
}

/** Equal-power pan law: pan in [-1, 1], -1 hard left, 0 center, 1 hard
 * right. Built from dsp/math.ts's own sin/cos (never `Math.sin`/`Math.cos`). */
export function panToStereo(mono: Float64Array, pan: number): { left: Float64Array; right: Float64Array } {
  const clamped = Math.max(-1, Math.min(1, pan));
  const angle = (clamped + 1) * (HALF_PI / 2); // 0..pi/2, 0 = hard left
  const leftGain = cos(angle);
  const rightGain = sin(angle);
  const left = new Float64Array(mono.length);
  const right = new Float64Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    left[i] = mono[i] * leftGain;
    right[i] = mono[i] * rightGain;
  }
  return { left, right };
}
