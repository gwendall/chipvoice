import assert from 'node:assert/strict';
import {arrange,recordSong,nesChip,gbChip,mdChip,snesChip,c64Chip} from '../dist/index.js';
const score={bpm:120,order:[0],patterns:[{chordShape:[[0,4,7]],lead:'C5 = E5 = G5 = C6 =',chord:'C4 = = = F4 = = =',bass:'C2 = C3 = F2 = F3 =',perc:'K H S H K H S H'}]};
for(const chip of [nesChip,gbChip,mdChip,snesChip,c64Chip]){
 const song=arrange(score,chip.spec.id),log=recordSong(song,{seconds:2,sampleRate:44100});
 const core=chip.create(44100);core.setGain(.6);for(const block of log.memory)core.load(block.address,block.bytes);core.schedule(log.events);
 core.render(new Float32Array(17777),new Float32Array(17777),0);
 assert.equal(typeof core.fork,'function',`${chip.spec.id} has a complete checkpoint`);
 const checkpoint=core.fork();
 const left=new Float32Array(20000),right=new Float32Array(20000);core.render(left,right,17777);
 const restored=checkpoint.fork(),a=new Float32Array(20000),b=new Float32Array(20000);
 for(let offset=0;offset<a.length;offset+=128)restored.render(a.subarray(offset,offset+128),b.subarray(offset,offset+128),17777+offset);
 assert.deepEqual(a,left,`${chip.spec.id}: checkpoint preserves every left sample`);assert.deepEqual(b,right,`${chip.spec.id}: checkpoint preserves every right sample`);
 const again=checkpoint.fork();again.render(a,b,17777);assert.deepEqual(a,left,`${chip.spec.id}: forks never mutate the saved checkpoint`);
}
console.log('PASS complete DSP checkpoints reproduce PCM on all five chips');
