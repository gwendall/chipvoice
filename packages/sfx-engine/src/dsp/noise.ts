/**
 * Noise generators, all driven by the seeded PRNG (rng/prng.ts) so a recipe
 * plus seed is reproducible. Colours other than white are shaped from the
 * same white stream, never a second, independent source, so a seed's noise
 * content stays coupled across colours (documented, not relied on by any
 * preset).
 */
import type { Prng } from '../rng/prng.js';

export type NoiseColor = 'white' | 'pink' | 'brown' | 'velvet';

export interface NoiseParams {
  color: NoiseColor;
  /** velvet only: impulses per second. Default 2000 (a dense, "hiss-like"
   * velvet noise; Karplus-Strong-style excitations often want it sparser). */
  density?: number;
}

/** White noise: PRNG samples mapped from [0,1) to [-1,1). */
function renderWhite(length: number, rng: Prng): Float64Array {
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) out[i] = rng.next() * 2 - 1;
  return out;
}

/**
 * Pink noise (-3 dB/octave): the Paul Kellet "economy" three-stage IIR
 * approximation (public-domain, widely circulated on musicdsp.org), driven
 * by this module's own white generator. Roughly +-1 dB accurate across the
 * audio band, which is the accuracy the reference itself claims.
 */
function renderPink(length: number, rng: Prng): Float64Array {
  const white = renderWhite(length, rng);
  const out = new Float64Array(length);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < length; i++) {
    const w = white[i];
    b0 = 0.99765 * b0 + w * 0.0990460;
    b1 = 0.96300 * b1 + w * 0.2965164;
    b2 = 0.57000 * b2 + w * 1.0526913;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return out;
}

/**
 * Brown/red noise (-6 dB/octave): integrated white noise through a leaky
 * one-pole (the leak prevents the random walk from drifting outside
 * [-1, 1] over a long render), normalized to the source's peak so the
 * result stays comparable in level to the other colours.
 */
function renderBrown(length: number, rng: Prng): Float64Array {
  const white = renderWhite(length, rng);
  const out = new Float64Array(length);
  let acc = 0;
  let peak = 1e-9;
  const leak = 0.02;
  for (let i = 0; i < length; i++) {
    acc = acc * (1 - leak) + white[i] * leak;
    out[i] = acc;
    const a = Math.abs(acc);
    if (a > peak) peak = a;
  }
  const gain = 1 / peak;
  for (let i = 0; i < length; i++) out[i] *= gain;
  return out;
}

/**
 * Velvet noise: sparse unit impulses (+1 or -1) at PRNG-jittered intervals
 * averaging `density` per second, zero elsewhere. Used as a low-colouration
 * excitation for modal/Karplus-Strong models (Karjalainen & Valimaki-style
 * velvet-noise excitation) and PhISEM's individual grains, following
 * Perry Cook and Julius O. Smith's overview of stochastic excitation
 * signals in physical modelling synthesis.
 */
function renderVelvet(length: number, rng: Prng, impulsesPerSample: number): Float64Array {
  const out = new Float64Array(length);
  if (impulsesPerSample <= 0) return out;
  const avgSpacing = 1 / impulsesPerSample; // samples between impulses, on average
  let i = 0;
  while (i < length) {
    out[i] = rng.next() < 0.5 ? -1 : 1;
    const jitter = 0.5 + rng.next(); // 0.5x .. 1.5x the average spacing
    i += Math.max(1, Math.round(avgSpacing * jitter));
  }
  return out;
}

/** `params.density` is impulses per second (velvet only); converted here to
 * impulses per sample using `sampleRate`. */
export function renderNoise(length: number, sampleRate: number, params: NoiseParams, rng: Prng): Float64Array {
  switch (params.color) {
    case 'white': return renderWhite(length, rng);
    case 'pink': return renderPink(length, rng);
    case 'brown': return renderBrown(length, rng);
    case 'velvet': return renderVelvet(length, rng, (params.density ?? 2000) / sampleRate);
  }
}
