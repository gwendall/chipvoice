import { test } from "node:test";
import assert from "node:assert/strict";
import { sin, cos, tan, exp, log, log10, pow, tanh, expm1, PI, TWO_PI, LN2, LN10 } from "../dist/dsp/math.js";

// dsp/math.ts exists because ECMA-262 leaves every transcendental
// "implementation-approximated" - these tests hold each one to native
// Math's own accuracy (not just internal self-consistency), since a
// custom implementation that merely "looks plausible" can still be
// silently wrong (this file exists because exactly that happened once:
// an earlier expKernel computed the wrong polynomial entirely, off by
// ~0.5% at exp(1), caught only when a downstream K-weighting coefficient
// cross-check against ITU's published values did not match).

function closeTo(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tolerance, `${message}: |${actual} - ${expected}| = ${diff} > ${tolerance}`);
}

// A custom minimax/Taylor implementation matching a native libm to ~10-11
// significant digits (relative error ~1e-10 or tighter) is the honest bar
// here, not bit-identical agreement: different native libms do not agree
// with each other at the last bit or two either (that disagreement is
// exactly why this file exists), and Math.round-based argument reduction
// accumulates a few ULPs of absolute error as the input magnitude grows.
// What actually matters for determinism is that THIS engine's own
// implementation is exact-per-engine (see the "repeated calls" test below
// and parity/), not that it matches V8's Math.* to the last bit.
function relClose(actual, expected, relTolerance, message) {
  const scale = Math.max(1, Math.abs(expected));
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= relTolerance * scale, `${message}: |${actual} - ${expected}| = ${diff} > ${relTolerance} * ${scale}`);
}

test("sin/cos match native Math to within 1e-10 across representative angles", () => {
  const angles = [-10, -PI, -1, -0.001, 0, 0.001, 0.5, 1, PI / 2, PI, 2, 5, TWO_PI, 100.123];
  for (const a of angles) {
    relClose(sin(a), Math.sin(a), 1e-10, `sin(${a})`);
    relClose(cos(a), Math.cos(a), 1e-10, `cos(${a})`);
  }
});

test("sin^2 + cos^2 == 1 (to well within audible/perceptual precision) across many angles", () => {
  for (let a = -20; a <= 20; a += 0.37) {
    const s = sin(a), c = cos(a);
    closeTo(s * s + c * c, 1, 5e-10, `sin^2+cos^2 at ${a}`);
  }
});

test("tan matches native Math away from its poles", () => {
  for (const a of [-1.2, -0.5, 0, 0.3, 0.7, 1.0, 1.2]) {
    closeTo(tan(a), Math.tan(a), 1e-10, `tan(${a})`);
  }
});

test("exp matches native Math (the bug this file exists to catch)", () => {
  closeTo(exp(1), Math.E, 1e-12, "exp(1) must equal e");
  for (const x of [-10, -3, -1, -0.1, 0, 0.1, 1, 3, 10]) {
    const expected = Math.exp(x);
    const rel = Math.abs(exp(x) - expected) / Math.abs(expected);
    assert.ok(rel < 1e-12, `exp(${x}) relative error ${rel} too large`);
  }
});

test("log matches native Math, and log(exp(x)) round-trips", () => {
  for (const x of [1e-6, 0.1, 1, 2, 10, 100, 1e6]) {
    relClose(log(x), Math.log(x), 1e-10, `log(${x})`);
  }
  for (const x of [-5, -1, 0.01, 1, 5]) {
    closeTo(log(exp(x)), x, 1e-9, `log(exp(${x})) round-trip`);
  }
  assert.equal(log(0), -Infinity);
  assert.ok(Number.isNaN(log(-1)));
});

test("log10 matches native Math.log10, including exact powers of ten", () => {
  for (const x of [0.001, 0.1, 1, 10, 100, 1000, 3.14159]) {
    relClose(log10(x), Math.log10(x), 1e-10, `log10(${x})`);
  }
  for (let k = -3; k <= 6; k++) {
    closeTo(log10(pow(10, k)), k, 1e-9, `log10(10^${k})`);
  }
});

test("pow matches native Math.pow for integer and non-integer exponents", () => {
  const cases = [
    [10, 0.5], [10, 0.2], [10, 2.5], [10, -1], [2, 10], [2, 10.5],
    [1.5848931924611136, 0.4996667741545416], // the exact K-weighting shelf gain term
  ];
  for (const [base, exponent] of cases) {
    const expected = Math.pow(base, exponent);
    const rel = Math.abs(pow(base, exponent) - expected) / Math.abs(expected);
    assert.ok(rel < 1e-11, `pow(${base}, ${exponent}) relative error ${rel} too large`);
  }
  // Integer path is exact multiplication, not exp/log - exact equality.
  assert.equal(pow(2, 10), 1024);
  assert.equal(pow(3, 0), 1);
  assert.equal(pow(2, -3), 0.125);
});

test("pow rejects a non-integer exponent on a non-positive base", () => {
  assert.throws(() => pow(-2, 0.5));
});

test("tanh matches native Math.tanh and saturates towards +-1", () => {
  for (const x of [-5, -2, -0.5, 0, 0.5, 2, 5]) {
    closeTo(tanh(x), Math.tanh(x), 1e-12, `tanh(${x})`);
  }
  assert.ok(tanh(50) > 0.999999);
  assert.ok(tanh(-50) < -0.999999);
});

test("expm1 matches native Math.expm1 near zero and away from it", () => {
  for (const x of [-1, -0.001, 0, 0.001, 0.5, 2]) {
    closeTo(expm1(x), Math.expm1(x), 1e-12, `expm1(${x})`);
  }
});

test("every transcendental here is a pure function: repeated calls are bit-identical", () => {
  // Determinism sanity: no hidden global state, no Date/Math.random leakage.
  for (const [name, fn, arg] of [["sin", sin, 1.2345], ["cos", cos, 1.2345], ["exp", exp, 1.2345], ["log", log, 1.2345], ["tan", tan, 1.2345]]) {
    const a = fn(arg), b = fn(arg), c = fn(arg);
    assert.equal(a, b, `${name} not repeatable`);
    assert.equal(b, c, `${name} not repeatable`);
  }
  assert.equal(pow(1.2345, 6.789), pow(1.2345, 6.789));
  assert.equal(tanh(1.2345), tanh(1.2345));
});

test("LN10 constant matches Math.LN10", () => {
  closeTo(LN10, Math.LN10, 1e-15, "LN10");
});
