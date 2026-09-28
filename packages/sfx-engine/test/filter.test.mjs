import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSvf, renderBiquad, renderOnePole, renderResonator } from "../dist/dsp/filter.js";

const SR = 48000;

function sine(freq, seconds, sampleRate = SR) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

function rms(signal, startSample) {
  let sum = 0, count = 0;
  for (let i = startSample; i < signal.length; i++) { sum += signal[i] * signal[i]; count++; }
  return Math.sqrt(sum / count);
}

/** Steady-state gain in dB at `freq`: render a sine, filter it, discard the
 * first 50ms (filter transient/settling), compare RMS of what remains. */
function gainAtFreqDb(render, freq) {
  const input = sine(freq, 0.2);
  const output = render(input);
  const start = Math.round(0.05 * SR);
  return 20 * Math.log10(rms(output, start) / rms(input, start));
}

test("biquad lowpass (Butterworth Q) is within 0.05 dB of the exact -3.0103 dB Butterworth cutoff point", () => {
  const db = gainAtFreqDb((x) => renderBiquad(x, SR, { kind: "biquad", mode: "lowpass", cutoff: 1000, q: Math.SQRT1_2 }), 1000);
  assert.ok(Math.abs(db - -3.0103) < 0.05, `biquad lowpass @ cutoff = ${db} dB, expected ~-3.0103 dB`);
});

test("biquad lowpass: passband near-flat, stopband falls off steeply (2-pole, ~-12dB/octave)", () => {
  const render = (mode) => (x) => renderBiquad(x, SR, { kind: "biquad", mode, cutoff: 1000, q: Math.SQRT1_2 });
  const lp = render("lowpass");
  const passband = gainAtFreqDb(lp, 100);
  const octave1 = gainAtFreqDb(lp, 2000); // one octave above cutoff
  const octave2 = gainAtFreqDb(lp, 4000); // two octaves above cutoff
  assert.ok(passband > -0.5, `passband gain ${passband} dB should be near 0 dB`);
  assert.ok(octave1 < -9 && octave1 > -15, `one octave above cutoff: ${octave1} dB, expected ~-12 dB`);
  assert.ok(octave2 < octave1 - 9, `two octaves above cutoff (${octave2} dB) should fall roughly another 12 dB below one octave (${octave1} dB)`);
});

test("biquad highpass mirrors lowpass: stopband below cutoff, passband above", () => {
  const hp = (x) => renderBiquad(x, SR, { kind: "biquad", mode: "highpass", cutoff: 1000, q: Math.SQRT1_2 });
  const db = gainAtFreqDb(hp, 1000);
  assert.ok(Math.abs(db - -3.0103) < 0.05, `biquad highpass @ cutoff = ${db} dB`);
  assert.ok(gainAtFreqDb(hp, 8000) > -0.5, "highpass passband (well above cutoff) should be near 0 dB");
  assert.ok(gainAtFreqDb(hp, 125) < -20, "highpass stopband (three octaves below cutoff) should be heavily attenuated");
});

test("biquad notch: deep null at the notch frequency, near-unity elsewhere", () => {
  const notch = (x) => renderBiquad(x, SR, { kind: "biquad", mode: "notch", cutoff: 1000, q: 2 });
  assert.ok(gainAtFreqDb(notch, 1000) < -30, "notch center should be deeply attenuated");
  assert.ok(Math.abs(gainAtFreqDb(notch, 200)) < 1, "far below the notch, gain should be close to 0 dB");
  assert.ok(Math.abs(gainAtFreqDb(notch, 5000)) < 1, "far above the notch, gain should be close to 0 dB");
});

test("svf lowpass lands within 0.1 dB of the same -3.0103 dB Butterworth point as the biquad", () => {
  const db = gainAtFreqDb((x) => renderSvf(x, SR, { kind: "svf", mode: "lowpass", cutoff: 1000, q: 0.7071 }), 1000);
  assert.ok(Math.abs(db - -3.0103) < 0.1, `svf lowpass @ cutoff = ${db} dB, expected ~-3.0103 dB`);
});

