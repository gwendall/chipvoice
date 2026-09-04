import type { ChipDriver, FmPatch, NoteFrame, RegisterEvent } from "../../chip.js";
import { YM_INPUT_HZ } from "./dsp.js";
import { PSG_CLOCK_HZ } from "./sn76489.js";

/**
 * The Mega Drive's driver: a note's frames to bytes on the YM2612's four
 * ports and the PSG's one, as a 68000 program wrote them.
 *
 * An FM note is a patch - thirty register writes, made once per channel and
 * kept until the patch changes - then the frequency as a block and an
 * F-number, then a key-on. Volume is the carriers' total level, which the
 * chip takes live, so a volume table costs a write per carrier per frame and
 * no retrigger. The note ends with a key-off and the patch's release.
 *
 * The chip takes a register as an address byte and then a data byte, and it
 * is busy for thirty-two of its cycles after the data: the writes here are
 * spaced as a program that waits on the busy flag spaces them. Each voice's
 * writes start at their own offset into the frame so two voices changing in
 * one frame do not interleave.
 *
 * The PSG takes one byte per write: a latch with the low bits, a data byte
 * with the high ones. The noise is clocked by tone 3, which is what a driver
 * gave up to get a noise rate of its choosing.
 */

/** Master cycles between an address byte and its data byte: one internal cycle. */
const PAIR = 42;
/** Master cycles between register writes: the busy flag's thirty-two cycles. */
const GAP = 42 * 32;
/**
 * Each voice's writes start this far into the frame per voice, counted from
 * one, so they never interleave with each other or with power-on's.
 */
const STAGGER = 80000;

const YM_PORT = 0xa04000;
const PSG_PORT = 0xc00011;

/** Operator register offsets in the order OP1, OP2, OP3, OP4: the chip numbers them 1, 3, 2, 4. */
const OP_OFFSET = [0, 8, 4, 12];

/** Which operators reach the output, per algorithm, in OP1 to OP4 indices. */
const CARRIERS = [[3], [3], [3], [3], [1, 3], [1, 2, 3], [1, 2, 3], [0, 1, 2, 3]];

const NES_NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];

/** The default patch, for an FM voice with no patch of its own: a plain two-operator tone. */
const DEFAULT_PATCH: FmPatch = {
  algorithm: 4,
  feedback: 3,
  ops: [
    { dt: 0, mul: 1, tl: 38, ks: 0, ar: 31, dr: 10, sr: 0, sl: 2, rr: 8 },
    { dt: 0, mul: 1, tl: 0, ks: 0, ar: 31, dr: 12, sr: 3, sl: 3, rr: 8 },
    { dt: 0, mul: 2, tl: 44, ks: 0, ar: 31, dr: 10, sr: 0, sl: 3, rr: 8 },
    { dt: 0, mul: 1, tl: 0, ks: 0, ar: 31, dr: 12, sr: 3, sl: 3, rr: 8 },
  ],
};

/** A volume 0 to 15 as an attenuation to add to a carrier's total level, in 0.75 dB steps. */
function attenuation(volume: number): number {
  if (volume <= 0) return 127;
  return Math.round((-20 * Math.log10(volume / 15)) / 0.75);
}

/** Block and F-number for a pitch: F = 144 f 2^(21-B) / clock, with B chosen so F fits in eleven bits. */
function fmFrequency(freq: number): { block: number; fnum: number } {
  if (freq <= 0) return { block: 0, fnum: 0 };
  let block = 0;
  let fnum = (144 * freq * Math.pow(2, 21)) / YM_INPUT_HZ;
  while (fnum >= 2048 && block < 7) {
    fnum /= 2;
    block++;
  }
  return { block, fnum: Math.max(0, Math.min(2047, Math.round(fnum))) };
}

