import assert from 'node:assert/strict';
import {arrange,renderSong,recordSong,nesChip,gbChip,mdChip,snesChip,c64Chip} from '../dist/index.js';
const line=Array(48).fill('.'),silent=line.join(' ');line[47]='C5';
const score={bpm:120,stepsPerBeat:12,patterns:[{lead:line.join(' '),bass:silent,chord:silent,perc:silent,chordShape:[[0]]}],order:[0]};
for(const chip of [nesChip,gbChip,mdChip,snesChip,c64Chip]){
 const song=arrange(score,chip.spec.id),audio=renderSong(song,{seconds:2,stereo:true});
 const energy=audio.left.slice(-1200).reduce((sum,n)=>sum+n*n,0)/1200;
 assert.ok(energy>1e-8,`${chip.spec.id}: a final triplet-grid note must reach the export`);
 const log=recordSong(song,{seconds:2}),core=chip.create(44100);core.setGain(.78);for(const block of log.memory)core.load?.(block.address,block.bytes);core.schedule(log.events);
 const left=new Float32Array(audio.left.length),right=new Float32Array(audio.left.length);core.render(left,right,0);
 assert.deepEqual(left,audio.left,`${chip.spec.id}: capture and render share the musical origin`);
}
console.log('PASS final-note audio and register replay on all five consoles, with no live startup delay in exports');
