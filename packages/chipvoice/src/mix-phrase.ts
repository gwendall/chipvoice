import type {ChipDefinition, Role} from './chip.js';
import {noteToFreq, noteFrameCount, frameSemitones, FRAME_RATE, type PlayNoteOptions} from './driver.js';
import {planMix, type MixOptions, type PartMix} from './mix.js';

export interface MixPhraseNote extends PlayNoteOptions {
  voice: string;
  part: string;
  role: Role;
  /** Offset inside this phrase, in seconds. */
  at: number;
  mix?: PartMix;
}

/** Prepare an already voiced game phrase without rendering PCM. Call in the
 * scheduler, never in an audio callback. At most two seconds and 128 notes;
 * notes must finish inside the phrase. Keep the existing APU alive across
 * phrases, then schedule returned offsets relative to the next audio boundary.
 * Overlapping/held voices across phrases require the caller's voice arbiter.
 * This API deliberately does not guess the next phrase or allocate its voices. */
export function prepareMixPhrase(chip: ChipDefinition, notes: readonly MixPhraseNote[], options: MixOptions = {}) {
  if (notes.length > 128) throw new Error('Mix phrase exceeds 128 notes');
  // The APU plays whole 60 Hz frames. Use its actual duration consistently,
  // otherwise a rounded note-off can cut the following supposedly free voice.
  const framedNotes = notes.map(note => {
    if (!Number.isFinite(note.duration) || note.duration <= 0) throw new Error('Invalid or excessive mix phrase');
    return {...note, duration: noteFrameCount(note.duration) / FRAME_RATE};
  });
  const voiced = framedNotes.map((note, index) => {
    const voice = chip.spec.voices.find(v => v.id === note.voice);
    if (!voice || !Number.isFinite(note.at) || note.at < 0 || !Number.isFinite(note.duration) || note.duration <= 0 || note.at + Math.max(1, Math.round(note.duration * 60)) / 60 > 2 || !Number.isFinite(note.gain ?? 1) || (note.gain ?? 1) < 0 || (note.gain ?? 1) > 1 || !Number.isFinite(note.detune ?? 0)) throw new Error('Invalid or excessive mix phrase');
    if (framedNotes.some((other, otherIndex) => otherIndex !== index && other.voice === note.voice && other.at < note.at + note.duration && note.at < other.at + other.duration)) throw new Error('Mix phrase contains overlapping hardware voices');
    const hz = typeof note.note === 'string' ? noteToFreq(note.note) : note.note;
    const pitch = voice.notes === 'period' ? 60 : 69 + 12 * Math.log2(hz / 440) + (note.detune ?? 0);
    if (!Number.isFinite(pitch)) throw new Error('Invalid mix phrase pitch');
    return {part: note.part, role: note.role, voice: note.voice, instrument: note.instrument, pitch, start: note.at, end: note.at + note.duration, mix: note.mix};
  });
  const policy = planMix(chip, voiced, options);
  const prepared = framedNotes.map((note, index) => {
    const volume = [];
    const count = noteFrameCount(note.duration);
    for (let frame = 0; frame < count; frame++) {
      const source = note.instrument.volume;
      const control = (source[Math.min(frame, source.length - 1)] ?? 0) * (frame < source.length || note.instrument.sustain ? 1 : 0) * (note.gain ?? 1);
      const modulation = frameSemitones(note.instrument, frame);
      volume.push(policy.level(index, control, note.at + frame / FRAME_RATE, typeof note.note === 'number' ? Math.max(0, Math.min(15, Math.round(note.note + modulation + (note.detune ?? 0)))) : 9, voiced[index].pitch + modulation));
    }
    return {...note, gain: 1, calibrated: true, instrument: {...note.instrument, volume, sustain: false}};
  });
  return {notes: prepared, mix: policy.report};
}
