/**
 * A seeded PRNG for recipe variants and noise/particle generation. mulberry32
 * (Tommy Ettinger, public domain: https://gist.github.com/tommyettinger/46a874533244883189143505d203312).
 * It touches no transcendental: only 32-bit integer multiplication
 * (`Math.imul`, exact per ECMA-262) and bitwise ops (exact per ECMA-262), so
 * it is bit-identical across Node, Chromium, Firefox and WebKit by
 * construction, the same way `dsp/math.ts`'s own functions are.
 *
 * A recipe's `seed` is a 32-bit unsigned integer. Two recipes that differ
 * only by seed are "variants" of the same idea (the brief's "a sound is a
 * recipe plus a seed"); which params a seed jitters, and by how much, is
 * declared per model in `presets/*` metadata.
 */
import { sin, cos, log, PI } from '../dsp/math.js';
export interface Prng {
  /** Next value in [0, 1). */
  next(): number;
  /** Next value in [min, max). */
  range(min: number, max: number): number;
  /** Next integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** A standard-normal sample (Box-Muller, using this PRNG's own stream). */
  gaussian(): number;
  /** A fresh, independent PRNG seeded deterministically from this one. */
  fork(): Prng;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derives a 32-bit child seed from a master seed and a string label (a
 * node id), so every stochastic graph node gets its own independent-but-
 * reproducible stream regardless of node evaluation order - adding an
 * unrelated node to a recipe never perturbs another node's randomness.
 * FNV-1a, 32-bit: only `Math.imul` and bitwise ops (both exact per
 * ECMA-262), mixed with the seed itself so two recipes with the same node
 * ids but different seeds still diverge.
 */
export function deriveSeed(seed: number, label: string): number {
  let hash = (seed >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createPrng(seed: number): Prng {
  const raw = mulberry32(seed >>> 0);
  let cachedGaussian: number | null = null;
  const prng: Prng = {
    next: raw,
    range(min, max) {
      return min + raw() * (max - min);
    },
    int(min, max) {
      return min + Math.floor(raw() * (max - min + 1));
    },
    gaussian() {
      if (cachedGaussian !== null) {
        const value = cachedGaussian;
        cachedGaussian = null;
        return value;
      }
      // Box-Muller, using our own sin/cos/log/sqrt (sqrt is spec-exact;
      // sin/cos/log come from dsp/math.ts, imported lazily below to avoid a
      // module cycle with dsp code that itself uses the PRNG).
      let u1 = raw();
      while (u1 <= 1e-12) u1 = raw();
      const u2 = raw();
      const radius = Math.sqrt(-2 * log(u1));
      const angle = 2 * PI * u2;
      const z0 = radius * cos(angle);
      const z1 = radius * sin(angle);
      cachedGaussian = z1;
      return z0;
    },
    fork() {
      // Deterministically derived from this stream, not from the outer
      // seed again, so forking twice never repeats the same child stream.
      const childSeed = (raw() * 4294967296) >>> 0;
      return createPrng(childSeed);
    },
  };
  return prng;
}
