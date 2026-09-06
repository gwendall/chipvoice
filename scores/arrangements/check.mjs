import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validatePerformance,planPerformance,nesChip,gbChip,mdChip,snesChip} from '../../packages/chipvoice/dist/index.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const arrangementChips=[nesChip,gbChip,mdChip,snesChip];
export const arrangementIds=['mario','zelda','sonic'];
export const loadArrangement=async id=>JSON.parse(await readFile(new URL(`./${id}.json`,import.meta.url),'utf8'));

export function comparePerformance(score,reference){
  const actual=score.parts.flatMap(part=>part.notes.map(n=>({part:part.id,tick:n.tick,endTick:n.endTick,pitch:n.pitch,velocity:n.velocity,program:n.program}))).sort((a,b)=>a.part.localeCompare(b.part)||a.tick-b.tick||a.pitch-b.pitch||a.endTick-b.endTick);
  const expected=reference.notes.slice().sort((a,b)=>a.part.localeCompare(b.part)||a.tick-b.tick||a.pitch-b.pitch||a.endTick-b.endTick);
  assert.equal(score.source.sha256,reference.sourceSha256,'source identity');
  assert.equal(score.ticksPerBeat,reference.ticksPerBeat,'time base');assert.equal(score.endTick,reference.endTick,'complete form');assert.deepEqual(score.tempos,reference.tempos,'tempo automation');assert.deepEqual(actual,expected,'all notes, parts, velocities and programs');
  return {notes:expected.length,parts:score.parts.length,exactTicks:true};
}
export function compareNativeArrangement(score,native,reference){
  assert.equal(score.source.sha256,reference.sourceSha256);
  assert.equal(hash(JSON.stringify(score)),reference.performanceSha256,'reviewed portable extraction snapshot (not an independent observer)');
  const first=native.events.findIndex(e=>e.addr===0x4017&&e.value===255),commands=native.events.slice(first);
  assert.equal(commands.length,reference.musicCommands);assert.equal(hash(JSON.stringify(commands)),reference.commandsSha256,'independent NSF command ledger');
  assert.equal(native.seconds,score.endTick/score.ticksPerBeat);assert.equal(native.loopStartSeconds,score.loopStartTick/score.ticksPerBeat);
  return {musicCommands:commands.length,exactCycles:true,oracle:reference.oracle};
}
// Decode register destinations independently of the bus serializer. The old
// byte sort corrupted these on real arrangements despite finite/quiet PCM.
const destinations=(events,chip)=>{
 const result=[];let latch=0;
 for(const e of events){
  if(chip==='snes'){if(e.addr===0xf2)latch=e.value;else if(e.addr===0xf3)result.push(`${latch}:${e.value}`);}
  else if(e.addr===0xa04000||e.addr===0xa04002)latch=e.value+(e.addr===0xa04002?256:0);
  else if(e.addr===0xa04001||e.addr===0xa04003)result.push(`${latch}:${e.value}`);
 }
 return result;
};
export function planWithRegisterAudit(score,chip){
 if(!['snes','md'].includes(chip.spec.id))return planPerformance(score,chip,{allowLoss:true});
 const intended=[];
 const wrapped={...chip,driver:()=>{const driver=chip.driver();return {memory:()=>driver.memory?.()??[],...Object.fromEntries(['powerOn','note','noteOff'].map(name=>[name,(...args)=>{const events=driver[name](...args);intended.push(...destinations(events,chip.spec.id));return events;}]))};}};
 const plan=planPerformance(score,wrapped,{allowLoss:true});
 assert.deepEqual(destinations(plan.events,chip.spec.id).sort(),intended.sort(),`${score.title}/${chip.spec.id}: every intended register destination and byte survives compilation`);
 return plan;
}
export async function checkArrangements(){
  const results=[];
  for(const id of arrangementIds){
    const score=await loadArrangement(id),reference=JSON.parse(await readFile(new URL(`./references/${id}.json`,import.meta.url),'utf8'));
    validatePerformance(score);
    let evidence;
    if(id==='mario'){
      const native=JSON.parse(await readFile(new URL('./mario-native.json',import.meta.url),'utf8'));
      evidence=compareNativeArrangement(score,native,reference);
    }else evidence=comparePerformance(score,reference);
    const ports={};
    for(const chip of arrangementChips){
      const plan=planWithRegisterAudit(score,chip);
      const total=score.parts.reduce((n,p)=>n+p.notes.length,0),missing=plan.losses.filter(l=>l.kind==='voice-omitted');
      assert.equal(plan.notes.length+missing.length,total,'every source note accounted for');
      const keys=plan.notes.map(n=>`${n.part}:${n.id}`);assert.equal(new Set(keys).size,keys.length,'no invented duplicates');
      for(const part of score.parts)for(const note of part.notes)assert.ok(plan.notes.some(n=>n.part===part.id&&n.id===note.id)||missing.some(n=>n.part===part.id&&n.note===note.id),'source identity retained');
      ports[chip.spec.id]={played:plan.notes.length,omitted:missing.length,registerDestinationsVerified:['snes','md'].includes(chip.spec.id)};
    }
    results.push({id,evidence,ports});
  }
  return results;
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkArrangements(),null,2));
