/**
 * The MOS 6581 SID, the Commodore 64's sound chip: the digital part.
 *
 * Three voices, each an oscillator and an envelope. The oscillator is a
 * 24-bit accumulator that a 16-bit frequency is added to every cycle; its top
 * twelve bits are the sawtooth, folded on the top bit for the triangle,
 * compared with a 12-bit width for the pulse, and a 23-bit shift register
 * clocked by bit 19 of the accumulator is the noise. Selecting two waveforms
 * at once ANDs them through the DAC's own wiring, which is not an AND at all.
 * A voice can reset its neighbour's accumulator (sync) or fold its triangle
 * on the neighbour's top bit (ring modulation). The envelope is an 8-bit
 * counter driven by a 15-bit rate register and slowed down by an exponential
 * counter as it falls, with a gate bit starting its attack and its release.
 *
 * Written from the 6581 datasheet, from kevtris's rate register values, from
 * plogue's ADSR findings and from the behaviour the VICE and reSID projects
 * recovered from the die and published: the two-cycle shift pipeline, the
 * cycle-by-cycle state machine of a gate change, the write-back of combined
 * waveforms into the noise register, the accumulator's even bits high at
 * power-on. The harness checks all of it against reSID-fp, which stays in
 * the harness: see decision 18.
 *
 * What comes out is two digital values per voice, the twelve-bit waveform
 * and the eight-bit envelope, before the DACs. The DACs, the filter and the
 * output stage are the analog part, in `dsp.ts`, and a profile.
 */

import type { DigitalChip, RegisterEvent } from "../../chip.js";

/** The PAL C64's clock: the one most SID music was written for. */
export const PAL_CLOCK_HZ = 985248;
/** The NTSC C64's. */
export const NTSC_CLOCK_HZ = 1022727;

/** The order `trace` reports voices in: three waveforms, then three envelopes. */
export const SID_VOICES = ["osc1", "osc2", "osc3", "env1", "env2", "env3"] as const;

/**
 * The envelope rates: how many cycles between steps of the counter, for each
 * of the sixteen values of attack, decay or release. The datasheet's times
 * (2 ms to 8 s for a full attack) divided by the 256 steps, except rate 8,
 * where the value kevtris read off the chip is one cycle longer than the
 * datasheet's 391.
 */
export const RATE_PERIOD = [9, 32, 63, 95, 149, 220, 267, 313, 392, 977, 1954, 3126, 3907, 11720, 19532, 31251];

/**
 * The 15-bit rate register is a shift register with feedback from its two
 * low bits, and the envelope steps when it reaches a value chosen per rate.
 * The value for a period of p cycles is where the register lands after p - 1
 * shifts from all ones: kevtris read these off the chip and they follow.
 */
export const RATE_COMPARE = RATE_PERIOD.map((period) => {
  let lfsr = 0x7fff;
  for (let i = 0; i < period - 1; i++) lfsr = (lfsr >> 1) | (((lfsr ^ (lfsr >> 1)) & 1) << 14);
  return lfsr;
});

/**
 * The exponential counter's period at the envelope levels where it changes:
 * the decay slows down as it falls, so a linear counter makes an exponential
 * curve. Measured by plogue on a 6581 R3.
 */
const EXPONENTIAL_PERIOD: Record<number, number> = { 0xff: 1, 0x5d: 2, 0x36: 4, 0x1a: 8, 0x0e: 16, 0x06: 30, 0x00: 1 };

/**
 * Cycles the waveform output holds its last value with no waveform
 * selected, and cycles the test bit takes to clear the noise register: both
 * are a capacitor discharging and vary with temperature and chip. These are
 * a warm 6581 R3's.
 */
const FLOATING_TTL = 95000;
const NOISE_RESET = 210000;

/**
 * The noise register's output taps: which of its twenty-three bits become
 * which of the eight noise bits, the low four of the twelve being grounded.
 * The register shifts left, bit 0 taking bit 22 XOR bit 17.
 */
const NOISE_TAPS: [number, number][] = [[20, 11], [18, 10], [14, 9], [11, 8], [9, 7], [5, 6], [2, 5], [0, 4]];
const NOISE_TAP_MASK = NOISE_TAPS.reduce((m, [bit]) => m | (1 << bit), 0);

