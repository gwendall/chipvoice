import type {ChipSpec, VoiceSpec} from './chip.js';
import type {Instrument} from './driver.js';

/** The MD noise driver uses tone 3 as its clock, even though their IDs differ.
 * `noiseIsFm` adds a second, conditional pairing: an FM kit loaded on the
 * noise voice (`perc: "punchy"`) plays channel 6 instead of the PSG noise, so
 * it then shares hardware with a melodic `fm6` note too (driver.ts redirects
 * it there). That pairing only applies when the caller says the noise voice
 * is actually carrying an FM patch; plain PSG percussion never conflicts with fm6. */
export function voicesConflict(spec: ChipSpec, a: string, b: string, noiseIsFm = false): boolean {
  if (a === b) return true;
  if (spec.id !== 'md') return false;
  if (a === 'noise' && b === 'psg3' || a === 'psg3' && b === 'noise') return true;
  return noiseIsFm && (a === 'noise' && b === 'fm6' || a === 'fm6' && b === 'noise');
}

export function instrumentFitsVoice(spec: ChipSpec, voice: VoiceSpec, instrument: Instrument): boolean {
  // The noise voice's own redirect (driver.ts) plays an FM patch on channel 6,
  // so it fits an FM instrument too, not only the fm-kind voices.
  return spec.id !== 'md' || !instrument.fm || voice.kind === 'fm' || voice.id === 'noise';
}

export function performanceVoices(spec: ChipSpec, instrument: Instrument, percussion: boolean): VoiceSpec[] {
  // An FM kit on percussion (`perc: "punchy"`) is always the noise voice's own
  // redirect to channel 6 (driver.ts), never a direct fm1-fm6 pick: that keeps
  // the kit's period-as-pitch mapping and stops it from landing on whatever FM
  // voice happens to be free, which a melodic part might also be using.
  return spec.voices.filter(v => v.notes !== 'sample' && (spec.id === 'snes' || spec.id === 'c64' ||
    (percussion ? (instrument.fm ? v.id === 'noise' : v.notes === 'period') : v.notes === 'pitch')));
}
