import assert from 'node:assert/strict';
import {importMidi,planPerformance,renderPerformance,performanceClock,validatePerformance,nesChip,gbChip,mdChip,snesChip} from '../dist/index.js';
import {RegisterTransactions} from '../dist/register-transactions.js';

const variable = n => {const bytes=[n&127];while(n>>=7)bytes.unshift((n&127)|128);return bytes;};
const chunk = (name,data) => [...Buffer.from(name),...[(data.length>>>24)&255,(data.length>>>16)&255,(data.length>>>8)&255,data.length&255],...data];
const midi = rows => Uint8Array.from([...chunk('MThd',[0,0,0,1,1,224]),...chunk('MTrk',rows.flatMap(([delta,...event])=>[...variable(delta),...event]))]);
const bytes=midi([
 [0,0xff,0x51,3,7,0xa1,0x20], [0,0xc0,71], [0,0x90,60,100], [0,64,80],
 [120,0xb0,64,127], [120,0x80,60,0], [0,64,0],
 [0,0xe0,0,96], [0,0xb0,11,64], [240,0xb0,64,0],
 [0,0xff,0x51,3,15,0x42,0x40], [0,0x90,67,127], [480,0x80,67,0], [0,0xff,0x2f,0],
]);
const source=importMidi(bytes), notes=source.parts[0].notes;
assert.deepEqual(notes.map(n=>[n.pitch,n.tick,n.endTick,n.velocity,n.program]),[[60,0,480,100,71],[64,0,480,80,71],[67,480,960,127,71]]);
assert.equal(notes[0].expression.at(-1).pitch,1);
assert.equal(notes[0].expression.at(-1).gain,64/127);
assert.equal(performanceClock(source)(960),1.5);
assert.deepEqual(importMidi(bytes),source,'reimport is deterministic');
const original=JSON.stringify(source);
for(const chip of [nesChip,gbChip,mdChip,snesChip]){
 const a=planPerformance(source,chip),b=planPerformance(source,chip);
 assert.deepEqual(a,b);assert.equal(a.notes.length,3);assert.deepEqual(a.notes.map(n=>[n.at,n.until]),[[0,.5],[0,.5],[.5,1.5]]);
 const rendered=renderPerformance(a,chip,{sampleRate:8000});assert.ok(rendered.peak>0);assert.ok(rendered.left.every(Number.isFinite));
}
assert.equal(JSON.stringify(source),original,'planning never edits the source');
const crowded=structuredClone(source);crowded.parts[0].notes=Array.from({length:9},(_,i)=>({...notes[0],id:`n${i}`,pitch:60+i}));
assert.throws(()=>planPerformance(crowded,nesChip),/allowLoss/);
const plan=planPerformance(crowded,nesChip,{allowLoss:true});assert.equal(plan.notes.length,3);assert.equal(plan.losses.filter(l=>l.kind==='voice-omitted').length,6);
const solo=planPerformance(crowded,nesChip,{allowLoss:true,parts:[]});assert.deepEqual(solo.notes,plan.notes,'solo does not reallocate voices');assert.deepEqual(solo.losses.filter(l=>l.kind==='voice-omitted'),plan.losses.filter(l=>l.kind==='voice-omitted'));
assert.equal(planPerformance(source,nesChip,{tempoScale:2}).seconds,.75);
assert.deepEqual(planPerformance(source,nesChip,{transpose:12}).notes.map(n=>n.pitch),[72,76,79]);
for(const mutate of [s=>s.tempos[0].tick=1,s=>s.parts[0].notes[0].endTick=0,s=>s.parts[0].notes[0].pitch=NaN,s=>s.parts[0].notes[0].expression[0].gain=2,s=>s.parts[0].notes.push(s.parts[0].notes[0]),s=>s.endTick=Infinity]){const s=structuredClone(source);mutate(s);assert.throws(()=>validatePerformance(s));}
assert.throws(()=>importMidi(bytes.subarray(0,-1)),/Truncated/);
assert.throws(()=>importMidi(midi([[0,0x90,60,100],[480,0xff,0x2f,0]])),/Unterminated/);
assert.throws(()=>importMidi(midi([[0,0x80,60,0],[0,0xff,0x2f,0]])),/Unmatched/);
console.log('PASS multivoice MIDI, running status, sustain, expression, bends, tempo map, deterministic allocation, explicit losses, solo invariance and malformed sources');

const eight=structuredClone(crowded);eight.parts[0].notes=eight.parts[0].notes.slice(0,8);
assert.equal(planPerformance(eight,snesChip).notes.length,8,'SNES has eight general-purpose sample voices');
const dsp=new RegisterTransactions('snes');
dsp.add([{at:3000,addr:0xf2,value:0x14},{at:3005,addr:0xf3,value:3}]);
dsp.add([{at:3000,addr:0xf2,value:4},{at:3005,addr:0xf3,value:12}]);
const commands=dsp.finish();assert.deepEqual(commands.events.map(e=>[e.at,e.addr,e.value]),[[3000,0xf2,0x14],[3005,0xf3,3],[3010,0xf2,4],[3015,0xf3,12]]);
const fm=new RegisterTransactions('md');
fm.add([{at:0,addr:0xa04000,value:0xa4},{at:42,addr:0xa04001,value:0x19},{at:1344,addr:0xa04000,value:0xa0},{at:1386,addr:0xa04001,value:0x80}]);
fm.add([{at:10,addr:0xa04002,value:0xa4},{at:52,addr:0xa04003,value:0x2a},{at:1354,addr:0xa04002,value:0xa0},{at:1396,addr:0xa04003,value:0x40}]);
assert.deepEqual(fm.finish().events.map(e=>e.value),[0xa4,0x19,0xa0,0x80,0xa4,0x2a,0xa0,0x40],'both banks share the FM high-frequency latch');
const expanded=[];for(let i=0;i<1000;i++)expanded.push([0,0x90,i%128,90]);for(let i=0;i<220;i++)expanded.push([1,0xb0,11,i%127]);expanded.push([1,0xb0,120,0],[0,0xff,0x2f,0]);
assert.throws(()=>importMidi(midi(expanded)),/200,000 points/,'small MIDI cannot expand to unbounded expression objects');
console.log('PASS atomic DSP pairs, shared FM FNUM latch, eight SNES pitched voices and bounded controller expansion');

for(const name of [Buffer.from('Éclaté','utf8'),Buffer.from([0xc9,0x63,0x6c,0x61,0x74,0xe9])]){
 const named=importMidi(midi([[0,0xff,3,name.length,...name],[0,0x90,60,100],[480,0x80,60,0],[0,0xff,0x2f,0]]));
 assert.equal(named.parts[0].name,'Éclaté','UTF-8 and legacy MIDI labels preserve accents');
 assert.equal(named.notices.some(n=>n.includes('Windows-1252')),name[0]===0xc9);
}
const updates=[],progressPlan=planPerformance(source,nesChip);
const monitored=renderPerformance(progressPlan,nesChip,{sampleRate:8000,onProgress:p=>updates.push(p)}),plain=renderPerformance(progressPlan,nesChip,{sampleRate:8000});
assert.equal(updates[0],0);assert.equal(updates.at(-1),1);assert.ok(updates.some(p=>p>0&&p<1));assert.ok(updates.every((p,i)=>!i||p>updates[i-1]));
assert.deepEqual(monitored.left,plain.left,'reporting actual rendered frames does not change PCM');
console.log('PASS legacy MIDI labels and monotonic sample-based render progress without audio changes');
