import { arrange, validateSong, type Pattern, type Role } from 'chipvoice';
import { SongDocumentSchema, type SongInput as Input } from '@/lib/schema';
import { decode as decodeLegacy } from './share';

export type ChipId = Input['chip'];
export type SongDocument = Input;
export const ROLES: Role[] = ['lead', 'chord', 'bass', 'perc'];
export const ROLE_NAMES: Record<Role, string> = { lead: 'Melody', chord: 'Chords', bass: 'Bass', perc: 'Drums' };
export const MACHINES: { id: ChipId; name: string; chip: string; year: string; logo: string }[] = [
  { id: '2a03', logo: '/machines/famicom.svg', name: 'Famicom', chip: 'Ricoh 2A03', year: '1983' },
  { id: 'dmg', logo: '/machines/game-boy.svg', name: 'Game Boy', chip: 'DMG APU', year: '1989' },
  { id: 'md', logo: '/machines/mega-drive-jp.svg', name: 'Mega Drive', chip: 'YM2612 + SN76489', year: '1988' },
  { id: 'snes', logo: '/machines/super-famicom.svg', name: 'Super Famicom', chip: 'S-DSP', year: '1990' },
  { id: 'c64', logo: '/machines/c64.svg', name: 'C64', chip: 'MOS 6581 SID', year: '1982' },
];
// Presentation only: retain SID support for existing drafts, shares and the SDK.
export const DEMO_MACHINES = MACHINES.filter(machine => machine.id !== 'c64');
export const tokens = (line: string) => line.trim().split(/\s+/).filter(Boolean);
export const lengthOf = (pattern: Pattern) => tokens(pattern.bass).length;

/** Runtime validation at every persistence boundary, including local drafts. */
export function readDocument(raw: unknown): SongDocument | null {
  const result = SongDocumentSchema.safeParse(raw);
  if (!result.success) return null;
  return validateSong(arrange(result.data)).ok ? result.data : null;
}
export function encodeDocument(song: SongDocument) {
  return 'v1.' + btoa(unescape(encodeURIComponent(JSON.stringify(song))));
}
export function decodeDocument(hash: string): SongDocument | null {
  try {
    if (hash.startsWith('v1.')) return readDocument(JSON.parse(decodeURIComponent(escape(atob(hash.slice(3))))));
    const old = decodeLegacy(hash);
    if (!old) return null;
    return readDocument({ bpm: old.bpm, chip: old.chip, order: [0], patterns: [{
      ...Object.fromEntries(ROLES.map(role => [role, old.track[role].join(' ')])),
      chordShape: [[0, 3, 7], [0, 3, 7], [0, 3, 7], [0, 4, 7], [0, 4, 7]],
    }] });
  } catch { return null; }
}
export function musicSong(song: SongDocument, muted: Role[] = []) {
  return arrange({ ...song, patterns: song.patterns.map(pattern => ({ ...pattern,
    ...Object.fromEntries(muted.map(role => [role, tokens(pattern[role]).map(() => '.').join(' ')])),
  })) });
}
export function runnableCode(song: SongDocument, copy = {play: 'Play / stop', unavailable: 'AudioWorklet unavailable'}) {
  // A standalone browser example: importing alone never starts audio.
  return `import { Chip, arrange } from "chipvoice";\n\nconst score = ${JSON.stringify(song, null, 2)};\n\nconst button = document.createElement("button");\nbutton.textContent = ${JSON.stringify(copy.play)};\ndocument.body.append(button);\nlet chip;\nbutton.onclick = async () => {\n  chip ??= await Chip.create({ chip: score.chip });\n  if (!chip) return; // ${copy.unavailable}\n  await chip.resume();\n  if (chip.playing) chip.stop();\n  else chip.play(arrange(score));\n};\n`;
}
