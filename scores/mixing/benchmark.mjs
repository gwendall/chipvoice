import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {performance as timer} from 'node:perf_hooks';
import {gzipSync} from 'node:zlib';
import {planPerformance,nesChip,gbChip,mdChip,snesChip,c64Chip,prepareMixPhrase,instrumentsFor} from '../../packages/chipvoice/dist/index.js';
import {generatedPerformance} from './corpus.mjs';
const median=a=>a.sort((a,b)=>a-b)[a.length>>1];
const results=[];
for(const chip of [nesChip,gbChip,mdChip,snesChip,c64Chip]){
 const score=generatedPerformance(12),samples={legacy:[],automatic:[],phrase:[]};
 const phrase=[{voice:chip.spec.roles.lead,part:'melody',role:'lead',at:0,note:'C4',duration:.25,instrument:instrumentsFor(chip.spec.id).lead}];
 for(let iteration=0;iteration<30;iteration++)for(const mode of iteration%2?['automatic','legacy','phrase']:['legacy','automatic','phrase']){
  const start=timer.now();for(let i=0;i<10;i++)mode==='phrase'?prepareMixPhrase(chip,phrase):planPerformance(score,chip,{allowLoss:true,mix:mode==='legacy'?false:{}});
  if(iteration>=5)samples[mode].push((timer.now()-start)/10);
 }
 results.push({chip:chip.spec.id,legacyMs:median(samples.legacy),automaticMs:median(samples.automatic),phraseMs:median(samples.phrase)});
}
const profiles=await readFile('packages/chipvoice/dist/mix-profiles.js');
const report={scope:'Same-host interleaved warmed planning; legacy control mode uses the same allocator. This isolates policy overhead, not an exact historical SDK or phone baseline.',results,profiles:{bytes:profiles.length,gzipBytes:gzipSync(profiles).length}};
await mkdir('.artifacts/automatic-mixing',{recursive:true});await writeFile('.artifacts/automatic-mixing/benchmark.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
