import {snesChip} from 'chipvoice';
import {observeSnesMixer} from './snes-mixer.mjs';
import {snesSpc} from '../oracles/snes-spc.mjs';

/** Same driver registers + same BRR RAM, independently executed by native C++.
 * A match validates this digital execution, not the instruments' musical idiom. */
export function snesReference(log){
  const reference=snesSpc.trace(log.events,log.cycles,log.memory);
  const chip=snesChip.digital();for(const block of log.memory)chip.load(block.address,block.bytes);chip.schedule(log.events);
  const mixer=observeSnesMixer(chip);
  let index=0,first=null;
  chip.trace(log.cycles,(cycle,voice,value)=>{
    const expected=reference[index];
    if(!first&&(!expected||expected.cycle!==cycle||expected.voice!==voice||expected.value!==value))first={index,actual:{cycle,voice,value},expected:expected??null};
    index++;
  });
  if(!first&&index!==reference.length)first={index,actual:null,expected:reference[index]??null};
  const frames=Math.floor(log.cycles/32),left=new Float32Array(frames),right=new Float32Array(frames);
  let event=0,l=0,r=0,rails=0,peak=0;
  for(let frame=0;frame<frames;frame++){
    while(event<reference.length&&reference[event].cycle<(frame+1)*32){const change=reference[event++];if(change.voice===0)l=change.value;else r=change.value;}
    left[frame]=l/32768;right[frame]=r/32768;peak=Math.max(peak,Math.abs(left[frame]),Math.abs(right[frame]));
    if(l===32767||l===-32768)rails++;if(r===32767||r===-32768)rails++;
  }
  return {comparison:{ok:first===null,oracle:snesSpc.name,changes:index,first,railSamples:rails,mixer},
    audio:{sampleRate:32000,left,right,seconds:frames/32000,peak}};
}
