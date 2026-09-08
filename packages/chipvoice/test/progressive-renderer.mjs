import assert from 'node:assert/strict';
import {arrange,recordSong,renderSong,nesChip,gbChip,mdChip,snesChip,c64Chip} from '../dist/index.js';
import {ProgressiveRenderer} from '../dist/progressive-renderer.js';
const score={bpm:172,order:[0,0],patterns:[{chordShape:[[0,4,7]],lead:'C5 = E5 = G5 = C6 =',chord:'C4 = = = F4 = = =',bass:'C2 = C3 = F2 = F3 =',perc:'K H S H K H S H'}]};
for(const chip of [nesChip,gbChip,mdChip,snesChip,c64Chip]){
 const song=arrange(score,chip.spec.id),seconds=2.6,rate=44100;
 const expected=renderSong(song,{seconds,sampleRate:rate,stereo:true,gain:.6});
 const capture=recordSong(song,{seconds,sampleRate:rate});
 const renderer=new ProgressiveRenderer({chip:chip.spec.id,seconds,loopStartSeconds:0,events:capture.events,memory:capture.memory,notes:[],losses:[]},chip,rate,.6);
 for(const [start,frames] of [[0,4800],[4800,20000],[24800,43000],[4000,9000],[80000,25000],[44100,2048],[110000,2000]]){
  const iterator=renderer.read(start,frames);let next;do{next=iterator.next();}while(!next.done);
  const {left,right}=next.value;assert.deepEqual(left,expected.left.slice(start,start+frames),`${chip.spec.id}: left at ${start}`);assert.deepEqual(right,expected.right.slice(start,start+frames),`${chip.spec.id}: right at ${start}`);
 }
}
console.log('PASS progressive blocks, cached/backward/cold seeks preserve full offline PCM on five chips');
const {loadNative}=await import('../../../scores/arrangements/native-sources.mjs');
const {renderPerformance}=await import('../dist/index.js');
for(const id of ['mario','zelda','sonic']) {
 const capture=await loadNative(id),chip=capture.chip==='md'?mdChip:nesChip;
 const plan={...capture,seconds:8,memory:capture.memory.map(block=>({...block,bytes:new Uint8Array(block.bytes)}))};
 const expected=renderPerformance(plan,chip,{sampleRate:44100,gain:.6});
 const renderer=new ProgressiveRenderer(plan,chip,44100,.6);
 for(const [start,frames] of [[0,4096],[220000,22050],[45000,32768],[280000,12000]]) {
  const branch=renderer.branch(),iterator=branch.read(start,frames);let next;do{next=iterator.next();}while(!next.done);renderer.adopt(branch);
  assert.deepEqual(next.value.left,expected.left.slice(start,start+frames),`${id}: native checkpoint left at ${start}`);
  assert.deepEqual(next.value.right,expected.right.slice(start,start+frames),`${id}: native checkpoint right at ${start}`);
 }
}
console.log('PASS native Mario, Zelda and Sonic captures retain exact PCM through branched seeks');
