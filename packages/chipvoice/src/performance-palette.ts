import type {Instrument} from './driver.js';
import {instrumentsFor} from './score.js';
import type {Role} from './chip.js';

/** Deliberate GM-family approximations, not an original game's patch bank.
 * Program changes select a new family on every note. All samples are ours. */
export function performanceInstrument(chip: string, role: Role, program = 80): Instrument {
  const family = program >> 3;
  const bass = role === 'bass' || family === 4;
  const sustained = bass || family >= 5 && family <= 10;
  const palette = instrumentsFor(chip,{lead:family===7?'bright':family<=1?'round':'soft',chord:sustained?'held':'plucked',bass:program===38||program===39?'bright':'round'});
  const base = bass ? palette.bass : palette.lead;
  const {vibrato: _vibrato, arp: _arp, pitch: _pitch, slide: _slide, ...plain} = base;
  if(chip==='snes') return {...plain,volume:[15],sustain:true,sample:bass?(program===38||program===39?'synth-bass':'picked-bass'):family<=1?'mallet':family===5||family===6?'strings':family===7?'brass':family===8?'flute':family===10?'square':family===11?'mallet':'flute'};
  return {...plain,volume:sustained?[13]:[15,12,10,8,6,4,3],sustain:true};
}
