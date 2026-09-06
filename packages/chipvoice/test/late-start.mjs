import assert from 'node:assert/strict';
import {OfflineDriver,snesChip} from '../dist/index.js';
function render(origin){
 const core=snesChip.create(32000),driver=new OfflineDriver(core,snesChip,()=>origin);
 driver.playNote('v0',{note:'C4',at:origin+.1,duration:1,instrument:{sample:'flute',volume:[15],sustain:true}});driver.flush();
 const audio=new Float32Array(16000);core.render(audio,null,origin*32000);return audio;
}
const first=render(0),late=render(2);
let maxDelta=0;for(let i=0;i<first.length;i++)maxDelta=Math.max(maxDelta,Math.abs(first[i]-late[i]));
assert.equal(maxDelta,0,'Creating a SNES engine on an already-running clock must retain its startup register delays');
console.log('PASS late SNES creation preserves startup timing and identical relative PCM');
