import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrng, deriveSeed } from "../dist/rng/prng.js";

// mulberry32 and FNV-1a (deriveSeed) touch no transcendental - only
// Math.imul and bitwise ops, both exact per ECMA-262 - so these are pinned
// exact-value tests (not tolerance-based), the strongest determinism
// evidence this package can give for its randomness source.

test("createPrng(12345).next() reproduces a pinned sequence exactly", () => {
  const p = createPrng(12345);
  const got = [p.next(), p.next(), p.next(), p.next(), p.next()];
  const expected = [
    0.9797282677609473, 0.3067522644996643, 0.484205421525985,
    0.817934412509203, 0.5094283693470061,
  ];
  assert.deepEqual(got, expected);
});

test("next() always returns a value in [0, 1)", () => {
  const p = createPrng(777);
  for (let i = 0; i < 2000; i++) {
    const v = p.next();
    assert.ok(v >= 0 && v < 1, `next() out of range: ${v}`);
  }
});

test("two independent createPrng() calls with the same seed produce identical streams", () => {
  const a = createPrng(2024), b = createPrng(2024);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
});

test("different seeds diverge immediately", () => {
  const a = createPrng(1), b = createPrng(2);
  assert.notEqual(a.next(), b.next());
});

test("range(min, max) stays within [min, max) and is deterministic per seed", () => {
  const p = createPrng(42);
  const got = [p.range(10, 20), p.range(10, 20), p.range(10, 20)];
  const expected = [16.011037519201636, 14.482905589975417, 18.5246579349041];
  assert.deepEqual(got, expected);
  const p2 = createPrng(42);
  for (let i = 0; i < 200; i++) {
    const v = p2.range(-5, 5);
    assert.ok(v >= -5 && v < 5, `range() out of bounds: ${v}`);
  }
});

test("int(min, max) is inclusive of both ends and deterministic per seed", () => {
  const p = createPrng(42);
  const got = [p.int(0, 5), p.int(0, 5), p.int(0, 5), p.int(0, 5), p.int(0, 5)];
  assert.deepEqual(got, [3, 2, 5, 4, 1]);
  const p2 = createPrng(1);
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const v = p2.int(0, 3);
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 3, `int() out of bounds: ${v}`);
    seen.add(v);
  }
  assert.equal(seen.size, 4, "int(0,3) over 500 draws should hit all four values");
});

test("gaussian() reproduces a pinned sequence exactly (Box-Muller, cached second sample)", () => {
  const p = createPrng(7);
  const got = [p.gaussian(), p.gaussian(), p.gaussian()];
  const expected = [2.7593729870287698, 1.1319811186666953, -0.06805135658700055];
  assert.deepEqual(got, expected);
});

test("gaussian() has roughly zero mean and unit variance over a large sample", () => {
  const p = createPrng(555);
  const n = 20000;
  let sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = p.gaussian();
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  assert.ok(Math.abs(mean) < 0.05, `gaussian mean too far from 0: ${mean}`);
  assert.ok(Math.abs(variance - 1) < 0.1, `gaussian variance too far from 1: ${variance}`);
});

test("deriveSeed() is pinned and deterministic per (seed, label)", () => {
  assert.equal(deriveSeed(12345, "a"), 3710209575);
  assert.equal(deriveSeed(12345, "b"), 3726987194);
  assert.equal(deriveSeed(1, "a"), 3842779839);
  // Negative test: a different label or a different seed must not collide
  // with these pinned values, and repeated calls must be stable.
  assert.notEqual(deriveSeed(12345, "a"), deriveSeed(12345, "b"));
  assert.notEqual(deriveSeed(12345, "a"), deriveSeed(1, "a"));
  assert.equal(deriveSeed(12345, "a"), deriveSeed(12345, "a"));
});

test("deriveSeed() always returns a 32-bit unsigned integer", () => {
  for (const label of ["", "x", "node-42", "a-fairly-long-node-id-string"]) {
    const s = deriveSeed(4294967295, label);
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 4294967295, `deriveSeed out of range: ${s}`);
  }
});

test("fork() derives a deterministic child stream from the parent's own stream", () => {
  const a = createPrng(99).fork();
  const b = createPrng(99).fork();
  assert.equal(a.next(), b.next());
  // Forking twice from the same parent stream (which has now advanced)
  // must not repeat the same child seed.
  const parent = createPrng(99);
  const child1 = parent.fork();
  const child2 = parent.fork();
  assert.notEqual(child1.next(), child2.next());
});
