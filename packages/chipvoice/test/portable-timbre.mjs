import assert from 'node:assert/strict';
import {planPerformance,renderPerformance,nesChip,gbChip,snesChip,mdChip} from '../dist/index.js';
import {analyzeFmTimbre,prepareFmTimbres} from '../../../scores/analyze-fm-timbres.mjs';
const patch={volume:[15],sustain:true,fm:{algorithm:7,feedback:0,ops:Array.from({length:4},()=>({dt:0,mul:4,tl:24,ks:0,ar:31,dr:0,sr:0,sl:0,rr:15}))}};
const input={version:1,title:'Opaque native patch',ticksPerBeat:1000,endTick:1000,tempos:[{tick:0,microsecondsPerBeat:1000000}],notices:[],parts:[{id:'p',name:'p',role:'lead',priority:100,origin:{chip:'md',voice:'fm1'},instruments:{'md:4':patch},notes:[{id:'n',tick:100,endTick:700,pitch:57,velocity:127,program:4}]}]};
const prepared=prepareFmTimbres(input),t=prepared.parts[0].portableTimbres['md:4'];
assert.equal(t.pitchOffset,24,'measure carrier pitch, not the FM register base');assert.ok(t.confidence>.95);
const correlation=(a,hz)=>{const lag=Math.round(44100/hz);let xy=0,xx=0,yy=0;for(let i=10000;i<20000;i++){xy+=a[i]*a[i+lag];xx+=a[i]**2;yy+=a[i+lag]**2;}return xy/Math.sqrt(xx*yy);};
for(const chip of [nesChip,gbChip,snesChip]){
 const plan=planPerformance(prepared,chip);assert.equal(plan.notes[0].pitch,81);
 assert.ok(correlation(renderPerformance(plan,chip).left,880)>.9,`${chip.spec.id}: actual audio has the native 880 Hz period`);
 const renamed=structuredClone(prepared),p=renamed.parts[0];p.instruments['md:80']=p.instruments['md:4'];delete p.instruments['md:4'];p.portableTimbres['md:80']=p.portableTimbres['md:4'];delete p.portableTimbres['md:4'];p.notes[0].program=80;
 assert.deepEqual(plan.events,planPerformance(renamed,chip).events,'opaque patch renumbering cannot change the sound');
}
assert.deepEqual(planPerformance(input,mdChip).events,planPerformance(prepared,mdChip).events,'source chip keeps its original patch and register frequency');
const stale=structuredClone(prepared);stale.parts[0].instruments['md:4'].fm.ops[0].mul=1;assert.throws(()=>planPerformance(stale,snesChip),/Stale portable/);
for(const value of [NaN,Infinity,49]){const invalid=structuredClone(prepared);invalid.parts[0].portableTimbres['md:4'].pitchOffset=value;assert.throws(()=>planPerformance(invalid,snesChip),/Invalid portable/);}
const absent=structuredClone(input),renamed=structuredClone(input);renamed.parts[0].instruments={'md:80':patch};renamed.parts[0].notes[0].program=80;
assert.deepEqual(planPerformance(absent,nesChip).events,planPerformance(renamed,nesChip).events,'unmeasured native IDs never become GM programs');
const dry=planPerformance({...input,parts:[{...input.parts[0],origin:undefined,instruments:undefined,notes:[{...input.parts[0].notes[0],program:73}]}]},snesChip);
let select=0;const withoutEcho={...dry,events:dry.events.map(e=>{if(e.addr===0xf2)select=e.value;return e.addr===0xf3&&(select===0x2c||select===0x3c)?{...e,value:0}:e;})};
assert.deepEqual(renderPerformance(dry,snesChip).left,renderPerformance(withoutEcho,snesChip).left,'factory notes have no imposed echo');
console.log('PASS measured FM pitch, real console PCM, opaque patch IDs, stale descriptor rejection, native preservation and dry SNES');
