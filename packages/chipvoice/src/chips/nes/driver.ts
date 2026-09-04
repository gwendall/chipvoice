import type { ChipDriver, NoteFrame, RegisterEvent } from "../../chip.js";
import { CPU_HZ } from "./dsp.js";

/**
 * The 2A03's driver: a note's frames to bytes on `$4000-$4017`, as a program
 * on the hardware wrote them every NMI.
 *
 * What a NES needed and this writes: the sweep byte that keeps low notes
 * audible, a phase restart only where the hardware forces one, silence
 * through each channel's own registers rather than `$4015`. Only changes are
 * written, so a flat sustained note costs one frame of writes.
 */

/** Pulse and noise: f = CPU / (16 * (t + 1)). */
export function freqToPulsePeriod(freq: number): number {
  if (freq <= 0) return 0x7ff;
  return Math.max(0, Math.min(0x7ff, Math.round(CPU_HZ / (16 * freq) - 1)));
}

/** The triangle divides by 32, which is why it sounds an octave lower. */
export function freqToTrianglePeriod(freq: number): number {
  if (freq <= 0) return 0x7ff;
  return Math.max(0, Math.min(0x7ff, Math.round(CPU_HZ / (32 * freq) - 1)));
}

const BASE: Record<string, number> = { p1: 0x4000, p2: 0x4004, tri: 0x4008, noi: 0x400c };

export class NesDriver implements ChipDriver {
  /** The triangle's last period high bits, for silencing it without a blip. */
  private triangleHi = 0;

  /**
   * What a program did first: enable the four voices.
   *
   * `$4015` is written once here and never again. It sets every enable at
   * once, and a driver that schedules notes two hundred milliseconds ahead
   * cannot know what the other channels will be doing on the cycle a write
   * lands: an effect stopping pulse 2 now would carry a lead that ends later,
   * or miss one that starts later. Silence goes through each channel's own
   * registers instead.
   */
  powerOn(): RegisterEvent[] {
    return [{ at: 0, addr: 0x4015, value: 0x0f }];
  }

  note(voice: string, frames: NoteFrame[]): RegisterEvent[] {
    const base = BASE[voice];
    if (base === undefined) return [];
    const out: RegisterEvent[] = [];
    const write = (at: number, addr: number, value: number) => out.push({ at, addr, value });
    const isNoise = voice === "noi";
    const isTriangle = voice === "tri";
    let lastControl = -1;
    let lastLo = -1;
    let lastHi = -1;

    frames.forEach((s, f) => {
      const at = s.at;
      const vol = s.volume;

      if (isNoise) {
        // Noise has 16 periods rather than a frequency, so arpeggio and slide
        // walk the period index instead of transposing.
        const control = 0x30 | vol; // halted, constant volume
        const mode = (s.noiseMode ? 0x80 : 0) | s.period;
        if (f === 0) {
          write(at, 0x400c, control);
          write(at, 0x400e, mode);
          // Length 31, halted above, and the envelope restarted.
          write(at, 0x400f, 31 << 3);
        } else {
          if (control !== lastControl) write(at, 0x400c, control);
          if (mode !== lastLo) write(at, 0x400e, mode);
        }
        lastControl = control;
        lastLo = mode;
        return;
      }

      let period = isTriangle ? freqToTrianglePeriod(s.freq) : freqToPulsePeriod(s.freq);
      if (s.pitchOffset !== 0) {
        period = Math.max(0, Math.min(0x7ff, period + Math.round(s.pitchOffset)));
      }
      const lo = period & 0xff;
      const hi = period >> 8;

      if (isTriangle) {
        if (f === 0) {
          // Control flag set and the linear counter at its longest: the
          // triangle plays until told otherwise, and the driver ends notes
          // itself.
          write(at, 0x4008, 0xff);
          write(at, 0x400a, lo);
          write(at, 0x400b, (31 << 3) | hi);
        } else {
          if (lo !== lastLo) write(at, 0x400a, lo);
          if (hi !== lastHi) write(at, 0x400b, (31 << 3) | hi);
        }
        this.triangleHi = hi;
      } else {
        const control = (s.duty << 6) | 0x30 | vol; // halted, constant volume
        if (f === 0) {
          write(at, base, control);
          // Sweep off, negate set. With negate clear the sweep's target is
          // twice the period, and anything at $400 or above - G#2 and below -
          // is muted. Every driver on the hardware wrote this byte.
          write(at, base + 1, 0x08);
          write(at, base + 2, lo);
          // Length 31, halted above; the phase and the envelope restart.
          write(at, base + 3, (31 << 3) | hi);
        } else {
          if (control !== lastControl) write(at, base, control);
          if (lo !== lastLo) write(at, base + 2, lo);
          // The only road to the high bits, and it restarts the phase. A
          // slide or a vibrato across the boundary clicks here, as on a NES.
          if (hi !== lastHi) write(at, base + 3, (31 << 3) | hi);
        }
        lastControl = control;
      }
      lastLo = lo;
      lastHi = hi;
    });
    return out;
  }

  /**
   * Quiet, through the channel's own registers.
   *
   * A pulse or the noise goes quiet with a constant volume of 0. The triangle
   * has no volume, so its linear counter is told to reload with 0, which the
   * next quarter frame does - at most four milliseconds away - and the
   * sequencer stops where it is. `$400B` carries the period high bits, hence
   * the copy kept above: zeros there would pitch the last milliseconds up an
   * octave or more.
   */
  noteOff(voice: string, at: number): RegisterEvent[] {
    switch (voice) {
      case "p1":
        return [{ at, addr: 0x4000, value: 0x30 }];
      case "p2":
        return [{ at, addr: 0x4004, value: 0x30 }];
      case "noi":
        return [{ at, addr: 0x400c, value: 0x30 }];
      case "tri":
        return [
          { at, addr: 0x4008, value: 0x00 },
          { at, addr: 0x400b, value: this.triangleHi },
        ];
      default:
        return [];
    }
  }
}
