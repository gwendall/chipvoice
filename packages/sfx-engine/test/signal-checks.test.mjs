import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasClipping, isSilent, onsetSampleIndex, onsetWithinMs, dcOffset, hasNoDcOffset,
  endsAtZero, isFinitePcm, countDiscontinuities, runSignalChecks, scoreReport,
} from "../dist/analysis/signal-checks.js";

// Every check below gets both a positive test (it passes a clean signal)
// and a negative test (it actually bites on a signal built to violate it) -
// the brief's explicit requirement for this file.

function silentBuffer(n) { return new Float64Array(n); }

test("hasClipping: false for anything under full scale, true at/above 1.0", () => {
  assert.equal(hasClipping(new Float64Array([0.1, -0.9, 0.9999])), false);
  assert.equal(hasClipping(new Float64Array([0.1, 1.0, 0.2])), true);
  assert.equal(hasClipping(new Float64Array([0.1, -1.0001, 0.2])), true);
});

test("isSilent: true for exact and near-zero silence, false once a sample exceeds the threshold", () => {
  assert.equal(isSilent(silentBuffer(100)), true);
  assert.equal(isSilent(new Float64Array([0, 1e-6, 0])), true, "well below the -90dBFS threshold");
  assert.equal(isSilent(new Float64Array([0, 0.01, 0])), false);
});

test("onsetSampleIndex / onsetWithinMs: finds the first sample reaching 1% of peak, -1 for silence", () => {
  const sr = 48000;
  const signal = new Float64Array(1000);
  for (let i = 200; i < 1000; i++) signal[i] = 0.8; // onset at sample 200
  assert.equal(onsetSampleIndex(signal), 200);
  assert.equal(onsetWithinMs(signal, sr, (200 / sr) * 1000 + 1), true);
  assert.equal(onsetWithinMs(signal, sr, (200 / sr) * 1000 - 1), false, "onset just past the requested max should fail");
  assert.equal(onsetSampleIndex(silentBuffer(1000)), -1);
  assert.equal(onsetWithinMs(silentBuffer(1000), sr), false, "a silent signal has no onset to be within any window");
});

test("dcOffset / hasNoDcOffset: reads the mean, and bites on a signal deliberately biased past the threshold", () => {
  assert.equal(dcOffset(new Float64Array([1, -1, 1, -1])), 0);
  const biased = new Float64Array(1000).fill(0.5);
  assert.equal(dcOffset(biased), 0.5);
  assert.equal(hasNoDcOffset(biased), false, "a constant 0.5 signal is nowhere near hasNoDcOffset's threshold");
  // 480Hz at 48000Hz is exactly a 100-sample period, so 1000 samples is
  // exactly 10 whole cycles - the sum cancels to float64 rounding noise
  // rather than leaving a partial-cycle DC bias behind.
  const clean = new Float64Array(1000);
  for (let i = 0; i < clean.length; i++) clean[i] = Math.sin((2 * Math.PI * 480 * i) / 48000);
  assert.equal(hasNoDcOffset(clean), true, "a zero-centred, whole-cycle sine has ~0 DC offset");
  // Negative test at the documented threshold boundary (default 2e-3).
  const justOver = new Float64Array(1000).fill(0.003);
  assert.equal(hasNoDcOffset(justOver), false);
  const justUnder = new Float64Array(1000).fill(0.001);
  assert.equal(hasNoDcOffset(justUnder), true);
});