function noiseBits(register: number): number {
  let out = 0;
  for (const [bit, outBit] of NOISE_TAPS) if (register & (1 << bit)) out |= 1 << outBit;
  return out;
}

/** The output, written back over the register's tapped bits: a zero clears them. */
function noiseWriteback(output: number): number {
  let keep = ~NOISE_TAP_MASK;
  for (const [bit, outBit] of NOISE_TAPS) if (output & (1 << outBit)) keep |= 1 << bit;
  return keep;
}

/**
 * The combined waveforms.
 *
 * Two waveforms selected at once do not AND: each output bit is a transistor
 * pulled by its own value and, through the wiring, by its neighbours, closer
 * ones harder, and the pulse pulls every bit from above. The result is a bit
 * where that adds up past a threshold. The model has six numbers per
 * combination: the threshold, the pulse's pull, how much the top bit counts
 * under a sawtooth, how fast a neighbour's pull fades with distance below
 * and above, and for saw with triangle, which is really two sawtooths at
 * different speeds, how much of each. They are fitted against reSID-fp's
 * tables for a 6581 R2, themselves fitted to kevtris's samplings; the fit's
 * score is on the chip's sheet.
 */
export interface CombinedModel {
  bias: number;
  pull: number;
  top: number;
  below: number;
  above: number;
  mix: number;
}

/** Indexed by the waveform bits: 3 saw+tri, 5 pulse+tri, 6 pulse+saw, 7 all three. */
export const COMBINED_6581: Record<3 | 5 | 6 | 7, CombinedModel> = {
  3: { bias: 0.90251, pull: 0, top: 0, below: 1.6747, above: 1.9147, mix: 0.62376 },
  5: { bias: 0.93088, pull: 2.4843, top: 0, below: 1.1484, above: 1.0353, mix: 0 },
  6: { bias: 0.90988, pull: 2.26303, top: 1.13126, below: 1.13801, above: 1.0035, mix: 0 },
  7: { bias: 0.91, pull: 1.192, top: 0, below: 1.2, above: 1.0169, mix: 0.637 },
};

export function combinedWaveform(model: CombinedModel, waveform: number, index: number): number {
  const level = new Float32Array(12);
  for (let i = 0; i < 12; i++) level[i] = (index >> i) & 1;
  if ((waveform & 3) === 1) {
    // The triangle: the bits below the top one, shifted up, inverted on it.
    const top = (index & 0x800) !== 0;
    for (let i = 11; i > 0; i--) level[i] = top ? 1 - level[i - 1] : level[i - 1];
    level[0] = 0;
  } else if ((waveform & 3) === 3) {
    // Saw with triangle: the triangle's selector is pulled down by the
    // sawtooth's, so what is left is two sawtooths, one twice as fast.
    level[0] *= model.mix;
    for (let i = 1; i < 12; i++) level[i] = level[i - 1] * (1 - model.mix) + level[i] * model.mix;
  }
  if (waveform & 2) level[11] *= model.top;
  if (waveform === 3 || waveform > 4) {
    const pulled = new Float32Array(12);
    for (let i = 0; i < 12; i++) {
      let sum = 0;
      let weight = 0;
      for (let j = 0; j < 12; j++) {
        const w = j > i ? Math.fround(1 / Math.pow(model.above, j - i)) : j < i ? Math.fround(1 / Math.pow(model.below, i - j)) : 1;
        sum = Math.fround(sum + Math.fround(level[j] * w));
        weight = Math.fround(weight + w);
      }
      if (waveform > 4) {
        const w = Math.fround(1 / Math.pow(model.above, 12 - i));
        sum = Math.fround(sum + Math.fround(model.pull * w));
        weight = Math.fround(weight + w);
      }
      pulled[i] = Math.fround(Math.fround(level[i] + Math.fround(sum / weight)) * 0.5);
    }
    level.set(pulled);
  }
  let value = 0;
  for (let i = 0; i < 12; i++) if (level[i] > model.bias) value |= 1 << i;
  return value;
}

