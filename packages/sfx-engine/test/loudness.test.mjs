import { test } from "node:test";
import assert from "node:assert/strict";
import { kWeightingCoefficients } from "../dist/loudness/kweight.js";
import { momentaryLoudnessMax, integratedLoudness, measureBlocks } from "../dist/loudness/loudness.js";
import { truePeakDb, truePeakLinear } from "../dist/loudness/truepeak.js";
import { normalizeLoudness, TARGET_MOMENTARY_LUFS, TARGET_TRUE_PEAK_DB } from "../dist/loudness/normalize.js";

const SR = 48000;

function sine(freq, amplitude, seconds, sampleRate = SR) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

test("K-weighting coefficients at 48kHz reproduce ITU-R BS.1770-4 Annex 1's own published values", () => {
  // These are ITU's own published 48kHz coefficients (Annex 1), copied
  // verbatim from the spec, not re-derived - the point of this test is
  // that this package's own bilinear-transform derivation (built for both
  // 44100 and 48000 Hz, since Annex 1 only publishes 48000) reproduces
  // them independently.
  const expected = {
    shelf: { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 },
    highpass: { b0: 1, b1: -2, b2: 1, a1: -1.99004745483398, a2: 0.99007225036621 },
  };
  const got = kWeightingCoefficients(48000);
  for (const stage of ["shelf", "highpass"]) {
    for (const k of ["b0", "b1", "b2", "a1", "a2"]) {
      const diff = Math.abs(got[stage][k] - expected[stage][k]);
      assert.ok(diff < 1e-9, `${stage}.${k}: |${got[stage][k]} - ${expected[stage][k]}| = ${diff} >= 1e-9`);
    }
  }
});

test("K-weighting coefficients are also produced (and stable) at 44100Hz, the schema's other allowed rate", () => {
  const got = kWeightingCoefficients(44100);
  for (const stage of ["shelf", "highpass"]) {
    for (const k of ["b0", "b1", "b2", "a1", "a2"]) {
      assert.ok(Number.isFinite(got[stage][k]), `${stage}.${k} at 44100Hz is not finite`);
    }
  }
  // A negative test: 44100Hz coefficients must differ from 48000Hz's (a
  // filter that ignored sampleRate entirely would fail this).
  const at48k = kWeightingCoefficients(48000);
  assert.notEqual(got.shelf.a1, at48k.shelf.a1);
});

test("a full-scale 1kHz sine reads close to the well-known ~-3.0 LUFS reference point", () => {
  // The standard mental-model calibration check every BS.1770 loudness
  // meter agrees on: a 0 dBFS, 1 kHz sine wave reads approximately -3.0
  // LUFS (not the naively-expected -3.01 dBFS RMS -0.691 = -3.70, because
  // K-weighting's head-effects shelf already has partial gain at 1kHz,
  // below its ~1.68kHz corner). 0.3 LU of tolerance covers the specific
  // shelf-gain-at-1kHz detail without pinning an unpublished digit.
  const signal = sine(1000, 1.0, 1.0);
  const momentary = momentaryLoudnessMax(signal, SR);
  const integrated = integratedLoudness(signal, SR);
  assert.ok(Math.abs(momentary - -3.0) < 0.3, `momentary ${momentary} LUFS too far from -3.0`);
  assert.ok(Math.abs(integrated - -3.0) < 0.3, `integrated ${integrated} LUFS too far from -3.0`);
  // Momentary and integrated should closely agree for a steady tone.
  assert.ok(Math.abs(momentary - integrated) < 0.05, "steady tone: momentary and integrated should nearly match");
});

test("halving amplitude (-6.0206 dB) shifts momentary loudness by very close to -6.0206 LU", () => {
  const full = sine(1000, 1.0, 1.0);
  const half = sine(1000, 0.5, 1.0);
  const delta = momentaryLoudnessMax(half, SR) - momentaryLoudnessMax(full, SR);
  assert.ok(Math.abs(delta - -6.0206) < 0.01, `delta ${delta} LU, expected ~-6.0206 LU (20*log10(0.5))`);
});

