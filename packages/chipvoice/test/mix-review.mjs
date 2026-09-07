import assert from 'node:assert/strict';
import {nesChip,mdChip,snesChip,planPerformance,renderPerformance,prepareMixPhrase,instrumentsFor} from '../dist/index.js';
import {observeSnesMixer} from '../../conform/src/listening/snes-mixer.mjs';
const note=(id,pitch=24)=>({id,tick:0,endTick:96,pitch,velocity:127,program:80});
const part=(id,notes,role='lead')=>({id,name:id,role,priority:100,notes});
const score=parts=>({version:1,title:'Mix regression',ticksPerBeat:96,endTick:96,tempos:[{tick:0,microsecondsPerBeat:500000}],notices:[],parts});
const rms=a=>Math.sqrt(a.left.reduce((sum,x)=>sum+x*x,0)/a.left.length);
const tests=[
 ['SNES joint headroom',()=>{for(const pitch of [24,36,60])for(const separate of [false,true]){
  const notes=Array.from({length:8},(_,i)=>note(`n${i}`,pitch));
  const p=planPerformance(score(separate?notes.map(n=>part(n.id,[n])):[part('p',notes)]),snesChip);
  const core=snesChip.digital();for(const b of p.memory)core.load(b.address,b.bytes);core.schedule(p.events);const internal=observeSnesMixer(core);core.trace(Math.round(p.seconds*snesChip.spec.clockHz),()=>{});
  assert.equal(internal.mainClampedAdditions,0);assert.equal(internal.echoClampedAdditions,0);
  assert.ok(rms(renderPerformance(p,snesChip))>.005,'headroom must not silence the arrangement');
 }}],
 ['silent notes do not duck',()=>{
  const loud=note('n0',60),silent=Array.from({length:7},(_,i)=>({...note(`n${i+1}`,61+i),expression:[{tick:0,gain:0}]}));
  const a=renderPerformance(planPerformance(score([part('p',[loud])]),snesChip),snesChip);
  const b=renderPerformance(planPerformance(score([part('p',[loud,...silent])]),snesChip),snesChip);
  assert.ok(a.left.every((v,i)=>v===b.left[i]),'silent additions must preserve exact PCM');
 }],
 ['phrase resources',()=>{
  const tone={voice:'psg3',part:'lead',role:'lead',at:0,note:'A4',duration:.5,instrument:{volume:[15],sustain:true}};
  const noise={voice:'noise',part:'drums',role:'perc',at:.1,note:9,duration:.2,instrument:{volume:[15],sustain:true}};
  assert.throws(()=>prepareMixPhrase(mdChip,[tone,noise]),/overlapping|resource/);
  assert.doesNotThrow(()=>prepareMixPhrase(mdChip,[tone,{...noise,at:.6}]));
 }],
 ['explicit FM percussion uses FM',()=>{
  const p=part('kick',[{...note('n',36),drum:36}],'perc');p.instruments={md:instrumentsFor('md').lead};
  const plan=planPerformance(score([p]),mdChip);
  assert.match(plan.notes[0].voice,/^fm/);assert.ok(!plan.losses.some(l=>l.kind==='instrument-substitution'));
 }],
];
let failed=0;for(const [name,run]of tests)try{run();console.log('PASS',name);}catch(e){failed++;console.error('FAIL',name,e.message);}assert.equal(failed,0);
// Shared controller bound survives stagger, release, feedback, dense entrances
// and changes of expression. Never use final output gain to hide internal clips.
for(const stagger of [0,3,9]){
 const parts=Array.from({length:8},(_,i)=>part(`v${i}`,Array.from({length:3},(_,j)=>({id:`n${j}`,tick:j*192+i*stagger,endTick:j*192+i*stagger+144,pitch:24+i%3*12,velocity:127,program:80,expression:[{tick:j*192+i*stagger,gain:j%2?.5:1},{tick:j*192+i*stagger+72,gain:j%2?1:.5}]}))));
 const input={...score(parts),endTick:672};
 const plan=planPerformance(input,snesChip),core=snesChip.digital();for(const b of plan.memory)core.load(b.address,b.bytes);core.schedule(plan.events);const internal=observeSnesMixer(core);core.trace(Math.round(plan.seconds*snesChip.spec.clockHz),()=>{});assert.equal(internal.mainClampedAdditions,0);assert.equal(internal.echoClampedAdditions,0);
}
// Splitting a role across source tracks cannot alter its controller budget.
const split=score([part('a',[note('0',60)]),part('b',[note('1',64)])]);
const joined=score([part('a',[note('0',60),note('1',64)])]);
assert.deepEqual(planPerformance(split,snesChip).events,planPerformance(joined,snesChip).events);
console.log('PASS staggered SNES entrances, releases, expression and track-grouping invariance');
const loud=note('loud',72),silent={...note('silent',24),expression:[{tick:0,gain:0}]};
const alone=planPerformance(score([part('p',[loud])]),snesChip);
const withSilent=planPerformance(score([part('p',[silent,loud])]),snesChip);
assert.deepEqual(alone.events,withSilent.events,'silent earlier/lower notes cannot move audible voices');
assert.deepEqual(withSilent.silentNotes,[{part:'p',id:'silent'}]);
const occupied=score([part('silent',Array.from({length:8},(_,i)=>({...silent,id:`s${i}`}))),part('audible',[loud])]);
assert.equal(planPerformance(occupied,snesChip).notes.length,1,'silent parts cannot steal every voice');
let reads=0;const invalid={voice:'v0',part:'p',role:'lead',at:0,note:'C4',duration:100,instrument:{get volume(){reads++;return [15];}}};
assert.throws(()=>prepareMixPhrase(snesChip,[invalid]),/phrase/);assert.equal(reads,0,'reject oversized phrases before allocating frames');
const kick=part('kick',[{...note('n',36),drum:36}],'perc');kick.instruments={md:instrumentsFor('md').lead};
assert.deepEqual(planPerformance(score([kick]),mdChip).events,planPerformance(score([kick]),mdChip,{transpose:12}).events,'melodic transpose does not retune FM drums');
const corrected={...kick,role:'lead',roleInference:{confidence:'high',reason:'override'},instruments:undefined};
assert.notEqual(planPerformance(score([corrected]),nesChip).notes[0].voice,'noi','manual musical role overrides channel-derived percussion');
console.log('PASS source-silent ledger, allocation invariance, preallocation bounds, drum transpose and role override');
const {balanceMixFrames}=await import('../dist/mix-headroom.js');
const frame=(time,volume)=>({at:Math.round(time*snesChip.spec.clockHz),volume,freq:440,period:9,duty:2,noiseMode:false,pitchOffset:0,waveform:null,wave:null,fm:null,sample:'tri'});
const boundary=[{voice:'v7',frames:[frame(0,15),frame(.988,0)],until:2*snesChip.spec.clockHz},{voice:'v0',frames:[frame(0,15),frame(.99,15),frame(1.01,15)],until:2*snesChip.spec.clockHz}];
balanceMixFrames(snesChip,boundary,{version:1,calibratedNotes:2,fallbackNotes:0,diagnostics:[]});
const driver=snesChip.driver(),writes=[];
for(const n of boundary){const events=driver.note(n.voice,n.frames);for(let i=0;i<events.length-1;i++)if(events[i].addr===0xf2&&[1,0x71].includes(events[i].value)&&events[i+1].addr===0xf3)writes.push({voice:n.voice,...events[i+1]});}
const held=new Map();for(const e of writes.sort((a,b)=>a.at-b.at)){held.set(e.voice,e.value);assert.ok([...held.values()].reduce((a,b)=>a+b,0)<=38,'recovery never exceeds the budget between staggered hardware writes');}
console.log('PASS physical SNES volume budget at recovery boundaries');
const {OfflineDriver}=await import('../dist/index.js');
const phrase=prepareMixPhrase(snesChip,Array.from({length:8},(_,i)=>({voice:`v${i}`,part:`p${i}`,role:'lead',at:0,note:'C2',duration:.5,instrument:{sample:'square',volume:[15],sustain:true}})));
const phraseCore=snesChip.digital(),sink={schedule:e=>phraseCore.schedule(e),load:(a,b)=>phraseCore.load(a,b),reset:()=>phraseCore.reset(),setGain:()=>{}};
const offline=new OfflineDriver(sink,snesChip);for(const n of phrase.notes)offline.playNote(n.voice,n);offline.flush();
const internal=observeSnesMixer(phraseCore);phraseCore.trace(Math.round(.7*snesChip.spec.clockHz),()=>{});assert.equal(internal.mainClampedAdditions,0);assert.equal(internal.echoClampedAdditions,0);
console.log('PASS SNES phrase through the public offline driver and internal mixer');
