import assert from 'node:assert/strict';
import {arrange,snesChip,OfflineDriver,renderSong,validateSong} from '../dist/index.js';
import {Sequencer} from '../dist/sequencer.js';
const score={bpm:120,order:[0],patterns:[{lead:'. . . . . . . .',bass:'. . . . . . . .',perc:'. . . . . . . .',chord:'C4 . = . D4 . . .',chordShape:[[0,4,7],[0,3,7]]}]};
function sequence(position, input=score, canPlay=()=>true){
 const notes=[],stops=[];
 const seq=new Sequencer({playNote(voice,opts){notes.push({voice,...opts});},stop(voice,at){stops.push({voice,at});}}, {canPlay},()=>0,
   {live:false,roles:snesChip.spec.roles,chordVoices:snesChip.spec.chordVoices});
 seq.play(arrange(input,'snes'),position);seq.pump(.9);return {notes,stops,seq};
}
const initial=sequence();
const triad=initial.notes.filter(note=>note.note==='C4');
assert.deepEqual(triad.map(note=>note.voice),['v1','v4','v5']);
assert.deepEqual(triad.map(note=>note.detune),[0,4,7]);
assert.ok(triad.every(note=>note.at===.1&&!note.instrument.arp));
for(const voice of ['v1','v4','v5'])assert.ok(initial.stops.some(stop=>stop.voice===voice&&stop.at===.35),'Cut must stop every chord tone');
initial.stops.length=0;initial.seq.stop();
for(const voice of snesChip.spec.chordVoices)assert.ok(initial.stops.some(stop=>stop.voice===voice));
const resumed=sequence({step:1,orderIndex:0});
assert.deepEqual(resumed.notes.filter(note=>note.note==='C4').map(note=>note.detune),[0,4,7]);
const afterCut=sequence({step:3,orderIndex:0});
assert.deepEqual(afterCut.notes.filter(note=>note.note==='D4').map(note=>note.detune),[0,3,7]);
const tooMany={...score,patterns:[{...score.patterns[0],chordShape:[[0,2,4,7,9,12]]}]};
assert.ok(validateSong({...tooMany,chip:'snes'}).issues.some(issue=>issue.code==='chord_capacity'));
const fallback=sequence(undefined,tooMany).notes.filter(note=>note.note==='C4');
assert.equal(fallback.length,1);
assert.equal(fallback[0].voice,'v1');
assert.deepEqual(fallback[0].instrument.arp,[0,2,4,7,9,12]);
const borrowed=sequence(undefined,score,voice=>voice!=='v4');
assert.ok(!borrowed.stops.some(stop=>stop.voice==='v4'&&stop.at!==undefined),'A timed cut must respect a custom voice claim');
assert.deepEqual(borrowed.notes.filter(note=>note.note==='D4').map(note=>note.detune),[0,7]);
const extended=sequence(undefined,{...score,patterns:[{...score.patterns[0],chordShape:[[0,4,7,11,14]]}]}).notes.filter(note=>note.note==='C4');
assert.deepEqual(extended.map(note=>note.voice),['v1','v4','v5','v6','v7']);
assert.deepEqual(extended.map(note=>note.detune),[0,4,7,11,14]);
const muted=sequence(undefined,{...score,patterns:[{...score.patterns[0],chord:'. . . . . . . .'}]});
assert.equal(muted.notes.length,0,'An empty chord lane must schedule no bank voices');
// Actual rendered output must be audible and preserve stereo placement.
const audio=renderSong(arrange({...score,patterns:[{...score.patterns[0],chord:'C4 . . . . . . .'}]},'snes'),{seconds:1,stereo:true});
assert.ok(audio.peak>0.01);
let stereoDifference=0;for(let i=10000;i<audio.left.length;i++)stereoDifference+=Math.abs(audio.left[i]-audio.right[i]);
assert.ok(stereoDifference>1,'Chord tones should have distinct left/right placement');
console.log('PASS SNES simultaneous triads, all-voice cuts/stops, seek reconstruction, capacity warning and stereo PCM');
// Borrow an inner chord voice, restore its pitch, then stop the entire bank.
{
  let now=0;
  const core=snesChip.create(32000),driver=new OfflineDriver(core,snesChip,()=>now);
  const seq=new Sequencer(driver,{canPlay:()=>true},()=>now,{live:false,roles:snesChip.spec.roles,chordVoices:snesChip.spec.chordVoices});
  seq.play(arrange({...score,patterns:[{...score.patterns[0],chord:'C4 . . . . . . .'}]},'snes'));driver.flush();
  core.render(new Float32Array(9600),null,0);now=.3;
  driver.playEffect('v4',{note:880,instrument:{sample:'brass',volume:[12],sustain:true},duration:.1,at:now});
  core.render(new Float32Array(9600),null,9600);now=.6;
  const regs=core.chip.dsp.regs;
  const expected=Math.round((440*2**((64-69)/12))*4096/500);
  assert.equal(regs[0x42]|((regs[0x43]&63)<<8),expected,'Inner E4 chord tone must return after SFX');
  assert.ok(core.chip.dsp.voices[4].env>0);
  seq.stop();driver.flush();core.render(new Float32Array(9600),null,19200);
  for(const voice of [1,4,5,6,7])assert.equal(core.chip.dsp.voices[voice].env,0,`Stopped chord voice ${voice} remains active`);
}
console.log('PASS inner-voice SFX restoration and complete hardware-envelope stop');

// Share gain without first rounding to a 4-bit volume table. SNES registers
// can still represent quiet chord tones that a 0–15 frame integer would erase.
for(const shape of [[0,4,7],[0,4,7,11,14]]){
  const quiet={...score,patterns:[{...score.patterns[0],chord:'C4 . . . . . . .',chordShape:[shape]}]};
  const peaks=[.1,.2,.3].map(gain=>renderSong(arrange({...quiet,gain},'snes'),{seconds:1,stereo:true}).peak);
  assert.ok(peaks[0]>0,`Quiet ${shape.length}-tone chord disappeared`);
  assert.ok(peaks[1]>peaks[0]&&peaks[2]>peaks[1],`Quiet chord gain collapsed: ${peaks}`);
}
console.log('PASS quiet triads and five-tone chords retain audible, increasing gain');
