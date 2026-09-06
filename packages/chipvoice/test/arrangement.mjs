import assert from 'node:assert/strict';
import { arrange, validateSong, renderSong, recordSong, registerChip, nesChip } from '../dist/index.js';
const score = {bpm:144,order:[0],patterns:[{bass:'C2 . . .',lead:'C4 . E4 .',chord:'C3 . . .',perc:'K . H .',chordShape:[[0,4,7]]}]};
for (const [chip,role,note] of [['2a03','lead','C0'],['dmg','bass','A0'],['md','chord','C2'],['snes','bass','C8'],['c64','lead','C8']]) {
  const source = {...score,chip,patterns:score.patterns.map(p=>({...p,[role]:`${note} . . .`}))};
  const song = arrange(source), before=JSON.stringify(song), result=validateSong(song);
  assert.equal(result.ok,true,'representable range diagnostics are non-destructive warnings');
  const issue=result.issues.find(i=>i.code==='pitch_range' && i.track===role);
  assert.ok(issue); assert.equal(issue.token,note); assert.equal(issue.pattern,0); assert.equal(issue.step,0);
  assert.equal(JSON.stringify(song),before);
}
const chord=arrange({...score,patterns:[{...score.patterns[0],chordShape:[[0,96]]}]},'c64');
assert.ok(validateSong(chord).issues.some(i=>i.code==='pitch_range' && i.track==='chord'));
assert.equal(validateSong({...score,patterns:[{...score.patterns[0],chordShape:[[]]}]}).ok,false);
assert.equal(validateSong({...score,patterns:[{bass:'',lead:'',chord:'',perc:'',chordShape:[[0,4,7]]}]}).ok,false);
assert.notEqual(arrange(score).id,arrange({...score,gain:.5}).id);
for (const chip of ['2a03','dmg','md','snes','c64']) {
  const song=arrange({...score,chip}); assert.equal(song.chip,chip);
  const implicit=renderSong(song,{seconds:.25,stereo:true}), explicit=renderSong(song,{seconds:.25,chip,stereo:true});
  assert.deepEqual(implicit,explicit);
  assert.deepEqual(recordSong(song,{seconds:.25}),recordSong(song,{seconds:.25,chip}));
}
registerChip({...nesChip,spec:{...nesChip.spec,id:'test-right-peak'},create:()=>({schedule(){},reset(){},setGain(){},render(left,right){left.fill(.1);right?.fill(.9);}})});
const result=renderSong({...arrange(score),chip:'test-right-peak'},{seconds:.01,stereo:true});
assert.equal(result.peak,Math.abs(result.right[0]));
console.log('PASS target preservation, gain identity, voice/arpeggio range warnings, empty-pattern rejection and stereo peak');

const fallbackSample = arrange({bpm:144,chip:'snes',order:[0],patterns:[{lead:'C8 . . .',bass:'C2 . . .',chord:'C3 . . .',perc:'K . H .',chordShape:[[0,4,7]]}]});
for (const sample of ['unknown','toString','constructor']) assert.ok(validateSong({...fallbackSample,lead:{...fallbackSample.lead,sample}}).issues.some(issue=>issue.code==='pitch_range' && issue.track==='lead'));
assert.equal(validateSong({...fallbackSample,intent:{lead:'toString'}}).ok,false);
assert.equal(validateSong({...fallbackSample,intent:{toString:'anything'}}).ok,false);
