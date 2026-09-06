import assert from 'node:assert/strict';
import {arrange,recordSong,renderSong,nesChip,gbChip,mdChip,snesChip,c64Chip} from '../dist/index.js';
const score={bpm:144,order:[0],patterns:[{lead:'C4 . . . . . . . . . . . . . . .',bass:'. . . . . . . . . . . . . . . .',chord:'. . . . . . . . . . . . . . . .',perc:'. . . . . . . . . . . . . . . .',chordShape:[[0,4,7]]}]};
const shortLead=Array(24).fill('.'),silent=shortLead.join(' ');
shortLead[7]='C4';shortLead[8]='=';shortLead[9]='D4';
const shortScore={...score,stepsPerBeat:12,patterns:[{lead:shortLead.join(' '),bass:silent,chord:silent,perc:silent,chordShape:[[0]]}]};
for(const chip of [snesChip,nesChip,gbChip,mdChip,c64Chip]) {
  for(const {seconds,bpm=144,order=[0],sampleRate=44100,source=score} of [
    {seconds:.31}, {seconds:1.2},
    // The second pump cancels a queued frame-rounded release after the rest.
    {seconds:.7,bpm:180,source:shortScore},
    // A new loop starts inside the final rounded sample at this tempo.
    {seconds:480/172,bpm:172,order:[0,0]},
    {seconds:480/172,bpm:172,order:[0,0],sampleRate:48000},
  ]) {
    const song=arrange({...source,bpm,order},chip.spec.id);
    const expected=renderSong(song,{seconds,sampleRate,stereo:true});
    const log=recordSong(song,{seconds,sampleRate});
    const core=chip.create(expected.sampleRate);core.setGain(.78);
    for(const block of log.memory)core.load?.(block.address,block.bytes);
    core.schedule(log.events);
    const left=new Float32Array(expected.left.length),right=new Float32Array(left.length);
    core.render(left,right,0);
    let first=-1,max=0;
    for(let i=0;i<left.length;i++){
      const delta=Math.max(Math.abs(left[i]-expected.left[i]),Math.abs(right[i]-expected.right[i]));
      if(delta>1e-7&&first<0)first=i;max=Math.max(max,delta);
    }
    assert.ok(max<=1e-7,`${chip.spec.id} ${seconds}s @ ${sampleRate}Hz: capture replay diverges at ${(first/expected.sampleRate).toFixed(6)}s; max delta ${max}`);
  }
}
console.log('PASS captured registers reproduce complete WAVs through the final sample on all five machines');
