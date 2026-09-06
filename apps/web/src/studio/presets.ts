import classics from './classics.json';
import type { Pattern } from 'chipvoice';
import type { SongDocument } from './document';

const pattern = (lead: string, chord: string, bass: string, perc: string, chordShape: number[][]): Pattern => ({ lead, chord, bass, perc, chordShape });
export type Preset = {id: string; title: string; mood: string; color: string; song: SongDocument; composer?: string; coverage?: string; fidelity?: {referenceNotes: number; pass: boolean}; adaptation?: string; source?: {url: string; transcriber: string; excerpt: string}};
export const ORIGINAL_PRESETS: Preset[] = [
  { id: 'overworld', title: 'Overworld', mood: 'A new adventure', color: '#e5af46', song: {
    title: 'Overworld', chip: '2a03', bpm: 144, intent: { lead: 'bright', chord: 'plucked', bass: 'round', perc: 'soft' }, order: [0, 1], patterns: [
      pattern('E5 . G5 . A5 . G5 E5 D5 . E5 . G5 . . =', 'C4 . . . . . . . G3 . . . . . . .', 'C2 . C3 . C2 . G2 . G2 . G3 . G2 . D3 .', 'K . H . S . H . K . H H S . H .', [[0,4,7], [0,4,7]]),
      pattern('A5 . C6 . B5 A5 G5 . E5 . D5 . C5 . . =', 'F3 . . . . . . . C4 . . . G3 . . .', 'F2 . F3 . F2 . C3 . C2 . G2 . G2 . B2 .', 'K . H . S . H H K . H . S H K O', [[0,4,7], [0,4,7], [0,4,7]]),
    ],
  } },
  { id: 'boss', title: 'Boss Fight', mood: 'No extra lives', color: '#e47b63', song: {
    title: 'Boss Fight', chip: 'md', bpm: 172, intent: { lead: 'bright', chord: 'held', bass: 'bright', perc: 'tight' }, order: [0, 1], patterns: [
      pattern('E5 E5 . G5 E5 . Bb5 . A5 G5 E5 . D5 E5 . =', 'E3 . . . . . . . C4 . . . B3 . . .', 'E2 E2 . E3 E2 E2 . E3 C2 C3 C2 C3 B1 B2 B1 B2', 'K H K H S H K H K H K H S H S O', [[0,3,7],[0,4,7],[0,4,7]]),
      pattern('B5 . Bb5 A5 G5 E5 D5 . E5 G5 E5 D5 E5 . . =', 'A3 . . . . . . . B3 . . . . . . .', 'A1 A2 A1 A2 A1 A2 A1 A2 B1 B2 B1 B2 B1 B2 D2 D3', 'K H K H S H H H K K H H S H S S', [[0,3,7],[0,4,7]]),
    ],
  } },
  { id: 'midnight', title: 'Midnight', mood: 'One more level', color: '#91aaa9', song: {
    title: 'Midnight', chip: 'snes', bpm: 96, intent: { lead: 'round', chord: 'held', bass: 'hollow', perc: 'soft' }, order: [0, 1], patterns: [
      pattern('E5 . . . B4 . D5 . . . E5 . G5 . . =', 'A3 . . . . . . . F3 . . . . . . .', 'A1 . . . E2 . . . F2 . . . C3 . . .', 'K . . H S . . H K . . H S . H .', [[0,3,7],[0,4,7]]),
      pattern('F5 . . E5 . . D5 . E5 . . . B4 . . =', 'D4 . . . . . . . E4 . . . . . . .', 'D2 . . . A2 . . . E2 . . . B2 . . .', 'K . . H S . H . K . . H S . . O', [[0,3,7],[0,3,7]]),
    ],
  } },
];

export const CLASSIC_PRESETS = classics as Preset[];
export const PRESETS: Preset[] = [...ORIGINAL_PRESETS, ...CLASSIC_PRESETS];
