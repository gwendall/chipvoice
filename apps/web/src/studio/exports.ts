import { arrange, loopSeconds, recordSong, renderSong, toVgm, toWav } from 'chipvoice';
import { ROLES, tokens, type SongDocument } from './document';
import { zip } from './zip';

export type ExportKind = 'wav' | 'stems' | 'machines' | 'vgm';
export const VGM_CHIPS = ['2a03', 'dmg', 'md'];
export function exportSong(song: SongDocument, kind: ExportKind, progress: (done: number, total: number) => void = () => {}) {
  const arranged = arrange(song);
  const seconds = Math.min(300, loopSeconds(arranged) * 2);
  if ((kind === 'stems' || kind === 'machines') && seconds > 30) throw new Error('Bundles support up to 30 seconds. Shorten the loop or download a single WAV.');
  if (kind === 'vgm') {
    if (!VGM_CHIPS.includes(song.chip)) throw new Error('VGM is available for NES, Game Boy and Mega Drive.');
    const capture = recordSong(arranged);
    return { bytes: toVgm(capture.events, capture.cycles, { chip: song.chip, title: song.title, author: song.author }), extension: 'vgm', type: 'audio/x-vgm' };
  }
  if (kind === 'wav') return { bytes: toWav(renderSong(arranged, { stereo: true })), extension: 'wav', type: 'audio/wav' };
  const files: { name: string; bytes: Uint8Array }[] = [];
  const choices = kind === 'machines' ? ['2a03', 'dmg', 'md', 'snes', 'c64'] : ROLES;
  for (const choice of choices) {
    const score = kind === 'machines' ? { ...song, chip: choice } : { ...song, patterns: song.patterns.map(pattern => ({ ...pattern,
      ...Object.fromEntries(ROLES.filter(role => role !== choice).map(role => [role, tokens(pattern[role]).map(() => '.').join(' ')])),
    })) };
    files.push({ name: `${choice}.wav`, bytes: toWav(renderSong(arrange(score), { seconds, stereo: true })) });
    progress(files.length, choices.length);
  }
  files.push({ name: 'score.json', bytes: new TextEncoder().encode(JSON.stringify(song, null, 2)) });
  files.push({ name: 'README.txt', bytes: new TextEncoder().encode(kind === 'stems'
    ? 'Each role is rendered alone, at the same start and duration. Hardware voice sharing and chip output stages mean summing these files can differ from the full mix.\n'
    : 'The same full score, arranged separately for each machine. Every WAV starts at the same position and has the same duration.\n') });
  return { bytes: zip(files), extension: 'zip', type: 'application/zip' };
}
