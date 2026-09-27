/**
 * The pieces of the analog stage the bench needs to reimplement on its own,
 * so that `render.mjs` can produce a "profile-free" render and `compare.mjs`
 * can synthesise fake captures at chosen corners - neither of which the
 * package exposes, since `NesOutputStage` only ever renders the one shipping
 * profile through `nesChip`.
 *
 * Nothing here is a secret: the DAC's non-linear mixing curve is the nesdev
 * wiki's own published formula, quoted verbatim on this project's own sheet
 * (docs/chips/2a03.md's analog-stage section) and cited in CONFORMANCE.md;
 * the filters are the generic one-pole exponential sections every emulator's
 * output stage uses, parameterised here instead of fixed to one profile.
 * `packages/chipvoice`'s own `NesOutputStage` is not imported, and this file
 * does not change if it does - the two are independent implementations of
 * the same public formulas, the way the harness's oracles are independent of
 * the core they check.
 */

/** The pulses' shared non-linear DAC curve, from the nesdev wiki. */
export function mixPulses(p1, p2) {
  const sum = p1 + p2;
  return sum === 0 ? 0 : 95.88 / (8128 / sum + 100);
}

/** The triangle, noise and DMC's shared non-linear DAC curve, from the nesdev wiki. */
export function mixTnd(triangle, noise, dmc) {
  const denom = triangle / 8227 + noise / 12241 + dmc / 22638;
  return denom === 0 ? 0 : 159.79 / (1 / denom + 100);
}

/**
 * A one-pole high-pass section, in the same exponential form nesdev's own
 * profile uses: `y[n] = c * (y[n-1] + x[n] - x[n-1])`, `c = exp(-2*pi*fc/fs)`.
 */
export class OnePoleHighPass {
  constructor(fcHz, sampleRate) {
    this.c = Math.exp((-2 * Math.PI * fcHz) / sampleRate);
    this.y = 0;
    this.lastX = 0;
    this.primed = false;
  }
  process(x) {
    if (!this.primed) {
      this.primed = true;
      this.lastX = x;
    }
    this.y = this.c * (this.y + x - this.lastX);
    this.lastX = x;
    return this.y;
  }
}

/** A one-pole low-pass section: `y[n] = y[n-1] + c * (x[n] - y[n-1])`, `c = 1 - exp(-2*pi*fc/fs)`. */
export class OnePoleLowPass {
  constructor(fcHz, sampleRate) {
    this.c = 1 - Math.exp((-2 * Math.PI * fcHz) / sampleRate);
    this.y = 0;
    this.primed = false;
  }
  process(x) {
    if (!this.primed) {
      this.primed = true;
      this.y = x;
    }
    this.y += this.c * (x - this.y);
    return this.y;
  }
}

/**
 * A chain of the same shape as `NesOutputStage`, parameterised: two
 * high-passes, one low-pass, a gain. Passing `null` for `highPassHz`/
 * `lowPassHz` skips that section entirely - what makes a "profile-free"
 * render possible, since there is no such thing as a filter with a corner
 * of zero or infinity in this implementation, only the absence of one.
 */
export class AnalogStage {
  constructor({ highPassHz = null, lowPassHz = null, gain = 1 }, sampleRate) {
    this.hp1 = highPassHz?.[0] ? new OnePoleHighPass(highPassHz[0], sampleRate) : null;
    this.hp2 = highPassHz?.[1] ? new OnePoleHighPass(highPassHz[1], sampleRate) : null;
    this.lp = lowPassHz ? new OnePoleLowPass(lowPassHz, sampleRate) : null;
    this.gain = gain;
  }
  process(x) {
    let s = x;
    if (this.hp1) s = this.hp1.process(s);
    if (this.hp2) s = this.hp2.process(s);
    if (this.lp) s = this.lp.process(s);
    return Math.max(-1, Math.min(1, s * this.gain));
  }
}

/**
 * Steps `digital` (an `Nes2A03`, from `nesChip.digital()`) for `totalCycles`
 * cycles, box-averaging the DAC-mixed output over each output sample the way
 * `NesOutputStage` does, and passing every sample through `stage`.
 *
 * This is the shared inner loop `render.mjs`'s profile-free render and
 * `compare.mjs`'s synthetic-capture generator both need: a cycle-accurate
 * digital core, decimated and filtered independently of the package.
 */
export function renderThroughStage(digital, stage, sampleRate, totalCycles) {
  const totalSamples = Math.ceil((totalCycles * sampleRate) / 1789773);
  const out = new Float32Array(totalSamples);
  const voices = [0, 0, 0, 0, 0];
  let remainder = 0;
  const CPU_HZ = 1789773;
  for (let i = 0; i < totalSamples; i++) {
    let sum = 0;
    let count = 0;
    remainder += CPU_HZ;
    while (remainder >= sampleRate) {
      digital.step();
      digital.outputs(voices);
      sum += mixPulses(voices[0], voices[1]) + mixTnd(voices[2], voices[3], voices[4]);
      count++;
      remainder -= sampleRate;
    }
    const mixed = count > 0 ? sum / count : 0;
    out[i] = stage.process(mixed);
  }
  return out;
}
