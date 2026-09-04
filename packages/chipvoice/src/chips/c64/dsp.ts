/**
 * The 6581 after the digital part: two DACs per voice, the filter, the
 * output stage, and the sample clock.
 *
 * Every number here is a profile, not a fact: the chip is analog from the
 * DACs on, and two 6581s disagree about their filter more than any two
 * consoles disagree about anything. What the profile holds is the shape the
 * documents give - an R-2R ladder with a 2R/R mismatch of 2.2 and no
 * termination, which is what makes the 6581's DACs non-linear; a two-
 * integrator state-variable filter whose cutoff follows the curve measured
 * on a 6581 R4AR, with the well-known kink at 1024; the output stage's
 * corners at 16 Hz and 16 kHz - and nothing has been measured on a unit of
 * our own. The sheet, `docs/chips/c64.md`, says what is verified and what
 * is not.
 *
 * `SidOutputStage` is everything after the DACs, `SidCore` the chip and the
 * stage behind `ChipCore`.
 */

import type { ChipCore, RegisterEvent } from "../../chip.js";
import { PAL_CLOCK_HZ, Sid } from "./sid.js";

export const CLOCK_HZ = PAL_CLOCK_HZ;
export const C64_PROCESSOR_NAME = "sid-processor";

/**
 * The weight of each bit of an R-2R ladder DAC, from the LSB up, with the
 * ladder's actual 2R/R ratio and whether its far end is terminated by 2R.
 * A perfect ladder gives powers of two; the 6581's does not.
 *
 * Each bit drives 2R into its node; nodes are R apart; the output is the
 * top node. A bit's weight is found by Thevenin: the ladder below the bit
 * collapses to one resistance, the bit's source is transformed into the
 * node, and the result is carried up node by node to the top. The weights
 * are then scaled so they sum to full scale, as an ideal ladder's do.
 */
export function ladderWeights(bits: number, ratio: number, terminated: boolean): Float64Array {
  const R = 1;
  const R2 = ratio * R;
  const parallel = (a: number, b: number) => (a === Infinity ? b : b === Infinity ? a : (a * b) / (a + b));
  const weights = new Float64Array(bits);
  for (let bit = 0; bit < bits; bit++) {
    // The ladder below this bit, seen from its node.
    let below = terminated ? R2 : Infinity;
    for (let i = 0; i < bit; i++) below = R + parallel(R2, below);
    // The bit's own source, transformed into its node.
    let v = 1;
    let r: number;
    if (below === Infinity) r = R2;
    else {
      r = parallel(R2, below);
      v = (v * r) / R2;
    }
    // Carried up to the top node, one series R and one shunt 2R at a time.
    for (let i = bit + 1; i < bits; i++) {
      r += R;
      const current = v / r;
      r = parallel(R2, r);
      v = r * current;
    }
    weights[bit] = v;
  }
  let sum = 0;
  for (let i = 0; i < bits; i++) sum += weights[i];
  const scale = ((1 << bits) - 1) / sum;
  for (let i = 0; i < bits; i++) weights[i] *= scale;
  return weights;
}

/** A DAC's output for every input, from its bit weights. */
function dacTable(bits: number, ratio: number, terminated: boolean): Float32Array {
  const weights = ladderWeights(bits, ratio, terminated);
  const table = new Float32Array(1 << bits);
  for (let i = 0; i < table.length; i++) {
    let v = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) v += weights[b];
    table[i] = v;
  }
  return table;
}

export interface SidProfile {
  name: string;
  /** 2R/R of the DAC ladders, and whether their far end is terminated. */
  ladderRatio: number;
  ladderTerminated: boolean;
  /**
   * The waveform value at which a voice is silent: where the envelope DAC's
   * reference sits. The 6581's is not the middle of the range, which is why
   * its envelopes click and why a change of volume alone makes a sound.
   */
  waveZero: number;
  /** The filter's cutoff in Hz at points of the register's range, 0 to 2047. */
  cutoff: [number, number][];
  /** Resonance: Q at the register's 0 and 15. */
  qLow: number;
  qHigh: number;
  /** The output stage's corners: a coupling capacitor and a low-pass. */
  highPassHz: number;
  lowPassHz: number;
  /** Full scale for one voice at full envelope and volume, peak. */
  scale: number;
}

/**
 * A 6581: the ladder from the documents, the cutoff curve as reSID measured
 * it on a 6581 R4AR, which is one chip of a famously varied run.
 */
export const SID_6581_PROFILE: SidProfile = {
  name: "6581",
  ladderRatio: 2.2,
  ladderTerminated: false,
  waveZero: 0x380,
  cutoff: [
    [0, 220], [128, 230], [256, 250], [384, 300], [512, 420], [640, 780], [768, 1600], [832, 2300],
    [896, 3200], [960, 4300], [992, 5000], [1008, 5400], [1016, 5700], [1023, 6000],
    [1024, 4600], [1032, 4800], [1056, 5300], [1088, 6000], [1120, 6600], [1152, 7200],
    [1280, 9500], [1408, 12000], [1536, 14500], [1664, 16000], [1792, 17100], [1920, 17700], [2047, 18000],
  ],
  qLow: 0.707,
  qHigh: 1.707,
  highPassHz: 16,
  lowPassHz: 16000,
  scale: 0.3 / (2048 * 256),
};

