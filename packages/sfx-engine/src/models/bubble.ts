/**
 * The bubble model for liquid sounds, after Kees van den Doel, "Physically
 * based models for liquid sounds" (ACM Transactions on Applied Perception,
 * 2005), which is itself built on Marcel Minnaert's 1933 result ("On
 * musical air-bubbles and the sounds of running water") that a bubble of
 * radius r rings at approximately f0 = 3/r Hz (r in metres) as a lightly
 * damped, essentially single-mode oscillator - a resonating gas pocket, not
 * the surrounding liquid. A "liquid" sound (a pour, a bubbling pot, rain on
 * water) is, in van den Doel's model, many such bubbles born at random
 * times with a distribution of radii; this engine's `stream` mode is that
 * process, and `single` is one bubble on its own (a drip, a glug, a plink).
 *
 * This does not model the onset chirp some recordings show (a bubble's
 * frequency glides slightly as it detaches from its source) - documented
 * as a known simplification in docs/GAMESOUNDS-ENGINE.md, not modelled here.
 */
import type { Prng } from '../rng/prng.js';
import { exp, log, cos, PI } from '../dsp/math.js';

export interface BubbleParams {
  kind: 'single' | 'stream';
  /** Bubble radius in millimetres (single mode), or the centre of the
   * radius range (stream mode). Smaller rings higher. Default 4mm. */
  radiusMm?: number;
  /** Stream mode only: the radius range bubbles are drawn from,
   * millimetres. Default [2, 9]. */
  radiusRangeMm?: [number, number];
  /** Stream mode only: bubbles per second. Default 16. */
  rate?: number;
  /** 0..1: extra high-frequency loss (a murkier, duller liquid). Default
   * 0.3. */
  damping?: number;
}

/** Minnaert's resonance: f0 = 3 / r (r in metres). radiusMm is millimetres. */
function minnaertHz(radiusMm: number): number {
  const radiusMeters = Math.max(0.1, radiusMm) / 1000;
  return 3 / radiusMeters;
}

function addBubble(out: Float64Array, sampleRate: number, startSample: number, freqHz: number, t60Seconds: number, amplitude: number, durationSamples: number): void {
  const omega = (2 * PI * freqHz) / sampleRate;
  const r = exp(log(0.001) / (t60Seconds * sampleRate));
  const a1 = -2 * r * cos(omega);
  const a2 = r * r;
  const gain = (1 - r * r) * amplitude;
  let y1 = 0, y2 = 0;
  for (let i = 0; i < durationSamples; i++) {
    const idx = startSample + i;
    if (idx >= out.length) break;
    if (idx < 0) continue;
    const x = i === 0 ? gain : 0;
    const y0 = x - a1 * y1 - a2 * y2;
    out[idx] += y0;
    y2 = y1; y1 = y0;
  }
}

function bubbleT60(radiusMm: number, damping: number): number {
  const base = 0.025 * Math.sqrt(Math.max(0.5, radiusMm) / 4);
  return Math.max(0.004, base * (1 - damping * 0.7));
}

export function renderBubble(length: number, sampleRate: number, params: BubbleParams, rng: Prng): Float64Array {
  const damping = Math.max(0, Math.min(1, params.damping ?? 0.3));
  const out = new Float64Array(length);

  if (params.kind === 'single') {
    const radiusMm = params.radiusMm ?? 4;
    const freq = minnaertHz(radiusMm);
    const t60 = bubbleT60(radiusMm, damping);
    const durationSamples = Math.min(length, Math.round(t60 * sampleRate * 8));
    addBubble(out, sampleRate, 0, freq, t60, 0.95, durationSamples);
    return out;
  }

  const [minR, maxR] = params.radiusRangeMm ?? [2, 9];
  const rate = Math.max(0.1, params.rate ?? 16);
  const durationSeconds = length / sampleRate;
  let t = rng.range(0, 1 / rate);
  while (t < durationSeconds) {
    const radiusMm = rng.range(minR, maxR);
    const freq = minnaertHz(radiusMm);
    const t60 = bubbleT60(radiusMm, damping);
    const amplitude = 0.5 + rng.next() * 0.5;
    const startSample = Math.round(t * sampleRate);
    const durationSamples = Math.min(length - startSample, Math.round(t60 * sampleRate * 8));
    if (durationSamples > 0) addBubble(out, sampleRate, startSample, freq, t60, amplitude, durationSamples);
    // Poisson-ish inter-arrival: exponential distribution via the inverse
    // CDF, using our own log (never Math.log).
    const u = Math.max(1e-9, rng.next());
    t += -log(u) / rate;
  }

  let peak = 0;
  for (let i = 0; i < length; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  if (peak > 1e-9) { const g = 0.85 / peak; for (let i = 0; i < length; i++) out[i] *= g; }
  return out;
}
