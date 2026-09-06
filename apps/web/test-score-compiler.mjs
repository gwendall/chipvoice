import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compileRecipe} from './scripts/scores/compile.mjs';
import {scoreMelody,compareMelody,scheduledMelody,fidelityChips} from './scripts/scores/fidelity.mjs';
const recipes=JSON.parse(await readFile(new URL('../../scores/classics.json',import.meta.url),'utf8'));
for(const recipe of recipes){
 const c=compileRecipe(recipe),reference=JSON.parse(await readFile(new URL(`../../scores/references/${recipe.id}.json`,import.meta.url),'utf8'));
 assert.ok(recipe.beats>=96,'Full phrases must replace four-bar snippets');
 assert.ok(compareMelody(reference,scoreMelody(c.song)).pass);
 for(const chip of fidelityChips)assert.ok(compareMelody(reference,scheduledMelody(c.song,chip)).pass,`${recipe.id}/${chip.spec.id}`);
 const observed=scoreMelody(c.song),mutate=fn=>{const bad=structuredClone(observed);fn(bad);assert.equal(compareMelody(reference,bad).pass,false);};
 mutate(b=>b.notes.splice(3,1)); // missing note
 mutate(b=>b.notes.splice(3,0,b.notes[3].slice())); // invented note
 mutate(b=>b.notes[3][2]+=12); // an octave is not considered equivalent
 mutate(b=>b.notes[3][0]+=.5); // displaced onset / altered rest
 mutate(b=>b.notes[3][1]+=.5); // wrong release / erased rest
 mutate(b=>b.beats-=4); // truncation, including a silent tail
 mutate(b=>b.unexpectedRoles.push({pattern:0,role:'bass'}));
 for(const p of c.song.patterns)for(const role of ['chord','bass','perc'])assert.ok(p[role].split(' ').every(t=>t==='.'||t==='='));
}
const solo={version:2,id:'solo',title:'Solo source',chip:'2a03',bpm:120,stepsPerBeat:12,beats:4,lines:{lead:[[0,1/3,'C4'],[1/3,2/3,'D4'],[2/3,1,'E4']]}};
const song=compileRecipe(solo).song;
assert.equal(scoreMelody(song).notes.length,3);
for(const chip of fidelityChips){const events=scheduledMelody(song,chip);assert.equal(events.notes.length,3);assert.ok(Math.abs(events.notes[2][0]-2/3)<1e-8);assert.deepEqual(events.unexpectedRoles,[]);}
const bad=structuredClone(solo);bad.lines.lead[1][0]=.1;assert.throws(()=>compileRecipe(bad),/off-grid/);
bad.lines.lead=[[0,2,'C4'],[1,3,'D4']];assert.throws(()=>compileRecipe(bad),/overlapping/);
bad.lines.lead=[[0,2,'wat']];assert.throws(()=>compileRecipe(bad),/Invalid/);
// A held note spanning the nominal pattern cut is neither cut nor retriggered.
const tied=compileRecipe({...solo,beats:32,lines:{lead:[[0,1,'C4'],[15,17,'D4'],[20,22,'E4']]}}).song;
assert.deepEqual(scoreMelody(tied).notes,[[0,1,60],[15,17,62],[20,22,64]]);
assert.equal(scheduledMelody(tied,fidelityChips[0]).notes.length,3);
console.log('PASS 415 source notes on five sequencer maps; mutation checks catch missing/extra/octave/rhythm/rest/truncation/backing errors; triplets and ties retained');