/** A PSG tone period for a pitch: f = clock / (32 N). */
function psgPeriod(freq: number): number {
  if (freq <= 0) return 1023;
  return Math.max(2, Math.min(1023, Math.round(PSG_CLOCK_HZ / (32 * freq))));
}

const VOICES = ["fm1", "fm2", "fm3", "fm4", "fm5", "fm6", "psg1", "psg2", "psg3", "noise"];

export class MdDriver implements ChipDriver {
  /** The patch each FM channel holds, so a note with the same one costs no patch writes. */
  private readonly loaded: (FmPatch | null)[] = [null, null, null, null, null, null];
  /** The carriers' attenuation last written per channel, so a held note costs nothing. */
  private readonly lastVolume = [-1, -1, -1, -1, -1, -1];

  powerOn(): RegisterEvent[] {
    this.loaded.fill(null);
    this.lastVolume.fill(-1);
    const out: RegisterEvent[] = [];
    let t = 0;
    const reg = (port: number, address: number, value: number) => {
      out.push({ at: t, addr: YM_PORT + port, value: address });
      out.push({ at: t + PAIR, addr: YM_PORT + port + 1, value });
      t += GAP;
    };
    reg(0, 0x22, 0x00); // LFO off
    reg(0, 0x27, 0x00); // channel 3 normal, timers off
    reg(0, 0x2b, 0x00); // DAC off
    for (let ch = 0; ch < 6; ch++) reg(0, 0x28, ch < 3 ? ch : ch + 1); // every key off
    // The PSG: every voice silent.
    for (let ch = 0; ch < 4; ch++) out.push({ at: t + ch * 60, addr: PSG_PORT, value: 0x9f | (ch << 5) });
    return out;
  }

  note(voice: string, frames: NoteFrame[]): RegisterEvent[] {
    const index = VOICES.indexOf(voice);
    if (index < 0 || frames.length === 0) return [];
    const out: RegisterEvent[] = [];
    const offset = (index + 1) * STAGGER;
    if (index < 6) this.fmNote(index, frames, offset, out);
    else if (index < 9) this.psgNote(index - 6, frames, offset, out);
    else this.noiseNote(frames, offset, out);
    return out;
  }

  private fmNote(channel: number, frames: NoteFrame[], offset: number, out: RegisterEvent[]) {
    const port = channel < 3 ? 0 : 2;
    const sub = channel % 3;
    const keyIndex = channel < 3 ? channel : channel + 1;
    let lastBlock = -1;
    let lastFnum = -1;
    frames.forEach((s, f) => {
      let t = s.at + offset;
      const reg = (address: number, value: number) => {
        out.push({ at: t, addr: YM_PORT + port, value: address });
        out.push({ at: t + PAIR, addr: YM_PORT + port + 1, value: value & 0xff });
        t += GAP;
      };
      const global = (address: number, value: number) => {
        out.push({ at: t, addr: YM_PORT, value: address });
        out.push({ at: t + PAIR, addr: YM_PORT + 1, value: value & 0xff });
        t += GAP;
      };
      const patch = s.fm ?? DEFAULT_PATCH;
      const carriers = CARRIERS[patch.algorithm & 7];
      const level = attenuation(s.volume);
      const writeVolume = () => {
        for (const op of carriers) {
          reg(0x40 + OP_OFFSET[op] + sub, Math.min(127, patch.ops[op].tl + level));
        }
      };
      const { block, fnum } = fmFrequency(s.freq);
      if (f === 0) {
        global(0x28, keyIndex); // key off, so a note on a sounding channel restarts
        if (this.loaded[channel] !== patch) {
          patch.ops.forEach((op, i) => {
            const base = OP_OFFSET[i] + sub;
            reg(0x30 + base, ((op.dt & 7) << 4) | (op.mul & 15));
            reg(0x50 + base, ((op.ks & 3) << 6) | (op.ar & 31));
            reg(0x60 + base, ((op.am ? 1 : 0) << 7) | (op.dr & 31));
            reg(0x70 + base, op.sr & 31);
            reg(0x80 + base, ((op.sl & 15) << 4) | (op.rr & 15));
            reg(0x90 + base, 0);
          });
          // Modulators' levels are the patch's; carriers' are set with the volume.
          patch.ops.forEach((op, i) => {
            if (!carriers.includes(i)) reg(0x40 + OP_OFFSET[i] + sub, op.tl & 127);
          });
          reg(0xb0 + sub, ((patch.feedback & 7) << 3) | (patch.algorithm & 7));
          reg(0xb4 + sub, 0xc0 | ((patch.ams ?? 0) << 4) | (patch.pms ?? 0));
          this.loaded[channel] = patch;
        }
        writeVolume();
        this.lastVolume[channel] = level;
        reg(0xa4 + sub, (block << 3) | (fnum >> 8));
        reg(0xa0 + sub, fnum & 0xff);
        global(0x28, 0xf0 | keyIndex);
      } else {
        if (level !== this.lastVolume[channel]) {
          writeVolume();
          this.lastVolume[channel] = level;
        }
        if (block !== lastBlock || fnum !== lastFnum) {
          reg(0xa4 + sub, (block << 3) | (fnum >> 8));
          reg(0xa0 + sub, fnum & 0xff);
        }
      }
      lastBlock = block;
      lastFnum = fnum;
    });
  }

