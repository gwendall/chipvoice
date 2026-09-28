import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAdsr, renderSegments, renderSweep, renderEnvelope } from "../dist/dsp/envelope.js";

// A sample rate of 1000 Hz makes "sample index" and "millisecond" the same
// number, so segment-timing assertions read directly as the seconds/ms
// given to the envelope, with no unit conversion to get wrong in the test
// itself.
const SR = 1000;

test("renderAdsr: attack reaches peak exactly at the attack boundary, decay lands on sustain level", () => {
  const env = renderAdsr(1000, SR, { kind: "adsr", attack: 0.1, decay: 0.1, sustain: 0.5, release: 0.2, curve: "linear" });
  assert.equal(env[0], 0, "envelope starts at 0");
  assert.equal(env[100], 1, "attack (100 samples @ 1000Hz = 0.1s) reaches peak 1 exactly at its boundary");
  assert.equal(env[200], 0.5, "decay (100 samples) reaches the sustain level exactly at its boundary");
});

test("renderAdsr: sustain holds flat until release begins", () => {
  const env = renderAdsr(1000, SR, { kind: "adsr", attack: 0.1, decay: 0.1, sustain: 0.5, release: 0.2, curve: "linear" });
  // With no sustainHold given, sustain fills the rest of the buffer minus
  // release: sustainEnd = length - release samples = 1000 - 200 = 800. The
  // release segment's own first written sample (800) still equals its
  // fromValue (the segment writes fromValue + step*i for i starting at 0),
  // so the sustain level is still visibly exact through sample 800 - the
  // first sample strictly less than it is 801.
  for (const i of [200, 400, 600, 799, 800]) assert.equal(env[i], 0.5, `sample ${i} should still be at the sustain level`);
  assert.ok(env[801] < 0.5, "release should be visibly progressing by sample 801");
});

test("renderAdsr: release ramps down to (within one step of) zero by the end of the buffer", () => {
  const env = renderAdsr(1000, SR, { kind: "adsr", attack: 0.1, decay: 0.1, sustain: 0.5, release: 0.2, curve: "linear" });
  // A linear segment's last written sample is one step short of the exact
  // target (the segment writes fromValue + step*i for i in [0, n), so the
  // final index is fromValue + step*(n-1), not the target itself) - the
  // release is 200 samples from 0.5 to 0, so the step is -0.0025 and the
  // last sample lands at 0.0025, not 0.
  assert.ok(Math.abs(env[999] - 0.0025) < 1e-9, `last sample ${env[999]}, expected ~0.0025`);
  assert.ok(env[999] < env[850], "release should be monotonically decreasing");
});

test("renderAdsr: a custom peak level scales attack and decay targets", () => {
  const env = renderAdsr(500, SR, { kind: "adsr", attack: 0.05, decay: 0.05, sustain: 0.5, release: 0.05, peak: 0.3 });
  assert.ok(Math.abs(env[50] - 0.3) < 1e-9, `peak sample should reach the custom peak 0.3, got ${env[50]}`);
});

test("renderAdsr: an explicit sustainHold, not just 'fill the rest', controls when release starts", () => {
  const env = renderAdsr(1000, SR, { kind: "adsr", attack: 0.05, decay: 0.05, sustain: 1, sustainHold: 0.1, release: 0.05, curve: "linear" });
  // attackEnd=50, decayEnd=100, sustainEnd=100+100=200, releaseEnd=200+50=250.
  assert.equal(env[199], 1, "still sustaining just before sustainHold ends");
  assert.ok(env[249] < 1, "release should have progressed by its own end");
  for (let i = 251; i < 1000; i++) assert.equal(env[i], 0, "everything after releaseEnd should be exactly 0");
});

