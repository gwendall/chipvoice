import type { ChipSpec, VoiceSpec } from './chip.js';
import { sampleBaseHz } from './chips/snes/driver.js';
import type { Instrument } from './driver.js';

/**
 * The chip's own register code for a frequency: the same formula each
 * driver uses to write it, kept here rather than imported so this file
 * stays the one place that knows every chip's representable pitches. Used
 * to tell whether a requested change - a slide, a vibrato swing - actually
 * moves a register, or is smaller than the hardware can step.
 *
 * This lives beside `pitch-range.ts` rather than in it on purpose:
 * `pitch-range.ts` is reachable from the render path (`performance.ts` uses
 * `pitchRange` to size a voice), so it is part of the recordings' hashed
 * engine. These four functions exist only for diagnostics - `validate.ts` is
 * their only caller - so keeping them here means adding or changing a
 * diagnostic never touches a hashed module or asks for a re-evaluation.
 */
export function registerCode(chip: ChipSpec, voice: VoiceSpec, hz: number, instrument?: Instrument): number | null {
  if (!(hz > 0)) return null;
  if (chip.id === '2a03') {
    const divider = voice.kind === 'triangle' ? 32 : 16;
    return Math.round(chip.clockHz / (divider * hz) - 1);
  }
  if (chip.id === 'dmg') {
    const divider = voice.kind === 'wavetable' ? 64 : 32;
    return Math.round(2048 - chip.clockHz / (divider * hz));
  }
  if (chip.id === 'md') {
    if (voice.kind === 'fm') {
      const input = chip.clockHz / 7;
      let fnum = (144 * hz * 2 ** 21) / input;
      let block = 0;
      while (fnum >= 2048 && block < 7) { fnum /= 2; block++; }
      return (block << 11) | Math.max(0, Math.min(2047, Math.round(fnum)));
    }
    return Math.round((chip.clockHz / 15) / (32 * hz));
  }
  if (chip.id === 'c64') return Math.round((hz * 2 ** 24) / chip.clockHz);
  if (chip.id === 'snes') {
    const base = sampleBaseHz(instrument?.sample ?? 'tri');
    return base ? Math.round((hz * 4096) / base) : null;
  }
  return null;
}

/** The exact frequency a register code plays: `registerCode`'s inverse. */
export function hzAtCode(chip: ChipSpec, voice: VoiceSpec, code: number, instrument?: Instrument): number | null {
  if (chip.id === '2a03') {
    const divider = voice.kind === 'triangle' ? 32 : 16;
    return chip.clockHz / (divider * (code + 1));
  }
  if (chip.id === 'dmg') {
    const divider = voice.kind === 'wavetable' ? 64 : 32;
    const denom = 2048 - code;
    return denom > 0 ? chip.clockHz / (divider * denom) : null;
  }
  if (chip.id === 'md') {
    if (voice.kind === 'fm') {
      const input = chip.clockHz / 7;
      const block = code >> 11, fnum = code & 2047;
      return (fnum * input) / (144 * 2 ** (21 - block));
    }
    return code > 0 ? (chip.clockHz / 15) / (32 * code) : null;
  }
  if (chip.id === 'c64') return (code * chip.clockHz) / 2 ** 24;
  if (chip.id === 'snes') {
    const base = sampleBaseHz(instrument?.sample ?? 'tri');
    return base ? (code * base) / 4096 : null;
  }
  return null;
}

/** The frequency the hardware actually produces for a requested pitch,
 * after its register rounds to the nearest representable code. */
export function quantizedHz(chip: ChipSpec, voice: VoiceSpec, hz: number, instrument?: Instrument): number | null {
  const code = registerCode(chip, voice, hz, instrument);
  return code === null ? null : hzAtCode(chip, voice, code, instrument);
}

/**
 * Cents spanned by one register step at this frequency: how coarse the
 * chip's table is right here. A period register's step is a reciprocal, not
 * a linear one, so this grows fast at the low end of the table - the high,
 * numerically small end of a period, where the 2A03 and the Game Boy run out
 * of resolution before they run out of range.
 */
export function registerStepCents(chip: ChipSpec, voice: VoiceSpec, hz: number, instrument?: Instrument): number | null {
  const code = registerCode(chip, voice, hz, instrument);
  if (code === null) return null;
  const here = hzAtCode(chip, voice, code, instrument);
  const next = hzAtCode(chip, voice, code + 1, instrument);
  if (!here || !next || !(here > 0) || !(next > 0)) return null;
  return Math.abs(1200 * Math.log2(next / here));
}
