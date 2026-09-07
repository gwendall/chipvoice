import type {ChipSpec, VoiceSpec} from './chip.js';
import type {Instrument} from './driver.js';

/** The MD noise driver uses tone 3 as its clock, even though their IDs differ. */
export function voicesConflict(spec: ChipSpec, a: string, b: string): boolean {
  return a === b || spec.id === 'md' && (a === 'noise' && b === 'psg3' || a === 'psg3' && b === 'noise');
}

export function instrumentFitsVoice(spec: ChipSpec, voice: VoiceSpec, instrument: Instrument): boolean {
  return spec.id !== 'md' || !instrument.fm || voice.kind === 'fm';
}

export function performanceVoices(spec: ChipSpec, instrument: Instrument, percussion: boolean): VoiceSpec[] {
  return spec.voices.filter(v => v.notes !== 'sample' && (spec.id === 'snes' || spec.id === 'c64' ||
    (percussion ? (instrument.fm ? v.kind === 'fm' : v.notes === 'period') : v.notes === 'pitch')));
}
