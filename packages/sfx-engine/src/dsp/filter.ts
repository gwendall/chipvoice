/**
 * Filters: a state-variable filter (Chamberlin's topology, LP/HP/BP/notch
 * from one structure), RBJ cookbook biquads (Robert Bristow-Johnson's
 * "Audio EQ Cookbook", the standard reference every audio engineer cites),
 * a one-pole, a feedback comb and an allpass. All float64, all built from
 * dsp/math.ts's own sin/cos/exp/log/pow (never `Math.sin`, `Math.cos`,
 * `Math.exp`, `Math.log` or `Math.pow` directly), so a filter's coefficients
 * are exact-per-engine the same way the oscillators are.
 */
import { sin, cos, exp, log, pow, PI } from './math.js';
import type { ModulatableNumber } from './oscillator.js';

function at(value: ModulatableNumber, i: number): number {
  return typeof value === 'number' ? value : value[i];
}

export type SvfMode = 'lowpass' | 'highpass' | 'bandpass' | 'notch';

export interface SvfParams {
  kind: 'svf';
  mode: SvfMode;
  cutoff: ModulatableNumber;
  /** Resonance, roughly 0.5 (no resonance) to ~20 (self-oscillating). */
  q: ModulatableNumber;
}

/** Chamberlin's state-variable filter: two integrators, one feedback path,
 * all four modes from the same recurrence. Stable up to roughly fs/6; the
 * caller is expected to keep cutoff below that (a preset's own params keep
 * cutoffs well inside typical SFX ranges). */
export function renderSvf(input: Float64Array, sampleRate: number, params: SvfParams): Float64Array {
  const out = new Float64Array(input.length);
  let low = 0, band = 0;
  for (let i = 0; i < input.length; i++) {
    const cutoff = Math.min(sampleRate * 0.24, Math.max(1, at(params.cutoff, i)));
    const q = Math.max(0.5, at(params.q, i));
    const f = 2 * sin(PI * cutoff / sampleRate);
    const damp = 1 / q;
    const x = input[i];
    low = low + f * band;
    const high = x - low - damp * band;
    band = band + f * high;
    const notch = high + low;
    switch (params.mode) {
      case 'lowpass': out[i] = low; break;
      case 'highpass': out[i] = high; break;
      case 'bandpass': out[i] = band; break;
      case 'notch': out[i] = notch; break;
    }
  }
  return out;
}

export type BiquadMode = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peak' | 'lowshelf' | 'highshelf' | 'allpass';

export interface BiquadParams {
  kind: 'biquad';
  mode: BiquadMode;
  /** Constant only: RBJ coefficients are recomputed only when cutoff/q/gain
   * change block-to-block would be needed for per-sample modulation, which
   * this engine's short one-shot renders do not need - a biquad node reads
   * its cutoff/q once, at render start. */
  cutoff: number;
  q?: number;
  gainDb?: number;
}

interface BiquadCoeffs { b0: number; b1: number; b2: number; a1: number; a2: number }

