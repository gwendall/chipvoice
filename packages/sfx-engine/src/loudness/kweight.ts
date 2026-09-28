/**
 * K-weighting (ITU-R BS.1770-4, section 2 and its Annex 1): two cascaded
 * biquads that model, first, the head's acoustic effect on incoming sound (a
 * high shelf, roughly +4 dB above ~1.7 kHz) and, second, the RLB
 * (Revised Low-frequency B-curve) weighting, a high-pass around 38 Hz that
 * de-emphasizes the low end the way perceived loudness does.
 *
 * ITU-R BS.1770-4 Annex 1 publishes exact z-domain coefficients, but only at
 * 48 kHz. This engine also supports 44100 Hz (the schema's other allowed
 * rate), so both filters are built here from their shelf/high-pass design
 * parameters (centre frequency, Q, and the shelf's gain) via the standard
 * bilinear-transform biquad design used by every open BS.1770 implementation
 * (e.g. libebur128, pyloudnorm - both permissively licensed; this is an
 * independent implementation of the documented design method, not a port of
 * either's code). `test/loudness.test.mjs` checks that, at 48000 Hz, this
 * derivation reproduces ITU's own published coefficients to within 1e-9,
 * which is the evidence that the general formula is correct rather than an
 * unverified guess.
 *
 * Every coefficient is computed from dsp/math.ts's own tan/pow (never
 * `Math.tan`/`Math.pow`), so the filter design itself - not just the
 * per-sample filtering - is exact-per-engine.
 */
import { tan, pow, PI } from '../dsp/math.js';

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** Stage 1: the "head effects" high shelf. Design parameters from ITU-R
 * BS.1770-4's own filter (reverse-engineered to design-parameter form by
 * every open implementation that needs a rate other than 48 kHz): centre
 * frequency ~1681.97 Hz, Q ~0.7072, shelf gain ~+3.99984 dB. */
function headEffectsShelf(sampleRate: number): Biquad {
  const fc = 1681.9744509555319;
  const q = 0.7071752369554193;
  const gainDb = 3.999843853973347;

  const k = tan((PI * fc) / sampleRate);
  const vh = pow(10, gainDb / 20);
  const vb = pow(vh, 0.4996667741545416);
  const k2 = k * k;
  const a0 = 1 + k / q + k2;

  return {
    b0: (vh + (vb * k) / q + k2) / a0,
    b1: (2 * (k2 - vh)) / a0,
    b2: (vh - (vb * k) / q + k2) / a0,
    a1: (2 * (k2 - 1)) / a0,
    a2: (1 - k / q + k2) / a0,
  };
}

/** Stage 2: the RLB high-pass. Centre frequency ~38.135 Hz, Q ~0.5003. */
function rlbHighpass(sampleRate: number): Biquad {
  const fc = 38.13547087613982;
  const q = 0.5003270373238773;

  const k = tan((PI * fc) / sampleRate);
  const k2 = k * k;
  const a0 = 1 + k / q + k2;

  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k2 - 1)) / a0,
    a2: (1 - k / q + k2) / a0,
  };
}

function applyBiquad(input: Float64Array, c: Biquad): Float64Array {
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

/** Exposed for `test/loudness.test.mjs`'s cross-check against ITU's
 * published 48 kHz coefficients. */
export function kWeightingCoefficients(sampleRate: number): { shelf: Biquad; highpass: Biquad } {
  return { shelf: headEffectsShelf(sampleRate), highpass: rlbHighpass(sampleRate) };
}

/** K-weights a mono signal: the head-effects shelf, then the RLB high-pass,
 * in that order (ITU-R BS.1770-4, Figure 1). */
export function kWeight(input: Float64Array, sampleRate: number): Float64Array {
  const { shelf, highpass } = kWeightingCoefficients(sampleRate);
  return applyBiquad(applyBiquad(input, shelf), highpass);
}