/** The eight tables the waveform bits select, 4096 twelve-bit values each. */
export function buildWaveTables(combined: Record<3 | 5 | 6 | 7, CombinedModel>): Int16Array[] {
  const tables: Int16Array[] = [];
  for (let wf = 0; wf < 8; wf++) {
    const t = new Int16Array(4096);
    for (let i = 0; i < 4096; i++) {
      if (wf === 1) t[i] = (i & 0x800) === 0 ? i << 1 : (i ^ 0xfff) << 1;
      else if (wf === 2) t[i] = i;
      else if (wf === 3 || wf > 4) t[i] = combinedWaveform(combined[wf as 3 | 5 | 6 | 7], wf, i);
      else t[i] = 0xfff;
    }
    tables.push(t);
  }
  return tables;
}

const TABLES_6581 = buildWaveTables(COMBINED_6581);

class Oscillator {
  /** Even bits high at power-on; a reset does not touch it. */
  accumulator = 0x555555;
  frequency = 0;
  pulseWidth = 0;
  /** The control register's top four bits: noise, pulse, saw, triangle. */
  waveform = 0;
  test = false;
  sync = false;
  /** The top bit, when the triangle folds on the ring modulator's. */
  ringMask = 0;
  /** The 23-bit noise register, shifting left. */
  noise = 0x7fffff;
  /** Cycles until a shift started by bit 19 lands: two. */
  shiftPipeline = 0;
  /** Cycles of test bit left before the noise register is all ones again. */
  noiseReset = 0;
  /** The eight noise bits as the output sees them. */
  noiseOut = 0;
  /** The pulse comparator's result, a cycle late. */
  pulseLevel = 0xfff;
  /** The twelve-bit waveform output. */
  output = 0;
  /** Cycles the output still holds with no waveform selected. */
  floating = 0;
  /** Whether the accumulator's top bit went high on this cycle. */
  msbRose = false;
  table = TABLES_6581[0];

  /** The accumulator, and the noise register when bit 19 rises. */
  clock() {
    if (this.test) {
      if (this.noiseReset !== 0 && --this.noiseReset === 0) {
        this.noise = 0x7fffff;
        this.noiseOut = noiseBits(this.noise);
      }
      // The test bit holds the pulse high.
      this.pulseLevel = 0xfff;
      return;
    }
    const before = this.accumulator;
    this.accumulator = (before + this.frequency) & 0xffffff;
    const rose = ~before & this.accumulator;
    this.msbRose = (rose & 0x800000) !== 0;
    if (rose & 0x080000) this.shiftPipeline = 2;
    else if (this.shiftPipeline !== 0 && --this.shiftPipeline === 0) this.shiftNoise();
  }

  private shiftNoise(bit0 = ((this.noise >> 22) ^ (this.noise >> 17)) & 1) {
    this.noise = ((this.noise << 1) | bit0) & 0x7fffff;
    this.noiseOut = noiseBits(this.noise);
  }

  /**
   * The waveform output for this cycle, after every oscillator has been
   * clocked, given the oscillator this one is ring-modulated by.
   */
  compute(ring: Oscillator) {
    if (this.waveform !== 0) {
      const index = (this.accumulator ^ (~ring.accumulator & this.ringMask)) >>> 12;
      let out = this.table[index];
      if (this.waveform & 4) out &= this.pulseLevel;
      if (this.waveform & 8) out &= this.noiseOut;
      // Pulse with noise: only a run of high bits survives.
      if ((this.waveform & 0xc) === 0xc) out = out < 0xf00 ? 0 : out & (out << 1) & (out << 2);
      this.output = out;
      // With the sawtooth in a combination, a low top bit pulls the
      // accumulator's own down.
      if (this.waveform & 2 && this.waveform & 0xd) this.accumulator &= (out << 12) | 0x7fffff;
      // A combination with noise writes its output back over the register's
      // taps, except while a shift is half way through.
      if (this.waveform > 8 && !this.test && this.shiftPipeline !== 1) {
        this.noise &= noiseWriteback(out);
        this.noiseOut &= out;
      }
    } else if (this.floating !== 0 && --this.floating === 0) {
      this.output = 0;
    }
    this.pulseLevel = this.accumulator >>> 12 >= this.pulseWidth ? 0xfff : 0;
  }

