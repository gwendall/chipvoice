import {scoreOverview} from './score-overview.mjs';
import {performanceClock,importMidi,importVgm,isolateNativePerformance,planPerformance,renderPerformance,toWav,nesChip,gbChip,mdChip,snesChip,type Performance,type PerformancePlan} from 'chipvoice';
const chips={'2a03':nesChip,dmg:gbChip,md:mdChip,snes:snesChip};
onmessage=async ({data}:{data:{id:number;importOnly?:boolean;score?:Performance;midi?:ArrayBuffer;title?:string;native?:PerformancePlan;nativeVgm?:ArrayBuffer;chip:keyof typeof chips;tempo:number;transpose:number;part:string}})=>{
 try{
  const score=data.midi?importMidi(new Uint8Array(data.midi),{title:data.title}):data.score!;
  if(data.importOnly){postMessage({id:data.id,score});return;}
  postMessage({id:data.id,type:'progress',phase:'planning'});
  let plan:PerformancePlan;
  const native=data.nativeVgm?importVgm(new Uint8Array(data.nativeVgm)):data.native;
  if(native&&data.chip===native.chip&&data.tempo===100&&data.transpose===0){
   plan=data.part==='mix'?native:isolateNativePerformance(native,[data.part]);
  }else plan=planPerformance(score,chips[data.chip],{allowLoss:true,tempoScale:data.tempo/100,transpose:data.transpose,...(data.part==='mix'?{}:{parts:[data.part]})});
  let reported=-1;
  const audio=renderPerformance(plan,chips[data.chip],{onProgress:fraction=>{const percent=Math.floor(fraction*100);if(percent!==reported){reported=percent;postMessage({id:data.id,type:'progress',phase:'rendering',percent,seconds:plan.seconds});}}});
  postMessage({id:data.id,type:'progress',phase:'encoding',seconds:plan.seconds});
  const wav=toWav(audio);
  postMessage({id:data.id,overview:scoreOverview(score,performanceClock(score),plan.losses),score:data.midi?score:undefined,wav:wav.buffer,seconds:plan.seconds,loopStartSeconds:plan.loopStartSeconds,losses:plan.losses,notes:plan.notes.length,peak:audio.peak}, {transfer:[wav.buffer]});
 }catch(error){postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}
};
