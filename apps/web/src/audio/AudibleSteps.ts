import type {Chip} from 'chipvoice';
import {outputTime} from './output-clock.mjs';

/** Retain recently observed step boundaries after the SDK's scheduling queue
 * has moved on. Fixed storage; the display reads the device's output clock. */
export class AudibleSteps {
 private entries=Array.from({length:512},()=>({at:-Infinity,step:0,orderIndex:0}));
 private start=0;private size=0;private lastChip:Chip|null=null;
 read(chip:Chip|null,stepSeconds:number,into:{step:number;orderIndex:number}){
  if(!chip?.playing){this.size=0;this.lastChip=null;return null;}
  const context=chip.audioContext,phase=chip.phaseAt();
  const previous=this.size?this.entries[(this.start+this.size-1)%512]:null;
  if(phase&&(!previous||chip!==this.lastChip||previous.step!==phase.step||previous.orderIndex!==phase.orderIndex)){
   if(this.size===512){this.start=(this.start+1)%512;this.size--;}
   const entry=this.entries[(this.start+this.size++)%512];entry.at=context.currentTime-(phase.progress??0)*stepSeconds;entry.step=phase.step;entry.orderIndex=phase.orderIndex;this.lastChip=chip;
  }
  const at=outputTime(context);
  while(this.size>1&&this.entries[(this.start+1)%512].at<=at){this.start=(this.start+1)%512;this.size--;}
  if(!this.size||this.entries[this.start].at>at)return null;
  const entry=this.entries[this.start];into.step=entry.step;into.orderIndex=entry.orderIndex;return into;
 }
}