test("endsAtZero: true only when the literal final sample(s) are at true zero", () => {
  const endsClean = new Float64Array([0.5, 0.3, 0.1, 0]);
  assert.equal(endsAtZero(endsClean), true);
  const endsNonZero = new Float64Array([0.5, 0.3, 0.1, 0.02]);
  assert.equal(endsAtZero(endsNonZero), false);
  // A linear fade ramp is deliberately still audible partway through its
  // own fade window - the default only checks the very last sample, not a
  // multi-sample tail, since that is what render/finalize.ts's fadeToZero
  // actually guarantees.
  const fadeRamp = new Float64Array([0.5, 0.375, 0.25, 0.125, 0]);
  assert.equal(endsAtZero(fadeRamp, 1), true, "only the literal last sample needs to be zero");
  assert.equal(endsAtZero(fadeRamp, 5, 1e-9), false, "the whole 5-sample ramp is not near-zero, only its endpoint is");
});

test("isFinitePcm: true for ordinary PCM, false once a NaN or Infinity appears", () => {
  assert.equal(isFinitePcm(new Float64Array([0.1, -0.2, 0])), true);
  const withNaN = new Float64Array([0.1, NaN, 0.2]);
  assert.equal(isFinitePcm(withNaN), false);
  const withInf = new Float64Array([0.1, Infinity, 0.2]);
  assert.equal(isFinitePcm(withInf), false);
});

test("countDiscontinuities: zero for a smooth signal, counts each jump past the threshold", () => {
  const smooth = new Float64Array(1000);
  for (let i = 0; i < smooth.length; i++) smooth[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / 48000);
  assert.equal(countDiscontinuities(smooth), 0);
  const withJumps = new Float64Array([0, 0.1, 0.9, -0.9, 0, 0.05]);
  // 0.1->0.9 (+0.8), 0.9->-0.9 (-1.8), -0.9->0 (+0.9): three jumps past 0.3.
  assert.equal(countDiscontinuities(withJumps), 3);
});

test("runSignalChecks: a well-formed signal passes every check", () => {
  const sr = 48000;
  const n = Math.round(0.1 * sr);
  const signal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const envelope = t < 0.05 ? t / 0.05 : 1 - (t - 0.05) / 0.95;
    signal[i] = envelope * 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
  }
  signal[n - 1] = 0; // literal final sample at true zero
  const report = runSignalChecks(signal, sr);
  assert.equal(report.clipping, false);
  assert.equal(report.silent, false);
  assert.equal(report.onsetWithin10ms, true);
  assert.equal(report.noDcOffset, true);
  assert.equal(report.endsAtZero, true);
  assert.equal(report.finite, true);
  assert.equal(scoreReport(report), 1, "a fully clean report should score a perfect 1.0");
});

test("runSignalChecks: a deliberately broken signal fails the checks it should, and scores below 1", () => {
  const sr = 48000;
  const broken = new Float64Array(1000).fill(0.5); // DC-biased, never reaches zero, no onset ramp issue but constant
  broken[500] = NaN;
  const report = runSignalChecks(broken, sr);
  assert.equal(report.finite, false);
  assert.equal(report.noDcOffset, false);
  assert.equal(report.endsAtZero, false);
  assert.ok(scoreReport(report) < 1, "a broken report must score below a perfect 1.0");
});

test("scoreReport: silence and non-finite are the two full-weight (1.0) penalties", () => {
  const silentReport = { clipping: false, silent: true, onsetWithin10ms: false, dcOffset: 0, noDcOffset: true, endsAtZero: true, finite: true, discontinuities: 0 };
  assert.equal(scoreReport(silentReport) <= 0.2, true, "silence should be scored very close to (or at) the floor");
  const nonFiniteReport = { clipping: false, silent: false, onsetWithin10ms: true, dcOffset: 0, noDcOffset: true, endsAtZero: true, finite: false, discontinuities: 0 };
  assert.equal(scoreReport(nonFiniteReport) <= 0.2, true, "non-finite PCM should be scored very close to (or at) the floor");
});

test("scoreReport never returns a negative score even when every check fails", () => {
  const worst = { clipping: true, silent: true, onsetWithin10ms: false, dcOffset: 1, noDcOffset: false, endsAtZero: false, finite: false, discontinuities: 1000 };
  assert.equal(scoreReport(worst), 0);
});
