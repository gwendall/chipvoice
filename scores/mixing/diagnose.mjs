import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {performance as timer} from 'node:perf_hooks';
import {planPerformance,renderPerformance,isolateNativePerformance,toWav,nesChip,mdChip} from '../../packages/chipvoice/dist/index.js';
import {measureAudio,spectrum} from '../../packages/conform/src/listening/metrics.mjs';
const out=process.argv[2]??'.artifacts/automatic-mixing/before';await mkdir(out,{recursive:true});
const score=JSON.parse(await readFile(new URL('../arrangements/zelda.json',import.meta.url))),native=JSON.parse(await readFile(new URL('../arrangements/zelda-native.json',import.meta.url)));
for(const part of score.parts)part.origin={chip:'2a03',voice:part.id};
const report={source:score.source.sha256,seconds:12,measurements:[]};
for(const chip of [nesChip,mdChip])for(const part of ['mix',...score.parts.map(p=>p.id)]){
 const start=timer.now();
 const plan=chip===nesChip?(part==='mix'?native:isolateNativePerformance(native,[part])):planPerformance(score,chip,{allowLoss:true,...(part==='mix'?{}:{parts:[part]})});
 const audio=renderPerformance({...plan,seconds:12},chip);
 const measurement={chip:chip.spec.id,part,elapsedMs:timer.now()-start,metrics:measureAudio(audio),spectrum:spectrum(audio)};
 report.measurements.push(measurement);await writeFile(`${out}/zelda-${chip.spec.id}-${part}.wav`,toWav(audio));
 console.log(JSON.stringify({chip:measurement.chip,part,rmsDbFS:measurement.metrics.rmsDbFS,peakDbFS:measurement.metrics.samplePeakDbFS,elapsedMs:measurement.elapsedMs}));
}
await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
