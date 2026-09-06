import {importMidi,planPerformance,renderPerformance,toWav,nesChip,gbChip,mdChip,snesChip,type Performance,type PerformancePlan} from 'chipvoice';
const chips={'2a03':nesChip,dmg:gbChip,md:mdChip,snes:snesChip};
onmessage=async ({data}:{data:{id:number;importOnly?:boolean;score?:Performance;midi?:ArrayBuffer;title?:string;native?:PerformancePlan;chip:keyof typeof chips;tempo:number;transpose:number;part:string}})=>{
 try{
  const score=data.midi?importMidi(new Uint8Array(data.midi),{title:data.title}):data.score!;
  if(data.importOnly){postMessage({id:data.id,score});return;}
  let plan:PerformancePlan;
  if(data.native&&data.chip==='2a03'&&data.tempo===100&&data.transpose===0){
   plan=data.native;
   if(data.part!=='mix'){
    const base=({p1:0x4000,p2:0x4004,tri:0x4008,noi:0x400c} as Record<string,number>)[data.part];
    const bit=({p1:1,p2:2,tri:4,noi:8} as Record<string,number>)[data.part];
    if(base===undefined)throw new Error('Unknown native part');
    plan={...plan,events:plan.events.filter(e=>e.addr>=base&&e.addr<base+4||e.addr===0x4015||e.addr===0x4017).map(e=>e.addr===0x4015?{...e,value:e.value&bit}:e)};
   }
  }else plan=planPerformance(score,chips[data.chip],{allowLoss:true,tempoScale:data.tempo/100,transpose:data.transpose,...(data.part==='mix'?{}:{parts:[data.part]})});
  const audio=renderPerformance(plan,chips[data.chip]),wav=toWav(audio);
  postMessage({id:data.id,score:data.midi?score:undefined,wav:wav.buffer,seconds:plan.seconds,loopStartSeconds:plan.loopStartSeconds,losses:plan.losses,notes:plan.notes.length,peak:audio.peak}, {transfer:[wav.buffer]});
 }catch(error){postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}
};
