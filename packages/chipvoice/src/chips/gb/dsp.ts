/**
 * The Game Boy's sound, the DMG's APU, at the T-cycle.
 *
 * Four voices: two pulses, the first with a frequency sweep; a wave channel
 * that plays thirty-two 4-bit samples out of sixteen bytes of RAM; and a
 * noise channel on a 15-bit register that can be shortened to seven. A frame
 * sequencer at 512 Hz, from the divider, clocks lengths at 256 Hz, the sweep
 * at 128 Hz and the envelopes at 64 Hz. Each voice's DAC takes 0 to 15, and
 * two output amplifiers with their own volumes sum whichever voices a routing
 * register sends them: the chip is stereo.
 *
 * Written from Pan Docs and from blargg's "Game Boy Sound Operation", which
 * is where the obscure behaviour comes from: the extra length clock on an
 * NRx4 write when the next frame step will not clock lengths, the sweep's
 * negate-mode trap, the wave channel's first sample and what touching its RAM
 * does while it plays. His dmg_sound test ROMs check those, and the harness
 * runs them.
 *
 * Same two stages as the 2A03: `GbApu` is the digital chip, `GbOutputStage`
 * everything after the DACs, `GbApuCore` the two behind `ChipCore`. What is
 * verified and what is not is on the chip's sheet, `docs/chips/dmg.md`.
 */

import type { ChipCore, DigitalChip, RegisterEvent } from "../../chip.js";

/** The T-cycle clock. The CPU's machine cycle is four of these. */
export const CLOCK_HZ = 4194304;

export const GB_PROCESSOR_NAME = "gb-apu-processor";

/** The order `trace` reports voices in. */
export const GB_VOICES = ["ch1", "ch2", "ch3", "ch4"] as const;

