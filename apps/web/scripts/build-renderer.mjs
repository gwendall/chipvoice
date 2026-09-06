import { build } from '../../../packages/chipvoice/node_modules/esbuild/lib/main.js';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
await build({ entryPoints: ['src/lib/audio-worker.ts'], outfile: 'generated/audio-render.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: true, logLevel: 'warning' });
await build({entryPoints:['src/arrangements/render-worker.ts'],outfile:'public/arrangement-render.js',bundle:true,platform:'browser',format:'iife',target:'es2022',minify:true,logLevel:'warning'});
await mkdir('public/arrangement-data',{recursive:true});
for(const id of ['mario','zelda','sonic','mario-native'])await copyFile(`../../scores/arrangements/${id}.json`,`public/arrangement-data/${id}.json`);

// The first screen needs titles, parts and assets, not the full per-note audit.
const report=JSON.parse(await readFile('public/arrangement-data/report.json','utf8'));
const asset=({file,metrics})=>({file,metrics:{rmsDbFS:metrics.rmsDbFS,samplePeakDbFS:metrics.samplePeakDbFS,envelope:[]}});
const catalogue={pieces:report.pieces.map(p=>({...p,cases:p.cases.map(c=>({...c,omitted:c.losses.filter(l=>l.kind==='voice-omitted').length,losses:c.losses.filter(l=>l.kind!=='voice-omitted'),asset:asset(c.asset)})),reference:p.reference?{...p.reference,asset:asset(p.reference.asset)}:undefined}))};
await writeFile('generated/arrangement-catalogue.json',JSON.stringify(catalogue));
const {performanceClock}=await import('chipvoice');
const {scoreOverview}=await import('../src/arrangements/score-overview.mjs');
for(const id of ['mario','zelda','sonic']){
 const score=JSON.parse(await readFile(`../../scores/arrangements/${id}.json`,'utf8'));
 await writeFile(`public/arrangement-data/${id}-view.json`,JSON.stringify(scoreOverview(score,performanceClock(score))));
 for(const row of report.pieces.find(p=>p.id===id).cases)await writeFile(`public/arrangement-data/${id}-${row.chip}-view.json`,JSON.stringify(scoreOverview(score,performanceClock(score),row.losses)));
}
