import { instrumentsFor, type SfxOptions, type Role } from 'chipvoice';
import type { SongDocument } from './document';
export const EFFECTS = [
  { id: 'jump', name: 'Jump', key: '1', symbol: '↟', detail: 'Take a leap' },
  { id: 'coin', name: 'Coin', key: '2', symbol: '✦', detail: 'Pocket a little gold' },
  { id: 'laser', name: 'Laser', key: '3', symbol: '↗', detail: 'Borrow a voice' },
  { id: 'explosion', name: 'Explosion', key: '4', symbol: '✳', detail: 'Make an entrance' },
] as const;
export type EffectId = typeof EFFECTS[number]['id'];
export function effectFor(id: EffectId, song: SongDocument): { role: Role; options: SfxOptions } {
  const inst = instrumentsFor(song.chip, song.intent);
  const role = id === 'explosion' ? 'perc' : 'chord';
  if (id === 'explosion') return { role, options: { ...inst.perc.S, duration: 0.3, instrument: { ...inst.perc.S.instrument, volume: [15, 14, 13, 12, 10, 8, 7, 6, 4, 3, 2, 1], slide: -0.5 } } };
  return { role, options: {
    note: id === 'jump' ? 'C4' : id === 'coin' ? 'E6' : 'B6',
    duration: id === 'coin' ? 0.25 : 0.3,
    instrument: { ...inst.lead, arp: id === 'coin' ? [0, 7, 12, 7] : undefined,
      volume: [13, 13, 12, 11, 10, 8, 6, 4, 2, 1], sustain: false,
      vibrato: undefined, slide: id === 'jump' ? 1.1 : id === 'laser' ? -1.4 : 0 },
  } };
}