  writeControl(value: number) {
    const wasWaveform = this.waveform;
    const wasTest = this.test;
    this.waveform = value >> 4;
    this.test = (value & 0x08) !== 0;
    this.sync = (value & 0x02) !== 0;
    this.ringMask = value & 0x04 && !(value & 0x20) ? 0x800000 : 0;
    if (this.waveform !== wasWaveform) {
      this.table = TABLES_6581[this.waveform & 7];
      if (this.waveform === 0) this.floating = FLOATING_TTL;
    }
    if (this.test !== wasTest) {
      if (this.test) {
        this.accumulator = 0;
        this.shiftPipeline = 0;
        this.noiseReset = NOISE_RESET;
      } else {
        // Releasing the test bit finishes a shift. A combination with noise
        // writes its output back first, unless it was pulse with noise, is
        // becoming noise alone, or swaps the triangle for the sawtooth.
        const swap = ((wasWaveform & 3) === 1 && (this.waveform & 3) === 2) || ((wasWaveform & 3) === 2 && (this.waveform & 3) === 1);
        if (wasWaveform > 8 && this.waveform !== 8 && wasWaveform !== 0xc && !swap) this.noise &= noiseWriteback(this.output);
        // With the test bit in the feedback, bit 0 takes NOT bit 17.
        this.shiftNoise(((~this.noise) >> 17) & 1);
      }
    }
  }

  reset() {
    this.frequency = 0;
    this.pulseWidth = 0;
    this.msbRose = false;
    this.waveform = 0;
    this.test = false;
    this.sync = false;
    this.ringMask = 0;
    this.table = TABLES_6581[0];
    this.pulseLevel = 0xfff;
    this.noise = 0x7fffff;
    this.noiseReset = 0;
    // The register is clocked once as the reset line goes.
    this.shiftNoise(((~this.noise) >> 17) & 1);
    this.shiftPipeline = 0;
    this.output = 0;
    this.floating = 0;
  }
}

const enum Phase {
  Attack,
  DecaySustain,
  Release,
}

class Envelope {
  /** The 15-bit rate register. */
  lfsr = 0x7fff;
  /** What it has to reach for the counter to step. */
  rate = RATE_COMPARE[0];
  exponential = 0;
  exponentialPeriod = 1;
  exponentialPeriodNext = 0;
  /** Cycles until a change of phase lands. */
  phasePipeline = 0;
  /** Cycles until the counter steps. */
  counterPipeline = 0;
  /** Cycles until the exponential counter's step lands. */
  exponentialPipeline = 0;
  phase = Phase.Release;
  nextPhase = Phase.Release;
  /** Cleared when the counter reaches zero; only an attack sets it again. */
  counting = true;
  gate = false;
  lfsrReset = false;
  /** 0xaa at power-on; a reset does not touch it. */
  counter = 0xaa;
  attack = 0;
  decay = 0;
  /** The sustain nibble in both nibbles: the counter is compared with both. */
  sustain = 0;
  release = 0;
  /** What ENV3 reads: the counter, a cycle late. */
  env3 = 0;

  clock() {
    this.env3 = this.counter;
    if (this.exponentialPeriodNext > 0) {
      this.exponentialPeriod = this.exponentialPeriodNext;
      this.exponentialPeriodNext = 0;
    }
    if (this.phasePipeline) this.changePhase();
    if (this.counterPipeline !== 0 && --this.counterPipeline === 0) {
      if (this.counting) {
        if (this.phase === Phase.Attack) {
          this.counter = (this.counter + 1) & 0xff;
          if (this.counter === 0xff) {
            this.nextPhase = Phase.DecaySustain;
            this.phasePipeline = 3;
          }
        } else {
          this.counter = (this.counter - 1) & 0xff;
          if (this.counter === 0) this.counting = false;
        }
        const period = EXPONENTIAL_PERIOD[this.counter];
        if (period !== undefined) this.exponentialPeriodNext = period;
      }
    } else if (this.exponentialPipeline !== 0 && --this.exponentialPipeline === 0) {
      this.exponential = 0;
      // Decaying towards the sustain level, or releasing: the counter steps.
      if ((this.phase === Phase.DecaySustain && this.counter !== this.sustain) || this.phase === Phase.Release) this.counterPipeline = 1;
    } else if (this.lfsrReset) {
      this.lfsr = 0x7fff;
      this.lfsrReset = false;
      if (this.phase === Phase.Attack) {
        // An attack step also resets the exponential counter.
        this.exponential = 0;
        this.counterPipeline = 2;
      } else if (this.counting && ++this.exponential === this.exponentialPeriod) {
        this.exponentialPipeline = this.exponentialPeriod !== 1 ? 2 : 1;
      }
    }
    // The rate register shifts until it matches, then starts over: a rate
    // set below its current value waits for it to wrap, which is the ADSR
    // delay bug.
    if (this.lfsr !== this.rate) this.lfsr = (this.lfsr >> 1) | (((this.lfsr ^ (this.lfsr >> 1)) & 1) << 14);
    else this.lfsrReset = true;
  }

