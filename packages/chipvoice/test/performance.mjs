import assert from 'node:assert/strict';
import {importMidi,planPerformance,renderPerformance,performanceClock,validatePerformance,nesChip,gbChip,mdChip,snesChip} from '../dist/index.js';

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
