import assert from 'node:assert/strict';
import {shapeScore,transposeBounds,arrange,validateSong} from '../dist/index.js';
const source={id:'fixed',chip:'snes',bpm:144,patterns:[{lead:'C4 . D4 =',bass:'C2 . . =',chord:'C3 . . .',chordShape:[[0,4,7]],perc:'K H S H'}],order:[0]};
const before=JSON.stringify(source);
const up=shapeScore(source,{transpose:7,drums:50});
assert.equal(up.patterns[0].lead,'G4 . A4 =');assert.equal(up.patterns[0].bass,'G2 . . =');assert.equal(up.patterns[0].chord,'G3 . . .');assert.equal(up.patterns[0].perc,'K . S .');assert.deepEqual(up.patterns[0].chordShape,[[0,4,7]]);assert.equal(up.id,undefined);
assert.equal(shapeScore(source,{transpose:0,drums:100}),source);assert.equal(JSON.stringify(source),before);
let previous=new Set();for(let drums=0;drums<=100;drums++){
 const line=shapeScore(source,{drums}).patterns[0].perc.split(' '),hits=new Set(line.flatMap((token,index)=>token==='.'?[]:[index]));
 for(const hit of previous)assert.ok(hits.has(hit));previous=hits;
}
const high={...source,patterns:[{...source.patterns[0],chord:'B8 . . .'}]};assert.equal(transposeBounds(high).max,-7);assert.throws(()=>shapeScore(high,{transpose:1}),RangeError);
assert.throws(()=>shapeScore(source,{transpose:.5}),RangeError);assert.throws(()=>shapeScore(source,{drums:101}),RangeError);
for(const chip of ['2a03','dmg','md','snes','c64'])for(const transpose of [-12,0,12])assert.ok(validateSong(arrange(shapeScore(source,{transpose,drums:50}),chip)).ok);
console.log('PASS pitch intervals, chord shapes, rests, deterministic monotonic drums, restoration, range and five-chip validation');
