/**
 * True peak (ITU-R BS.1770-4 Annex 2): inter-sample peaks can exceed the
 * sampled peak, so true-peak measurement 4x-oversamples the signal with a
 * lowpass interpolation filter and reports the oversampled reconstruction's
 * max |amplitude|.
 *
 * This is a windowed-sinc polyphase interpolator (Hann window, cutoff at
 * the original Nyquist), not ITU Annex 2's own published filter table (this
 * engine does not have that table memorized precisely enough to reproduce
 * bit-for-bit, and says so rather than guessing) - `scripts/ffmpeg-loudness-check.mjs`
 * cross-checks the measured difference against ffmpeg's `ebur128` filter
 * (which does implement Annex 2's filter) across every rendered preset, and
 * `docs/GAMESOUNDS-ENGINE.md` reports the observed agreement honestly as a
 * limitation, not a spec claim.
 *
 * Built entirely from dsp/math.ts's own sin/cos (the sinc kernel, the Hann
 * window), never `Math.sin`/`Math.cos`, so the filter design - not just the
 * per-sample application - is exact-per-engine.
 */
import { sin, cos, PI, log10 } from '../dsp/math.js';

const OVERSAMPLE = 4;
const HALF_TAPS = 16; // 33 taps total (odd, centred), a modest but adequate window.

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = PI * x;
  return sin(px) / px;
}

/** The 4x interpolation filter's taps, one polyphase set per oversample
 * phase (`OVERSAMPLE` phases of `2*HALF_TAPS+1` taps each), windowed-sinc,
 * cutoff at the original signal's Nyquist (so phase 0 - the original
 * samples themselves - passes through as an identity, and the other three
 * phases reconstruct the in-between values). Gain-normalized per phase so a
 * DC input's oversampled reconstruction stays at unit gain. */
function buildPolyphaseTaps(): number[][] {
  const span = HALF_TAPS;
  const phases: number[][] = [];
  for (let phase = 0; phase < OVERSAMPLE; phase++) {
    const taps: number[] = [];
    let sum = 0;
    for (let k = -span; k <= span; k++) {
      const t = k - phase / OVERSAMPLE;
      const w = 0.5 + 0.5 * cos((PI * t) / (span + 1)); // Hann-ish window over the tap's offset
      const windowed = Math.abs(t) <= span + 1 ? sinc(t) * w : 0;
      taps.push(windowed);
      sum += windowed;
    }
    const norm = sum !== 0 ? 1 / sum : 1;
    phases.push(taps.map((v) => v * norm));
  }
  return phases;
}

let cachedTaps: number[][] | null = null;
function taps(): number[][] {
  if (!cachedTaps) cachedTaps = buildPolyphaseTaps();
  return cachedTaps;
}

/** The max |amplitude| of the 4x-oversampled reconstruction (linear, not
 * dB). `truePeakDb` below converts to dBTP. */
export function truePeakLinear(signal: Float64Array): number {
  if (signal.length === 0) return 0;
  const phases = taps();
  const span = HALF_TAPS;
  let peak = 0;
  for (let i = 0; i < signal.length; i++) {
    for (let phase = 0; phase < OVERSAMPLE; phase++) {
      const t = phases[phase];
      let acc = 0;
      for (let k = -span; k <= span; k++) {
        const idx = i + k;
        if (idx < 0 || idx >= signal.length) continue;
        acc += signal[idx] * t[k + span];
      }
      const a = Math.abs(acc);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/** True peak in dBTP (20*log10(linear peak)); -Infinity for true silence.
 * Feeds directly into normalize.ts's gain decision, which changes every
 * output sample, so even this once-per-render scalar goes through our own
 * log10 (never `Math.log`/`Math.LN10`) to stay exact-per-engine. */
export function truePeakDb(signal: Float64Array): number {
  const peak = truePeakLinear(signal);
  if (peak <= 0) return -Infinity;
  return 20 * log10(peak);
}