  /**
   * A change of phase, one cycle at a time, as the die does it: the attack
   * enables the decay rate for a cycle before its own, the release from an
   * attack lands a cycle later than from a decay.
   */
  private changePhase() {
    this.phasePipeline--;
    switch (this.nextPhase) {
      case Phase.Attack:
        if (this.phasePipeline === 1) this.rate = RATE_COMPARE[this.decay];
        else if (this.phasePipeline === 0) {
          this.phase = Phase.Attack;
          this.rate = RATE_COMPARE[this.attack];
          this.counting = true;
        }
        break;
      case Phase.DecaySustain:
        if (this.phasePipeline === 0) {
          this.phase = Phase.DecaySustain;
          this.rate = RATE_COMPARE[this.decay];
        }
        break;
      case Phase.Release:
        if ((this.phase === Phase.Attack && this.phasePipeline === 0) || (this.phase === Phase.DecaySustain && this.phasePipeline === 1)) {
          this.phase = Phase.Release;
          this.rate = RATE_COMPARE[this.release];
        }
        break;
    }
  }

  writeControl(value: number) {
    const gate = (value & 0x01) !== 0;
    if (gate === this.gate) return;
    this.gate = gate;
    if (gate) {
      this.nextPhase = Phase.Attack;
      this.phasePipeline = 2;
      if (this.lfsrReset || this.exponentialPipeline === 2) {
        this.counterPipeline = this.exponentialPeriod === 1 || this.exponentialPipeline === 2 ? 2 : 4;
      } else if (this.exponentialPipeline === 1) {
        this.phasePipeline = 3;
      }
    } else {
      this.nextPhase = Phase.Release;
      this.phasePipeline = this.counterPipeline > 0 ? 3 : 2;
    }
  }

  writeAttackDecay(value: number) {
    this.attack = (value >> 4) & 0x0f;
    this.decay = value & 0x0f;
    if (this.phase === Phase.Attack) this.rate = RATE_COMPARE[this.attack];
    else if (this.phase === Phase.DecaySustain) this.rate = RATE_COMPARE[this.decay];
  }

  writeSustainRelease(value: number) {
    this.sustain = (value & 0xf0) | (value >> 4);
    this.release = value & 0x0f;
    if (this.phase === Phase.Release) this.rate = RATE_COMPARE[this.release];
  }

  reset() {
    this.counterPipeline = 0;
    this.phasePipeline = 0;
    this.exponentialPipeline = 0;
    this.attack = 0;
    this.decay = 0;
    this.sustain = 0;
    this.release = 0;
    this.gate = false;
    this.lfsrReset = true;
    this.exponential = 0;
    this.exponentialPeriod = 1;
    this.exponentialPeriodNext = 0;
    this.phase = Phase.Release;
    this.nextPhase = Phase.Release;
    this.counting = true;
    this.rate = RATE_COMPARE[0];
  }
}

/**
 * The chip. Byte writes to `$D400-$D7FF` in, stamped with the cycle they
 * land on; each voice's waveform and envelope out, cycle by cycle, with the
 * filter and volume registers for whoever mixes them.
 */
export class Sid implements DigitalChip {
  readonly voices = SID_VOICES;
  readonly osc = [new Oscillator(), new Oscillator(), new Oscillator()];
  readonly env = [new Envelope(), new Envelope(), new Envelope()];
  /** `$D415-$D416`: the filter cutoff, eleven bits. */
  cutoff = 0;
  /** `$D417`: resonance in the high nibble, which voices are filtered in the low. */
  resonanceFilter = 0;
  /** `$D418`: the filter modes and voice 3 off in the high nibble, the volume in the low. */
  modeVolume = 0;
  /** The last byte written: what a write-only register reads back as. */
  private bus = 0;

