import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {captureNsf} from '../capture-nsf.mjs';
import {nsfPerformance} from '../extract-nsf-performance.mjs';
const [input,out]=process.argv.slice(2);
if(!input||!out)throw new Error('Usage: node scores/arrangements/capture-mario.mjs source.nsf output-dir');
const bytes=await readFile(input),source=JSON.parse(await readFile(new URL('./mario.json',import.meta.url))).source;
assert.equal(createHash('sha256').update(bytes).digest('hex'),source.sha256,'Reviewed NSF source required');
const capture=captureNsf(bytes,{frames:10600});
const signature=c=>JSON.stringify(capture.events.slice(c.first,c.end).map(e=>[e.addr,e.value]));
for(let i=0;i<5184;i++)assert.equal(signature(capture.calls[136+i]),signature(capture.calls[5320+i]),`Loop repeat frame ${i}`);
const {score,native}=nsfPerformance(capture,{title:'Mario · Ground Theme',endFrame:5320,loopFrame:136,source});
for(const part of score.parts)if(part.role==='perc')for(const note of part.notes){const period=note.expression.find(p=>p.gain>0)?.noisePeriod??13;note.drum=period<=7?36:period<=10?38:42;}
await mkdir(out,{recursive:true});
await writeFile(`${out}/mario.json`,JSON.stringify(score)+'\n');await writeFile(`${out}/mario-native.json`,JSON.stringify(native)+'\n');
console.log('Captured complete intro + loop; verified the entire repeated 5,184-frame cycle. Review output before replacing frozen sources.');