test("measureBlocks: a signal shorter than 400ms falls back to a single whole-signal block", () => {
  const short = sine(1000, 0.5, 0.05); // 50ms, well under the 400ms block
  const blocks = measureBlocks(short, SR);
  assert.equal(blocks.length, 1, "a sub-block-length signal should produce exactly one block");
  assert.equal(blocks[0].timeSeconds, 0);
});

test("measureBlocks: a signal longer than 400ms produces multiple 100ms-hop blocks", () => {
  const long = sine(1000, 0.5, 1.0); // 1 second
  const blocks = measureBlocks(long, SR);
  assert.ok(blocks.length > 1, "a 1-second signal should produce more than one block");
  // 75% overlap: block N's start should be 100ms after block N-1's.
  assert.ok(Math.abs(blocks[1].timeSeconds - blocks[0].timeSeconds - 0.1) < 1e-9);
});

test("integratedLoudness returns -Infinity for true silence, with no crash", () => {
  const silence = new Float64Array(4800);
  assert.equal(integratedLoudness(silence, SR), -Infinity);
  assert.equal(momentaryLoudnessMax(silence, SR), -Infinity);
});

test("integratedLoudness's two-stage gate excludes a much-quieter tail from the loud majority's average", () => {
  // A loud 1kHz tone for 1s, then a much quieter 1kHz tone for another 1s.
  // The quiet tail sits below (loud mean - 10 LU), so the relative gate
  // should drop it. Measured: loud-only=-3.00 LUFS, quiet-only=-29.02
  // LUFS, combined(gated)=-3.71 LUFS - within ~0.7 LU of the loud-only
  // reading (a handful of blocks straddling the loud/quiet boundary carry
  // partial power from both and survive the relative gate, pulling the
  // average down slightly) but nowhere near the quiet-only reading. An
  // ungated (simple, non-power-weighted) average of -3.00 and -29.02 would
  // land near -16 LUFS, so "close to loud-only" is a meaningful,
  // gate-specific claim, not a coincidence of the tolerance chosen.
  const loud = sine(1000, 1.0, 1.0);
  const quiet = sine(1000, 0.05, 1.0); // ~-26 dB quieter, well past the 10 LU relative gate
  const combined = new Float64Array(loud.length + quiet.length);
  combined.set(loud, 0);
  combined.set(quiet, loud.length);
  const loudOnly = integratedLoudness(loud, SR);
  const quietOnly = integratedLoudness(quiet, SR);
  const combinedIntegrated = integratedLoudness(combined, SR);
  assert.ok(Math.abs(combinedIntegrated - loudOnly) < 1.0, `gated integrated (${combinedIntegrated}) should stay close to the loud-only reading (${loudOnly})`);
  assert.ok(Math.abs(combinedIntegrated - quietOnly) > 15, `gated integrated (${combinedIntegrated}) should stay far from the gated-out quiet-only reading (${quietOnly})`);
});

test("true peak of a full-scale sine sampled on-grid reads ~0 dBTP (no inter-sample peak beyond the sample itself)", () => {
  const signal = sine(1000, 1.0, 0.1);
  assert.ok(Math.abs(truePeakDb(signal)) < 0.05, `expected ~0 dBTP, got ${truePeakDb(signal)}`);
});

test("true peak catches an inter-sample peak that the raw sample peak misses", () => {
  // A high, off-grid frequency puts real energy between sample instants;
  // the 4x-oversampled reconstruction should read higher than the raw
  // per-sample peak.
  const trickyFreq = SR / 4 + 137;
  const signal = sine(trickyFreq, 1.0, 0.05);
  let samplePeak = 0;
  for (const s of signal) samplePeak = Math.max(samplePeak, Math.abs(s));
  const oversampledPeak = truePeakLinear(signal);
  assert.ok(oversampledPeak > samplePeak, `oversampled peak ${oversampledPeak} should exceed the raw sample peak ${samplePeak}`);
  assert.ok(truePeakDb(signal) > 0, "this specific off-grid tone should read a positive (over 0 dBFS) true-peak dB");
});

