/**
 * Determinism is a hard requirement (GS-02): the same recipe and seed must
 * give bit-identical PCM in Node, Chromium, Firefox and WebKit. ECMA-262
 * mandates exact IEEE-754 double results for +, -, *, / and for `Math.sqrt`,
 * `Math.round`, `Math.floor`, `Math.abs` and friends, but it explicitly
 * leaves the transcendental functions (`sin`, `cos`, `exp`, `log`, `pow`,
 * `tanh`, ...) "implementation-approximated" - V8, SpiderMonkey and
 * JavaScriptCore each ship a different libm, and nothing stops them from
 * disagreeing in the last bit or two.
 *
 * Every transcendental this engine needs is implemented here from +, -, *
 * and / only (plus the spec-exact `Math.round`/`Math.abs` for argument
 * reduction), so the DSP core never calls `Math.sin`, `Math.cos`, `Math.exp`,
 * `Math.log`, `Math.pow` or `Math.tanh` directly. `Math.sqrt` is kept as-is:
 * it is one of the few transcendental-shaped functions IEEE-754 (and so
 * ECMA-262) requires to be correctly rounded, which every engine honours.
 *
 * `packages/sfx-engine/parity/` cross-checks this file's output against
 * itself in Chromium, Firefox and WebKit (the same harness shape as
 * chipvoice's own render-parity, `docs/RENDER-PARITY.md`) and reports which
 * `Math.*` call, if any, would have diverged had it been used raw instead.
 *
 * Algorithms follow the standard fdlibm range-reduction shape (Sun
 * Microsystems' fdlibm, and the many textbook descriptions of it): reduce
 * the argument to a small interval where a Taylor/Maclaurin series converges
 * to well past double precision, then reconstruct. Sources: Cody & Waite,
 * "Software Manual for the Elementary Functions" (1980); Muller, "Elementary
 * Functions: Algorithms and Implementation" (2016).
 */

/** A double-precision literal for pi; the engine's only source of it. */
export const PI = 3.14159265358979323846;
export const TWO_PI = 2 * PI;
export const HALF_PI = PI / 2;
const QUARTER_PI = PI / 4;
/** ln(2) to double precision, used by exp()'s range reduction. */
export const LN2 = 0.6931471805599453094172321214581766;

/**
 * 2^n for an integer n, exact for any n IEEE-754 double can represent
 * (doubling or halving only ever changes a float's exponent field, never
 * its mantissa, so this never loses a bit). Built from multiplication alone
 * (exponentiation by squaring), never from `Math.pow`.
 */
function pow2Int(n: number): number {
  if (n === 0) return 1;
  const negative = n < 0;
  let e = negative ? -n : n;
  let base = negative ? 0.5 : 2;
  let result = 1;
  while (e > 0) {
    if (e & 1) result *= base;
    base *= base;
    e = e >>> 1;
  }
  return result;
}

/** sin Taylor kernel, accurate for |r| <= pi/4 to well past float64 precision. */
function sinKernel(r: number): number {
  const r2 = r * r;
  // Horner's method: r * (1 - r2/6 * (1 - r2/20 * (1 - r2/42 * (1 - r2/72 * (1 - r2/110)))))
  let acc = 1 - (r2 / 110);
  acc = 1 - (r2 / 72) * acc;
  acc = 1 - (r2 / 42) * acc;
  acc = 1 - (r2 / 20) * acc;
  acc = 1 - (r2 / 6) * acc;
  return r * acc;
}

/** cos Taylor kernel, accurate for |r| <= pi/4 to well past float64 precision. */
function cosKernel(r: number): number {
  const r2 = r * r;
  let acc = 1 - (r2 / 90);
  acc = 1 - (r2 / 56) * acc;
  acc = 1 - (r2 / 30) * acc;
  acc = 1 - (r2 / 12) * acc;
  acc = 1 - (r2 / 2) * acc;
  return acc;
}

/** Reduces x to a quadrant index (0..3) and a remainder in [-pi/4, pi/4]. */
function reduceQuadrant(x: number): { quadrant: number; r: number } {
  const n = Math.round(x / HALF_PI);
  const r = x - n * HALF_PI;
  const quadrant = ((n % 4) + 4) % 4;
  return { quadrant, r };
}

/** Our own `sin`, exact-per-engine by construction (+, -, *, / only). */
export function sin(x: number): number {
  const { quadrant, r } = reduceQuadrant(x);
  switch (quadrant) {
    case 0: return sinKernel(r);
    case 1: return cosKernel(r);
    case 2: return -sinKernel(r);
    default: return -cosKernel(r);
  }
}

/** Our own `cos`, exact-per-engine by construction (+, -, *, / only). */
export function cos(x: number): number {
  const { quadrant, r } = reduceQuadrant(x);
  switch (quadrant) {
    case 0: return cosKernel(r);
    case 1: return -sinKernel(r);
    case 2: return -cosKernel(r);
    default: return sinKernel(r);
  }
}