function rbjCoeffs(sampleRate: number, params: BiquadParams): BiquadCoeffs {
  const q = params.q ?? Math.SQRT1_2;
  const w0 = 2 * PI * Math.min(0.49, Math.max(1e-5, params.cutoff / sampleRate));
  const cosw0 = cos(w0);
  const sinw0 = sin(w0);
  const alpha = sinw0 / (2 * q);
  const A = tenPow(params.gainDb ?? 0);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  switch (params.mode) {
    case 'lowpass':
      b0 = (1 - cosw0) / 2; b1 = 1 - cosw0; b2 = (1 - cosw0) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cosw0) / 2; b1 = -(1 + cosw0); b2 = (1 + cosw0) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1; b1 = -2 * cosw0; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      break;
    case 'allpass':
      b0 = 1 - alpha; b1 = -2 * cosw0; b2 = 1 + alpha;
      a0 = 1 + alpha; a1 = -2 * cosw0; a2 = 1 - alpha;
      break;
    case 'peak': {
      const alphaOverA = alpha / A;
      const alphaTimesA = alpha * A;
      b0 = 1 + alphaTimesA; b1 = -2 * cosw0; b2 = 1 - alphaTimesA;
      a0 = 1 + alphaOverA; a1 = -2 * cosw0; a2 = 1 - alphaOverA;
      break;
    }
    case 'lowshelf': {
      const sqrtA2alpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cosw0 + sqrtA2alpha);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
      b2 = A * ((A + 1) - (A - 1) * cosw0 - sqrtA2alpha);
      a0 = (A + 1) + (A - 1) * cosw0 + sqrtA2alpha;
      a1 = -2 * ((A - 1) + (A + 1) * cosw0);
      a2 = (A + 1) + (A - 1) * cosw0 - sqrtA2alpha;
      break;
    }
    case 'highshelf': {
      const sqrtA2alpha = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cosw0 + sqrtA2alpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
      b2 = A * ((A + 1) + (A - 1) * cosw0 - sqrtA2alpha);
      a0 = (A + 1) - (A - 1) * cosw0 + sqrtA2alpha;
      a1 = 2 * ((A - 1) - (A + 1) * cosw0);
      a2 = (A + 1) - (A - 1) * cosw0 - sqrtA2alpha;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** 10^(dB/40), the RBJ cookbook's shelf/peak gain term A; built from our
 * own `pow` (never `Math.pow`). */
function tenPow(db: number): number {
  return pow(10, db / 40);
}

export function renderBiquad(input: Float64Array, sampleRate: number, params: BiquadParams): Float64Array {
  const c = rbjCoeffs(sampleRate, params);
  const out = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

export interface OnePoleParams {
  kind: 'onepole';
  mode: 'lowpass' | 'highpass';
  cutoff: ModulatableNumber;
}

export function renderOnePole(input: Float64Array, sampleRate: number, params: OnePoleParams): Float64Array {
  const out = new Float64Array(input.length);
  let low = 0;
  for (let i = 0; i < input.length; i++) {
    const cutoff = Math.min(sampleRate * 0.49, Math.max(1, at(params.cutoff, i)));
    // Exact one-pole coefficient from the pole's analytic position, via our
    // own exp: a = exp(-2*pi*cutoff/sampleRate).
    const a = exp((-2 * PI * cutoff) / sampleRate);
    low = (1 - a) * input[i] + a * low;
    out[i] = params.mode === 'lowpass' ? low : input[i] - low;
  }
  return out;
}

export interface CombParams {
  kind: 'comb';
  delayMs: number;
  feedback: number; // -0.999..0.999
  mix?: number; // 0..1, default 0.5
}

export function renderComb(input: Float64Array, sampleRate: number, params: CombParams): Float64Array {
  const delaySamples = Math.max(1, Math.round((params.delayMs / 1000) * sampleRate));
  const line = new Float64Array(delaySamples);
  let writeIndex = 0;
  const feedback = Math.max(-0.999, Math.min(0.999, params.feedback));
  const mix = params.mix ?? 0.5;
  const out = new Float64Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const delayed = line[writeIndex];
    const x = input[i];
    const fed = x + feedback * delayed;
    line[writeIndex] = fed;
    out[i] = (1 - mix) * x + mix * delayed;
    writeIndex = (writeIndex + 1) % delaySamples;
  }
  return out;
}

export interface AllpassParams {
  kind: 'allpass-delay';
  delayMs: number;
  feedback: number; // typically ~0.5-0.7
}

/** The Schroeder allpass diffuser (distinct from the RBJ biquad allpass
 * above, which is a filter-shape allpass; this is the delay-based allpass
 * reverb primitive). */
export function renderAllpassDelay(input: Float64Array, sampleRate: number, params: AllpassParams): Float64Array {
  const delaySamples = Math.max(1, Math.round((params.delayMs / 1000) * sampleRate));
  const line = new Float64Array(delaySamples);
  let writeIndex = 0;
  const g = Math.max(-0.999, Math.min(0.999, params.feedback));
  const out = new Float64Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const delayed = line[writeIndex];
    const x = input[i];
    const w = x + g * delayed;
    out[i] = -g * w + delayed;
    line[writeIndex] = w;
    writeIndex = (writeIndex + 1) % delaySamples;
  }
  return out;
}

export interface ResonatorParams {
  kind: 'resonator';
  /** Hz. */
  freq: number;
  /** Seconds to decay 60 dB, the modal-synthesis convention (van den Doel
   * & Pai). */
  t60: number;
}

/** A single damped resonant mode: a two-pole filter placed directly from
 * its physical parameters (frequency, T60) rather than from a Q, which is
 * how modal synthesis papers (van den Doel & Pai, "The Sounds of Physical
 * Shapes") specify a mode. Pole radius r = exp(ln(0.001) / (T60 * fs))
 * makes the impulse response's envelope cross -60 dB at exactly T60. */
export function renderResonator(input: Float64Array, sampleRate: number, params: ResonatorParams): Float64Array {
  const omega = 2 * PI * Math.min(sampleRate * 0.49, Math.max(1, params.freq)) / sampleRate;
  const t60 = Math.max(0.001, params.t60);
  const r = exp(log(0.001) / (t60 * sampleRate));
  const a1 = -2 * r * cos(omega);
  const a2 = r * r;
  // Normalize so the resonator's peak gain near `freq` is close to unity
  // (a two-pole resonator excited by an impulse has gain roughly
  // (1 - r^2) at resonance for this direct-form).
  const gain = 1 - r * r;
  const out = new Float64Array(input.length);
  let y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const y0 = gain * input[i] - a1 * y1 - a2 * y2;
    out[i] = y0;
    y2 = y1; y1 = y0;
  }
  return out;
}
