// Offline ablation, deliberately outside the public SDK API. Bundle the exact
// candidate with only automatic role weights and density sharing disabled.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {planPerformance,renderPerformance,nesChip,gbChip,mdChip,snesChip,c64Chip} from '../../packages/chipvoice/dist/index.js';
import {generatedPerformance} from './corpus.mjs';
import {candidateIdentity} from './freeze.mjs';
import {measureAudio} from '../../packages/conform/src/listening/metrics.mjs';
const out='.artifacts/automatic-mixing/ablation';await mkdir(out,{recursive:true});
const replacements=[
 ['const importance = note.mix?.importance ?? (source ? 1 : prominence[note.role]);','const importance = note.mix?.importance ?? 1;'],
 ['densityGain = segment.from === segment.target ? segment.target : segment.target + (segment.from - segment.target) * Math.exp(-Math.max(0, at - segment.at) / .03)','densityGain = 1'],
];
let transformed=0;
await build({entryPoints:['packages/chipvoice/dist/index.js'],bundle:true,platform:'node',format:'esm',outfile:`${out}/sdk.mjs`,plugins:[{name:'explicit-ablation',setup(build){build.onLoad({filter:/\/mix\.js$/},async ({path})=>{let contents=await readFile(path,'utf8');for(const [before,after] of replacements){assert.equal(contents.split(before).length,2,'ablation needs review when policy structure changes');contents=contents.replace(before,after);}transformed++;return {contents,loader:'js'};});}}]});
assert.equal(transformed,1);
const calibration=await import(pathToFileURL(resolve(out,'sdk.mjs')).href),rows=[];
for(const style of ['lead','bass','drums','solo'])for(const chip of [nesChip,gbChip,mdChip,snesChip,c64Chip]){
 const score=generatedPerformance(12,style),modes=[];let ledger;
 for(const mode of ['legacy','calibration-only','automatic']){
  const compile=mode==='calibration-only'?calibration.planPerformance:planPerformance;
  const plan=compile(score,chip,{allowLoss:true,...(mode==='legacy'?{mix:false}:{})});
  if(ledger)assert.deepEqual(plan.notes,ledger,'ablation changes controls, never voice allocation');ledger=plan.notes;
  const metrics=measureAudio(renderPerformance(plan,chip));assert.equal(metrics.invalidSamples,0);assert.equal(metrics.clippedSamples,0);
  modes.push({mode,metrics});
 }
 rows.push({style,chip:chip.spec.id,modes});
}
const report={candidate:await candidateIdentity(),ablationSha256:createHash('sha256').update(await readFile(`${out}/sdk.mjs`)).digest('hex'),replacements,scope:'Development-only ablation. Instrument calibration, explicit author controls and allocation remain; only inferred role weights and density sharing are removed. This is not another unseen holdout.',rows};
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log('PASS 20 development ablations: legacy, calibrated-only, complete policy; identical source allocation');
