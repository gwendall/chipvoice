// Tests for scripts/lib/audio.mjs. Two things this file is careful about,
// per the research-driven requirements for this build:
//
// 1. The loudness reference test measures a signal whose LUFS and true peak
//    were computed independently (by hand, from the signal's own known
//    amplitude - see the comment above REFERENCE below), not a signal this
//    build's own leveling code produced. The build is never its own oracle.
// 2. The trim test checks the actual output samples (first/last near zero,
//    no step at the seam), not just that the function ran.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeToRender,
  trimToZeroCrossing,
  measureLoudness,
  levelToConvention,
  measureLoopSeam,
  LOOP_SEAM_MAX_STEP,
  toWavBytes,
  LOUDNESS_TARGET_LUFS,
  TRUE_PEAK_CEILING_DBTP,
  encodeVariant,
  peakPerChannel,
  energyPerChannel,
  OGG_TAIL_GUARD_FRAMES,
} from "../scripts/lib/audio.mjs";
import { checkLeadingSilence, checkFormatEnergy, checkFormatEnergies, checkFormatLengths, FORMAT_ENERGY_TOLERANCE_DB } from "../scripts/lib/checks.mjs";
import { createHash } from "node:crypto";

// Whether this runner's ffmpeg has the native "experimental" vorbis encoder
// at all - used only by the standalone BITEXACT_ARGS regression fixture
// below (a real bug from before this build stopped using ffmpeg's own vorbis
// encoders at all - see docs/DECISIONS.md, decision 54), never by production
// code any more (GS-06/GS-07: every ogg is encoded with sox's libvorbis
// handler, on every machine, no fallback).
function nativeVorbisAvailable() {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { maxBuffer: 1024 * 1024 * 8 });
  return /^\s*[A-Za-z.]+\s+vorbis\s/m.test((result.stdout ?? "").toString());
}