  private psgNote(channel: number, frames: NoteFrame[], offset: number, out: RegisterEvent[]) {
    let lastPeriod = -1;
    let lastVolume = -1;
    frames.forEach((s) => {
      let t = s.at + offset;
      const byte = (value: number) => {
        out.push({ at: t, addr: PSG_PORT, value });
        t += 60;
      };
      const period = psgPeriod(s.freq);
      if (period !== lastPeriod) {
        byte(0x80 | (channel << 5) | (period & 0x0f));
        byte((period >> 4) & 0x3f);
      }
      const volume = 15 - Math.max(0, Math.min(15, s.volume));
      if (volume !== lastVolume) byte(0x90 | (channel << 5) | volume);
      lastPeriod = period;
      lastVolume = volume;
    });
  }

  /** The noise, clocked by tone 3 at the 2A03's rate for the index, white. */
  private noiseNote(frames: NoteFrame[], offset: number, out: RegisterEvent[]) {
    let lastPeriod = -1;
    let lastVolume = -1;
    frames.forEach((s, f) => {
      let t = s.at + offset;
      const byte = (value: number) => {
        out.push({ at: t, addr: PSG_PORT, value });
        t += 60;
      };
      const rate = 1789773 / NES_NOISE_PERIODS[Math.max(0, Math.min(15, s.period))];
      const period = Math.max(1, Math.min(1023, Math.round(PSG_CLOCK_HZ / (32 * rate))));
      if (period !== lastPeriod) {
        byte(0xc0 | (period & 0x0f));
        byte((period >> 4) & 0x3f);
      }
      // The noise register resets the shift register, so it is written once.
      if (f === 0) byte(0xe7);
      const volume = 15 - Math.max(0, Math.min(15, s.volume));
      if (volume !== lastVolume) byte(0xf0 | volume);
      lastPeriod = period;
      lastVolume = volume;
    });
  }

  noteOff(voice: string, at: number): RegisterEvent[] {
    const index = VOICES.indexOf(voice);
    if (index < 0) return [];
    const t = at + (index + 1) * STAGGER;
    if (index < 6) {
      const keyIndex = index < 3 ? index : index + 1;
      return [
        { at: t, addr: YM_PORT, value: 0x28 },
        { at: t + PAIR, addr: YM_PORT + 1, value: keyIndex },
      ];
    }
    if (index < 9) return [{ at: t, addr: PSG_PORT, value: 0x9f | ((index - 6) << 5) }];
    return [{ at: t, addr: PSG_PORT, value: 0xff }];
  }
}
