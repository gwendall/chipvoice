import assert from 'node:assert/strict';
import '../test-capture-nsf.mjs';
import {compareNativeTrace} from './compare-native.mjs';
import {readFile} from 'node:fs/promises';
import {comparePerformance,compareNativeArrangement,loadArrangement,checkArrangements} from './check.mjs';
const source={source:{sha256:'fixture'},ticksPerBeat:96,endTick:96,tempos:[{tick:0,microsecondsPerBeat:500000}],parts:['lead','chord','bass','perc'].map(id=>({id,notes:[{tick:0,endTick:24,pitch:60,velocity:100,program:0},{tick:24,endTick:48,pitch:62,velocity:90,program:1}]}))};
const reference={sourceSha256:'fixture',ticksPerBeat:96,endTick:96,tempos:source.tempos,notes:source.parts.flatMap(p=>p.notes.map(n=>({part:p.id,...n})))};
for(const mutation of [s=>s.parts[1].notes.pop(),s=>s.parts[2].notes[1].pitch++,s=>s.parts[3].notes[0].tick++,s=>s.parts[0].notes[0].velocity--,s=>s.parts[1].notes[0].program++,s=>s.endTick--,s=>s.tempos[0].microsecondsPerBeat++,s=>s.parts.push({...s.parts[0],id:'invented-bass'})]){const candidate=structuredClone(source);mutation(candidate);assert.throws(()=>comparePerformance(candidate,reference));}
console.log('PASS independent polyphonic ledgers reject missing/added parts, notes, pitches, durations, velocity, timbre programs and tempo changes');
const mario=await loadArrangement('mario'),native=JSON.parse(await readFile(new URL('./mario-native.json',import.meta.url))),nativeReference=JSON.parse(await readFile(new URL('./references/mario.json',import.meta.url)));
for(const mutate of [s=>s.parts.pop(),s=>s.parts[0].notes[0].pitch++,s=>s.parts=[]]){const score=structuredClone(mario);mutate(score);assert.throws(()=>compareNativeArrangement(score,native,nativeReference));}
const changed=structuredClone(native);changed.events[100].value^=1;assert.throws(()=>compareNativeArrangement(mario,changed,nativeReference));

console.log('PASS reviewed Mario extraction, independent native commands and real-arrangement register destination regressions');
console.log(JSON.stringify(await checkArrangements(),null,2));

const traceFixture={events:[{at:10,addr:0x4017,value:255},{at:20,addr:0x4000,value:127}]};
assert.equal(compareNativeTrace(traceFixture,'10 16407 255\n20 16384 127').musicCommands,2);
for(const trace of ['10 16407 255','10 16407 255\n21 16384 127','10 16407 255\n20 16384 126'])assert.throws(()=>compareNativeTrace(traceFixture,trace));
