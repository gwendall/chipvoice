import assert from 'node:assert/strict';
import {arrange,recordSong,snesChip} from 'chipvoice';
import {observeSnesMixer} from './snes-mixer.mjs';
const score={bpm:144,order:[0],patterns:[{
  lead:'C4 . E4 . G4 . C5 . G4 . E4 . D4 . G4 .',
  chord:'C4 . . . C4 . . . C4 . . . C4 . . .',
  bass:'C3 . . . C3 . . . C3 . . . C3 . . .',
  perc:'K H S H K H S H K H S H K H S H',chordShape:[[0,4,7]],
}]};
const log=recordSong(arrange(score,'snes'),{seconds:2});
function inspect(events){
  const chip=snesChip.digital();
  for(const block of log.memory)chip.load(block.address,block.bytes);
  chip.schedule(events);
  const counts=observeSnesMixer(chip);chip.trace(log.cycles,()=>{});return counts;
}
const measured=inspect(log.events);
assert.equal(measured.mainClampedAdditions,0,`Default SNES mix saturates: ${JSON.stringify(measured)}`);
assert.equal(measured.echoClampedAdditions,0,'Default echo input saturates');
// A deliberately overloaded driver must fail the same probe: the observer is
// not a self-fulfilling zero counter. Do not change the emulator's saturation.
let register=0;
const overloaded=log.events.map(event=>{
  if(event.addr===0xf2)register=event.value;
  if(event.addr===0xf3&&(register&15)<=1&&event.value>0)return {...event,value:127};
  return event;
});
assert.ok(inspect(overloaded).mainClampedAdditions>0);
console.log('PASS SNES score keeps mix/echo headroom; overloaded-register control detects internal saturation');
