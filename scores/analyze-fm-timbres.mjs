import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {planPerformance,renderPerformance,mdChip} from '../packages/chipvoice/dist/index.js';
import {mixInstrumentSignature} from '../packages/chipvoice/dist/mix-calibration.js';

// Explicit, bounded build/preparation work. No sound is rendered inside the
// runtime planner. No song title, channel number or patch ID enters analysis.
const rate=44100,start=.05,duration=.8;
function probe(instrument,pitch){
 const score={version:1,title:'FM source probe',ticksPerBeat:1000,endTick:900,tempos:[{tick:0,microsecondsPerBeat:1000000}],notices:[],parts:[{id:'probe',name:'probe',role:'lead',priority:100,instruments:{md:{...instrument,volume:[15],sustain:true}},notes:[{id:'n',tick:50,endTick:850,pitch,velocity:127}]}]};
 return renderPerformance(planPerformance(score,mdChip,{mix:false}),mdChip,{gain:1}).left;
}
function fundamental(data,base){
 const from=Math.round(.10*rate),until=Math.round(.40*rate),rows=[];
 for(let half=1;half<=32;half++){
  const ratio=half/2,period=rate/(base*ratio);let best=-1;
  for(let lag=Math.max(1,Math.round(period*.98));lag<=Math.round(period*1.02);lag++){
   let xy=0,xx=0,yy=0;
   for(let i=from;i<until;i++){const x=data[i],y=data[i+lag];xy+=x*y;xx+=x*x;yy+=y*y;}
   best=Math.max(best,xx&&yy?xy/Math.sqrt(xx*yy):0);
  }
  rows.push({ratio,correlation:best});
 }
 const best=Math.max(...rows.map(r=>r.correlation));
 // The shortest equally good period avoids reporting an arbitrary subharmonic
 // of a sine wave. This is a harmonic-patch detector, not universal FM pitch.
 return {...rows.filter(r=>r.correlation>=best-.025).at(-1),confidence:best};
}
export function analyzeFmTimbre(instrument){
 if(!instrument.fm)throw Error('Expected an FM source instrument');
 const data=probe(instrument,57),check=probe(instrument,69),a=fundamental(data,220),b=fundamental(check,440);
 const confidence=Math.max(0,Math.min(1,a.confidence,b.confidence));
 const stable=a.ratio===b.ratio&&confidence>=.9;
 const envelope=[];
 for(let frame=0;frame<duration*60;frame++){
  const from=Math.round((start+frame/60)*rate),to=Math.round((start+(frame+1)/60)*rate);let square=0;
  for(let i=from;i<to;i++)square+=data[i]*data[i];envelope.push(Math.sqrt(square/(to-from)));
 }
 const rms=Math.max(...envelope);
 // A nearly sinusoidal patch needs a soft pitched family. Richer harmonic
 // patches use the bright family. This labels an approximation, not GM truth.
 let xy=0,xx=0,yy=0;const lag=Math.round(rate/(220*a.ratio)/2);
 for(let i=Math.round(.12*rate);i<Math.round(.32*rate);i++){xy+=data[i]*data[i+lag];xx+=data[i]**2;yy+=data[i+lag]**2;}
 const halfCorrelation=xx&&yy?xy/Math.sqrt(xx*yy):0;
 return {sourceSignature:mixInstrumentSignature(instrument),pitchOffset:stable?12*Math.log2(a.ratio):0,program:halfCorrelation<-.9?73:61,envelope:envelope.map(v=>rms?v/rms:0),rms,confidence:stable?confidence:0};
}
export function prepareFmTimbres(score){
 const result=structuredClone(score),cache=new Map();
 for(const part of result.parts){
  if(part.origin?.chip!=='md')continue;
  for(const [key,instrument]of Object.entries(part.instruments??{})){
   if(!key.startsWith('md:')||!instrument.fm)continue;
   const signature=mixInstrumentSignature(instrument);
   if(!cache.has(signature)){
    if(cache.size>=128)throw Error('FM preparation exceeds 128 patches');
    cache.set(signature,analyzeFmTimbre(instrument));
   }
   (part.portableTimbres??={})[key]=cache.get(signature);
  }
 }
 return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scores/analyze-fm-timbres.mjs input.json output.json');
 const result=prepareFmTimbres(JSON.parse(await readFile(input,'utf8')));
 await writeFile(output,JSON.stringify(result)+'\n');
 console.log('Prepared measured FM timbres',result.parts.map(p=>({part:p.id,timbres:Object.entries(p.portableTimbres??{}).map(([id,t])=>({id,pitchOffset:t.pitchOffset,confidence:t.confidence,rms:t.rms,program:t.program}))})));
}
