import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {planPerformance,renderPerformance,nesChip,gbChip,mdChip,snesChip,c64Chip} from '../../packages/chipvoice/dist/index.js';
const rms=audio=>Math.sqrt(audio.left.reduce((s,v)=>s+v*v,0)/audio.left.length);
const score=(velocity=96,importance=1)=>({version:1,title:'Acoustic contract',ticksPerBeat:96,endTick:96,tempos:[{tick:0,microsecondsPerBeat:500000}],notices:[],parts:[{id:'line',name:'line',role:'lead',priority:100,mix:{importance},notes:[{id:'n',tick:0,endTick:96,pitch:60,velocity,program:80}]}]});
const rows=[];
for(const chip of [nesChip,gbChip,mdChip,snesChip,c64Chip]){
 const loud=planPerformance(score(),chip),quiet=planPerformance(score(32),chip),background=planPerformance(score(96,.3),chip);
 const levels=[loud,quiet,background].map(p=>rms(renderPerformance(p,chip)));
 assert.ok(levels.every(x=>Number.isFinite(x)&&x>.001),'audible sound, not just finite samples');
 const dynamicsDb=20*Math.log10(levels[0]/levels[1]),prominenceDb=20*Math.log10(levels[0]/levels[2]);
 assert.ok(dynamicsDb>=4&&dynamicsDb<=16,`${chip.spec.id}: velocity contrast must survive (${dynamicsDb} dB)`);
 assert.ok(prominenceDb>=4&&prominenceDb<=18,`${chip.spec.id}: author prominence must affect the sound (${prominenceDb} dB)`);
 assert.deepEqual(loud.notes,background.notes,'mix controls do not rewrite note allocation');
 rows.push({chip:chip.spec.id,dynamicsDb,prominenceDb,levels});
}
await mkdir('.artifacts/automatic-mixing',{recursive:true});await writeFile('.artifacts/automatic-mixing/acceptance.json',JSON.stringify({scope:'Audibility and bounded dynamic/prominence contrast for a declared lead fixture; not a perceptual or timbre oracle',rows},null,2));
console.log('PASS five-console acoustic gates: audibility, dynamics and explicit prominence',rows);