test("svf bandpass: gain peaks near the center frequency and falls off to either side", () => {
  const bp = (x) => renderSvf(x, SR, { kind: "svf", mode: "bandpass", cutoff: 1000, q: 2 });
  const center = gainAtFreqDb(bp, 1000);
  const below = gainAtFreqDb(bp, 250);
  const above = gainAtFreqDb(bp, 4000);
  assert.ok(center > 3, `bandpass center gain ${center} dB should show resonant boost (Q=2 => ~+6 dB)`);
  assert.ok(center - below > 10, "bandpass should fall off well below its center frequency");
  assert.ok(center - above > 10, "bandpass should fall off well above its center frequency");
});

test("svf notch: deep null exactly at the notch frequency, near-unity an octave to either side", () => {
  const notch = (x) => renderSvf(x, SR, { kind: "svf", mode: "notch", cutoff: 1000, q: 2 });
  assert.ok(gainAtFreqDb(notch, 1000) < -100, "svf notch center should be essentially silent");
  assert.ok(Math.abs(gainAtFreqDb(notch, 500)) < 1, "an octave below, svf notch should be near 0 dB");
  assert.ok(Math.abs(gainAtFreqDb(notch, 2000)) < 1, "an octave above, svf notch should be near 0 dB");
});

test("one-pole lowpass lands within 0.1 dB of -3.0 dB at its own analytic cutoff", () => {
  const db = gainAtFreqDb((x) => renderOnePole(x, SR, { kind: "onepole", mode: "lowpass", cutoff: 1000 }), 1000);
  assert.ok(Math.abs(db - -3.0) < 0.1, `one-pole lowpass @ cutoff = ${db} dB, expected ~-3.0 dB`);
});

test("one-pole highpass is the complementary response (input minus the lowpass)", () => {
  const hp = (x) => renderOnePole(x, SR, { kind: "onepole", mode: "highpass", cutoff: 1000 });
  assert.ok(gainAtFreqDb(hp, 100) < -15, "one-pole highpass should attenuate well below cutoff");
  assert.ok(gainAtFreqDb(hp, 8000) > -1, "one-pole highpass should pass well above cutoff");
});

test("resonator: impulse response envelope crosses -60 dB at exactly T60 (within 0.01 dB)", () => {
  const freq = 1000, t60 = 0.2, sampleRate = SR;
  const length = Math.round(0.5 * sampleRate);
  const impulse = new Float64Array(length);
  impulse[0] = 1;
  const out = renderResonator(impulse, sampleRate, { kind: "resonator", freq, t60 });

  function windowRms(signal, centerSeconds, halfWindowSeconds) {
    const c = Math.round(centerSeconds * sampleRate);
    const h = Math.round(halfWindowSeconds * sampleRate);
    let sum = 0, count = 0;
    for (let i = Math.max(0, c - h); i < Math.min(signal.length, c + h); i++) { sum += signal[i] * signal[i]; count++; }
    return Math.sqrt(sum / count);
  }

  // Measure between two points exactly T60 apart (both well past the
  // initial attack, so the envelope is already in its clean exponential
  // decay) rather than from the literal impulse, which avoids the peak's
  // own transient shape biasing the ratio.
  const early = windowRms(out, 0.01, 0.001);
  const late = windowRms(out, 0.01 + t60, 0.001);
  const db = 20 * Math.log10(late / early);
  assert.ok(Math.abs(db - -60) < 0.01, `resonator decayed ${db} dB over one T60, expected -60 dB`);
});

test("resonator rings at its requested frequency (zero-crossing estimate)", () => {
  const freq = 800, t60 = 0.3, sampleRate = SR;
  const length = Math.round(0.05 * sampleRate);
  const impulse = new Float64Array(length);
  impulse[0] = 1;
  const out = renderResonator(impulse, sampleRate, { kind: "resonator", freq, t60 });
  let crossings = 0;
  for (let i = 1; i < out.length; i++) if (out[i - 1] <= 0 && out[i] > 0) crossings++;
  const estimated = crossings / (out.length / sampleRate);
  assert.ok(Math.abs(estimated - freq) / freq < 0.02, `resonator rang at ~${estimated} Hz, expected ~${freq} Hz`);
});

test("filters are deterministic: same input and params render identical output", () => {
  const input = sine(300, 0.05);
  const a = renderBiquad(input, SR, { kind: "biquad", mode: "lowpass", cutoff: 900, q: 1.2 });
  const b = renderBiquad(input, SR, { kind: "biquad", mode: "lowpass", cutoff: 900, q: 1.2 });
  assert.deepEqual(Array.from(a), Array.from(b));
});