/** exp Taylor kernel, accurate for |r| <= ln(2)/2 to well past float64 precision. */
function expKernel(r: number): number {
  // 1 + r + r^2/2! + ... + r^12/12!, factored and evaluated by Horner's
  // method as 1 + r*(1 + r/2*(1 + r/3*(1 + r/4*(...(1 + r/12)...)))): each
  // step is `acc = 1 + (r/k)*acc`, mirroring sinKernel/cosKernel's
  // `acc = 1 - (r2/k)*acc` shape above (an earlier version of this function
  // used `acc = 1/k + r*acc`, which is a different, wrong polynomial - it
  // does not compute the exponential series at all. Caught by comparing
  // `exp(1)` against `Math.E`.)
  let acc = 1 + r / 12;
  acc = 1 + (r / 11) * acc;
  acc = 1 + (r / 10) * acc;
  acc = 1 + (r / 9) * acc;
  acc = 1 + (r / 8) * acc;
  acc = 1 + (r / 7) * acc;
  acc = 1 + (r / 6) * acc;
  acc = 1 + (r / 5) * acc;
  acc = 1 + (r / 4) * acc;
  acc = 1 + (r / 3) * acc;
  acc = 1 + (r / 2) * acc;
  return 1 + r * acc;
}

/** Our own `exp`, exact-per-engine by construction. */
export function exp(x: number): number {
  const n = Math.round(x / LN2);
  const r = x - n * LN2;
  return pow2Int(n) * expKernel(r);
}

/**
 * Our own natural log for x > 0, exact-per-engine by construction. Reduces
 * x = m * 2^e with m in [1, 2) by repeated exact doubling/halving (never
 * `Math.pow` or bit tricks), then evaluates the fast-converging series for
 * atanh on (m-1)/(m+1) (Cody & Waite's approach): ln(m) = 2*atanh((m-1)/(m+1)).
 */
export function log(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  let m = x;
  let e = 0;
  while (m >= 2) { m *= 0.5; e++; }
  while (m < 1) { m *= 2; e--; }
  const z = (m - 1) / (m + 1);
  const z2 = z * z;
  // 2z * (1 + z2/3 + z2^2/5 + z2^3/7 + ... + z2^8/17), Horner's method.
  let acc = 1 / 17;
  acc = 1 / 15 + z2 * acc;
  acc = 1 / 13 + z2 * acc;
  acc = 1 / 11 + z2 * acc;
  acc = 1 / 9 + z2 * acc;
  acc = 1 / 7 + z2 * acc;
  acc = 1 / 5 + z2 * acc;
  acc = 1 / 3 + z2 * acc;
  acc = 1 + z2 * acc;
  return e * LN2 + 2 * z * acc;
}

/**
 * Our own `pow`. An integer exponent (the common case: envelope shaping,
 * material curves) is computed by exact exponentiation by squaring, correct
 * for any sign of `base`. A non-integer exponent needs `base > 0` and goes
 * through `exp(exponent * log(base))`.
 */
export function pow(base: number, exponent: number): number {
  if (Number.isInteger(exponent)) {
    const negative = exponent < 0;
    let e = negative ? -exponent : exponent;
    let b = base;
    let result = 1;
    while (e > 0) {
      if (e & 1) result *= b;
      b *= b;
      e = Math.floor(e / 2);
    }
    return negative ? 1 / result : result;
  }
  if (base <= 0) throw new RangeError('pow: a non-integer exponent needs a positive base');
  return exp(exponent * log(base));
}

/**
 * Our own `tanh`, built from `exp` above (never `Math.tanh`). Saturates
 * exactly at +-1 well before `exp` would overflow, matching the standard
 * library's own saturation boundary in spirit if not in bit pattern.
 */
export function tanh(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return -1;
  const e2x = exp(2 * x);
  return (e2x - 1) / (e2x + 1);
}

/** exp(x) - 1, computed via the exp() kernel directly when |x| is small to
 * avoid the catastrophic cancellation `exp(x) - 1` suffers near x = 0. */
export function expm1(x: number): number {
  if (Math.abs(x) >= LN2 / 2) return exp(x) - 1;
  return expKernel(x) - 1;
}

/** Our own `tan`, built from `sin`/`cos` above (never `Math.tan`): exact by
 * construction since division is exact per ECMA-262. Used once per filter
 * design (K-weighting biquads in `loudness/kweight.ts`), never per-sample. */
export function tan(x: number): number {
  return sin(x) / cos(x);
}

/** log base 10, via our own `log` (never `Math.log10`). Used by
 * `loudness/*` to turn a mean-square power into dB/LUFS. */
export function log10(x: number): number {
  return log(x) / LN10;
}

/** ln(10) to double precision. */
export const LN10 = 2.302585092994045684017991454684364;