// Duty patterns, as bits from the most significant: 12.5, 25, 50 and 75 percent.
const DUTY = [
  [0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
];

// The noise divisor, by the low three bits of NR43, in T-cycles before the shift.
const NOISE_DIVISOR = [8, 16, 32, 48, 64, 80, 96, 112];

/** A T-cycle count per frame sequencer step: 4194304 / 512. */
const FRAME_STEP = 8192;

/**
 * What a read of each register returns on top of its bits: the unused ones
 * read as 1. Indexed from `$FF10`.
 */
const READ_MASK = [
  0x80, 0x3f, 0x00, 0xff, 0xbf, // NR10-NR14
  0xff, 0x3f, 0x00, 0xff, 0xbf, // NR20-NR24
  0x7f, 0xff, 0x9f, 0xff, 0xbf, // NR30-NR34
  0xff, 0xff, 0x00, 0x00, 0xbf, // NR40-NR44
  0x00, 0x00, 0x70, // NR50-NR52
];

class Envelope {
  /** NRx2 as written: initial volume, direction, period. */
  register = 0;
  volume = 0;
  timer = 0;
  /** False once the envelope has reached 0 or 15 and stopped. */
  running = false;

  get period() {
    return this.register & 7;
  }

  get add() {
    return (this.register & 0x08) !== 0;
  }

  /** The DAC is on while any of the top five bits of NRx2 is set. */
  get dacOn() {
    return (this.register & 0xf8) !== 0;
  }

  trigger() {
    this.volume = this.register >> 4;
    this.timer = this.period === 0 ? 8 : this.period;
    this.running = true;
  }

  /** At 64 Hz. A period of zero means no envelope at all. */
  clock() {
    if (this.period === 0) return;
    if (--this.timer > 0) return;
    this.timer = this.period;
    if (!this.running) return;
    const next = this.volume + (this.add ? 1 : -1);
    if (next >= 0 && next <= 15) this.volume = next;
    else this.running = false;
  }

  /**
   * Writing NRx2 while the channel runs: the DMG's "zombie mode", as blargg
   * describes it. If the old period was zero and the envelope was still
   * running, the volume goes up by one; otherwise, in subtract mode, by two.
   * A change of direction turns the volume into 16 minus itself. Only the low
   * four bits survive.
   */
  write(value: number) {
    const oldPeriod = this.period;
    const oldAdd = this.add;
    this.register = value;
    if (this.running) {
      if (oldPeriod === 0) this.volume++;
      else if (!oldAdd) this.volume += 2;
      if (oldAdd !== this.add) this.volume = 16 - this.volume;
      this.volume &= 15;
    }
  }
}

/** What every voice has: an enable, a length counter, a DAC. */
interface Voice {
  enabled: boolean;
  length: number;
  lengthEnabled: boolean;
  dacOn(): boolean;
}

class Pulse implements Voice {
  readonly hasSweep: boolean;
  enabled = false;
  duty = 0;
  position = 0;
  frequency = 0;
  timer = 0;
  length = 0;
  lengthEnabled = false;
  readonly env = new Envelope();
  // The sweep, on channel 1 only.
  sweepPeriod = 0;
  sweepNegate = false;
  sweepShift = 0;
  sweepTimer = 0;
  sweepEnabled = false;
  sweepShadow = 0;
  /** True once a calculation has run in negate mode since the trigger. */
  sweepNegated = false;

  constructor(hasSweep: boolean) {
    this.hasSweep = hasSweep;
  }

  dacOn() {
    return this.env.dacOn;
  }

  /** The timer counts T-cycles: (2048 - f) * 4 per duty step. */
  clock() {
    if (--this.timer > 0) return;
    this.timer = (2048 - this.frequency) * 4;
    this.position = (this.position + 1) & 7;
  }

  output(): number {
    if (!this.enabled || !this.dacOn()) return 0;
    return DUTY[this.duty][this.position] ? this.env.volume : 0;
  }

  /** The sweep's next frequency from its shadow, and the overflow check. */
  sweepCalculate(): number {
    const delta = this.sweepShadow >> this.sweepShift;
    const next = this.sweepNegate ? this.sweepShadow - delta : this.sweepShadow + delta;
    if (this.sweepNegate) this.sweepNegated = true;
    if (next > 2047) this.enabled = false;
    return next;
  }

  /** At 128 Hz. */
  clockSweep() {
    if (!this.hasSweep) return;
    if (--this.sweepTimer > 0) return;
    this.sweepTimer = this.sweepPeriod === 0 ? 8 : this.sweepPeriod;
    if (!this.sweepEnabled || this.sweepPeriod === 0) return;
    const next = this.sweepCalculate();
    if (next <= 2047 && this.sweepShift > 0) {
      this.sweepShadow = next;
      this.frequency = next;
      // And once more, for the overflow check alone.
      this.sweepCalculate();
    }
  }
}

class Wave implements Voice {
  enabled = false;
  dac = false;
  frequency = 0;
  timer = 0;
  position = 0;
  /** The byte last fetched from wave RAM; the channel plays out of it. */
  buffer = 0;
  /** 0 mute, 1 full, 2 half, 3 quarter: a right shift of the sample. */
  level = 0;
  length = 0;
  lengthEnabled = false;
  readonly ram = new Uint8Array(16);
  /** Cycles since the last fetch, for what a CPU sees when it touches the RAM. */
  sinceFetch = 1000;

  dacOn() {
    return this.dac;
  }

  /** (2048 - f) * 2 T-cycles per sample. */
  clock() {
    this.sinceFetch++;
    if (--this.timer > 0) return;
    this.timer = (2048 - this.frequency) * 2;
    this.position = (this.position + 1) & 31;
    this.buffer = this.ram[this.position >> 1];
    this.sinceFetch = 0;
  }

  output(): number {
    if (!this.enabled || !this.dac) return 0;
    const sample = this.position & 1 ? this.buffer & 15 : this.buffer >> 4;
    const shift = [4, 0, 1, 2][this.level];
    return sample >> shift;
  }
}

class Noise implements Voice {
  enabled = false;
  shift = 0;
  narrow = false;
  divisor = 0;
  timer = 0;
  lfsr = 0x7fff;
  length = 0;
  lengthEnabled = false;
  readonly env = new Envelope();

  dacOn() {
    return this.env.dacOn;
  }

  period() {
    return NOISE_DIVISOR[this.divisor] << this.shift;
  }

  clock() {
    if (--this.timer > 0) return;
    this.timer = this.period();
    // Shifts of 14 and 15 stop the register; the hardware does not clock it.
    if (this.shift >= 14) return;
    const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;
    this.lfsr = (this.lfsr >> 1) | (bit << 14);
    if (this.narrow) this.lfsr = (this.lfsr & ~0x40) | (bit << 6);
  }

  output(): number {
    if (!this.enabled || !this.dacOn()) return 0;
    return this.lfsr & 1 ? 0 : this.env.volume;
  }
}

/**
 * The digital chip. Byte writes to `$FF10-$FF3F` in, stamped with the
 * T-cycle they land on; each voice's DAC input out, cycle by cycle, with the
 * routing and volumes for whoever mixes them.
 *
 * The frame sequencer follows a divider the chip keeps itself: the falling
 * edge of its bit 12, every 8192 T-cycles. On the console that divider is the
 * CPU's DIV register, and a write to DIV resets it, which `resetDivider`
 * lets a host with a CPU do.
 */
export class GbApu implements DigitalChip {
  readonly voices = GB_VOICES;
  readonly ch1 = new Pulse(true);
  readonly ch2 = new Pulse(false);
  readonly ch3 = new Wave();
  readonly ch4 = new Noise();

  power = false;
  /** NR50: bit 7 and 3 are VIN, bits 6-4 and 2-0 the left and right volumes. */
  nr50 = 0;
  /** NR51: which voices reach which side; high nibble left, low nibble right. */
  nr51 = 0;

  /** The absolute T-cycle about to be clocked. */
  cycle = 0;
  /** The 16-bit divider the frame sequencer follows; DIV is its high byte. */
  divider = 0;
  /** The last frame step executed, 0 to 7. */
  private frameStep = 7;

  private events: RegisterEvent[] = [];

  /** What the console's DIV write does: the divider goes to 0. */
  resetDivider() {
    this.divider = 0;
  }

  private get nextStepClocksLength() {
    return ((this.frameStep + 1) & 7) % 2 === 0;
  }

  /**
   * A register write, `$FF10` to `$FF3F`, as the CPU would make it.
   *
   * With the power off, only NR52 and, on the DMG, the length parts of NRx1
   * are heard.
   */
  write(addr: number, value: number) {
    const v = value & 0xff;
    if (addr >= 0xff30 && addr <= 0xff3f) {
      this.writeWaveRam(addr - 0xff30, v);
      return;
    }
    if (addr === 0xff26) {
      const on = (v & 0x80) !== 0;
      if (this.power && !on) this.powerOff();
      else if (!this.power && on) this.powerOn();
      return;
    }
    if (!this.power) {
      // The DMG's length counters live on with the power off.
      if (addr === 0xff11) this.ch1.length = 64 - (v & 63);
      else if (addr === 0xff16) this.ch2.length = 64 - (v & 63);
      else if (addr === 0xff1b) this.ch3.length = 256 - v;
      else if (addr === 0xff20) this.ch4.length = 64 - (v & 63);
      return;
    }
    switch (addr) {
      case 0xff10: {
        const ch = this.ch1;
        ch.sweepPeriod = (v >> 4) & 7;
        const negate = (v & 0x08) !== 0;
        // Clearing negate after a calculation used it disables the channel.
        if (ch.sweepNegate && !negate && ch.sweepNegated) ch.enabled = false;
        ch.sweepNegate = negate;
        ch.sweepShift = v & 7;
        return;
      }
      case 0xff11:
      case 0xff16: {
        const ch = addr === 0xff11 ? this.ch1 : this.ch2;
        ch.duty = v >> 6;
        ch.length = 64 - (v & 63);
        return;
      }
      case 0xff12:
      case 0xff17: {
        const ch = addr === 0xff12 ? this.ch1 : this.ch2;
        ch.env.write(v);
        if (!ch.env.dacOn) ch.enabled = false;
        return;
      }
      case 0xff13:
      case 0xff18: {
        const ch = addr === 0xff13 ? this.ch1 : this.ch2;
        ch.frequency = (ch.frequency & 0x700) | v;
        return;
      }
      case 0xff14:
      case 0xff19: {
        const ch = addr === 0xff14 ? this.ch1 : this.ch2;
        ch.frequency = (ch.frequency & 0xff) | ((v & 7) << 8);
        this.writeLengthEnable(ch, v, 64);
        if (v & 0x80) this.triggerPulse(ch);
        return;
      }
      case 0xff1a: {
        this.ch3.dac = (v & 0x80) !== 0;
        if (!this.ch3.dac) this.ch3.enabled = false;
        return;
      }
      case 0xff1b:
        this.ch3.length = 256 - v;
        return;
      case 0xff1c:
        this.ch3.level = (v >> 5) & 3;
        return;
      case 0xff1d:
        this.ch3.frequency = (this.ch3.frequency & 0x700) | v;
        return;
      case 0xff1e: {
        const ch = this.ch3;
        ch.frequency = (ch.frequency & 0xff) | ((v & 7) << 8);
        this.writeLengthEnable(ch, v, 256);
        if (v & 0x80) this.triggerWave();
        return;
      }
      case 0xff20:
        this.ch4.length = 64 - (v & 63);
        return;
      case 0xff21:
        this.ch4.env.write(v);
        if (!this.ch4.env.dacOn) this.ch4.enabled = false;
        return;
      case 0xff22:
        this.ch4.shift = v >> 4;
        this.ch4.narrow = (v & 0x08) !== 0;
        this.ch4.divisor = v & 7;
        return;
      case 0xff23: {
        const ch = this.ch4;
        this.writeLengthEnable(ch, v, 64);
        if (v & 0x80) this.triggerNoise();
        return;
      }
      case 0xff24:
        this.nr50 = v;
        return;
      case 0xff25:
        this.nr51 = v;
        return;
      default:
        return;
    }
  }

  /**
   * NRx4's length-enable bit, with the DMG's extra clock: enabling the
   * counter when the next frame step will not clock lengths counts it once
   * at once, and if that brings it to zero without a trigger, the voice is
   * off.
   */
  private writeLengthEnable(ch: Voice, v: number, max: number) {
    const enable = (v & 0x40) !== 0;
    const was = ch.lengthEnabled;
    ch.lengthEnabled = enable;
    if (!was && enable && !this.nextStepClocksLength && ch.length > 0) {
      ch.length--;
      if (ch.length === 0 && !(v & 0x80)) ch.enabled = false;
    }
    void max;
  }

  /**
   * A trigger's shared part: the voice is on, a zero length reloads to the
   * maximum - or one less, when lengths are enabled and the next frame step
   * will not clock them.
   */
  private triggerLength(ch: Voice, max: number) {
    ch.enabled = true;
    if (ch.length === 0) {
      ch.length = max;
      if (ch.lengthEnabled && !this.nextStepClocksLength) ch.length--;
    }
  }

  private triggerPulse(ch: Pulse) {
    this.triggerLength(ch, 64);
    ch.timer = (2048 - ch.frequency) * 4;
    ch.env.trigger();
    if (ch.hasSweep) {
      ch.sweepShadow = ch.frequency;
      ch.sweepTimer = ch.sweepPeriod === 0 ? 8 : ch.sweepPeriod;
      ch.sweepEnabled = ch.sweepPeriod !== 0 || ch.sweepShift !== 0;
      ch.sweepNegated = false;
      if (ch.sweepShift !== 0) ch.sweepCalculate();
    }
    if (!ch.dacOn()) ch.enabled = false;
  }

  private triggerWave() {
    const ch = this.ch3;
    // On the DMG, a trigger in the two cycles before the channel fetches a
    // byte rewrites the start of wave RAM with what it was about to fetch:
    // one byte from the first four, or the aligned four from further in.
    // blargg's ROM 10 is the arbiter of that window, and SameBoy agrees.
    if (ch.enabled && ch.dac && ch.timer <= 2) {
      const index = ((ch.position + 1) >> 1) & 15;
      if (index < 4) ch.ram[0] = ch.ram[index];
      else ch.ram.set(ch.ram.subarray(index & ~3, (index & ~3) + 4), 0);
    }
    this.triggerLength(ch, 256);
    // The position starts over; the sample buffer is not refilled, so the
    // first sample out is whatever was fetched last. The first fetch comes a
    // few cycles late.
    ch.position = 0;
    ch.timer = (2048 - ch.frequency) * 2 + 6;
    if (!ch.dac) ch.enabled = false;
  }

  private triggerNoise() {
    const ch = this.ch4;
    this.triggerLength(ch, 64);
    ch.timer = ch.period();
    ch.lfsr = 0x7fff;
    ch.env.trigger();
    if (!ch.dacOn()) ch.enabled = false;
  }

  /**
   * Wave RAM from the CPU's side. While the channel plays, on the DMG, the
   * RAM is reachable only on the cycle of a fetch, and then it is the byte
   * being fetched, wherever the CPU aimed.
   */
  private writeWaveRam(index: number, v: number) {
    const ch = this.ch3;
    if (ch.enabled && ch.dac) {
      if (ch.sinceFetch <= 1) ch.ram[ch.position >> 1] = v;
      return;
    }
    ch.ram[index] = v;
  }

  private readWaveRam(index: number): number {
    const ch = this.ch3;
    if (ch.enabled && ch.dac) return ch.sinceFetch <= 1 ? ch.ram[ch.position >> 1] : 0xff;
    return ch.ram[index];
  }

  /** What the CPU reads back: the registers under their masks, NR52's flags, wave RAM. */
  read(addr: number): number {
    if (addr >= 0xff30 && addr <= 0xff3f) return this.readWaveRam(addr - 0xff30);
    if (addr === 0xff26) {
      let v = 0x70;
      if (this.power) v |= 0x80;
      if (this.ch1.enabled) v |= 0x01;
      if (this.ch2.enabled) v |= 0x02;
      if (this.ch3.enabled) v |= 0x04;
      if (this.ch4.enabled) v |= 0x08;
      return v;
    }
    if (addr < 0xff10 || addr > 0xff2f) return 0xff;
    const index = addr - 0xff10;
    if (index >= READ_MASK.length) return 0xff;
    return this.registerBits(addr) | READ_MASK[index];
  }

  /** The readable bits of a register, from the state they set. */
  private registerBits(addr: number): number {
    if (!this.power) return 0;
    switch (addr) {
      case 0xff10: return (this.ch1.sweepPeriod << 4) | (this.ch1.sweepNegate ? 0x08 : 0) | this.ch1.sweepShift;
      case 0xff11: return this.ch1.duty << 6;
      case 0xff12: return this.ch1.env.register;
      case 0xff14: return this.ch1.lengthEnabled ? 0x40 : 0;
      case 0xff16: return this.ch2.duty << 6;
      case 0xff17: return this.ch2.env.register;
      case 0xff19: return this.ch2.lengthEnabled ? 0x40 : 0;
      case 0xff1a: return this.ch3.dac ? 0x80 : 0;
      case 0xff1c: return this.ch3.level << 5;
      case 0xff1e: return this.ch3.lengthEnabled ? 0x40 : 0;
      case 0xff21: return this.ch4.env.register;
      case 0xff22: return (this.ch4.shift << 4) | (this.ch4.narrow ? 0x08 : 0) | this.ch4.divisor;
      case 0xff23: return this.ch4.lengthEnabled ? 0x40 : 0;
      case 0xff24: return this.nr50;
      case 0xff25: return this.nr51;
      default: return 0;
    }
  }

  /**
   * Power off: every register to zero and every voice off. The DMG keeps its
   * length counters and its wave RAM.
   */
  private powerOff() {
    this.power = false;
    for (const ch of [this.ch1, this.ch2]) {
      const length = ch.length;
      Object.assign(ch, new Pulse(ch.hasSweep));
      ch.length = length;
    }
    const wave = this.ch3;
    const waveLength = wave.length;
    const ram = wave.ram.slice();
    Object.assign(wave, new Wave());
    wave.ram.set(ram);
    wave.length = waveLength;
    const noise = this.ch4;
    const noiseLength = noise.length;
    Object.assign(noise, new Noise());
    noise.length = noiseLength;
    this.nr50 = 0;
    this.nr51 = 0;
  }

  /** Power on: the frame sequencer's next step is 0; the duty positions start over. */
  private powerOn() {
    this.power = true;
    this.frameStep = 7;
    this.ch1.position = 0;
    this.ch2.position = 0;
    this.ch3.buffer = 0;
  }

  applyEvent(ev: RegisterEvent) {
    this.write(ev.addr, ev.value);
  }

  /** The frame sequencer's step, at 512 Hz. */
  private clockFrame() {
    this.frameStep = (this.frameStep + 1) & 7;
    const step = this.frameStep;
    if (step % 2 === 0) {
      for (const ch of [this.ch1, this.ch2, this.ch3, this.ch4]) {
        if (ch.lengthEnabled && ch.length > 0) {
          ch.length--;
          if (ch.length === 0) ch.enabled = false;
        }
      }
    }
    if (step === 2 || step === 6) this.ch1.clockSweep();
    if (step === 7) {
      this.ch1.env.clock();
      this.ch2.env.clock();
      this.ch4.env.clock();
    }
  }

  /** One T-cycle. */
  clockT() {
    const before = this.divider;
    this.divider = (this.divider + 1) & 0xffff;
    // The falling edge of bit 12 of the divider.
    if ((before & 0x1000) !== 0 && (this.divider & 0x1000) === 0 && this.power) this.clockFrame();
    if (!this.power) return;
    // A voice's timer runs only while the voice is on: the duty position a
    // note starts at is where the last one stopped, not where a timer that
    // kept running in the silence got to. SameBoy's model; no ROM checks it.
    if (this.ch1.enabled) this.ch1.clock();
    if (this.ch2.enabled) this.ch2.clock();
    if (this.ch3.enabled) this.ch3.clock();
    if (this.ch4.enabled) this.ch4.clock();
  }

  /**
   * One cycle of the chip: the writes due on it land, before it is clocked,
   * then it is clocked, then the count advances.
   */
  step() {
    while (this.events.length > 0 && this.events[0].at <= this.cycle) {
      const ev = this.events[0];
      this.events.shift();
      this.applyEvent(ev);
    }
    this.clockT();
    this.cycle++;
  }

  outputs(into: number[]) {
    into[0] = this.ch1.output();
    into[1] = this.ch2.output();
    into[2] = this.ch3.output();
    into[3] = this.ch4.output();
  }

  /** Whether each voice's DAC is on, for an output stage that models the DAC. */
  dacs(into: boolean[]) {
    into[0] = this.ch1.dacOn();
    into[1] = this.ch2.dacOn();
    into[2] = this.ch3.dacOn();
    into[3] = this.ch4.dacOn();
  }

  load() {
    // No sample memory: the wave channel's RAM is written through registers.
  }

  schedule(events: RegisterEvent[]) {
    for (const ev of events) this.events.push(ev);
    this.events.sort((a, b) => a.at - b.at);
  }

  trace(cycles: number, onChange: (cycle: number, voice: number, value: number) => void) {
    const last = [0, 0, 0, 0];
    const now = [0, 0, 0, 0];
    for (let i = 0; i < cycles; i++) {
      const cycle = this.cycle;
      this.step();
      this.outputs(now);
      for (let v = 0; v < 4; v++) {
        if (now[v] !== last[v]) {
          last[v] = now[v];
          onChange(cycle, v, now[v]);
        }
      }
    }
  }

  /** Power-on: everything cleared, the power off, the divider at 0. */
  reset() {
    this.events.length = 0;
    Object.assign(this.ch1, new Pulse(true));
    Object.assign(this.ch2, new Pulse(false));
    Object.assign(this.ch3, new Wave());
    Object.assign(this.ch4, new Noise());
    this.power = false;
    this.nr50 = 0;
    this.nr51 = 0;
    this.divider = 0;
    this.frameStep = 7;
  }
}

/**
 * The DMG's output: four DACs, two amplifiers, a capacitor.
 *
 * Each DAC turns its 4-bit input into a voltage centred on the middle, so 0
 * is as far below silence as 15 is above; a DAC that is off sits at silence.
 * Each side sums the voices its routing bit sends it and scales them by its
 * volume, and the coupling capacitor on the way out is a first-order
 * high-pass with a low corner. The corner and the scale are a profile; this
 * one is what SameBoy uses for a DMG, and nothing has been measured yet.
 */
export interface GbOutputProfile {
  name: string;
  highPassHz: number;
  /** Full scale for one voice at volume 7 on one side. */
  scale: number;
}

export const DMG_PROFILE: GbOutputProfile = { name: "dmg", highPassHz: 28, scale: 0.25 };

export class GbOutputStage {
  readonly profile: GbOutputProfile;
  private sumL = 0;
  private sumR = 0;
  private count = 0;
  private readonly hpCoef: number;
  private hpL = 0;
  private hpR = 0;
  private lastL = 0;
  private lastR = 0;
  private primed = false;

  constructor(sampleRate: number, profile: GbOutputProfile = DMG_PROFILE) {
    this.profile = profile;
    this.hpCoef = Math.exp((-2 * Math.PI * profile.highPassHz) / sampleRate);
  }

  begin() {
    this.sumL = 0;
    this.sumR = 0;
    this.count = 0;
  }

  /** One T-cycle of the four DACs, routed and scaled. */
  add(values: number[], dacs: boolean[], nr50: number, nr51: number) {
    let l = 0;
    let r = 0;
    for (let v = 0; v < 4; v++) {
      if (!dacs[v]) continue;
      const analog = (values[v] - 7.5) / 7.5;
      if (nr51 & (0x10 << v)) l += analog;
      if (nr51 & (0x01 << v)) r += analog;
    }
    this.sumL += (l * (((nr50 >> 4) & 7) + 1)) / 8;
    this.sumR += (r * ((nr50 & 7) + 1)) / 8;
    this.count++;
  }

  /** The two samples: averaged, high-passed, scaled, clamped. */
  end(gain: number): [number, number] {
    let l = this.count > 0 ? this.sumL / this.count : 0;
    let r = this.count > 0 ? this.sumR / this.count : 0;
    if (!this.primed) {
      this.primed = true;
      this.lastL = l;
      this.lastR = r;
    }
    const outL = this.hpCoef * (this.hpL + l - this.lastL);
    this.lastL = l;
    this.hpL = outL;
    const outR = this.hpCoef * (this.hpR + r - this.lastR);
    this.lastR = r;
    this.hpR = outR;
    const s = gain * this.profile.scale;
    return [Math.max(-1, Math.min(1, outL * s)), Math.max(-1, Math.min(1, outR * s))];
  }
}

/** The chip and its output stage behind `ChipCore`. */
export class GbApuCore implements ChipCore {
  readonly sampleRate: number;
  readonly chip = new GbApu();
  readonly stage: GbOutputStage;
  private remainder = 0;
  private nextSample = -1;
  private masterGain = 1;
  private readonly values = [0, 0, 0, 0];
  private readonly dacs = [false, false, false, false];

  constructor(sampleRate: number, profile: GbOutputProfile = DMG_PROFILE) {
    this.sampleRate = sampleRate;
    this.stage = new GbOutputStage(sampleRate, profile);
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
        chip.outputs(this.values);
        chip.dacs(this.dacs);
        stage.add(this.values, this.dacs, chip.nr50, chip.nr51);
      }
      const [l, r] = stage.end(this.masterGain);
      left[i] = l;
      if (right) right[i] = r;
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
