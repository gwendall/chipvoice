/**
 * The house loudness convention: normalize toward -18 LUFS momentary, but
 * never let true peak exceed -1 dBTP - if hitting -18 LUFS would push the
 * true peak past -1 dBTP, back off further and accept a quieter momentary
 * reading instead ("peak cap wins"). A single linear gain is solved for and
 * applied to the whole render (no compression/limiting - these are short,
 * one-shot sounds, not sustained material where a static gain could still
 * clip on a transient it didn't measure).
 */
import { pow } from '../dsp/math.js';
import { momentaryLoudnessMax } from './loudness.js';
import { truePeakDb } from './truepeak.js';

export const TARGET_MOMENTARY_LUFS = -18;
export const TARGET_TRUE_PEAK_DB = -1;

export interface NormalizeResult {
  signal: Float64Array;
  gainDb: number;
  momentaryLufsBefore: number;
  momentaryLufsAfter: number;
  truePeakDbBefore: number;
  truePeakDbAfter: number;
  /** True when the true-peak ceiling, not the -18 LUFS target, determined
   * the applied gain. */
  cappedByPeak: boolean;
}

export function normalizeLoudness(signal: Float64Array, sampleRate: number): NormalizeResult {
  const momentaryBefore = momentaryLoudnessMax(signal, sampleRate);
  const peakBefore = truePeakDb(signal);

  if (!Number.isFinite(momentaryBefore)) {
    // Effectively silent: no meaningful gain to solve for.
    return {
      signal, gainDb: 0,
      momentaryLufsBefore: momentaryBefore, momentaryLufsAfter: momentaryBefore,
      truePeakDbBefore: peakBefore, truePeakDbAfter: peakBefore,
      cappedByPeak: false,
    };
  }

  const loudnessGainDb = TARGET_MOMENTARY_LUFS - momentaryBefore;
  const peakGainDb = Number.isFinite(peakBefore) ? TARGET_TRUE_PEAK_DB - peakBefore : Infinity;
  const gainDb = Math.min(loudnessGainDb, peakGainDb);
  const cappedByPeak = peakGainDb < loudnessGainDb;

  const gainLinear = pow(10, gainDb / 20);
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] * gainLinear;

  return {
    signal: out,
    gainDb,
    momentaryLufsBefore: momentaryBefore,
    momentaryLufsAfter: momentaryLoudnessMax(out, sampleRate),
    truePeakDbBefore: peakBefore,
    truePeakDbAfter: truePeakDb(out),
    cappedByPeak,
  };
}