// An 880 Hz, 0.4-linear-amplitude mono tone at `n` samples - the exact
// signal shape the reviewer's own bench used to measure the original (now
// corrected) GS-07 defect report, reused below for the sox encoder's own
// tests so results are comparable across both investigations.
function gs07ToneRender(n, sampleRate = 44100, amp = 0.4, freq = 880) {
  const left = new Float32Array(n);
  for (let i = 0; i < n; i++) left[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return { sampleRate, left, right: null, seconds: n / sampleRate, peak: amp };
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { maxBuffer: 1024 * 1024 * 64 });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${result.stderr}`);
  return result;
}

// A 1kHz sine at exactly 0.1 linear amplitude (aevalsrc takes an exact
// mathematical expression, not a filter with its own gain curve - lavfi's
// `sine` source was tried first and rejected for this precise reason: it
// defaults to a non-full-scale, undocumented amplitude that made the
// reference wrong by 18dB. See scripts/lib/audio.mjs's header for why this
// matters).
//
// REFERENCE (hand-derived, independent of this codebase):
//   amplitude 0.1 linear   = 20*log10(0.1)            = -20.0 dBFS true peak
//   a full-scale sine's integrated/momentary loudness is -3.01 LUFS
//   (BS.1770's K-weighted RMS of a full-scale 1kHz sine is a published
//   constant of the standard); at -20 dBFS that shifts linearly to
//   -20.0 + -3.01 ~= -23.0 LUFS.
// ffmpeg's own ebur128 (libebur128, an independent BS.1770 implementation)
// was run by hand against this exact signal during development and reported
// M: -23.0, TPK: -20.0 - matching the hand derivation above, not the other
// way around.
const REFERENCE_PEAK_DBTP = -20.0;
const REFERENCE_LUFS = -23.0;

let workDir;
function makeWorkDir() {
  workDir = mkdtempSync(join(tmpdir(), "gamesounds-audio-test-"));
  return workDir;
}

try {
  const dir = makeWorkDir();
  const sinePath = join(dir, "reference-sine.wav");
  run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.1*sin(2*PI*1000*t):s=44100:d=1", sinePath]);

  {
    const measured = measureLoudness(sinePath);
    assert.ok(
      Math.abs(measured.lufs - REFERENCE_LUFS) <= 0.3,
      `measured ${measured.lufs} LUFS should be within 0.3 LU of the independently-derived ${REFERENCE_LUFS} LUFS reference`,
    );
    assert.ok(
      Math.abs(measured.peakDb - REFERENCE_PEAK_DBTP) <= 0.3,
      `measured ${measured.peakDb} dBTP should be within 0.3 dB of the independently-derived ${REFERENCE_PEAK_DBTP} dBTP reference`,
    );
    console.log(`PASS measureLoudness matches an independently-derived reference signal (${measured.lufs} LUFS / ${measured.peakDb} dBTP)`);
  }

  {
    // decodeToRender must round-trip the same file to the same measurement,
    // proving the decode step itself introduces no gain error.
    const render = decodeToRender(sinePath, { sampleRate: 44100 });
    const roundTripPath = join(dir, "roundtrip.wav");
    writeFileSync(roundTripPath, toWavBytes(render));
    const measured = measureLoudness(roundTripPath);
    assert.ok(Math.abs(measured.lufs - REFERENCE_LUFS) <= 0.3, `decodeToRender round-trip LUFS ${measured.lufs} should match the reference`);
    console.log("PASS decodeToRender round-trips a file without introducing gain error");
  }

  {
    // A signal well above both the LUFS target and the peak ceiling must be
    // leveled down to right at the ceiling that binds - here, the peak
    // ceiling (a full-scale-ish sine is far over -18 LUFS AND far over
    // -1 dBTP; which one governs depends on the signal, so check both
    // directions with two different signals).
    const loud = decodeToRender(sinePath, { sampleRate: 44100 }); // -23 LUFS, -20 dBTP raw: quiet, so leveling UP
    const leveled = levelToConvention(loud);
    const leveledPath = join(dir, "leveled.wav");
    writeFileSync(leveledPath, toWavBytes(leveled));
    const measured = measureLoudness(leveledPath);
    // Raw is -23 LUFS / -20 dBTP. Gain-for-loudness = -18 - (-23) = +5dB.
    // Gain-for-peak = -1 - (-20) = +19dB. min(+5, +19) = +5dB: LUFS governs,
    // landing on target with peak well under the ceiling.
    assert.ok(Math.abs(measured.lufs - LOUDNESS_TARGET_LUFS) <= 0.3, `leveled LUFS ${measured.lufs} should land on the ${LOUDNESS_TARGET_LUFS} target when LUFS is the binding constraint`);
    assert.ok(measured.peakDb <= TRUE_PEAK_CEILING_DBTP + 0.3, `leveled peak ${measured.peakDb} must not exceed the ${TRUE_PEAK_CEILING_DBTP} dBTP ceiling`);
    assert.ok(Math.abs(leveled.appliedGainDb - 5) <= 0.3, `applied gain should be about +5dB (LUFS-bound), got ${leveled.appliedGainDb}`);
    console.log(`PASS levelToConvention levels a quiet signal up to the LUFS target (applied ${leveled.appliedGainDb}dB)`);
  }

  {
    // Now force the peak cap to be the binding constraint: an impulsive
    // signal whose crest factor is high has a much louder true peak, in dB,
    // relative to its momentary loudness than a sine does, so leveling it to
    // the LUFS target would push its peak over the ceiling - the peak cap
    // must win instead.
    const impulsePath = join(dir, "impulse.wav");
    // A single narrow full-scale-ish pulse per 20ms: high true peak, low
    // average/momentary loudness.
    run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "aevalsrc=if(lt(mod(t\\,0.02)\\,0.0005)\\,0.9\\,0):s=44100:d=1", impulsePath]);
    const raw = measureLoudness(impulsePath);
    const render = decodeToRender(impulsePath, { sampleRate: 44100 });
    const leveled = levelToConvention(render);
    const leveledPath = join(dir, "impulse-leveled.wav");
    writeFileSync(leveledPath, toWavBytes(leveled));
    const measured = measureLoudness(leveledPath);
    assert.ok(measured.peakDb <= TRUE_PEAK_CEILING_DBTP + 0.3, `peak-bound leveling must respect the ${TRUE_PEAK_CEILING_DBTP} dBTP ceiling, got ${measured.peakDb}`);
    // Confirm the peak really was the binding constraint for this fixture,
    // otherwise this test would not exercise the branch it claims to.
    const gainForLoudness = LOUDNESS_TARGET_LUFS - raw.lufs;
    const gainForPeak = TRUE_PEAK_CEILING_DBTP - raw.peakDb;
    assert.ok(gainForPeak < gainForLoudness, "this fixture must be peak-bound (gainForPeak < gainForLoudness) for the assertion above to mean anything");
    console.log(`PASS levelToConvention lets the true-peak ceiling win over the LUFS target when they conflict (raw ${raw.lufs} LUFS / ${raw.peakDb} dBTP -> leveled peak ${measured.peakDb} dBTP)`);
  }
} finally {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
}

{
  // Regression for a real bug: ffmpeg's ebur128 filter prints the per-frame
  // "TPK:" field as one number per channel on the same line (e.g.
  // "TPK:  -20.0  -0.9 dBFS" for a stereo file whose channels differ), and a
  // regex that captures only the first number after "TPK:" reads just the
  // left channel, silently discarding a louder right channel. Build a
  // stereo fixture with a quiet left channel (0.1 linear, -20 dBTP) and a
  // loud right channel (0.9 linear, about -0.9 dBTP): measureLoudness must
  // report the loud channel's peak, not the quiet one's.
  const dir = makeWorkDir();
  try {
    const stereoPath = join(dir, "asymmetric-stereo.wav");
    run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.1*sin(2*PI*1000*t)|0.9*sin(2*PI*1000*t):s=44100:d=1", stereoPath]);
    const measured = measureLoudness(stereoPath);
    assert.ok(
      measured.peakDb > -3,
      `measureLoudness must report the louder (right) channel's true peak for an asymmetric stereo file, got ${measured.peakDb} dBTP (a bug that reads only the first per-frame TPK number would wrongly report the quiet left channel's -20 dBTP)`,
    );
    console.log(`PASS measureLoudness reads the loudest channel's true peak, not just the first one printed (${measured.peakDb} dBTP)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  // Synthetic 50ms silence / 200ms 440Hz tone / 50ms silence at 44100Hz,
  // built to land the tone's zero crossings at predictable sample indices.
  const sampleRate = 44100;
  const silence = Math.round(sampleRate * 0.05);
  const toneLen = Math.round(sampleRate * 0.2);
  const total = silence * 2 + toneLen;
  const left = new Float32Array(total);
  for (let i = 0; i < toneLen; i++) {
    left[silence + i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  const render = { sampleRate, left, right: null, seconds: total / sampleRate, peak: 0.8 };
  const trimmed = trimToZeroCrossing(render, { floorDb: -60, fadeSeconds: 0.003 });

  assert.ok(trimmed.cutStart > 0 && trimmed.cutStart < silence + 200, `cutStart ${trimmed.cutStart} should land near the end of the leading silence (${silence}), not at 0 or deep into the tone`);
  assert.ok(trimmed.cutEnd > silence + toneLen - 200 && trimmed.cutEnd <= total, `cutEnd ${trimmed.cutEnd} should land near the start of the trailing silence (${silence + toneLen})`);
  assert.ok(trimmed.left[0] === 0, "the first output sample must be exactly 0 (fade-in reaches zero)"); // === (not Object.is) so -0 counts as 0: a negative sample times a zero fade gain is legitimately -0
  assert.ok(trimmed.left[trimmed.left.length - 1] === 0, "the last output sample must be exactly 0 (fade-out reaches zero)");

  // No step: the fade must be monotonic-ish near the edges, not a jump. Check
  // the very first and last few samples stay small (bounded by the fade
  // ramp), instead of jumping straight to the tone's mid-wave amplitude.
  const earlySample = Math.abs(trimmed.left[2]);
  assert.ok(earlySample < 0.8 * (3 / Math.round(sampleRate * 0.003)) + 0.05, `sample 2 (${earlySample}) should still be inside the fade ramp, not already at full tone amplitude`);
  console.log(`PASS trimToZeroCrossing cuts silence at a zero crossing and fades both ends to exactly 0 (cutStart=${trimmed.cutStart}, cutEnd=${trimmed.cutEnd})`);
}

{
  // A file with no silence to trim (tone fills the whole buffer) must still
  // produce a fade to 0 at both ends without throwing or collapsing to
  // near-zero length.
  const sampleRate = 44100;
  const n = Math.round(sampleRate * 0.1);
  const left = new Float32Array(n);
  for (let i = 0; i < n; i++) left[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  const render = { sampleRate, left, right: null, seconds: n / sampleRate, peak: 0.5 };
  const trimmed = trimToZeroCrossing(render, { floorDb: -60, fadeSeconds: 0.003 });
  assert.ok(trimmed.left[0] === 0, "a file with no leading silence still gets a fade-in to exactly 0");
  assert.ok(trimmed.left[trimmed.left.length - 1] === 0, "a file with no trailing silence still gets a fade-out to exactly 0");
  assert.ok(trimmed.left.length > n * 0.9, "trimming a file with no real silence should not discard most of the audio");
  console.log("PASS trimToZeroCrossing fades a wall-to-wall signal without discarding it");
}

{
  // Regression for a real bug: on a genuinely slow, gradual attack (a
  // sci-fi laser sweep, a spoken voice line), cutting exactly at the
  // detected onset and then fading in from there attenuates the very onset
  // the cut was supposed to preserve, since the fade ramp multiplies real,
  // just-above-floor content back down toward 0. checkLeadingSilence then
  // re-measures the shipped, already-faded audio and finds the onset has
  // moved later - sometimes past the 10ms budget - even though the trim
  // "correctly" found the onset in the original signal. Build a 30ms linear
  // ramp from 0 to full amplitude (a stand-in for a slow real attack) with
  // 40ms of true silence before it: the ramp's own floor crossing sits deep
  // enough into the ramp that a naive cut-at-onset-then-fade would push the
  // shipped onset well past 10ms.
  const sampleRate = 44100;
  const lead = Math.round(sampleRate * 0.04);
  const rampLen = Math.round(sampleRate * 0.03);
  const tail = Math.round(sampleRate * 0.05);
  const total = lead + rampLen + tail;
  const left = new Float32Array(total);
  for (let i = 0; i < rampLen; i++) left[lead + i] = (i / rampLen) * 0.8;
  for (let i = 0; i < tail; i++) left[lead + rampLen + i] = 0.8;
  const render = { sampleRate, left, right: null, seconds: total / sampleRate, peak: 0.8 };
  const trimmed = trimToZeroCrossing(render, { floorDb: -60, fadeSeconds: 0.003 });
  const leveled = levelToConvention(trimmed);
  const check = checkLeadingSilence(leveled.left, leveled.right, leveled.sampleRate, { maxMs: 10, floorDb: -60 });
  assert.ok(check.ok, `a slow-attack source must not ship with the fade-in reintroducing leading silence past the budget: ${check.reason ?? ""}`);
  console.log("PASS trimToZeroCrossing reserves fade headroom before a slow onset instead of fading over it");
}

{
  // Regression for a real bug: a render whose float peak sits just over 1.0
  // (a hot lossy source's own inter-sample overshoot surfacing on decode,
  // observed on a real Kenney file) must still be leveled to respect the
  // -1 dBTP ceiling. `toWavBytes` hard-clamps to +-1.0, so measuring the
  // *raw* signal through a naive "write a WAV, then measure it" path would
  // silently flat-top anything over 1.0 and under-read its true peak,
  // under-computing the gain needed and shipping the file over the ceiling
  // even though the code believed it had capped it - exactly what
  // `measureLoudnessOfRender` (used inside `levelToConvention`) exists to
  // avoid.
  const sampleRate = 44100;
  const n = Math.round(sampleRate * 0.05);
  const left = new Float32Array(n);
  for (let i = 0; i < n; i++) left[i] = 1.3 * Math.sin((2 * Math.PI * 3000 * i) / sampleRate);
  const render = { sampleRate, left, right: null, seconds: n / sampleRate, peak: 1.3 };
  assert.ok(Math.max(...left.map(Math.abs)) > 1, "fixture must actually exceed full scale for this test to mean anything");
  const leveled = levelToConvention(render);
  const dir = makeWorkDir();
  try {
    const shippedPath = join(dir, "over-scale-leveled.wav");
    writeFileSync(shippedPath, toWavBytes(leveled));
    const shipped = measureLoudness(shippedPath);
    assert.ok(shipped.peakDb <= TRUE_PEAK_CEILING_DBTP + 0.3, `a render whose raw float peak exceeds 1.0 must still ship at or under the ${TRUE_PEAK_CEILING_DBTP} dBTP ceiling once leveled, got ${shipped.peakDb}`);
    console.log(`PASS levelToConvention respects the true-peak ceiling even when the raw render's float peak exceeds full scale (shipped ${shipped.peakDb} dBTP)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  // A synthetic tone with an exact 100-sample period (frequency chosen so
  // the period is an integer number of samples, not a real-world pitch):
  // looping it at exactly one period must be seamless, looping it at any
  // other offset must not be.
  const sampleRate = 44100;
  const period = 100;
  const cycles = 20;
  const left = new Float32Array(period * cycles);
  for (let i = 0; i < left.length; i++) left[i] = Math.sin((2 * Math.PI * i) / period);
  const render = { sampleRate, left, right: null, seconds: left.length / sampleRate, peak: 1 };

  const clean = measureLoopSeam(render, 0, period);
  assert.ok(clean.valueStep < LOOP_SEAM_MAX_STEP, `a loop cut at exactly one period must have a near-zero value step, got ${clean.valueStep}`);
  assert.ok(clean.slopeStep < LOOP_SEAM_MAX_STEP, `a loop cut at exactly one period must have a near-zero slope step, got ${clean.slopeStep}`);
  console.log(`PASS measureLoopSeam reports a clean seam for a loop cut at an exact period (value ${clean.valueStep.toFixed(4)}, slope ${clean.slopeStep.toFixed(4)})`);

  const dirty = measureLoopSeam(render, 0, period + Math.floor(period / 4));
  assert.ok(dirty.valueStep >= LOOP_SEAM_MAX_STEP, `a loop cut a quarter-period off must fail the ${LOOP_SEAM_MAX_STEP} threshold, got ${dirty.valueStep}`);
  console.log(`PASS measureLoopSeam reports a dirty seam for a loop cut a quarter-period off (value ${dirty.valueStep.toFixed(4)})`);
}

if (!nativeVorbisAvailable()) {
  console.log("SKIP the pre-BITEXACT_ARGS ogg-serial regression fixture: this runner's ffmpeg has no native \"vorbis\" encoder at all (checked via `ffmpeg -encoders`) - the fixture calls it directly");
} else {
  // Regression record for a real bug a PR review caught: WITHOUT bitexact
  // flags, ffmpeg's ogg/vorbis muxer embeds a random stream serial number on
  // every encode, so re-encoding byte-identical audio (as a fresh
  // checkout's build inevitably does) produces a different SHA-256 every
  // run, even though nothing about the sound changed -
  // scripts/check-determinism.mjs exists to catch exactly this. This proves
  // the bug was real by calling the exact PRE-FIX ogg args directly (not
  // through encodeVariant, which no longer has an ffmpeg-based ogg path to
  // call at all since GS-06/GS-07 switched to sox) - a fixture, not a test
  // of current production code, kept so this regression stays provable even
  // though the code that caused it is long gone.
  const sampleRate = 44100;
  const n = Math.round(sampleRate * 0.2);
  const left = new Float32Array(n);
  for (let i = 0; i < n; i++) left[i] = 0.8 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  const dir = makeWorkDir();
  try {
    const wavPath = join(dir, "tone.wav");
    writeFileSync(wavPath, toWavBytes({ sampleRate, left, right: null, seconds: n / sampleRate, peak: 0.8 }));
    const hashOf = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
    const encodeOld = (label) => {
      const outPath = join(dir, `old-${label}.ogg`);
      run("ffmpeg", ["-y", "-v", "error", "-i", wavPath, "-ac", "2", "-c:a", "vorbis", "-strict", "-2", "-q:a", "5", outPath]);
      return hashOf(outPath);
    };
    const a = encodeOld("a");
    const b = encodeOld("b");
    assert.notEqual(a, b, "the pre-fix ogg args (no bitexact) must be non-deterministic across repeated encodes of the same input, proving BITEXACT_ARGS fixes a real bug");
    console.log("PASS regression record: the pre-fix ogg fallback args really do produce different bytes across repeated encodes of the same input");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  // Round-3 regression, all synthetic (no ffmpeg needed - the bug was in
  // energyPerChannel's own JS, not in any codec): a round-2 review's own
  // energy metric (mean-square, sum divided by sample count) got the
  // padding case backwards and failed 36 real, unaffected catalogue
  // variants before a round-3 review caught it. At the time, this repo's
  // dev-machine ffmpeg had no libvorbis, so its native vorbis encoder did
  // not trim the ogg's own end granule - a decoded ogg routinely came back
  // padded with trailing silence out to the next 1024-sample block
  // boundary. That machine-dependent encoder choice is gone since
  // GS-06/GS-07 switched every machine to sox's libvorbis handler, but the
  // regression this fixture guards (the energy metric's own padding-case
  // sign bug) is independent of which encoder produced the padding, so the
  // synthetic case is kept as-is. n=1029 and
  // padded=2048 below are combat-shoot-16bit-snes's own real numbers, the
  // shortest of the 36 round-3 failures.
  const sampleRate = 44100;
  const n = 1029;
  const padded = 2048;
  const short = new Float32Array(n);
  for (let i = 0; i < n; i++) short[i] = 0.4 * Math.sin((2 * Math.PI * 880 * i) / sampleRate);
  const withTrailingSilence = new Float32Array(padded); // zero-initialized; short's samples copied in below
  withTrailingSilence.set(short);

  const sourceEnergy = energyPerChannel(short, null);
  const paddedEnergy = energyPerChannel(withTrailingSilence, null);

  // (a) the fix itself: a signal padded with trailing silence must PASS -
  // total energy (the sum of each sample squared) cannot be moved by
  // appending zeros, so the padded "format" reading must land within
  // tolerance of the short "source" reading - exactly 0 dB apart, not just
  // "close enough".
  const passResult = checkFormatEnergy(sourceEnergy.left, paddedEnergy.left, { format: "ogg", channel: "left" });
  assert.equal(passResult.ok, true, `total energy must be unaffected by ${padded - n} samples of trailing-silence padding: ${passResult.reason ?? ""}`);
  console.log(`PASS energyPerChannel (total energy) is unaffected by trailing-silence padding (${n} samples padded to ${padded}) - checkFormatEnergy passes`);

  // (c) pure regression pin, so nobody reintroduces mean-square division by
  // accident: the OLD metric this file shipped first (removed - see
  // energyPerChannel's own header in audio.mjs for the full story)
  // reimplemented inline here, not imported, since the buggy version no
  // longer exists anywhere in this codebase. It must read close to -3 dB of
  // "loss" on exactly this padding shape even though not one real sample of
  // energy was lost - matching combat-shoot-16bit-snes's own real measured
  // -3.02 dB before the fix.
  const meanSquare = (samples) => samples.reduce((sum, s) => sum + s * s, 0) / samples.length;
  const oldBuggyDeltaDb = 10 * Math.log10(meanSquare(withTrailingSilence) / meanSquare(short));
  assert.ok(
    oldBuggyDeltaDb < -2.5 && oldBuggyDeltaDb > -3.5,
    `the old, removed mean-square metric must read close to -3 dB on this padding shape (got ${oldBuggyDeltaDb.toFixed(4)} dB)`,
  );
  console.log(
    `PASS regression pin: the old, removed mean-square metric would have read ${oldBuggyDeltaDb.toFixed(4)} dB on this exact padding shape ` +
      "(pure padding, zero real energy actually lost) - documents why energyPerChannel sums instead of averaging",
  );

  // (b) the fix must still catch a real bug even with padding sitting
  // alongside it: scale the padded signal by the old ogg fallback path's
  // exact `-ac 2` factor (1/sqrt(2)) and confirm checkFormatEnergy still
  // fails at very close to its exact -3.0103 dB signature, not masked (or
  // amplified) by the padding.
  const degraded = new Float32Array(padded);
  for (let i = 0; i < padded; i++) degraded[i] = withTrailingSilence[i] / Math.SQRT2;
  const degradedEnergy = energyPerChannel(degraded, null);
  const failResult = checkFormatEnergy(sourceEnergy.left, degradedEnergy.left, { format: "ogg", channel: "left" });
  assert.equal(failResult.ok, false, "a real -ac 2 style gain bug must still fail even on a padded signal");
  assert.match(failResult.reason, /-3\.0/, `the failure must still read close to the exact -3.0103 dB -ac 2 signature (reason: ${failResult.reason})`);
  console.log(
    "PASS a real -ac-2-style gain bug still fails at its exact -3.0103 dB signature even when trailing-silence padding is also present, " +
      "proving the fix does not mask a genuine regression",
  );
}

{
  // encodeVariant itself (the production path, both fixes together): the
  // same render encoded twice, in two separate output directories, must
  // ship byte-identical ogg and mp3 (BITEXACT_ARGS), and the shipped ogg's
  // own decoded ENERGY (per channel - checkFormatEnergies, the real gate now)
  // must land within tolerance of the source's energy, never the ~3dB-down
  // loudness the fallback path's old `-ac 2` upmix used to cause.
  const sampleRate = 44100;
  const n = Math.round(sampleRate * 0.25);
  const left = new Float32Array(n);
  for (let i = 0; i < n; i++) left[i] = 0.7 * Math.sin((2 * Math.PI * 523 * i) / sampleRate);
  const render = { sampleRate, left, right: null, seconds: n / sampleRate, peak: 0.7 };
  const dirA = mkdtempSync(join(tmpdir(), "gamesounds-encode-a-"));
  const dirB = mkdtempSync(join(tmpdir(), "gamesounds-encode-b-"));
  try {
    const a = encodeVariant(render, dirA, { mkdirSync });
    const b = encodeVariant(render, dirB, { mkdirSync });
    assert.equal(a.files.ogg.sha256, b.files.ogg.sha256, "encodeVariant's shipped ogg bytes must be identical across two encodes of the same render");
    assert.equal(a.files.mp3.sha256, b.files.mp3.sha256, "encodeVariant's shipped mp3 bytes must be identical across two encodes of the same render");
    console.log("PASS encodeVariant is deterministic: the same render encodes to byte-identical ogg and mp3 across two separate runs");

    const sourceEnergy = energyPerChannel(render.left, render.right);
    const energyCheck = checkFormatEnergies(sourceEnergy, a.formatEnergy);
    assert.ok(energyCheck.ok, `encodeVariant's own shipped ogg/mp3 must pass checkFormatEnergies: ${energyCheck.reason ?? ""}`);
    console.log(
      `PASS encodeVariant's shipped ogg and mp3 decode back within ${FORMAT_ENERGY_TOLERANCE_DB} dB of the wav's own energy per channel ` +
        `(source ${JSON.stringify(a.formatEnergy.source)}, ogg ${JSON.stringify(a.formatEnergy.ogg)}, mp3 ${JSON.stringify(a.formatEnergy.mp3)})`,
    );
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
}

{
  // Real-fixture regression for the round-2 review's HF-dominated-content
  // finding: a signal whose real energy sits mostly above ~16 kHz (a
  // near-Nyquist tone at this catalogue's 44.1 kHz encode rate) must
  // actually FAIL checkFormatEnergies through the real encodeVariant
  // production path - not just as an asserted number, but as the same
  // ffmpeg ogg/vorbis and libmp3lame encodes the catalogue ships. This is
  // the exact class of defect that got `pickup-key`, `impact-glass-light`
  // and `footstep-metal` excluded (build-catalog.mjs's EXCLUDED_PRESETS):
  // both encoders roll off well before Nyquist at this catalogue's quality
  // settings, so a signal that lives almost entirely up there loses real
  // energy through the encode, not just peak.
  const sampleRate = 44100;
  const n = Math.round(sampleRate * 0.3);
  const left = new Float32Array(n);
  for (let i = 0; i < n; i++) left[i] = 0.8 * Math.sin((2 * Math.PI * 20500 * i) / sampleRate);
  const render = { sampleRate, left, right: null, seconds: n / sampleRate, peak: 0.8 };
  const dir = mkdtempSync(join(tmpdir(), "gamesounds-hf-encode-"));
  try {
    const encoded = encodeVariant(render, dir, { mkdirSync });
    const sourceEnergy = energyPerChannel(render.left, render.right);
    const energyCheck = checkFormatEnergies(sourceEnergy, encoded.formatEnergy);
    assert.equal(energyCheck.ok, false, "a ~20.5kHz near-Nyquist tone must fail checkFormatEnergies through the real encodeVariant path, proving the HF-energy-loss finding in code, not just asserted numbers");
    console.log(
      `PASS a near-Nyquist (20.5kHz) tone fails checkFormatEnergies through the real encodeVariant path ` +
        `(source ${JSON.stringify(encoded.formatEnergy.source)}, ogg ${JSON.stringify(encoded.formatEnergy.ogg)}, mp3 ${JSON.stringify(encoded.formatEnergy.mp3)}) - ` +
        "the same class of defect that excluded pickup-key, impact-glass-light and footstep-metal",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- GS-06/GS-07: every ogg is encoded with sox's libvorbis handler, on ---
// --- every machine, with a fixed tail guard - no native fallback left   ---

{
  // sox and its vorbis handler are a hard requirement now: a machine
  // missing either must fail loudly and specifically, never silently fall
  // back or silently skip the ogg. `ensureSoxVorbis` (scripts/lib/audio.mjs)
  // caches its check for the lifetime of the process, and earlier tests in
  // this same file already exercise the real, sox-present production path -
  // so simulating "sox missing" has to happen in a FRESH process, not by
  // shrinking this process's own PATH after that cache is already warm.
  const dir = mkdtempSync(join(tmpdir(), "gamesounds-gs07-nosox-"));
  // An empty, freshly-made directory - never a hardcoded system path like
  // "/usr/bin:/bin" - is the only PATH restriction guaranteed to exclude sox
  // on every machine this suite runs on: a hardcoded path excludes sox on a
  // Homebrew Mac (sox lives under /opt/homebrew/bin there) but NOT on this
  // repo's own CI runner, where `apt-get install sox` puts the binary at
  // /usr/bin/sox - inside "/usr/bin:/bin" - which silently defeated this
  // exact test in CI (DID_NOT_THROW) without ever failing it locally.
  const emptyPathDir = mkdtempSync(join(tmpdir(), "gamesounds-gs07-emptypath-"));
  try {
    const audioModuleUrl = new URL("../scripts/lib/audio.mjs", import.meta.url).href;
    const script = [
      `import { mkdirSync } from "node:fs";`,
      `import { encodeVariant } from ${JSON.stringify(audioModuleUrl)};`,
      `const sampleRate = 44100;`,
      `const n = 1000;`,
      `const left = new Float32Array(n);`,
      `for (let i = 0; i < n; i++) left[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);`,
      `const render = { sampleRate, left, right: null, seconds: n / sampleRate, peak: 0.5 };`,
      `try {`,
      `  encodeVariant(render, ${JSON.stringify(dir)}, { mkdirSync });`,
      `  console.log("DID_NOT_THROW");`,
      `} catch (err) {`,
      `  console.log(err.message);`,
      `}`,
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, PATH: emptyPathDir },
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.ok(!output.includes("DID_NOT_THROW"), `encodeVariant must throw when sox is missing, not silently fall back or skip the ogg (got: ${output.slice(0, 500)})`);
    assert.match(output, /sox.*not installed|not on PATH/i, `encodeVariant's missing-sox error must be clear and actionable (got: ${output.slice(0, 500)})`);
    console.log("PASS encodeVariant fails loudly (not silently) when sox is missing from PATH, in a fresh process");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(emptyPathDir, { recursive: true, force: true });
  }
}

{
  // Byte-repeatability (GS-06's own requirement): two encodes of the exact
  // same render, through the real production path, must produce
  // byte-identical ogg output. `sox -R` is what makes this true (a fixed
  // pseudo-random seed for anything sox itself randomizes) - verified
  // independently by the reviewer twice on the same input outside this
  // build (scratchpad ci128/r1.ogg, r2.ogg: same size, same sha256).
  const render = gs07ToneRender(6000);
  const dirA = mkdtempSync(join(tmpdir(), "gamesounds-gs07-rep-a-"));
  const dirB = mkdtempSync(join(tmpdir(), "gamesounds-gs07-rep-b-"));
  try {
    const a = encodeVariant(render, dirA, { mkdirSync });
    const b = encodeVariant(render, dirB, { mkdirSync });
    assert.equal(a.files.ogg.sha256, b.files.ogg.sha256, "two encodes of the same render must produce byte-identical ogg output (sox -R's own determinism)");
    console.log(`PASS sox -R produces byte-identical ogg output across two independent encodes of the same render (sha256 ${a.files.ogg.sha256.slice(0, 12)}...)`);
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
}

{
  // Channel layout is uniform now (GS-06): sox keeps the source's own mono
  // layout, unlike the old native-fallback path's forced dual-mono stereo
  // upmix (docs/DECISIONS.md, decision 54).
  const render = gs07ToneRender(4000);
  const dir = mkdtempSync(join(tmpdir(), "gamesounds-gs07-mono-"));
  try {
    const encoded = encodeVariant(render, dir, { mkdirSync });
    const result = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", join(dir, encoded.files.ogg.name)]);
    assert.equal(parseInt(result.stdout.toString().trim(), 10), 1, "a mono render's ogg must stay mono, on every machine, with no dual-mono stereo upmix");
    console.log("PASS encodeVariant's ogg output stays mono for a mono render (no upmix, on any machine)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  // The tail guard (OGG_TAIL_GUARD_FRAMES): the reviewer's own three
  // shortest truncating lengths from the original (now-corrected) GS-07
  // report - n=1023, 3071 and 4096 - must all decode to at least n frames
  // through the real production path, and must still pass both
  // checkFormatEnergies and checkFormatLengths. This is no longer a retry
  // that only fires when a first attempt comes up short: the guard pads the
  // ogg encoder's input on every single encode, unconditionally.
  for (const n of [1023, 3071, 4096]) {
    const dir = mkdtempSync(join(tmpdir(), `gamesounds-gs07-guard-${n}-`));
    try {
      const render = gs07ToneRender(n);
      const encoded = encodeVariant(render, dir, { mkdirSync });
      assert.ok(
        encoded.formatFrames.ogg >= n,
        `encodeVariant's tail guard must decode at least ${n} frames for a ${n}-frame source, got ${encoded.formatFrames.ogg}`,
      );
      const sourceEnergy = energyPerChannel(render.left, render.right);
      const energyCheck = checkFormatEnergies(sourceEnergy, encoded.formatEnergy);
      assert.ok(energyCheck.ok, `the guarded ogg must pass checkFormatEnergies for n=${n}: ${energyCheck.reason ?? ""}`);
      const lengthCheck = checkFormatLengths(render.left.length, encoded.formatFrames);
      assert.ok(lengthCheck.ok, `the guarded ogg must pass checkFormatLengths for n=${n}: ${lengthCheck.reason ?? ""}`);
      console.log(`PASS encodeVariant's tail guard covers n=${n} (source ${n} frames -> decoded ${encoded.formatFrames.ogg} frames), passing both checkFormatEnergies and checkFormatLengths`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

{
  // OGG_TAIL_GUARD_FRAMES must actually be applied: the ogg encoder's input
  // is source + guard frames, so a decode that comes back short of the
  // GUARDED length (rather than merely short of the source) proves the pad
  // is really landing in the file sox encodes, not just documented.
  const n = 5000;
  const render = gs07ToneRender(n);
  const dir = mkdtempSync(join(tmpdir(), "gamesounds-gs07-guard-applied-"));
  try {
    const encoded = encodeVariant(render, dir, { mkdirSync });
    assert.ok(encoded.formatFrames.ogg > n, `the guarded encode should generally decode past the bare source length (n=${n}), got ${encoded.formatFrames.ogg} - the guard may not be reaching the encoder`);
    assert.ok(OGG_TAIL_GUARD_FRAMES >= 128, `OGG_TAIL_GUARD_FRAMES (${OGG_TAIL_GUARD_FRAMES}) must be at least the measured 128-frame worst-case ffmpeg-CLI/Chromium end trim it exists to absorb`);
    console.log(`PASS OGG_TAIL_GUARD_FRAMES (${OGG_TAIL_GUARD_FRAMES}) is applied to the ogg encoder's input and covers the measured 128-frame worst case`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  // The guard never touches the wav or mp3 that ship - only the ogg
  // encoder's own input copy is padded.
  const n = 4500;
  const render = gs07ToneRender(n);
  const dir = mkdtempSync(join(tmpdir(), "gamesounds-gs07-guard-wav-mp3-"));
  try {
    const encoded = encodeVariant(render, dir, { mkdirSync });
    assert.equal(encoded.formatFrames.source, n, "the recorded source frame count must be the true, unpadded render length");
    const wavBytes = readFileSync(join(dir, encoded.files.wav.name));
    // 44-byte canonical PCM16 header + 2 bytes/sample, mono.
    assert.equal((wavBytes.length - 44) / 2, n, "the shipped wav must carry exactly the unpadded source frame count, never the guard-padded one");
    console.log(`PASS the ${OGG_TAIL_GUARD_FRAMES}-frame tail guard never reaches the shipped wav (still exactly ${n} frames)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
