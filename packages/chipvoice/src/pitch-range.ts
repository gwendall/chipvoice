import type { ChipSpec, VoiceSpec } from './chip.js';
import type { Instrument } from './driver.js';

/** Register limits used by the shipped drivers, before modulation. These are
 * representable frequencies, not an analog audibility or tuning guarantee. */
export function pitchRange(chip: ChipSpec, voice: VoiceSpec, instrument?: Instrument): [number, number] | null {
  if (chip.id === '2a03') {
    const divider = voice.kind === 'triangle' ? 32 : 16;
    return [chip.clockHz / (divider * 2048), chip.clockHz / (divider * (voice.kind === 'pulse' ? 9 : 2))];
  }
  if (chip.id === 'dmg') {
    const divider = voice.kind === 'wavetable' ? 64 : 32;
    return [chip.clockHz / (divider * 2048), chip.clockHz / divider];
  }
  if (chip.id === 'md') return voice.kind === 'fm'
    ? [chip.clockHz / 7 / (144 * 2 ** 21), 2047 * (chip.clockHz / 7) / (144 * 2 ** 14)]
    : [chip.clockHz / 15 / (32 * 1023), chip.clockHz / 15 / 64];
  if (chip.id === 'c64') return [chip.clockHz / 2 ** 24, 65535 * chip.clockHz / 2 ** 24];
  if (chip.id === 'snes') {
    const name = instrument?.sample ?? 'tri';
    const base = ['sine64', 'square64', 'saw64'].includes(name) ? 500 : ['sine', 'tri', 'saw', 'square'].includes(name) ? 1000 : null;
    return base ? [base / 4096, base * 16383 / 4096] : null;
  }
  return null;
}
