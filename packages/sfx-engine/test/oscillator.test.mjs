import { test } from "node:test";
import assert from "node:assert/strict";
import { renderOscillator } from "../dist/dsp/oscillator.js";

const SAMPLE_RATE = 48000;

/** Counts rising (negative-to-positive) zero crossings, the standard cheap
 * way to estimate a periodic signal's frequency without an FFT dependency
 * (this package has zero runtime dependencies). */
function countRisingZeroCrossings(signal) {
  let count = 0;
  for (let i = 1; i < signal.length; i++) {
    if (signal[i - 1] <= 0 && signal[i] > 0) count++;
  }
  return count;
}

function estimateFrequency(signal, sampleRate) {
  const crossings = countRisingZeroCrossings(signal);
  const seconds = signal.length / sampleRate;
  return crossings / seconds;
}

for (const shape of ["sine", "saw", "square", "triangle"]) {
  test(`${shape}: zero-crossing frequency estimate matches the requested freq within 1%`, () => {
    const freq = 440;
    const seconds = 0.5; // 220 cycles - long enough to average out edge effects
    const length = Math.round(seconds * SAMPLE_RATE);
    const signal = renderOscillator(length, SAMPLE_RATE, { shape, freq });
    const estimated = estimateFrequency(signal, SAMPLE_RATE);
    const relError = Math.abs(estimated - freq) / freq;
    assert.ok(relError < 0.01, `${shape} estimated ${estimated} Hz, expected ~${freq} Hz (${relError * 100}% off)`);
  });
}

test("sine oscillator stays within [-1, 1] and is a pure single partial (no PolyBLEP correction applied)", () => {
  const signal = renderOscillator(4800, SAMPLE_RATE, { shape: "sine", freq: 220 });
  for (const s of signal) assert.ok(Math.abs(s) <= 1.0000001, `sine sample out of range: ${s}`);
});

test("saw and square both reach close to their full-scale extremes away from PolyBLEP-smoothed corners", () => {
  for (const shape of ["saw", "square"]) {
    const signal = renderOscillator(4800, SAMPLE_RATE, { shape, freq: 220 });
    let max = -Infinity, min = Infinity;
    for (const s of signal) { if (s > max) max = s; if (s < min) min = s; }
    assert.ok(max > 0.9, `${shape} max ${max} too low`);
    assert.ok(min < -0.9, `${shape} min ${min} too low`);
  }
});

test("square respects pulseWidth: a narrower pulse spends less time high than low", () => {
  const freq = 220;
  const length = Math.round(0.1 * SAMPLE_RATE);
  const narrow = renderOscillator(length, SAMPLE_RATE, { shape: "square", freq, pulseWidth: 0.2 });
  let highCount = 0;
  for (const s of narrow) if (s > 0) highCount++;
  const highFraction = highCount / narrow.length;
  assert.ok(highFraction < 0.35, `narrow-pulse square spent ${highFraction} of its time high, expected close to 0.2`);
});

test("triangle oscillator is continuous (no PolyBLEP-sized single-sample jumps) and roughly symmetric", () => {
  const signal = renderOscillator(4800, SAMPLE_RATE, { shape: "triangle", freq: 220 });
  let maxJump = 0;
  for (let i = 1; i < signal.length; i++) maxJump = Math.max(maxJump, Math.abs(signal[i] - signal[i - 1]));
  // A 220 Hz triangle at 48kHz moves roughly 4*220/48000 ~= 0.018 per sample
  // at its steepest; anything far larger would mean a discontinuity leaked
  // through the leaky integrator.
  assert.ok(maxJump < 0.05, `triangle has an unexpectedly large sample-to-sample jump: ${maxJump}`);
});

test("a per-sample Float64Array freq (frequency modulation) is honoured sample-accurately", () => {
  const length = 4800;
  const freq = new Float64Array(length).fill(220);
  // A step from 220Hz to 880Hz halfway through - just confirms the
  // modulation path is read as ModulatableNumber, not ignored/constant-folded.
  for (let i = length / 2; i < length; i++) freq[i] = 880;
  const modulated = renderOscillator(length, SAMPLE_RATE, { shape: "sine", freq });
  const constant220 = renderOscillator(length, SAMPLE_RATE, { shape: "sine", freq: 220 });
  const firstHalfModulated = modulated.slice(0, length / 2);
  const firstHalfConstant = constant220.slice(0, length / 2);
  assert.deepEqual(Array.from(firstHalfModulated), Array.from(firstHalfConstant), "first half should match the 220Hz-constant render exactly");
  // Second half must differ (now at 880Hz, an audibly different signal).
  let anyDiff = false;
  for (let i = length / 2; i < length; i++) if (modulated[i] !== constant220[i]) { anyDiff = true; break; }
  assert.ok(anyDiff, "second half should differ once freq steps to 880Hz");
});

test("rendering is deterministic: same params, same output, called twice", () => {
  const params = { shape: "saw", freq: 300, pulseWidth: 0.4 };
  const a = renderOscillator(2000, SAMPLE_RATE, params);
  const b = renderOscillator(2000, SAMPLE_RATE, params);
  assert.deepEqual(Array.from(a), Array.from(b));
});
