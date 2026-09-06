import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {comparePerformance,loadArrangement,checkArrangements} from './check.mjs';
const source=await loadArrangement('zelda'),reference=JSON.parse(await readFile(new URL('./references/zelda.json',import.meta.url)));
for(const mutation of [s=>s.parts[1].notes.pop(),s=>s.parts[2].notes[1].pitch++,s=>s.parts[3].notes[0].tick++,s=>s.parts[0].notes[0].velocity--,s=>s.parts[1].notes[0].program++,s=>s.endTick--,s=>s.tempos[0].microsecondsPerBeat++,s=>s.parts.push({...s.parts[0],id:'invented-bass'})]){const candidate=structuredClone(source);mutation(candidate);assert.throws(()=>comparePerformance(candidate,reference));}
console.log('PASS independent polyphonic ledgers reject missing/added parts, notes, pitches, durations, velocity, timbre programs and tempo changes');
console.log(JSON.stringify(await checkArrangements(),null,2));
