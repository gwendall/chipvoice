import {arrange,validateSong,noteToFreq} from '../../../../packages/chipvoice/dist/index.js';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {scoreMelody,compareMelody,scheduledMelody,fidelityChips} from './fidelity.mjs';
const root=resolve(import.meta.dirname,'../../../..');
const roles=['lead','chord','bass','perc'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** An explicit timeline becomes portable tracker patterns. An absent role is
 * silent. Pattern cuts may never split a held note or invent a re-attack. */
export function compileRecipe(recipe){
 if(recipe.version!==2||!Number.isFinite(recipe.beats)||recipe.beats<=0||recipe.beats>256)throw new Error('Expected version 2 and up to 256 beats');
 const grid=recipe.stepsPerBeat??4;if(grid!==4&&grid!==12)throw new Error('stepsPerBeat must be 4 or 12');
 const length=recipe.beats*grid;if(!Number.isInteger(length))throw new Error('Total duration is off-grid');
 const lines=Object.fromEntries(roles.map(role=>[role,Array(length).fill('.')]));
 const held=new Uint8Array(length+1);
 for(const role of roles){
  lines[role][0]='=';let end=0;
  for(const [at,until,note] of recipe.lines?.[role]??[]){
   const start=Math.round(at*grid),stop=Math.round(until*grid);
   if(!Number.isFinite(at)||!Number.isFinite(until)||Math.abs(start-at*grid)>1e-7||Math.abs(stop-until*grid)>1e-7||start<end||stop<=start||stop>length)throw new Error(`${role}: overlapping, invalid or off-grid note at beat ${at}`);
   if(role==='perc'?!/^[KSHO]$/.test(note):typeof note!=='string'||!noteToFreq(note))throw new Error(`Invalid ${role} note: ${note}`);
   lines[role][start]=note;if(stop<length)lines[role][stop]='=';
   for(let step=start+1;step<stop;step++)held[step]=1;
   end=stop;
  }
 }
 // Prefer four-bar sections; move the boundary backwards to a release/onset
 // when a tie crosses it. The independent comparison verifies concatenation.
 const patterns=[];let start=0;
 while(start<length){
  let end=Math.min(length,start+grid*16);
  while(end<length&&end>start&&held[end])end--;
  if(end===start)throw new Error('A held note exceeds the supported pattern window');
  patterns.push({...Object.fromEntries(roles.map(role=>{const tokens=lines[role].slice(start,end);if(tokens[0]==='.')tokens[0]='=';return[role,tokens.join(' ')];})),chordShape:[[0]]});
  start=end;
 }
 if(patterns.length>16)throw new Error('Score requires more than 16 patterns');
 const song={title:recipe.title,author:recipe.composer,chip:recipe.chip,bpm:recipe.bpm,stepsPerBeat:grid,intent:recipe.intent,patterns,order:patterns.map((_,i)=>i)};
 for(const chip of fidelityChips){const result=validateSong(arrange(song,chip.spec.id));if(!result.ok)throw new Error(`${recipe.id}/${chip.spec.id}: ${JSON.stringify(result.issues)}`);}
 return {id:recipe.id,title:recipe.title,mood:recipe.mood,color:recipe.color,source:recipe.source,composer:recipe.composer,adaptation:recipe.adaptation,coverage:recipe.coverage,song};
}
export async function compile(){
 const recipes=JSON.parse(await readFile(resolve(root,'scores/classics.json'),'utf8'));
 if(new Set(recipes.map(recipe=>recipe.id)).size!==recipes.length)throw new Error('Duplicate cartridge ID');
 const result=[];
 for(const recipe of recipes){
  const referenceBytes=await readFile(resolve(root,`scores/references/${recipe.id}.json`)),reference=JSON.parse(referenceBytes);
  if(hash(referenceBytes)!==recipe.referenceSha256)throw new Error(`${recipe.id}: source reference changed; review it explicitly`);
  const cartridge=compileRecipe(recipe),comparison=compareMelody(reference,scoreMelody(cartridge.song));
  const scheduled=Object.fromEntries(fidelityChips.map(chip=>[chip.spec.id,compareMelody(reference,scheduledMelody(cartridge.song,chip))]));
  if(!comparison.pass||Object.values(scheduled).some(row=>!row.pass))throw new Error(`${recipe.id}: melody differs from source: ${JSON.stringify({comparison,scheduled})}`);
  result.push({...cartridge,fidelity:{...comparison,referenceSha256:recipe.referenceSha256,sourceSha256:reference.sourceSha256,checkedChips:Object.keys(scheduled)},recipeSha256:hash(JSON.stringify(recipe))});
 }
 const output=JSON.stringify(result,null,2)+'\n',path=resolve(root,'apps/web/src/studio/classics.json');
 if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==output)throw new Error('Cartridges are stale: run pnpm scores:build');}else await writeFile(path,output);
 console.log(`PASS ${result.length} source melodies, ${result.reduce((n,r)=>n+r.fidelity.referenceNotes,0)} notes, five sequencer role maps each; no invented accompaniment`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await compile();