/** The cutoff curve as one entry per register value. */
function cutoffTable(points: [number, number][]): Float32Array {
  const table = new Float32Array(2048);
  for (let fc = 0; fc < 2048; fc++) {
    let k = 0;
    while (k < points.length - 2 && points[k + 1][0] <= fc) k++;
    const [x0, y0] = points[k];
    const [x1, y1] = points[k + 1];
    table[fc] = x1 === x0 ? y0 : y0 + ((fc - x0) * (y1 - y0)) / (x1 - x0);
  }
  return table;
}

export class SidOutputStage {
  readonly profile: SidProfile;
  private readonly waveDac: Float32Array;
  private readonly envDac: Float32Array;
  private readonly w0: Float32Array;
  private vlp = 0;
  private vbp = 0;
  private vhp = 0;
  private sum = 0;
  private count = 0;
  private readonly hpCoef: number;
  private readonly lpCoef: number;
  private hp = 0;
  private lp = 0;
  private lastIn = 0;
  private primed = false;

  constructor(sampleRate: number, profile: SidProfile = SID_6581_PROFILE) {
    this.profile = profile;
    this.waveDac = dacTable(12, profile.ladderRatio, profile.ladderTerminated);
    const zero = this.waveDac[profile.waveZero];
    for (let i = 0; i < this.waveDac.length; i++) this.waveDac[i] -= zero;
    this.envDac = dacTable(8, profile.ladderRatio, profile.ladderTerminated);
    const hz = cutoffTable(profile.cutoff);
    this.w0 = new Float32Array(2048);
    for (let fc = 0; fc < 2048; fc++) this.w0[fc] = (2 * Math.PI * hz[fc]) / CLOCK_HZ;
    this.hpCoef = Math.exp((-2 * Math.PI * profile.highPassHz) / sampleRate);
    this.lpCoef = 1 - Math.exp((-2 * Math.PI * profile.lowPassHz) / sampleRate);
  }

  begin() {
    this.sum = 0;
    this.count = 0;
  }

  /** One cycle: the three voices through their DACs, the filter, the volume. */
  add(chip: Sid) {
    const filt = chip.resonanceFilter;
    const mode = chip.modeVolume;
    let direct = 0;
    let filtered = 0;
    for (let v = 0; v < 3; v++) {
      const value = this.waveDac[chip.osc[v].output] * this.envDac[chip.env[v].counter];
      if (filt & (1 << v)) filtered += value;
      else if (!(v === 2 && mode & 0x80)) direct += value;
    }
    // The state-variable filter, one integration step per cycle.
    const w0 = this.w0[chip.cutoff];
    const q = this.profile.qLow + ((this.profile.qHigh - this.profile.qLow) * (filt >> 4)) / 15;
    this.vhp = filtered - this.vlp - this.vbp / q;
    this.vbp += w0 * this.vhp;
    this.vlp += w0 * this.vbp;
    let out = direct;
    if (mode & 0x10) out += this.vlp;
    if (mode & 0x20) out += this.vbp;
    if (mode & 0x40) out += this.vhp;
    this.sum += (out * (mode & 0x0f)) / 15;
    this.count++;
  }

  /** The sample: averaged over its cycles, through the output stage, scaled, clamped. */
  end(gain: number): number {
    const x = this.count > 0 ? this.sum / this.count : 0;
    if (!this.primed) {
      this.primed = true;
      this.lastIn = x;
    }
    const highPassed = this.hpCoef * (this.hp + x - this.lastIn);
    this.lastIn = x;
    this.hp = highPassed;
    this.lp += this.lpCoef * (highPassed - this.lp);
    const s = this.lp * gain * this.profile.scale;
    return Math.max(-1, Math.min(1, s));
  }
}

/** The chip and its output stage behind `ChipCore`. */
export class SidCore implements ChipCore {
  readonly sampleRate: number;
  readonly chip = new Sid();
  readonly stage: SidOutputStage;
  private remainder = 0;
  private nextSample = -1;
  private masterGain = 1;

  constructor(sampleRate: number, profile: SidProfile = SID_6581_PROFILE) {
    this.sampleRate = sampleRate;
    this.stage = new SidOutputStage(sampleRate, profile);
  }

  render(left: Float32Array, right: Float32Array | null, startSample: number) {
    const n = left.length;
    if (startSample !== this.nextSample) this.seek(startSample);
    const chip = this.chip;
    const stage = this.stage;
    for (let i = 0; i < n; i++) {
      stage.begin();
      this.remainder += CLOCK_HZ;
      while (this.remainder >= this.sampleRate) {
        this.remainder -= this.sampleRate;
        chip.step();
        stage.add(chip);
      }
      const s = stage.end(this.masterGain);
      left[i] = s;
      if (right) right[i] = s;
    }
    this.nextSample = startSample + n;
  }

  private seek(sample: number) {
    const scaled = sample * CLOCK_HZ;
    this.chip.cycle = Math.floor(scaled / this.sampleRate);
    this.remainder = scaled - this.chip.cycle * this.sampleRate;
  }

  schedule(events: RegisterEvent[]) {
    this.chip.schedule(events);
  }

  load() {}

  setGain(value: number) {
    this.masterGain = value;
  }

  reset() {
    this.chip.reset();
  }
}
