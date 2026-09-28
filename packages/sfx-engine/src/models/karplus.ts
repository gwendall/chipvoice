/**
 * Karplus-Strong plucked strings, after Kevin Karplus & Alex Strong,
 * "Digital Synthesis of Plucked-String and Drum Timbres" (Computer Music
 * Journal, 1983): a circular buffer exactly one pitch period long is
 * filled with noise (the pluck), then repeatedly read and written back
 * through a short averaging (lowpass) filter - each pass around the loop
 * both delays and slightly damps the signal, so high partials die first,
 * exactly as a real plucked string's energy loss is frequency-dependent.
 *
 * This is an independent implementation of the published algorithm, not a
 * port of any existing codebase.
 */
import type { Prng } from '../rng/prng.js';
import { renderNoise } from '../dsp/noise.js';

export interface KarplusParams {
  /** Target pitch, Hz. */
  freq: number;
  /** 0..1: how long the string rings. Maps to the loop's damping
   * coefficient, not a literal seconds value, since a real plucked
   * string's ring time is itself frequency-dependent. Default 0.6. */
  decay?: number;
  /** 0..1: how much high-frequency content survives each pass around the
   * loop. 0 = a dull, quickly-damped string; 1 = a bright, long-ringing
   * one. Default 0.5. */
  brightness?: number;
  /** 0..1: where along the string it is plucked, 0.5 = the middle (the
   * classic, roundest pluck). Implemented as a second, position-offset tap
   * subtracted from the excitation (Karplus & Strong's own "pick
   * direction/position" extension), which notches out the partials that a
   * real string barely excites when plucked at that point. Default 0.2. */
  pluckPosition?: number;
}

export function renderKarplus(length: number, sampleRate: number, params: KarplusParams, rng: Prng): Float64Array {
  const freq = Math.max(20, Math.min(sampleRate * 0.45, params.freq));
  const decay = Math.max(0, Math.min(1, params.decay ?? 0.6));
  const brightness = Math.max(0, Math.min(1, params.brightness ?? 0.5));
  const pluckPosition = Math.max(0.02, Math.min(0.98, params.pluckPosition ?? 0.2));

  const period = Math.max(4, Math.round(sampleRate / freq));
  const buffer = renderNoise(period, sampleRate, { color: 'white' }, rng);

  // Pluck-position comb: subtracting a fraction-of-period-delayed copy of
  // the excitation notches partials the string would barely have at that
  // pluck point, brightest for pluckPosition near 0 or 1 (edge plucks).
  const posTap = Math.max(1, Math.round(pluckPosition * period));
  const excited = new Float64Array(period);
  for (let i = 0; i < period; i++) excited[i] = buffer[i] - 0.5 * buffer[(i - posTap + period) % period];

  // The averaging filter blends the direct sample with the previous one;
  // `brightness` biases that blend from a heavy 2-tap average (dull) to
  // an almost-unfiltered pass-through (bright). `decay` scales the loop's
  // overall feedback gain (kept just under 1 so the string actually dies
  // out within any finite render).
  const filterMix = 0.5 - 0.5 * brightness; // 0 (bright) .. 0.5 (dull average)
  const feedback = 0.965 + decay * 0.0345; // 0.965 .. 0.9995

  const out = new Float64Array(length);
  let prev = 0;
  for (let i = 0; i < length; i++) {
    const readIndex = i % period;
    const current = excited[readIndex];
    const filtered = (1 - filterMix) * current + filterMix * prev;
    const next = filtered * feedback;
    out[i] = current;
    excited[readIndex] = next;
    prev = current;
  }

  let peak = 0;
  for (let i = 0; i < length; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  if (peak > 1e-9) { const g = 0.9 / peak; for (let i = 0; i < length; i++) out[i] *= g; }
  return out;
}
