/**
 * The Mega Drive's sound: a YM2612 and an SN76489 on one bus, at one clock.
 *
 * Events are stamped on the master clock, 53693175 Hz on an NTSC machine,
 * because it is the one clock both chips and the CPU divide from: the 68000
 * and the YM2612's input run at a seventh of it, the YM2612's internal cycle
 * at a forty-second, the PSG at a fifteenth. A register log in master cycles
 * is what a logic capture of the bus would give.
 *
 * The YM2612's registers are reached through four ports at `$A04000` to
 * `$A04003`: address and data for channels 1 to 3, address and data for 4 to
 * 6. The PSG has one port at `$C00011`. A log uses those addresses; a chip
 * that took decoded fields would be the mistake decision 2 undid.
 *
 * `MdChip` is the digital pair, ten voices: six FM channels at their nine-bit
 * outputs, three PSG tones and the noise at their four-bit levels. Parity on
 * the FM voices is against Nuked-OPN2, which the YM2612 here is ported from;
 * the PSG is from the documents. `MdOutputStage` is everything after: the
 * YM2612's ladder DAC as Nuked models it, the PSG summed in, a Model 1's
 * output filter as a placeholder for a measurement. `MdCore` is the two
 * behind `ChipCore`.
 */

import type { ChipCore, DigitalChip, RegisterEvent } from "../../chip.js";
import { Sn76489 } from "./sn76489.js";
import { Ym2612 } from "./ym2612.js";

/** The NTSC master clock. */
export const MASTER_HZ = 53693175;
/** The 68000's and the YM2612's input clock: master over seven. */
export const YM_INPUT_HZ = MASTER_HZ / 7;
/** Master cycles per YM2612 internal cycle: seven times six. */
const YM_STEP = 42;
/** Master cycles per PSG cycle. */
const PSG_STEP = 15;

export const MD_PROCESSOR_NAME = "md-processor";

export const MD_VOICES = ["fm1", "fm2", "fm3", "fm4", "fm5", "fm6", "psg1", "psg2", "psg3", "noise"] as const;

const YM_BASE = 0xa04000;
const PSG_PORT = 0xc00011;

export class MdChip implements DigitalChip {
  readonly voices = MD_VOICES;
  readonly ym: Ym2612;
  readonly psg = new Sn76489();
  /** The absolute master cycle about to be clocked. */
  cycle = 0;
  private untilYm = YM_STEP;
  private untilPsg = PSG_STEP;
  /** Writes to each chip, in time order; a write reaches its chip on the chip's cycle that starts at or after it. */
  private ymPending: RegisterEvent[] = [];
  private psgPending: RegisterEvent[] = [];
  private nextYm = 0;
  private nextPsg = 0;
  /** A write waiting for the YM2612's next internal cycle, one at a time as the chip takes them. */
  private readonly ymQueue: { port: number; value: number }[] = [];

  constructor(type: "ym2612" | "ym3438" = "ym2612") {
    this.ym = new Ym2612(type);
  }

  schedule(events: RegisterEvent[]) {
    // Consumed writes must never be replayed when the next audio block arrives.
    this.ymPending.splice(0, this.nextYm);
    this.psgPending.splice(0, this.nextPsg);
    for (const e of events) {
      if ((e.addr & 0xfffffc) === YM_BASE) this.ymPending.push(e);
      else if (e.addr === PSG_PORT) this.psgPending.push(e);
    }
    this.ymPending.sort((a, b) => a.at - b.at);
    this.psgPending.sort((a, b) => a.at - b.at);
    this.nextYm = 0;
    this.nextPsg = 0;
  }

  load() {}

  /** A write, as the bus delivers it: to a YM port or to the PSG. */
  write(addr: number, value: number) {
    if ((addr & 0xfffffc) === YM_BASE) this.ymQueue.push({ port: addr & 3, value: value & 0xff });
    else if (addr === PSG_PORT) this.psg.write(value);
  }

  /** True after a `run` in which the YM2612 clocked: its pins have a new value. */
  ymTicked = false;

  /** Master cycles until one of the chips next moves. */
  untilNext(): number {
    return Math.min(this.untilYm, this.untilPsg);
  }

