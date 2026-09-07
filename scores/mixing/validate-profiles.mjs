import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {nesChip,gbChip,mdChip,snesChip,c64Chip,instrumentsFor,calibrateMixInstrument} from '../../packages/chipvoice/dist/index.js';
import {performanceInstrument} from '../../packages/chipvoice/dist/performance-palette.js';
import {mixProfileLevel,mixInstrumentSignature} from '../../packages/chipvoice/dist/mix-calibration.js';
import {MIX_FACTORY_PROFILES} from '../../packages/chipvoice/dist/mix-profiles.js';
const report=[];
for(const chip of [nesChip,gbChip,mdChip,snesChip,c64Chip]){
 const voice=chip.spec.roles.lead,inst=performanceInstrument(chip.spec.id,'lead',80);
 const base=MIX_FACTORY_PROFILES.find(p=>p.chip===chip.spec.id&&p.voice===voice&&p.signature===mixInstrumentSignature(inst));assert.ok(base);
 for(const rate of [44100,48000]){
  const measured=calibrateMixInstrument(chip,voice,inst,{sampleRate:rate,pitches:[54,78],durations:[.25],controls:[0,...[32,64,96,127].map(v=>15*v/127)]});
  const errors=[];
  for(let p=0;p<measured.positions.length;p++)for(let v=1;v<measured.controls.length;v++){
   const actual=measured.rms[p*measured.controls.length+v],predicted=mixProfileLevel(base,measured.positions[p],.25,false,measured.controls[v]);
   assert.ok(Number.isFinite(actual)&&actual>0);assert.ok(Number.isFinite(predicted)&&predicted>0);
   errors.push({pitch:measured.positions[p],control:measured.controls[v],actual,predicted,errorDb:20*Math.log10(actual/predicted)});
  }
  report.push({chip:chip.spec.id,voice,rate,scope:rate===44100?'Off-grid interpolation':'Rate sensitivity only; 44.1 kHz profiles are not certified at 48 kHz',errors});
 }
}
// Equivalent circuits have different scheduling offsets. Quantify, do not
// assume, the short-note error from sharing their steady response profiles.
for(const [chip,source,target] of [[nesChip,'p1','p2'],[mdChip,'fm1','fm6']]){
 const inst=performanceInstrument(chip.spec.id,'lead',80),options={pitches:[60],durations:[.125,.5]};
 const a=calibrateMixInstrument(chip,source,inst,options),b=calibrateMixInstrument(chip,target,inst,options);
 report.push({chip:chip.spec.id,aliases:[source,target],scope:'Voice onset offset sensitivity',errors:a.rms.map((r,i)=>r?20*Math.log10(b.rms[i]/r):0)});
}
await mkdir('.artifacts/automatic-mixing',{recursive:true});await writeFile('.artifacts/automatic-mixing/profile-validation.json',JSON.stringify(report,null,2));
console.log('PASS finite off-grid velocity/pitch/duration probes and rate/voice sensitivity; inspect descriptive errors separately');
