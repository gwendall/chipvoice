import {nesChip, validatePerformance} from '../packages/chipvoice/dist/index.js';

/** Extracts hardware note attacks and samples effective timer/envelope state at
 * 240 Hz for PORTING. The untouched command stream remains the native truth.
 * This observer is tied to the NES digital core and is not an independent oracle. */
export function nsfPerformance(capture, {title, endFrame, loopFrame, source}) {
  const endTick = capture.calls[endFrame].at, loopStartTick = capture.calls[loopFrame].at;
  const rows = [
    {id:'p2',name:'Melody · pulse 2',role:'lead',priority:100,reg:0x4007},
    {id:'p1',name:'Harmony · pulse 1',role:'chord',priority:90,reg:0x4003},
    {id:'tri',name:'Bass · triangle',role:'bass',priority:80,reg:0x400b},
    {id:'noi',name:'Percussion · noise',role:'perc',priority:70,reg:0x400f},
  ];
  const core = nesChip.digital();
  core.schedule(capture.events.filter(e=>e.at<endTick));
  const events = capture.events.filter(e=>e.at<endTick);
  let index=0, noisePeriod=0;
  const parts = rows.map(row=>({...row,notes:[],instruments:{'2a03':{volume:[15],sustain:true}}}));
  const active = new Map();
  // Explicit attacks, plus a fixed observer grid; no notation quantization.
  const sampleTicks = new Set([endTick]);
  for(let at=0;at<endTick;at+=capture.clockHz/240)sampleTicks.add(Math.round(at));
  for(const event of events)if(rows.some(row=>row.reg===event.addr))sampleTicks.add(event.at+1);
  const units = [core.pulse2,core.pulse1,core.triangle,core.noise];
  for(const tick of [...sampleTicks].sort((a,b)=>a-b)) {
    while(core.cycle<tick)core.step();
    while(index<events.length&&events[index].at<tick){
      const event=events[index++];
      if(event.addr===0x400e)noisePeriod=event.value&15;
      const pi=rows.findIndex(row=>row.reg===event.addr);
      if(pi<0)continue;
      const part=parts[pi],previous=active.get(part.id);
      if(previous)previous.endTick=event.at;
      const unit=units[pi],freq=capture.clockHz/((pi===2?32:16)*(unit.period+1));
      const pitch=pi===3?42:69+12*Math.log2(freq/440);
      const note={id:`${part.id}-${part.notes.length}`,tick:event.at,endTick,pitch,velocity:127,...(pi===3?{drum:42}:{}),expression:[]};
      part.notes.push(note);active.set(part.id,note);
    }
    for(let i=0;i<parts.length;i++){
      const part=parts[i],note=active.get(part.id),unit=units[i];
      if(!note||tick>=endTick)continue;
      const enabled=unit.enabled&&unit.lengthCounter>0;
      const gain=i===2?(enabled&&unit.linearCounter>0&&unit.period>=2?1:0):(enabled&&(i===3||unit.period>=8)?unit.env.output()/15:0);
      const freq=capture.clockHz/((i===2?32:16)*(unit.period+1));
      const pitch=i===3?0:69+12*Math.log2(freq/440)-note.pitch;
      const point={tick:Math.max(note.tick,tick),gain,pitch,...(i<2?{duty:unit.duty}:{}),...(i===3?{noisePeriod}:{})};
      const previous=note.expression.at(-1);
      if(!previous||['gain','pitch','duty','noisePeriod'].some(key=>previous[key]!==point[key]))note.expression.push(point);
    }
  }
  for(const part of parts){
    delete part.reg;
    part.notes=part.notes.filter(note=>note.expression.some(p=>p.gain>0)&&note.pitch>=0&&note.pitch<=127);
    for(const note of part.notes){
      note.expression=note.expression.filter(p=>p.tick<note.endTick);
      // A hardware trigger precedes the first envelope clock. Starting a GB
      // noise envelope at zero would keep the entire translated hit silent.
      const first=note.expression.findIndex(p=>p.gain>0);
      note.expression=note.expression.slice(first);note.tick=note.expression[0].tick;
      let last=note.expression.length-1;
      while(last>0&&note.expression[last].gain===0)last--;
      if(last<note.expression.length-1)note.endTick=note.expression[last+1].tick;
      note.expression=note.expression.filter(p=>p.tick<note.endTick);
    }
  }
  const score={version:1,title,ticksPerBeat:capture.clockHz,endTick,loopStartTick,tempos:[{tick:0,microsecondsPerBeat:1000000}],parts,source,notices:['Native commands reproduce the source driver. Portable expression is observed at 240 Hz, not cycle-exact.','Target timbres are adaptations; only the unmodified native command stream retains the game settings.']};
  validatePerformance(score);
  return {score,native:{chip:'2a03',seconds:endTick/capture.clockHz,loopStartSeconds:loopStartTick/capture.clockHz,events:events,memory:[],notes:[],losses:[]}};
}
