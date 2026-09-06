import type { Role } from 'chipvoice';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const DRUMS: Record<number, string> = { 35: 'K', 36: 'K', 38: 'S', 40: 'S', 42: 'H', 44: 'H', 46: 'O' };

/** Note-on presses share the palette's tap semantics. Ignore releases, clock,
 * system messages and unsupported notes; never request SysEx access. */
export function midiTap(data: ArrayLike<number>, selected: Role): { role: Role; note: string } | null {
  if (data.length !== 3 || (data[0] & 0xf0) !== 0x90 || data[2] < 1 || data[2] > 127) return null;
  const pitch = data[1];
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) return null;
  const role = (data[0] & 0x0f) === 9 ? 'perc' : selected;
  if (role === 'perc') return DRUMS[pitch] ? { role, note: DRUMS[pitch] } : null;
  return pitch >= 12 && pitch <= 119 ? { role, note: NAMES[pitch % 12] + (Math.floor(pitch / 12) - 1) } : null;
}
