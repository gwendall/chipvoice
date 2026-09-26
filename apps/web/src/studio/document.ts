import { arrange, validateSong, type Role } from 'chipvoice';
import { SongDocumentSchema, type SongInput as Input } from '@/lib/schema';
import { decode as decodeLegacy } from './share';
import { ROLES, ROLE_NAMES, MACHINES, DEMO_MACHINES, tokens, lengthOf, type ChipId } from './machines';

// Re-exported for the existing consumers of this module (the studio editor,
// arrangements and the publication view); see `machines.ts` for why this
// metadata now lives in its own file, with no `chipvoice` import of its own.
export type { ChipId };
export { ROLES, ROLE_NAMES, MACHINES, DEMO_MACHINES, tokens, lengthOf };
export type SongDocument = Input;

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
