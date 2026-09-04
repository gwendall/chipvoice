import type { ChipDriver, NoteFrame, RegisterEvent } from "../../chip.js";
import { CLOCK_HZ } from "./dsp.js";

/**
 * The Game Boy's driver: a note's frames to bytes on `$FF10-$FF3F`.
 *
 * The same instrument tables as the 2A03's, in the DMG's idiom:
 *
 * - A pulse's volume is the envelope's starting volume and takes effect on a
 *   trigger, so a change of volume retriggers the voice. The trigger reloads
 *   the timer and restarts the envelope but keeps the duty position, which is
 *   why drivers on the hardware could afford it. Silence is volume 0 with the
 *   DAC left on: switching the DAC off is what pops.
 * - The wave channel plays the instrument's waveform, or a triangle, and has
 *   four levels rather than sixteen volumes; the table maps onto them. Its RAM
 *   can only be written while the channel is off, so a new waveform costs a
 *   moment of silence, and the bass carries it because that is where Game Boy
 *   music put the bass.
 * - The noise takes a divisor and a shift rather than a period index; each of
 *   the 2A03's sixteen rates is mapped onto the nearest. Its volume table is
 *   fitted to the hardware envelope at the note's start, since a retrigger
 *   restarts the register and mutes it for its first fifteen shifts, which at
 *   the rates drums use is most of a frame.
 */

const DEFAULT_WAVE = Array.from({ length: 32 }, (_, i) => (i < 16 ? i : 31 - i));

/** NRx3/NRx4: f = 4194304 / (32 (2048 - x)) for a pulse. */
function pulseRegister(freq: number): number {
  if (freq <= 0) return 0;
  return Math.max(0, Math.min(2047, Math.round(2048 - CLOCK_HZ / (32 * freq))));
}

/** The wave channel plays its thirty-two samples per period: twice the rate. */
function waveRegister(freq: number): number {
  if (freq <= 0) return 0;
  return Math.max(0, Math.min(2047, Math.round(2048 - CLOCK_HZ / (64 * freq))));
}

/**
 * A bend in 2A03 period units, applied to a pitch as the ratio it would have
 * made on that chip, so an instrument written there bends the same way here.
 */
function bent(freq: number, offset: number): number {
  if (offset === 0 || freq <= 0) return freq;
  const period = 1789773 / (16 * freq) - 1;
  return (freq * (period + 1)) / (period + 1 + offset);
}

/** NR32's level for a volume: mute, quarter, half, full. */
function waveLevel(volume: number): number {
  if (volume <= 0) return 0;
  if (volume <= 5) return 3;
  if (volume <= 10) return 2;
  return 1;
}

/**
 * The 2A03's sixteen noise rates, each mapped onto the DMG's nearest
 * divisor and shift: the low three bits and the high four of NR43.
 */
const NES_NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const DIVISORS = [8, 16, 32, 48, 64, 80, 96, 112];
const NOISE_RATE: number[] = NES_NOISE_PERIODS.map((p) => {
  const want = 1789773 / p;
  let best = 0;
  let error = Infinity;
  for (let shift = 0; shift < 14; shift++) {
    DIVISORS.forEach((d, code) => {
      const rate = CLOCK_HZ / (d << shift);
      const e = Math.abs(Math.log(rate / want));
      if (e < error) {
        error = e;
        best = (shift << 4) | code;
      }
    });
  }
  return best;
});

/** NRx2 for a volume: the DAC stays on at volume 0. */
const envelope = (volume: number) => (volume > 0 ? volume << 4 : 0x08);

const BASE: Record<string, number> = { ch1: 0xff10, ch2: 0xff15, ch3: 0xff1a, ch4: 0xff1f };

export class GbDriver implements ChipDriver {
  /** What wave RAM holds, so a note with the same waveform does not reload it. */
  private loadedWave: number[] | null = null;
  /** The wave channel's last frequency high bits, for a change that must not trigger. */
  private waveHi = 0;

  /** Power, the master volume at 7 on both sides, every voice to both sides. */
  powerOn(): RegisterEvent[] {
    this.loadedWave = null;
    return [
      { at: 0, addr: 0xff26, value: 0x80 },
      { at: 0, addr: 0xff24, value: 0x77 },
      { at: 0, addr: 0xff25, value: 0xff },
    ];
  }

