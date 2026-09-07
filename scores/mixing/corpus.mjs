import {readFile} from 'node:fs/promises';
export const contract=JSON.parse(await readFile(new URL('contract.json',import.meta.url)));
/** Authored generator families; the runtime mix module never imports this file. */
export function generatedPerformance(seed,style='lead'){
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
 const scale=[0,2,3,5,7,8,10],root=48+Math.floor(random()*6),notes=[];
 for(let step=0;step<8;step++)notes.push({id:`n${step}`,tick:step*96,endTick:step*96+72,pitch:root+12+scale[Math.floor(random()*scale.length)],velocity:70+Math.floor(random()*45),program:80});
 const part=(id,role,priority,rows,importance)=>({id,name:id,role,priority,notes:rows,...(importance===undefined?{}:{mix:{importance}})});
 const parts=[part('melody','lead',100,notes,style==='bass'?.45:1)];
 if(style!=='solo'){
  parts.push(part('bass','bass',90,notes.filter((_,i)=>i%2===0).map((n,i)=>({...n,id:`b${i}`,pitch:root-12,endTick:n.tick+140,velocity:90,program:32})),style==='bass'?1:undefined));
  parts.push(part('harmony','chord',60,[0,384].flatMap(t=>[0,3,7].map((offset,i)=>({id:`c${t}-${i}`,tick:t,endTick:t+288,pitch:root+offset,velocity:70,program:40})))));
  parts.push(part('drums','perc',70,notes.filter((_,i)=>i%2===0).map((n,i)=>({...n,id:`d${i}`,pitch:36,drum:i%2?38:36,endTick:n.tick+36,velocity:85})),style==='drums'?1:undefined));
 }
 return {version:1,title:`Generated ${seed} ${style}`,ticksPerBeat:192,endTick:768,tempos:[{tick:0,microsecondsPerBeat:500000}],parts,notices:[]};
}
