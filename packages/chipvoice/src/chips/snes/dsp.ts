/**
 * The SNES's sound: the S-DSP and its 64 KB, on the SPC700's clock.
 *
 * Events are stamped on the SPC700's clock, 1024000 Hz, which is the DSP's
 * clock too: one phase of its pipeline per cycle, thirty-two to a sample. The
 * DSP's registers are reached the way the SPC700 reaches them: a register
 * number to `$F2`, a byte to `$F3`. Samples live in the RAM the two share,
 * put there by `load`, which is what a program did when it copied its
 * samples in before playing.
 *
 * `SnesChip` is the digital chip, and its two voices are the DSP's output
 * stream, left and right: on this chip the digital output is the sixteen-bit
 * word the DSP hands its DAC, and that stream is what the harness compares.
 * `SnesOutputStage` is what comes after: the DAC and the filter, as a
 * placeholder for a measurement. `SnesCore` is the two behind `ChipCore`.
 */

import type { ChipCore, DigitalChip, RegisterEvent } from "../../chip.js";
import { SDsp } from "./sdsp.js";

/** The SPC700's clock, and the DSP's. */
export const SPC_HZ = 1024000;
/** Clocks per sample: the DSP's output rate is 32000 Hz. */
export const CLOCKS_PER_SAMPLE = 32;

export const SNES_PROCESSOR_NAME = "snes-processor";

export const SNES_VOICES = ["left", "right"] as const;

export class SnesChip implements DigitalChip {
  readonly voices = SNES_VOICES;
  readonly ram = new Uint8Array(0x10000);
  readonly dsp = new SDsp(this.ram);
  /** The absolute cycle about to be clocked. */
  cycle = 0;
  private selected = 0;
  private pending: RegisterEvent[] = [];
  private next = 0;

  schedule(events: RegisterEvent[]) {
    this.pending.splice(0, this.next);
    for (const e of events) this.pending.push(e);
    this.pending.sort((a, b) => a.at - b.at);
    this.next = 0;
  }

  /** Bytes into the RAM the DSP reads its samples from. */
  load(address: number, bytes: Uint8Array) {
    for (let i = 0; i < bytes.length; i++) this.ram[(address + i) & 0xffff] = bytes[i];
  }

  /** A write as the SPC700 makes it: which register to `$F2`, the byte to `$F3`. */
  write(addr: number, value: number) {
    if (addr === 0xf2) this.selected = value & 0xff;
    else if (addr === 0xf3 && this.selected < 0x80) this.dsp.write(this.selected, value);
  }

  /** One clock: the writes stamped at or before it, then one phase of the DSP. */
  step() {
    while (this.next < this.pending.length && this.pending[this.next].at <= this.cycle) {
      const e = this.pending[this.next++];
      this.write(e.addr, e.value);
    }
    this.dsp.run(1);
    this.cycle++;
  }

  /** The two voices: the DSP's last output sample. */
  outputs(into: number[]) {
    into[0] = this.dsp.outL;
    into[1] = this.dsp.outR;
  }

  trace(cycles: number, onChange: (cycle: number, voice: number, value: number) => void) {
    let lastL = 0;
    let lastR = 0;
    const end = this.cycle + cycles;
    while (this.cycle < end) {
      const c = this.cycle;
      this.step();
      if (!this.dsp.sampleReady) continue;
      if (this.dsp.outL !== lastL) {
        lastL = this.dsp.outL;
        onChange(c, 0, lastL);
      }
      if (this.dsp.outR !== lastR) {
        lastR = this.dsp.outR;
        onChange(c, 1, lastR);
      }
    }
  }

  reset() {
    this.dsp.reset();
    this.cycle = 0;
    this.selected = 0;
    this.pending = [];
    this.next = 0;
  }
}

/**
 * After the DSP: a sixteen-bit DAC at 32000 Hz and the console's output
 * filter. A placeholder until a real unit is measured: the DAC holds each
 * sample, a first-order low-pass rounds the steps off, a high-pass takes the
 * coupling capacitor's part.
 */
export interface SnesOutputProfile {
  name: string;
  lowPassHz: number;
  highPassHz: number;
  scale: number;
}

export const SNES_PROFILE: SnesOutputProfile = {
  name: "snes",
  lowPassHz: 14000,
  highPassHz: 20,
  scale: 1 / 32768,
};

export class SnesOutputStage {
  private readonly profile: SnesOutputProfile;
  private heldL = 0;
  private heldR = 0;
  private lpL = 0;
  private lpR = 0;
  private hpL = 0;
  private hpR = 0;
  private hpInL = 0;
  private hpInR = 0;
  private readonly lpA: number;
  private readonly hpA: number;

  constructor(sampleRate: number, profile: SnesOutputProfile) {
    this.profile = profile;
    this.lpA = 1 - Math.exp((-2 * Math.PI * profile.lowPassHz) / sampleRate);
    this.hpA = Math.exp((-2 * Math.PI * profile.highPassHz) / sampleRate);
  }

  /** A new word from the DSP: the DAC holds it. */
  hold(l: number, r: number) {
    this.heldL = l;
    this.heldR = r;
  }

  /** One host sample of what the DAC holds, through the filter. */
  end(gain: number): [number, number] {
    const inL = this.heldL * this.profile.scale;
    const inR = this.heldR * this.profile.scale;
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

export class SnesCore implements ChipCore {
  readonly sampleRate: number;
  readonly chip = new SnesChip();
  readonly stage: SnesOutputStage;
  private remainder = 0;
  private nextSample = -1;
  private masterGain = 1;

  constructor(sampleRate: number, profile: SnesOutputProfile = SNES_PROFILE) {
    this.sampleRate = sampleRate;
    this.stage = new SnesOutputStage(sampleRate, profile);
  }

  render(left: Float32Array, right: Float32Array | null, startSample: number) {
    const n = left.length;
    if (startSample !== this.nextSample) this.seek(startSample);
    const chip = this.chip;
    const stage = this.stage;
    for (let i = 0; i < n; i++) {
      this.remainder += SPC_HZ;
      while (this.remainder >= this.sampleRate) {
        this.remainder -= this.sampleRate;
        chip.step();
        if (chip.dsp.sampleReady) stage.hold(chip.dsp.outL, chip.dsp.outR);
      }
      const [l, r] = stage.end(this.masterGain);
      left[i] = l;
      if (right) right[i] = r;
    }
    this.nextSample = startSample + n;
  }

  private seek(sample: number) {
    const scaled = sample * SPC_HZ;
    this.chip.cycle = Math.floor(scaled / this.sampleRate);
    this.remainder = scaled - this.chip.cycle * this.sampleRate;
  }

  schedule(events: RegisterEvent[]) {
    this.chip.schedule(events);
  }

  load(address: number, bytes: Uint8Array) {
    this.chip.load(address, bytes);
  }

  setGain(value: number) {
    this.masterGain = value;
  }

  reset() {
    this.chip.reset();
  }
}
