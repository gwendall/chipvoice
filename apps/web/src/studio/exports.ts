import { arrange, exportGbs, exportNsf, exportSpc, loopSeconds, recordSong, renderSong, SNES, SpcExportSizeError, toVgm, toWav } from 'chipvoice';
import { ROLES, tokens, type SongDocument } from './document';
import { zip } from './zip';

export type ExportKind = 'wav' | 'stems' | 'machines' | 'vgm' | 'nsf' | 'gbs' | 'spc';
export const VGM_CHIPS = ['2a03', 'dmg', 'md'];
export const NSF_CHIPS = ['2a03'];
export const GBS_CHIPS = ['dmg'];
export const SPC_CHIPS = ['snes'];
export function exportSong(song: SongDocument, kind: ExportKind, progress: (done: number, total: number) => void = () => {}) {
  const arranged = arrange(song);
  const seconds = Math.min(300, loopSeconds(arranged) * 2);
  if ((kind === 'stems' || kind === 'machines') && seconds > 30) throw new Error('Bundles support up to 30 seconds. Shorten the loop or download a single WAV.');
  if (kind === 'vgm') {
    if (!VGM_CHIPS.includes(song.chip)) throw new Error('VGM is available for NES, Game Boy and Mega Drive.');
    const capture = recordSong(arranged);
    return { bytes: toVgm(capture.events, capture.cycles, { chip: song.chip, title: song.title, author: song.author }), extension: 'vgm', type: 'audio/x-vgm' };
  }
  if (kind === 'nsf') {
    if (!NSF_CHIPS.includes(song.chip)) throw new Error('NSF is available for NES only.');
    const capture = recordSong(arranged);
    return { bytes: exportNsf(capture.events, capture.cycles, { title: song.title, author: song.author, memory: capture.memory }), extension: 'nsf', type: 'audio/x-nsf' };
  }
  if (kind === 'gbs') {
    if (!GBS_CHIPS.includes(song.chip)) throw new Error('GBS is available for Game Boy only.');
    const capture = recordSong(arranged);
    return { bytes: exportGbs(capture.events, capture.cycles, { title: song.title, author: song.author }), extension: 'gbs', type: 'audio/x-gbs' };
  }
  if (kind === 'spc') {
    if (!SPC_CHIPS.includes(song.chip)) throw new Error('SPC export is available for SNES.');
    const capture = recordSong(arranged);
    // The whole capture (intro included, since a song's own loop content can
    // start partway in) plays once, then repeats forever from the loop
    // point on - the same "twice the loop, so a genuine loop exists to find"
    // duration recordSong's own default already captures, per its own doc
    // comment.
    const loopAtCycle = Math.round(loopSeconds(arranged) * SNES.clockHz);
    try {
      return { bytes: exportSpc(capture.events, capture.cycles, capture.memory, { title: song.title, artist: song.author, loopAtCycle }), extension: 'spc', type: 'audio/x-spc' };
    } catch (error) {
      if (error instanceof SpcExportSizeError) throw new Error('This song is too big for a single .spc file (64 KB of SNES sound RAM). Shorten it or use fewer distinct instrument samples.');
      throw error;
    }
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
