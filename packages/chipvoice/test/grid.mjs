import assert from 'node:assert/strict';
import {Sequencer} from '../dist/sequencer.js';
import {arrange,loopSeconds,validateSong} from '../dist/index.js';
const pattern=count=>({lead:Array(count).fill('.').join(' '),bass:Array(count).fill('.').join(' '),chord:Array(count).fill('.').join(' '),perc:Array(count).fill('.').join(' '),chordShape:[[0]]});
for(const grid of [4,12]){
 const score={bpm:120,stepsPerBeat:grid,patterns:[pattern(grid*4)],order:[0]};
 assert.equal(loopSeconds(arrange(score)),2);
 const seq=new Sequencer({playNote(){},stop(){}},{canPlay:()=>true},()=>0,{live:false});
 seq.play(arrange(score),undefined,0);seq.pump(.4);
 assert.ok(Math.abs(seq.nextEighth(.3)-.5)<1e-8,`${grid}: pad waits for a real eighth`);
 seq.stop();
}
// Compiler may put a pattern boundary at a rest, in the middle of a beat.
const seq=new Sequencer({playNote(){},stop(){}},{canPlay:()=>true},()=>0,{live:false});
seq.play(arrange({bpm:120,stepsPerBeat:12,patterns:[pattern(10),pattern(38)],order:[0,1]}),undefined,0);seq.pump(.6);
assert.ok(Math.abs(seq.nextEighth(.6)-.75)<1e-8,'Pattern cuts do not reset musical eighth phase');
assert.equal(validateSong(arrange({bpm:120,stepsPerBeat:0,patterns:[pattern(16)],order:[0]})).ok,false);
console.log('PASS grid timing, eighth-note pad quantization, irregular pattern boundaries and validation');
