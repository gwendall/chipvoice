// V8-only regression for the Node/Chromium hosts we qualify. No native syntax
// is shipped in the library: constructor layouts matter inside per-cycle DSP.
import assert from 'node:assert/strict';
import {nesChip,gbChip,mdChip,snesChip,c64Chip} from '../dist/index.js';
for(const chip of [nesChip,gbChip,mdChip,snesChip,c64Chip]) {
 const core=chip.create(44100);core.render(new Float32Array(4096),new Float32Array(4096),0);const fork=core.fork(),seen=new Set();
 const check=(a,b,path)=>{
  if(!a||typeof a!=='object'||seen.has(a)||Array.isArray(a)||ArrayBuffer.isView(a)||a instanceof ArrayBuffer||a instanceof Map||a instanceof Set)return;
  seen.add(a);assert.ok(%HaveSameMap(a,b),`${path}: checkpoint retains the constructor's object layout`);
  for(const key of Object.keys(a))if(key!=='profile')check(a[key],b[key],path+'.'+key);
 };
 check(core,fork,chip.spec.id);
 assert.notEqual(fork.stage.profile,core.stage.profile,'mutable caller profiles remain isolated');
 const second=fork.fork();
 assert.notEqual(second.chip.voices,core.chip.voices,'second-generation snapshots must not reuse constructor-global arrays');
 assert.notEqual(second.chip.voices,fork.chip.voices);
 const voices=structuredClone(core.chip.voices);
 second.chip.voices.push({id:'checkpoint-only'});
 assert.deepEqual(core.chip.voices,voices,'fork mutations cannot change the shared chip definition');
 assert.deepEqual(fork.chip.voices,voices);
 const original=core.stage.profile.scale;fork.stage.profile.scale=.123;assert.equal(core.stage.profile.scale,original);
}
console.log('PASS checkpoints preserve hot DSP object layouts and isolate mutable profiles');