  /**
   * Advances `n` master cycles, `n` at most `untilNext()`, so that at most one
   * cycle of each chip lands, at the end. A chip's cycle that ends at the
   * target began a step earlier, and a write stamped at or before that start
   * is delivered to it first: the convention the oracle uses, a write at
   * cycle `t` reaching the chip on the internal cycle that starts at `t`.
   */
  run(n: number) {
    const target = this.cycle + n;
    this.cycle = target;
    this.untilYm -= n;
    this.untilPsg -= n;
    this.ymTicked = false;
    if (this.untilYm === 0) {
      this.untilYm = YM_STEP;
      const start = target - YM_STEP;
      while (this.nextYm < this.ymPending.length && this.ymPending[this.nextYm].at <= start) {
        const e = this.ymPending[this.nextYm++];
        this.ymQueue.push({ port: e.addr & 3, value: e.value & 0xff });
      }
      const w = this.ymQueue.shift();
      if (w) this.ym.write(w.port, w.value);
      this.ym.clock();
      this.ymTicked = true;
    }
    if (this.untilPsg === 0) {
      this.untilPsg = PSG_STEP;
      const start = target - PSG_STEP;
      while (this.nextPsg < this.psgPending.length && this.psgPending[this.nextPsg].at <= start) {
        this.psg.write(this.psgPending[this.nextPsg++].value);
      }
      this.psg.clock();
    }
  }

  /** One master cycle. */
  step() {
    this.run(1);
  }

  /** Every voice's value now: the FM channels' nine-bit outputs, the PSG's four-bit levels. */
  outputs(into: number[]) {
    for (let i = 0; i < 6; i++) into[i] = this.ym.ch_out[i];
    this.psgValues(into, 6);
  }

  private readonly psgScratch = [0, 0, 0, 0];

  private psgValues(into: number[], offset: number) {
    this.psg.outputs(this.psgScratch);
    for (let i = 0; i < 4; i++) into[offset + i] = this.psgScratch[i];
  }

  trace(cycles: number, onChange: (cycle: number, voice: number, value: number) => void) {
    const last = new Array<number>(MD_VOICES.length).fill(0);
    const now = new Array<number>(MD_VOICES.length).fill(0);
    const end = this.cycle + cycles;
    // A change is stamped with the start of the chip cycle that made it, and
    // the two chips' cycles start at different times, so changes are held
    // back until nothing earlier can still come and reported in order.
    const held: { cycle: number; voice: number; value: number }[] = [];
    const flush = (before: number) => {
      held.sort((a, b) => a.cycle - b.cycle || a.voice - b.voice);
      while (held.length > 0 && held[0].cycle < before) {
        const c = held.shift()!;
        onChange(c.cycle, c.voice, c.value);
      }
    };
    while (this.cycle < end) {
      const n = Math.min(this.untilNext(), end - this.cycle);
      this.run(n);
      const ymAt = this.cycle - YM_STEP;
      const psgAt = this.cycle - PSG_STEP;
      this.outputs(now);
      for (let v = 0; v < now.length; v++) {
        if (now[v] !== last[v]) {
          last[v] = now[v];
          held.push({ cycle: v < 6 ? ymAt : psgAt, voice: v, value: now[v] });
        }
      }
      flush(this.cycle - YM_STEP);
    }
    flush(Infinity);
  }

  reset() {
    this.ym.reset();
    this.psg.reset();
    this.cycle = 0;
    this.untilYm = YM_STEP;
    this.untilPsg = PSG_STEP;
    this.ymPending = [];
    this.psgPending = [];
    this.nextYm = 0;
    this.nextPsg = 0;
    this.ymQueue.length = 0;
  }
}

/**
 * What comes after the chips. A placeholder built to be replaced by a
 * measurement of a real unit: the YM2612's pins as Nuked models them, the
 * PSG summed at a level chosen by ear against recordings, and a first-order
 * low-pass where a Model 1 has one. The sheet says it is unmeasured.
 */
export interface MdOutputProfile {
  name: string;
  /** A PSG voice at full volume, in the units of a sample-averaged FM channel. */
  psgLevel: number;
  /** The output low-pass, in Hz. */
  lowPassHz: number;
  /** The coupling high-pass, in Hz. */
  highPassHz: number;
  /** Full scale to 1.0. */
  scale: number;
}

