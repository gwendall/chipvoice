/** Separate structural families, not another seed of the development loop.
 * Authored test music; no third-party transcriptions or runtime special cases. */
export function validationPerformances(){
 const note=(id,tick,length,pitch,program,velocity=90,expression)=>({id,tick,endTick:tick+length,pitch,program,velocity,...(expression?{expression}: {})});
 const part=(id,role,notes)=>({id,name:id,role,priority:{lead:100,chord:50,bass:80,perc:70}[role],notes});
 const score=(title,parts,tempos=[{tick:0,microsecondsPerBeat:500000}])=>({version:1,title,ticksPerBeat:96,endTick:1536,tempos,parts,notices:[]});
 return [
  score('Independent moving counterpoint',[
   part('upper','lead',[0,144,288,432,576,720,864,1008,1152,1296].map((t,i)=>note(`u${i}`,t,132,[72,74,76,79,77,76,74,71,72,67][i],73))),
   part('lower','chord',[0,192,384,576,768,960,1152,1344].map((t,i)=>note(`l${i}`,t,168,[55,59,57,60,53,57,55,48][i],42,72))),
  ]),
  score('Expression across long notes',[
   part('foreground','lead',[0,384,768,1152].map((t,i)=>note(`e${i}`,t,360,60+i*3,11,100,[{tick:t,gain:.2},{tick:t+96,gain:1,pitch:1},{tick:t+192,gain:0},{tick:t+288,gain:.7,pitch:0}]))),
   part('pedal','bass',[note('pedal',0,1440,36,38,60)]),
  ]),
  score('Program changes and tempo boundaries',[
   part('solo','lead',Array.from({length:12},(_,i)=>note(`s${i}`,i*128,112,60+[0,4,7,11][i%4],[0,8,16,24,40,56,64,72,80,88,96,104][i],45+i*6))),
  ],[{tick:0,microsecondsPerBeat:600000},{tick:512,microsecondsPerBeat:400000},{tick:1024,microsecondsPerBeat:750000}]),
  score('Sparse percussion with late harmony',[
   part('kit','perc',[0,192,480,768,1056,1440].map((t,i)=>({...note(`d${i}`,t,48,36,0,100),drum:[36,42,38,46,36,38][i]}))),
   part('harmony','chord',[960,1248].flatMap((t,i)=>[60,64,67].map(p=>note(`c${i}-${p}`,t,240,p+i*2,48,75)))),
  ]),
 ];
}