  /** The absolute cycle about to be clocked. */
  cycle = 0;
  private events: RegisterEvent[] = [];

  /** Power-on is a reset: the accumulators and counters keep their power-on values. */
  constructor() {
    this.reset();
  }

  write(addr: number, value: number) {
    if ((addr & 0xfc00) !== 0xd400) return;
    const v = value & 0xff;
    this.bus = v;
    const reg = addr & 0x1f;
    if (reg < 0x15) {
      const voice = Math.floor(reg / 7);
      const osc = this.osc[voice];
      switch (reg % 7) {
        case 0: osc.frequency = (osc.frequency & 0xff00) | v; break;
        case 1: osc.frequency = (osc.frequency & 0x00ff) | (v << 8); break;
        case 2: osc.pulseWidth = (osc.pulseWidth & 0xf00) | v; break;
        case 3: osc.pulseWidth = (osc.pulseWidth & 0x0ff) | ((v & 0x0f) << 8); break;
        case 4:
          osc.writeControl(v);
          this.env[voice].writeControl(v);
          break;
        case 5: this.env[voice].writeAttackDecay(v); break;
        case 6: this.env[voice].writeSustainRelease(v); break;
      }
      return;
    }
    switch (reg) {
      case 0x15: this.cutoff = (this.cutoff & 0x7f8) | (v & 0x07); break;
      case 0x16: this.cutoff = (this.cutoff & 0x007) | (v << 3); break;
      case 0x17: this.resonanceFilter = v; break;
      case 0x18: this.modeVolume = v; break;
    }
  }

  /** OSC3 and ENV3 read; everything else reads the last byte on the bus. */
  read(addr: number): number {
    if ((addr & 0xfc00) !== 0xd400) return 0xff;
    switch (addr & 0x1f) {
      case 0x1b: return this.osc[2].output >> 4;
      case 0x1c: return this.env[2].env3;
      default: return this.bus;
    }
  }

  /** One cycle of the three voices, then the sync between them. */
  clockVoices() {
    const [a, b, c] = this.osc;
    a.clock();
    b.clock();
    c.clock();
    for (const env of this.env) env.clock();
    // Each voice is modulated by the one before it: 1 by 3, 2 by 1, 3 by 2.
    a.compute(c);
    b.compute(a);
    c.compute(b);
    // And syncs the one after it, unless it was itself synced on the cycle
    // its top bit rose.
    for (let i = 0; i < 3; i++) {
      const source = this.osc[i];
      const target = this.osc[(i + 1) % 3];
      const own = this.osc[(i + 2) % 3];
      if (!source.test && source.frequency !== 0 && source.msbRose && target.sync && !(source.sync && own.msbRose)) target.accumulator = 0;
    }
  }

  /**
   * One cycle of the chip: the writes due on it land, before it is clocked,
   * then it is clocked, then the count advances.
   */
  step() {
    while (this.events.length > 0 && this.events[0].at <= this.cycle) {
      const ev = this.events[0];
      this.events.shift();
      this.write(ev.addr, ev.value);
    }
    this.clockVoices();
    this.cycle++;
  }

  outputs(into: number[]) {
    for (let v = 0; v < 3; v++) {
      into[v] = this.osc[v].output;
      into[3 + v] = this.env[v].counter;
    }
  }

  load() {
    // No memory: the SID has three oscillators and twenty-nine registers.
  }

  schedule(events: RegisterEvent[]) {
    for (const ev of events) this.events.push(ev);
    this.events.sort((a, b) => a.at - b.at);
  }

  trace(cycles: number, onChange: (cycle: number, voice: number, value: number) => void) {
    const last = [0, 0, 0, 0, 0, 0];
    const now = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < cycles; i++) {
      const cycle = this.cycle;
      this.step();
      this.outputs(now);
      for (let v = 0; v < 6; v++) {
        if (now[v] !== last[v]) {
          last[v] = now[v];
          onChange(cycle, v, now[v]);
        }
      }
    }
  }

  /** The reset line: registers cleared, the accumulators and counters left as they are. */
  reset() {
    this.events.length = 0;
    for (const osc of this.osc) osc.reset();
    for (const env of this.env) env.reset();
    this.cutoff = 0;
    this.resonanceFilter = 0;
    this.modeVolume = 0;
    this.bus = 0;
  }
}