/**
 * A full-scale FM channel, averaged over a sample as Nuked's users do: its
 * nine-bit value times three for one cycle in twenty-four, a sign bit for
 * the rest. About 33. The PSG's level is in the same units.
 */
export const MD1_PROFILE: MdOutputProfile = {
  name: "md1",
  psgLevel: 20,
  lowPassHz: 2840,
  highPassHz: 20,
  scale: 1 / 140,
};

const PSG_LEVELS = new Float32Array(16);
for (let i = 0; i < 16; i++) PSG_LEVELS[i] = i === 0 ? 0 : Math.pow(10, (-2 * (15 - i)) / 20);

export class MdOutputStage {
  private readonly profile: MdOutputProfile;
  private sumL = 0;
  private sumR = 0;
  private count = 0;
  private lpL = 0;
  private lpR = 0;
  private hpL = 0;
  private hpR = 0;
  private hpInL = 0;
  private hpInR = 0;
  private readonly lpA: number;
  private readonly hpA: number;

  constructor(sampleRate: number, profile: MdOutputProfile) {
    this.profile = profile;
    this.lpA = 1 - Math.exp((-2 * Math.PI * profile.lowPassHz) / sampleRate);
    this.hpA = Math.exp((-2 * Math.PI * profile.highPassHz) / sampleRate);
  }

  begin() {
    this.sumL = 0;
    this.sumR = 0;
    this.count = 0;
  }

  /** The YM2612's pins and the PSG's levels, on one internal cycle of the YM2612. */
  add(mol: number, mor: number, psg: number[]) {
    let p = 0;
    for (let i = 0; i < 4; i++) p += PSG_LEVELS[psg[i]];
    const psgLevel = p * this.profile.psgLevel;
    this.sumL += mol + psgLevel;
    this.sumR += mor + psgLevel;
    this.count++;
  }

  end(gain: number): [number, number] {
    const inL = (this.count ? this.sumL / this.count : 0) * this.profile.scale;
    const inR = (this.count ? this.sumR / this.count : 0) * this.profile.scale;
    this.lpL += this.lpA * (inL - this.lpL);
    this.lpR += this.lpA * (inR - this.lpR);
    const outL = this.hpA * (this.hpL + this.lpL - this.hpInL);
    const outR = this.hpA * (this.hpR + this.lpR - this.hpInR);
    this.hpInL = this.lpL;
    this.hpInR = this.lpR;
    this.hpL = outL;
    this.hpR = outR;
    return [outL * gain, outR * gain];
  }
}

export class MdCore implements ChipCore {
  readonly sampleRate: number;
  readonly chip = new MdChip();
  readonly stage: MdOutputStage;
  private remainder = 0;
  private nextSample = -1;
  private masterGain = 1;
  private readonly psg = [0, 0, 0, 0];

  constructor(sampleRate: number, profile: MdOutputProfile = MD1_PROFILE) {
    this.sampleRate = sampleRate;
    this.stage = new MdOutputStage(sampleRate, profile);
  }

  render(left: Float32Array, right: Float32Array | null, startSample: number) {
    const n = left.length;
    if (startSample !== this.nextSample) this.seek(startSample);
    const chip = this.chip;
    const stage = this.stage;
    for (let i = 0; i < n; i++) {
      stage.begin();
      this.remainder += MASTER_HZ;
      let budget = Math.floor(this.remainder / this.sampleRate);
      this.remainder -= budget * this.sampleRate;
      while (budget > 0) {
        const n = Math.min(budget, chip.untilNext());
        chip.run(n);
        budget -= n;
        // The YM2612 changes its pins once an internal cycle; the PSG's
        // outputs are read with them. Averaged over the sample, which is what
        // the capacitor after the pins does.
        if (chip.ymTicked) {
          chip.psg.outputs(this.psg);
          stage.add(chip.ym.mol, chip.ym.mor, this.psg);
        }
      }
      const [l, r] = stage.end(this.masterGain);
      left[i] = l;
      if (right) right[i] = r;
    }
    this.nextSample = startSample + n;
  }

  private seek(sample: number) {
    const scaled = sample * MASTER_HZ;
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