  note(voice: string, frames: NoteFrame[]): RegisterEvent[] {
    const base = BASE[voice];
    if (base === undefined || frames.length === 0) return [];
    const out: RegisterEvent[] = [];
    const write = (at: number, addr: number, value: number) => out.push({ at, addr, value });

    if (voice === "ch4") {
      const first = frames[0];
      const at = first.at;
      // The envelope fitted to the table: how many levels a frame it loses,
      // as the period of a 64 Hz clock. A flat table gets no envelope.
      let period = 0;
      const last = frames[frames.length - 1];
      if (frames.length > 1 && last.volume < first.volume) {
        const perFrame = (first.volume - last.volume) / (frames.length - 1);
        period = Math.max(1, Math.min(7, Math.round(1 / (0.9375 * perFrame))));
      }
      write(at, 0xff20, 0x00);
      write(at, 0xff21, first.volume > 0 ? (first.volume << 4) | period : 0x08);
      write(at, 0xff22, NOISE_RATE[Math.max(0, Math.min(15, first.period))] | (first.noiseMode ? 0x08 : 0));
      write(at, 0xff23, 0x80);
      // Only the rate follows the table after that: the envelope owns the
      // volume, and a retrigger would restart the register.
      let lastRate = -1;
      frames.forEach((s) => {
        const rate = NOISE_RATE[Math.max(0, Math.min(15, s.period))] | (s.noiseMode ? 0x08 : 0);
        if (lastRate >= 0 && rate !== lastRate) write(s.at, 0xff22, rate);
        lastRate = rate;
      });
      return out;
    }

    if (voice === "ch3") {
      let lastLevel = -1;
      let lastLo = -1;
      let lastHi = -1;
      frames.forEach((s, f) => {
        const at = s.at;
        const x = waveRegister(bent(s.freq, s.pitchOffset));
        const lo = x & 0xff;
        const hi = x >> 8;
        const level = waveLevel(s.volume);
        if (f === 0) {
          const wave = s.wave ?? DEFAULT_WAVE;
          if (!this.loadedWave || wave.some((v, i) => v !== this.loadedWave![i])) {
            // The RAM is only reachable while the channel is off.
            write(at, 0xff1a, 0x00);
            for (let i = 0; i < 16; i++) {
              write(at, 0xff30 + i, ((wave[2 * i] & 15) << 4) | (wave[2 * i + 1] & 15));
            }
            this.loadedWave = wave.slice();
          }
          write(at, 0xff1a, 0x80);
          write(at, 0xff1b, 0x00);
          write(at, 0xff1c, level << 5);
          write(at, 0xff1d, lo);
          write(at, 0xff1e, 0x80 | hi);
        } else {
          if (level !== lastLevel) write(at, 0xff1c, level << 5);
          if (lo !== lastLo) write(at, 0xff1d, lo);
          if (hi !== lastHi) write(at, 0xff1e, hi);
        }
        this.waveHi = hi;
        lastLevel = level;
        lastLo = lo;
        lastHi = hi;
      });
      return out;
    }

    // A pulse.
    let lastDuty = -1;
    let lastVolume = -1;
    let lastLo = -1;
    let lastHi = -1;
    frames.forEach((s, f) => {
      const at = s.at;
      const x = pulseRegister(bent(s.freq, s.pitchOffset));
      const lo = x & 0xff;
      const hi = x >> 8;
      if (f === 0) {
        if (voice === "ch1") write(at, 0xff10, 0x00); // no sweep
        write(at, base + 1, s.duty << 6);
        write(at, base + 2, envelope(s.volume));
        write(at, base + 3, lo);
        write(at, base + 4, 0x80 | hi);
      } else {
        if (s.duty !== lastDuty) write(at, base + 1, s.duty << 6);
        if (lo !== lastLo) write(at, base + 3, lo);
        if (s.volume !== lastVolume) {
          // A new volume takes effect on a trigger, which also carries the
          // high bits. The duty position survives it.
          write(at, base + 2, envelope(s.volume));
          write(at, base + 4, 0x80 | hi);
        } else if (hi !== lastHi) {
          write(at, base + 4, hi);
        }
      }
      lastDuty = s.duty;
      lastVolume = s.volume;
      lastLo = lo;
      lastHi = hi;
    });
    return out;
  }

  noteOff(voice: string, at: number): RegisterEvent[] {
    switch (voice) {
      case "ch1":
        return [{ at, addr: 0xff12, value: 0x08 }, { at, addr: 0xff14, value: 0x80 }];
      case "ch2":
        return [{ at, addr: 0xff17, value: 0x08 }, { at, addr: 0xff19, value: 0x80 }];
      case "ch3":
        return [{ at, addr: 0xff1c, value: 0x00 }];
      case "ch4":
        return [{ at, addr: 0xff21, value: 0x08 }, { at, addr: 0xff23, value: 0x80 }];
      default:
        return [];
    }
  }
}