test("renderAdsr: exponential curve (the default) never overshoots and lands on the exact target at each segment boundary", () => {
  const env = renderAdsr(1000, SR, { kind: "adsr", attack: 0.1, decay: 0.1, sustain: 0.3, release: 0.2 }); // curve defaults to 'exponential'
  for (const v of env) assert.ok(v >= -1e-9 && v <= 1 + 1e-9, `exponential envelope sample out of [0,1]: ${v}`);
  assert.ok(Math.abs(env[100] - 1) < 1e-9, "attack still lands exactly on peak at its boundary");
  assert.ok(Math.abs(env[200] - 0.3) < 1e-9, "decay still lands exactly on sustain at its boundary");
  assert.equal(env[999], 0, "exponential release forces the literal last written sample to the exact target (0)");
});

test("renderSegments: multi-point envelope lands on each declared (time, value) exactly at its sample boundary", () => {
  const seg = renderSegments(1000, SR, {
    kind: "segments",
    points: [
      { time: 0, value: 0 },
      { time: 0.2, value: 1, curve: "linear" },
      { time: 0.5, value: 0.2, curve: "exponential" },
      { time: 1.0, value: 0, curve: "linear" },
    ],
  });
  assert.equal(seg[0], 0);
  assert.equal(seg[200], 1, "linear segment to 1.0 at t=0.2s");
  assert.ok(Math.abs(seg[500] - 0.2) < 1e-9, "exponential segment forces the exact target at its boundary sample");
});

test("renderSegments: holds its first value before the first point's own time, and its last value after the last point", () => {
  const seg = renderSegments(1000, SR, { kind: "segments", points: [{ time: 0.1, value: 0.7 }, { time: 0.3, value: 0.2 }] });
  assert.equal(seg[0], 0.7, "before the first point, the envelope holds the first point's value");
  assert.equal(seg[50], 0.7);
  assert.equal(seg[999], 0.2, "after the last point, the envelope holds the last point's value");
});

test("renderSegments: an empty points array renders silence, not a crash", () => {
  const seg = renderSegments(100, SR, { kind: "segments", points: [] });
  assert.equal(seg.length, 100);
  for (const v of seg) assert.equal(v, 0);
});

test("renderSweep: linear ramp lands on both endpoints (within a linear segment's known one-step-short-of-target rule)", () => {
  const sw = renderSweep(500, SR, { from: 100, to: 1000, curve: "linear" });
  assert.equal(sw[0], 100);
  assert.equal(sw[250], 550, "linear sweep should be exactly halfway at the midpoint sample");
  assert.ok(sw[499] > 990 && sw[499] < 1000, "last sample should be one step short of the target (never quite arrives)");
});

test("renderSweep: exponential ramp has a constant per-sample multiplicative ratio (geometric, not arithmetic)", () => {
  const sw = renderSweep(500, SR, { from: 100, to: 1000, curve: "exponential" });
  assert.equal(sw[0], 100);
  assert.equal(sw[499], 1000, "exponential sweep forces the exact target on its last written sample");
  const ratios = [];
  for (let i = 1; i < 10; i++) ratios.push(sw[i] / sw[i - 1]);
  for (let i = 1; i < ratios.length; i++) {
    assert.ok(Math.abs(ratios[i] - ratios[0]) < 1e-9, `exponential sweep ratio not constant: ${ratios[i]} vs ${ratios[0]}`);
  }
});

test("renderEnvelope dispatches to the right implementation by 'kind'", () => {
  const adsr = renderEnvelope(200, SR, { kind: "adsr", attack: 0.02, decay: 0.02, sustain: 0.5, release: 0.05 });
  const segs = renderEnvelope(200, SR, { kind: "segments", points: [{ time: 0, value: 1 }, { time: 0.2, value: 0 }] });
  assert.equal(adsr.length, 200);
  assert.equal(segs.length, 200);
  assert.equal(segs[0], 1);
});

test("envelopes are deterministic: identical params render identical output", () => {
  const params = { kind: "adsr", attack: 0.03, decay: 0.04, sustain: 0.4, release: 0.1, curve: "exponential" };
  const a = renderAdsr(500, SR, params);
  const b = renderAdsr(500, SR, params);
  assert.deepEqual(Array.from(a), Array.from(b));
});
