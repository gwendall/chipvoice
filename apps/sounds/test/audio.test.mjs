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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
} from "../scripts/lib/audio.mjs";
import { checkLeadingSilence } from "../scripts/lib/checks.mjs";

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
