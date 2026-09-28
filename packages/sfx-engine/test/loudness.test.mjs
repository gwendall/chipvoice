import { test } from "node:test";
import assert from "node:assert/strict";
import { kWeightingCoefficients, kWeight } from "../dist/loudness/kweight.js";
import { momentaryLoudnessMax, integratedLoudness, measureBlocks } from "../dist/loudness/loudness.js";
import { truePeakDb, truePeakLinear } from "../dist/loudness/truepeak.js";
import { normalizeLoudness, TARGET_MOMENTARY_LUFS, TARGET_TRUE_PEAK_DB } from "../dist/loudness/normalize.js";

const SR = 48000;

function sine(freq, amplitude, seconds, sampleRate = SR, phaseDeg = 0) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float64Array(n);
  const phase = (phaseDeg * Math.PI) / 180;
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate + phase);
  return out;
}

function dbfsToAmplitude(dbfs) { return Math.pow(10, dbfs / 20); }

function concatSignals(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Float64Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

// --- Test-only reimplementations of loudness.ts's private block/gate logic,
// used ONLY by the two negative tests below (to prove the Tech 3341 cases
// actually exercise K-weighting and the relative gate, not just tautologically
// pass). Never exported by the package; deliberately duplicated rather than
// reused so the real loudness.ts is never modified to expose a "broken mode".
const BLOCK_SECONDS_LOCAL = 0.4, HOP_SECONDS_LOCAL = 0.1, ABSOLUTE_GATE_LUFS_LOCAL = -70, RELATIVE_GATE_OFFSET_LU_LOCAL = -10;
function meanSquareLocal(signal, start, length) {
  let sum = 0;
  for (let i = 0; i < length; i++) { const v = signal[start + i]; sum += v * v; }
  return sum / length;
}
function loudnessFromMeanSquareLocal(ms) {
  if (ms <= 0) return -Infinity;
  return -0.691 + 10 * Math.log10(ms);
}
function blockLufsOf(weighted, sampleRate) {
  const blockLen = Math.round(BLOCK_SECONDS_LOCAL * sampleRate);
  const hopLen = Math.round(HOP_SECONDS_LOCAL * sampleRate);
  const blocks = [];
  if (weighted.length <= blockLen) {
    if (weighted.length > 0) blocks.push(loudnessFromMeanSquareLocal(meanSquareLocal(weighted, 0, weighted.length)));
    return blocks;
  }
  for (let start = 0; start + blockLen <= weighted.length; start += hopLen) blocks.push(loudnessFromMeanSquareLocal(meanSquareLocal(weighted, start, blockLen)));
  return blocks;
}
function meanPowerOfLocal(lufsValues) {
  let sum = 0;
  for (const l of lufsValues) sum += Math.pow(10, (l + 0.691) / 10);
  return sum / lufsValues.length;
}
/** Test-only: the real gated-integration pipeline but with K-weighting
 * skipped entirely (raw signal fed straight to the block/gate stage). */
function integratedLoudnessNoWeighting(signal, sampleRate) {
  const lufsValues = blockLufsOf(signal, sampleRate).filter((l) => Number.isFinite(l));
  const passAbsolute = lufsValues.filter((l) => l > ABSOLUTE_GATE_LUFS_LOCAL);
  if (passAbsolute.length === 0) return -Infinity;
  const relativeThreshold = loudnessFromMeanSquareLocal(meanPowerOfLocal(passAbsolute)) + RELATIVE_GATE_OFFSET_LU_LOCAL;
  const passRelative = passAbsolute.filter((l) => l > relativeThreshold);
  const gated = passRelative.length > 0 ? passRelative : passAbsolute;
  return loudnessFromMeanSquareLocal(meanPowerOfLocal(gated));
}
/** Test-only: the real gated-integration pipeline (K-weighted) but with the
 * second, relative-gate stage skipped - absolute gate (-70 LUFS) only. */
function integratedLoudnessAbsoluteGateOnly(signal, sampleRate) {
  const weighted = kWeight(signal, sampleRate);
  const lufsValues = blockLufsOf(weighted, sampleRate).filter((l) => Number.isFinite(l));
  const passAbsolute = lufsValues.filter((l) => l > ABSOLUTE_GATE_LUFS_LOCAL);
  if (passAbsolute.length === 0) return -Infinity;
  return loudnessFromMeanSquareLocal(meanPowerOfLocal(passAbsolute));
}

// EBU Tech 3341, "Loudness metering: 'EBU Mode' metering to supplement EBU
// R128 loudness normalization", v4 (Geneva, November 2023), Table 1
// ("Minimum requirements test signals"), cases 1-5 and 15-19 below. Table 1's
// cases use STEREO signals (identical content on both channels, at a stated
// per-channel peak dBFS). This engine's loudness meter is mono only
// (loudness.ts: BS.1770's channel-weighted sum collapses to one term at
// weight 1.0 - see that file's own doc comment). For two bit-identical
// channels each at weight 1.0, BS.1770's power sum is exactly double a
// single channel's power at every block, so a stereo reading of the same
// waveform is always exactly 10*log10(2) = 3.0103 LU higher than the mono
// reading - a constant, exact shift derived straight from the formula
// itself (not an empirical fudge), so it carries the case's own +-0.1 LU
// tolerance forward unchanged. Expected values below are each case's
// published stereo figure minus 3.0103 LU.
const STEREO_TO_MONO_LU = 10 * Math.log10(2); // exactly 3.0103 LU

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

test("EBU Tech 3341 v4 Table 1, case 1: stereo 1kHz sine at -23.0dBFS reads M,I=-23.0+-0.1 LUFS; mono equivalent is -26.0103+-0.1 LUFS", () => {
  const signal = sine(1000, dbfsToAmplitude(-23), 1.0);
  const expected = -23.0 - STEREO_TO_MONO_LU;
  const momentary = momentaryLoudnessMax(signal, SR);
  const integrated = integratedLoudness(signal, SR);
  assert.ok(Math.abs(momentary - expected) < 0.1, `momentary ${momentary} LUFS, expected ${expected} +-0.1`);
  assert.ok(Math.abs(integrated - expected) < 0.1, `integrated ${integrated} LUFS, expected ${expected} +-0.1`);
});

test("EBU Tech 3341 v4 Table 1, case 2: as case 1 at -33.0dBFS; mono equivalent is -36.0103+-0.1 LUFS", () => {
  const signal = sine(1000, dbfsToAmplitude(-33), 1.0);
  const expected = -33.0 - STEREO_TO_MONO_LU;
  const momentary = momentaryLoudnessMax(signal, SR);
  const integrated = integratedLoudness(signal, SR);
  assert.ok(Math.abs(momentary - expected) < 0.1, `momentary ${momentary} LUFS, expected ${expected} +-0.1`);
  assert.ok(Math.abs(integrated - expected) < 0.1, `integrated ${integrated} LUFS, expected ${expected} +-0.1`);
});

test("a full-scale (0dBFS) 1kHz sine's loudness is pinned analytically from Tech 3341 case 1, not a rounded folklore number", () => {
  // BS.1770's formula, -0.691+10*log10(meanSquare(K-weighted signal)), is
  // linear in signal power, so scaling a steady 1kHz tone's amplitude by
  // +23dB (from -23.0dBFS to 0dBFS) scales its LUFS reading by exactly the
  // same +23dB (pure linear scaling of one steady tone crosses no gating
  // boundary). Case 1's stereo -23.0dBFS -> -23.0 LUFS therefore implies
  // stereo 0dBFS -> exactly 0.0 LUFS, and -3.0103 LU further for this
  // engine's mono meter (see STEREO_TO_MONO_LU above) = -3.0103 LUFS. This
  // replaces a previous version of this test that only asserted "close to
  // the well-known ~-3.0 LUFS" with +-0.3 LU of unpinned tolerance.
  const expected = 0.0 - STEREO_TO_MONO_LU;
  const signal = sine(1000, 1.0, 1.0);
  const momentary = momentaryLoudnessMax(signal, SR);
  const integrated = integratedLoudness(signal, SR);
  assert.ok(Math.abs(momentary - expected) < 0.1, `momentary ${momentary} LUFS too far from ${expected}`);
  assert.ok(Math.abs(integrated - expected) < 0.1, `integrated ${integrated} LUFS too far from ${expected}`);
  // Momentary and integrated should closely agree for a steady tone.
  assert.ok(Math.abs(momentary - integrated) < 0.05, "steady tone: momentary and integrated should nearly match");
});

test("EBU Tech 3341 v4 Table 1, case 3: 10s@-36/60s@-23/10s@-36dBFS gates the quiet fringes out; I=-23.0+-0.1 LUFS stereo -> -26.0103+-0.1 mono", () => {
  const signal = concatSignals([sine(1000, dbfsToAmplitude(-36), 10), sine(1000, dbfsToAmplitude(-23), 60), sine(1000, dbfsToAmplitude(-36), 10)]);
  const expected = -23.0 - STEREO_TO_MONO_LU;
  const integrated = integratedLoudness(signal, SR);
  assert.ok(Math.abs(integrated - expected) < 0.1, `integrated ${integrated} LUFS, expected ${expected} +-0.1`);
});

test("EBU Tech 3341 v4 Table 1, case 4: 10s@-72/10s@-36/60s@-23/10s@-36/10s@-72dBFS (absolute gate drops -72, relative gate drops -36); I=-26.0103+-0.1 mono", () => {
  const signal = concatSignals([
    sine(1000, dbfsToAmplitude(-72), 10),
    sine(1000, dbfsToAmplitude(-36), 10),
    sine(1000, dbfsToAmplitude(-23), 60),
    sine(1000, dbfsToAmplitude(-36), 10),
    sine(1000, dbfsToAmplitude(-72), 10),
  ]);
  const expected = -23.0 - STEREO_TO_MONO_LU;
  const integrated = integratedLoudness(signal, SR);
  assert.ok(Math.abs(integrated - expected) < 0.1, `integrated ${integrated} LUFS, expected ${expected} +-0.1`);
});

test("EBU Tech 3341 v4 Table 1, case 5: 20s@-26/20.1s@-20/20s@-26dBFS; I=-26.0103+-0.1 mono", () => {
  const signal = concatSignals([sine(1000, dbfsToAmplitude(-26), 20), sine(1000, dbfsToAmplitude(-20), 20.1), sine(1000, dbfsToAmplitude(-26), 20)]);
  const expected = -23.0 - STEREO_TO_MONO_LU;
  const integrated = integratedLoudness(signal, SR);
  assert.ok(Math.abs(integrated - expected) < 0.1, `integrated ${integrated} LUFS, expected ${expected} +-0.1`);
});

test("negative: bypassing K-weighting breaks Tech 3341 case 1's result (proves K-weighting is actually exercised, not a no-op)", () => {
  const signal = sine(1000, dbfsToAmplitude(-23), 1.0);
  const expected = -23.0 - STEREO_TO_MONO_LU;
  const broken = integratedLoudnessNoWeighting(signal, SR);
  assert.ok(Math.abs(broken - expected) > 0.1, `expected skipping K-weighting to miss case 1's +-0.1 LU tolerance, got ${broken} LUFS (diff ${Math.abs(broken - expected).toFixed(3)} LU)`);
});

test("negative: dropping the relative gate breaks Tech 3341 case 3's result (proves the two-stage gate is actually exercised, not a no-op)", () => {
  const signal = concatSignals([sine(1000, dbfsToAmplitude(-36), 10), sine(1000, dbfsToAmplitude(-23), 60), sine(1000, dbfsToAmplitude(-36), 10)]);
  const expected = -23.0 - STEREO_TO_MONO_LU;
  const broken = integratedLoudnessAbsoluteGateOnly(signal, SR);
  assert.ok(Math.abs(broken - expected) > 0.1, `expected dropping the relative gate to miss case 3's +-0.1 LU tolerance, got ${broken} LUFS (diff ${Math.abs(broken - expected).toFixed(3)} LU)`);
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

// EBU Tech 3341 v4 Table 1, cases 15-19: true-peak "minimum requirements"
// tests, each a stereo sine at a stated frequency/amplitude/phase, tapered
// with a 10ms fade-in/fade-out (per the table's own text for case 15,
// applied identically to 16-19 - without it, the true-peak interpolator's
// truncated filter window at the signal's hard-cut edges can itself become
// the reported global peak, which is an edge artifact of the *test
// fixture*, not of the filter's steady-state accuracy; the fade keeps the
// measured max in the steady, repeating part of the tone). True peak does
// not sum channels (BS.1770 Annex 2 takes the max across channels, it does
// not add their power), so with both stereo channels bit-identical, the
// mono and stereo readings are exactly equal - no STEREO_TO_MONO_LU-style
// shift applies here.
//
// Cases 20-23 are NOT implemented: they test one single, isolated period
// synthesized at 4x the working sample rate and then anti-alias-downsampled
// at four different sub-sample offsets - a much stricter, transient-specific
// probe of the exact interpolation kernel's impulse response than cases
// 15-19's steady tones. truepeak.ts's own doc comment already says this
// engine's 33-tap Hann-windowed-sinc interpolator is not ITU Annex 2's own
// published filter table, so it is not expected to reproduce that filter's
// exact transient response and cases 20-23 are left out rather than forced.
function truePeakTech3341Fixture(freq, amplitude, phaseDeg, sampleRate = SR) {
  const seconds = 0.05;
  const fadeSeconds = 0.01;
  const n = Math.round(seconds * sampleRate);
  const fadeSamples = Math.round(fadeSeconds * sampleRate);
  const out = new Float64Array(n);
  const phase = (phaseDeg * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    let gain = 1;
    if (i < fadeSamples) gain = i / fadeSamples;
    else if (i >= n - fadeSamples) gain = (n - 1 - i) / fadeSamples;
    out[i] = gain * amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate + phase);
  }
  return out;
}

test("EBU Tech 3341 v4 Table 1, case 15: fs/4 sine, 0.50FFS, phase 0deg reads -6.0 +0.2/-0.4 dBTP", () => {
  const db = truePeakDb(truePeakTech3341Fixture(SR / 4, 0.5, 0));
  assert.ok(db >= -6.4 && db <= -5.8, `case 15: got ${db} dBTP, expected [-6.4, -5.8]`);
});

test("EBU Tech 3341 v4 Table 1, case 16: fs/4 sine, 0.50FFS, phase 45deg reads -6.0 +0.2/-0.4 dBTP", () => {
  const db = truePeakDb(truePeakTech3341Fixture(SR / 4, 0.5, 45));
  assert.ok(db >= -6.4 && db <= -5.8, `case 16: got ${db} dBTP, expected [-6.4, -5.8]`);
});

test("EBU Tech 3341 v4 Table 1, case 17: fs/6 sine, 0.50FFS, phase 60deg reads -6.0 +0.2/-0.4 dBTP", () => {
  const db = truePeakDb(truePeakTech3341Fixture(SR / 6, 0.5, 60));
  assert.ok(db >= -6.4 && db <= -5.8, `case 17: got ${db} dBTP, expected [-6.4, -5.8]`);
});

test("EBU Tech 3341 v4 Table 1, case 18: fs/8 sine, 0.50FFS, phase 67.5deg reads -6.0 +0.2/-0.4 dBTP", () => {
  const db = truePeakDb(truePeakTech3341Fixture(SR / 8, 0.5, 67.5));
  assert.ok(db >= -6.4 && db <= -5.8, `case 18: got ${db} dBTP, expected [-6.4, -5.8]`);
});

test("EBU Tech 3341 v4 Table 1, case 19: fs/4 sine, 1.41FFS, phase 45deg reads +3.0 +0.2/-0.4 dBTP", () => {
  const db = truePeakDb(truePeakTech3341Fixture(SR / 4, 1.41, 45));
  assert.ok(db >= 2.6 && db <= 3.2, `case 19: got ${db} dBTP, expected [2.6, 3.2]`);
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