test("truePeakDb returns -Infinity for true silence", () => {
  assert.equal(truePeakDb(new Float64Array(100)), -Infinity);
});

test("normalizeLoudness: a low-crest-factor (sine) quiet signal is loudness-limited, landing exactly on the -18 LUFS target", () => {
  const quiet = sine(1000, 0.0316, 0.3); // ~-30 dBFS amplitude
  const result = normalizeLoudness(quiet, SR);
  assert.equal(result.cappedByPeak, false, "a sine has enough headroom that the loudness target, not the peak cap, should govern");
  assert.ok(Math.abs(result.momentaryLufsAfter - TARGET_MOMENTARY_LUFS) < 0.05, `momentary after (${result.momentaryLufsAfter}) should land on the -18 LUFS target`);
  assert.ok(result.truePeakDbAfter < TARGET_TRUE_PEAK_DB, "true peak after must still respect the -1 dBTP ceiling");
});

test("normalizeLoudness: a high-crest-factor (impulsive) signal is peak-limited, never reaching the loudness target", () => {
  const impulsive = new Float64Array(Math.round(0.2 * SR));
  for (let i = 0; i < impulsive.length; i++) impulsive[i] = 0.01 * Math.sin((2 * Math.PI * 300 * i) / SR);
  impulsive[1000] = 0.9; // one sharp spike among a quiet bed
  const result = normalizeLoudness(impulsive, SR);
  assert.equal(result.cappedByPeak, true, "an impulsive signal's peak should cap the gain before loudness reaches -18 LUFS");
  assert.ok(Math.abs(result.truePeakDbAfter - TARGET_TRUE_PEAK_DB) < 0.02, `true peak after (${result.truePeakDbAfter}) should land on the -1 dBTP ceiling`);
  assert.ok(result.momentaryLufsAfter < TARGET_MOMENTARY_LUFS, "peak-capped: momentary loudness after must stay below the -18 LUFS target, not reach it");
});

test("normalizeLoudness: 'peak cap wins' means gainDb is always the smaller of the two candidate gains", () => {
  for (const [amplitude, seconds] of [[0.02, 0.3], [0.9, 0.05], [0.3, 0.5]]) {
    const signal = sine(700, amplitude, seconds);
    const result = normalizeLoudness(signal, SR);
    // Never overshoot either ceiling, regardless of which one governed.
    assert.ok(result.truePeakDbAfter <= TARGET_TRUE_PEAK_DB + 0.02, `truePeakDbAfter ${result.truePeakDbAfter} exceeds the -1 dBTP ceiling`);
    assert.ok(result.momentaryLufsAfter <= TARGET_MOMENTARY_LUFS + 0.02, `momentaryLufsAfter ${result.momentaryLufsAfter} exceeds the -18 LUFS target`);
  }
});

test("normalizeLoudness on true silence returns 0 gain and does not crash", () => {
  const silence = new Float64Array(2000);
  const result = normalizeLoudness(silence, SR);
  assert.equal(result.gainDb, 0);
  assert.equal(result.momentaryLufsBefore, -Infinity);
  assert.equal(result.momentaryLufsAfter, -Infinity);
  assert.equal(result.cappedByPeak, false);
});

test("loudness measurement is deterministic: identical input renders identical results", () => {
  const signal = sine(440, 0.4, 0.3);
  const a = normalizeLoudness(signal, SR);
  const b = normalizeLoudness(signal, SR);
  assert.equal(a.gainDb, b.gainDb);
  assert.equal(a.momentaryLufsAfter, b.momentaryLufsAfter);
  assert.deepEqual(Array.from(a.signal), Array.from(b.signal));
});
