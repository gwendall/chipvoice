import {arrange,validateSong,noteToFreq} from '../../../../packages/chipvoice/dist/index.js';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(import.meta.dirname,'../../../..');
const chips=['2a03','dmg','md','snes','c64'];
const beats=text=>{if(!/^(?:\d+(?:\.\d+)?|\d+\/\d+)$/.test(text))throw new Error(`Invalid duration: ${text}`);const parts=text.split('/').map(Number);const n=parts.length===2?parts[0]/parts[1]:parts[0];if(!Number.isFinite(n)||n<=0)throw new Error(`Invalid duration: ${text}`);return n;};

/** A reviewed melody/harmony recipe becomes the same four-role score for every
 * machine. Timing reduction is explicit and recorded, never silently guessed. */
export function compileRecipe(recipe){
 if(recipe.version!==1||!recipe.bars?.length||recipe.bars.length>16)throw new Error('Expected version 1 and 1–16 bars');
 const quantization=[];
 const patterns=recipe.bars.map((bar,index)=>{
  let beat=0;const lead=Array(16).fill('.');lead[0]='=';
  for(const item of bar.melody.trim().split(/\s+/)){
   if(item.split(':').length!==2)throw new Error(`Invalid note/duration: ${item}`);
   const [note,duration]=item.split(':');const length=beats(duration??'');
   if(note!=='r'&&!noteToFreq(note))throw new Error(`Invalid note: ${note}`);
   const start=Math.round(beat*4),end=Math.round((beat+length)*4);
   if(end>16||start>=end)throw new Error(`Bar ${index+1}: note does not fit the sixteenth grid`);
   for(const point of [beat,beat+length])if(Math.abs(point*4-Math.round(point*4))>1e-7){
    if(recipe.grid!=='nearest-sixteenth')throw new Error(`Bar ${index+1}: unsupported rhythm; choose an explicit reduction`);
    quantization.push({bar:index+1,beat:point,renderedBeat:Math.round(point*4)/4});
   }
   lead[start]=note==='r'?'=':note;
   beat+=length;
  }
  if(Math.abs(beat-4)>1e-7)throw new Error(`Bar ${index+1} lasts ${beat} beats, expected 4`);
  const chord=Array(16).fill('.'),bass=Array(16).fill('.');
  if(!noteToFreq(bar.root)||!Array.isArray(bar.shape)||!bar.shape.length)throw new Error('Each bar needs a root and chord intervals');
  chord[0]=bar.root;
  const root=bar.bass;if(!noteToFreq(root)||!noteToFreq(bar.fifth))throw new Error('Each bar needs bass root and fifth');
  // Original supporting accompaniment, independent of the source piano voicing.
  for(const [step,note] of [[0,root],[4,bar.fifth],[8,root],[12,bar.fifth]]){bass[step]=note;bass[step+3]='=';}
  return {lead:lead.join(' '),chord:chord.join(' '),bass:bass.join(' '),perc:bar.drums??'K . H . S . H . K . H . S . H .',chordShape:[bar.shape]};
 });
 const song={title:recipe.title,author:recipe.composer,chip:recipe.chip,bpm:recipe.bpm,intent:recipe.intent,patterns,order:patterns.map((_,i)=>i)};
 for(const chip of chips){const result=validateSong(arrange(song,chip));if(!result.ok)throw new Error(`${recipe.id}/${chip}: ${JSON.stringify(result.issues)}`);}
 return {id:recipe.id,title:recipe.title,mood:recipe.mood,color:recipe.color,source:recipe.source,composer:recipe.composer,adaptation:recipe.adaptation,quantization,song};
}
export async function compile(){
 const recipes=JSON.parse(await readFile(resolve(root,'scores/classics.json'),'utf8'));
 if(new Set(recipes.map(recipe=>recipe.id)).size!==recipes.length)throw new Error('Duplicate cartridge ID');
 const result=recipes.map(recipe=>({...compileRecipe(recipe),recipeSha256:createHash('sha256').update(JSON.stringify(recipe)).digest('hex')}));
 const output=JSON.stringify(result,null,2)+'\n';const path=resolve(root,'apps/web/src/studio/classics.json');
 if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==output)throw new Error('Cartridges are stale: run pnpm scores:build');}
 else await writeFile(path,output);
 console.log(`PASS ${result.length} reproducible cartridges validated on ${chips.length} chips; ${result.reduce((n,r)=>n+r.quantization.length,0)} documented timing reductions`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await compile();
