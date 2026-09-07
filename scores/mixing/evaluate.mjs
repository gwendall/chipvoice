import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance as timer} from 'node:perf_hooks';
import {planPerformance,renderPerformance,importMidi,toWav,nesChip,gbChip,mdChip,snesChip,c64Chip} from '../../packages/chipvoice/dist/index.js';
import {measureAudio,spectrum,comparePcm} from '../../packages/conform/src/listening/metrics.mjs';
import {observeSnesMixer} from '../../packages/conform/src/listening/snes-mixer.mjs';
import {candidateIdentity} from './freeze.mjs';
import {contract,generatedPerformance} from './corpus.mjs';
const held=process.argv.includes('--held-out'), midiPath=process.argv.includes('--midi')?process.argv[process.argv.indexOf('--midi')+1]:null;
if(held&&midiPath)throw Error('MIDI development input cannot replace the frozen holdout');
const out=`.artifacts/automatic-mixing/${held?'held-out':midiPath?'development-midi':'development'}`;await mkdir(out,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
const identity=await candidateIdentity(), engineSha256=identity.engineSha256;
const policySha256=hash(await readFile('packages/chipvoice/dist/mix.js'));
const profileSha256=hash(await readFile('packages/chipvoice/dist/mix-profiles.js'));
if(held){const frozen=JSON.parse(await readFile('.artifacts/automatic-mixing/frozen-candidate.json'));assert.equal(identity.inputsSha256,frozen.inputsSha256);assert.equal(engineSha256,frozen.engineSha256);assert.equal(policySha256,frozen.policySha256);assert.equal(profileSha256,frozen.profileSha256);}
const cases=[];
for(const seed of (held?contract.heldOut:contract.development).generatedSeeds)for(const style of ['lead','bass','drums','solo'])cases.push(generatedPerformance(seed,style));
// Full catalogue renders have their own evaluation. Short windows here make
// joint/solo and baseline comparisons practical while retaining complete plans.
for(const id of held?['mario']:['zelda','sonic']){const score=JSON.parse(await readFile(`scores/arrangements/${id}.json`));cases.push(score);}
if(midiPath){const bytes=await readFile(midiPath),score=importMidi(bytes,{title:'Local MIDI development fixture'});score.source.sha256=hash(bytes);cases.splice(0,cases.length,score);}
const report={engineSha256,policySha256,profileSha256,heldOut:held,contract,scope:'Deterministic correctness and descriptive acoustics; no universal musical score or human preference claim',cases:[]};
for(const [caseIndex,score] of cases.entries())for(const chip of [nesChip,gbChip,mdChip,snesChip,c64Chip]){
 const measurements=[];
 for(const mode of ['legacy','automatic']){
  const before=timer.now(),plan=planPerformance(score,chip,{allowLoss:true,mix:mode==='legacy'?false:{}}),planningMs=timer.now()-before;
  const sourceNotes=new Set(score.parts.flatMap(p=>p.notes.map(n=>`${p.id}:${n.id}`)));
  const allocated=new Set(plan.notes.map(n=>`${n.part}:${n.id}`)),omitted=new Set(plan.losses.filter(l=>l.kind==='voice-omitted').map(n=>`${n.part}:${n.note}`));
  assert.equal(allocated.size,plan.notes.length);assert.equal(allocated.size+omitted.size,sourceNotes.size);
  for(const id of allocated)assert.ok(sourceNotes.has(id),'no invented notes');
  const window={...plan,seconds:Math.min(plan.seconds,6)};
  const start=timer.now(),audio=renderPerformance(window,chip),renderMs=timer.now()-start,metrics=measureAudio(audio);
  assert.equal(metrics.invalidSamples,0);assert.equal(metrics.clippedSamples,0);
  if(mode==='automatic')assert.ok(comparePcm(audio,renderPerformance(window,chip),0).ok,'repeatable PCM');
  let internal;
  if(chip===snesChip&&mode==='automatic'){const core=chip.digital();for(const block of plan.memory)core.load(block.address,block.bytes);core.schedule(plan.events);internal=observeSnesMixer(core);core.trace(Math.round(window.seconds*chip.spec.clockHz),()=>{});assert.equal(internal.mainClampedAdditions,0);assert.equal(internal.echoClampedAdditions,0);}
  const row={mode,planningMs,renderMs,events:plan.events.length,notes:plan.notes.length,omitted:omitted.size,mix:plan.mix,metrics,spectrum:spectrum(audio),internal};measurements.push(row);
  if(caseIndex===0||score.source)await writeFile(`${out}/${caseIndex}-${chip.spec.id}-${mode}.wav`,toWav(audio));
 }
 report.cases.push({title:score.title,sourceSha256:hash(JSON.stringify(score)),chip:chip.spec.id,measurements});
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
 console.log('PASS',caseIndex,chip.spec.id,measurements[1].metrics.rmsDbFS?.toFixed(1),measurements[1].mix?.fallbackNotes);
}
console.log('PASS',report.cases.length,'evaluated score/console pairs');
