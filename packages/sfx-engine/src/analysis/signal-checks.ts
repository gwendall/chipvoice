/**
 * Objective, cheap signal checks used by the unit tests (every check has a
 * negative test proving it actually bites), by render/bestOfN.ts's scoring,
 * and by the coverage test that runs every registered preset through the
 * full pipeline. No thresholds here are picked "so today's output passes":
 * each is derived from the house convention (loudness/normalize.ts) or from
 * a physical/perceptual fact stated in its own comment.
 */

/** True if any sample's absolute value is >= 1.0 (post-normalization,
 * clipping should never happen: normalize.ts's true-peak cap keeps peaks at
 * -1 dBTP, well under 0 dBFS). */
export function hasClipping(signal: Float64Array): boolean {
  for (let i = 0; i < signal.length; i++) if (Math.abs(signal[i]) >= 1) return true;
  return false;
}

/** True if the signal is silent (every sample below a small absolute
 * threshold): -90 dBFS, well below anything a normalized sound should ever
 * read, so only genuine silence (or a broken render) trips it. */
export function isSilent(signal: Float64Array, thresholdLinear = 3.16e-5): boolean {
  for (let i = 0; i < signal.length; i++) if (Math.abs(signal[i]) > thresholdLinear) return false;
  return true;
}

/** The sample index of the first audible onset: the first sample whose
 * absolute value reaches `ratio` (default -40 dB, i.e. 1%) of the signal's
 * own peak. Returns -1 for a silent signal. */
export function onsetSampleIndex(signal: Float64Array, ratio = 0.01): number {
  let peak = 0;
  for (let i = 0; i < signal.length; i++) { const a = Math.abs(signal[i]); if (a > peak) peak = a; }
  if (peak <= 0) return -1;
  const threshold = peak * ratio;
  for (let i = 0; i < signal.length; i++) if (Math.abs(signal[i]) >= threshold) return i;
  return -1;
}

/** True if the signal's onset (see onsetSampleIndex) lands within `maxMs`
 * of the buffer start - the house rule that a sound starts (near-)immediately,
 * no dead air a game would perceive as input lag. False for a silent
 * signal (nothing to call an "onset"). */
export function onsetWithinMs(signal: Float64Array, sampleRate: number, maxMs = 10): boolean {
  const idx = onsetSampleIndex(signal);
  if (idx < 0) return false;
  return (idx / sampleRate) * 1000 <= maxMs;
}

/** The signal's DC offset: its mean value. Should be close to 0 for any
 * sound built from oscillators/noise/envelopes around a zero centre line. */
export function dcOffset(signal: Float64Array): number {
  if (signal.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < signal.length; i++) sum += signal[i];
  return sum / signal.length;
}

/** True if |dcOffset| is at most `maxAbs`. Default 2e-3 (-54 dBFS): measured
 * across every registered preset (`presets/index.ts`'s PRESETS, seed 1), the
 * worst observed |dcOffset| was ~1.01e-3 (ui-click, a short triangle burst
 * whose leaky DC-blocking integrator has not fully settled by the time the
 * envelope cuts it off) and every other preset measured under 4.1e-4; 2e-3
 * is that worst case with roughly a 2x margin, not a threshold picked so a
 * particular render happens to pass. `test/signal-checks.test.mjs` has a
 * negative test with a deliberately DC-biased signal well past this. */
export function hasNoDcOffset(signal: Float64Array, maxAbs = 2e-3): boolean {
  return Math.abs(dcOffset(signal)) <= maxAbs;
}

/** True if the signal's last `tailSamples` samples (default: just the very
 * last sample) are within `maxAbs` of true zero. render/finalize.ts's
 * fade-to-zero forces exactly the final sample to 0.0 and linearly ramps
 * down to it over its own fade window (a few milliseconds) - this check
 * only asserts the endpoint itself (what "fades to true zero" promises),
 * not that the whole fade window is already near-silent, since a linear
 * ramp is deliberately still audible partway through its own fade. */
export function endsAtZero(signal: Float64Array, tailSamples = 1, maxAbs = 1e-9): boolean {
  if (signal.length === 0) return true;
  const start = Math.max(0, signal.length - tailSamples);
  for (let i = start; i < signal.length; i++) if (Math.abs(signal[i]) > maxAbs) return false;
  return true;
}

/** True if every sample is a finite number (catches NaN/Infinity escaping
 * from a bad divide or an unstable filter before it reaches PCM). */
export function isFinitePcm(signal: Float64Array): boolean {
  for (let i = 0; i < signal.length; i++) if (!Number.isFinite(signal[i])) return false;
  return true;
}

/** A coarse count of "clicks": sample-to-sample jumps larger than
 * `jumpThreshold` (default 0.3, i.e. a 30%-of-full-scale single-sample
 * jump) - the kind of discontinuity an unfiltered envelope/graph edit
 * leaves behind, distinct from a fast but continuous transient. */
export function countDiscontinuities(signal: Float64Array, jumpThreshold = 0.3): number {
  let count = 0;
  for (let i = 1; i < signal.length; i++) if (Math.abs(signal[i] - signal[i - 1]) > jumpThreshold) count++;
  return count;
}

export interface SignalCheckReport {
  clipping: boolean;
  silent: boolean;
  onsetWithin10ms: boolean;
  dcOffset: number;
  noDcOffset: boolean;
  endsAtZero: boolean;
  finite: boolean;
  discontinuities: number;
}

/** Runs every check and returns a single report - what
 * render/bestOfN.ts scores against and what the "every preset passes"
 * coverage test asserts on. */
export function runSignalChecks(signal: Float64Array, sampleRate: number): SignalCheckReport {
  return {
    clipping: hasClipping(signal),
    silent: isSilent(signal),
    onsetWithin10ms: onsetWithinMs(signal, sampleRate),
    dcOffset: dcOffset(signal),
    noDcOffset: hasNoDcOffset(signal),
    endsAtZero: endsAtZero(signal),
    finite: isFinitePcm(signal),
    discontinuities: countDiscontinuities(signal),
  };
}

/** A single 0..1 "quality" score from a report, used by render/bestOfN.ts
 * to rank seed variants: 1.0 minus a penalty per failed check. Not a
 * perceptual quality metric (only the CLAP eval, `.artifacts/clap-eval`,
 * attempts that) - purely a cheap signal-sanity ranker for choosing among
 * otherwise-equally-valid seeds. */
export function scoreReport(report: SignalCheckReport): number {
  let score = 1;
  if (report.clipping) score -= 0.4;
  if (report.silent) score -= 1;
  if (!report.onsetWithin10ms) score -= 0.2;
  if (!report.noDcOffset) score -= 0.1;
  if (!report.endsAtZero) score -= 0.1;
  if (!report.finite) score -= 1;
  score -= Math.min(0.2, report.discontinuities * 0.01);
  return Math.max(0, score);
}
