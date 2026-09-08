import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
const base=process.env.SITE??'http://127.0.0.1:3070';
const built=await build({entryPoints:['src/audio/BufferPlayback.mjs'],absWorkingDir:new URL('.',import.meta.url).pathname,bundle:true,format:'iife',globalName:'PlaybackTest',write:false});
const wav=Buffer.alloc(44+48000*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<48000;i++)wav.writeInt16LE(Math.round(Math.sin(i/48000*440*2*Math.PI)*12000),44+i*2);
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.goto(base+'/lab');await page.getByRole('button',{name:'Play',exact:true}).click();await page.getByRole('button',{name:'Pause',exact:true}).click();
 await page.route('**/probe-*.wav',async route=>{if(route.request().url().includes('slow'))await new Promise(resolve=>setTimeout(resolve,300));if(route.request().url().includes('fail'))return route.fulfill({status:500});return route.fulfill({contentType:'audio/wav',body:wav});});
 await page.addScriptTag({content:built.outputFiles[0].text});
 const result=await page.evaluate(async()=>{
  // Decode the 48 kHz fixture at 44.1 kHz on every platform. Resampling can
  // change its length by a frame; seek positions are fractions, not seconds.
  const ctx=new AudioContext({sampleRate:44100});await ctx.resume();const transport=new PlaybackTest.BufferPlayback(ctx);
  let count=0,max=0;const create=ctx.createBufferSource.bind(ctx);ctx.createBufferSource=()=>{const source=create();count++;max=Math.max(max,count);source.addEventListener('ended',()=>count--);return source;};
  const analyser=ctx.createAnalyser();transport.output.connect(analyser);const samples=new Float32Array(analyser.fftSize);
  const level=()=>{analyser.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((s,x)=>s+x*x,0)/samples.length);};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const entry=name=>[{file:'/probe-'+name+'.wav'},{file:'/probe-'+name+'-b.wav'}];
  const until=async (predicate,label)=>{
   const deadline=performance.now()+10000;
   while(!predicate()&&performance.now()<deadline)await wait(10);
   if(!predicate())throw new Error(`Timed out: ${label}; audio=${ctx.currentTime}, playing=${transport.playing}, retiring=${!!transport.retiring}, offset=${transport.group?.offset}, duration=${transport.group?.duration}`);
  };
  const reachAudioTime=at=>until(()=>ctx.currentTime>=at,`audio clock reaches ${at}`);
  await transport.select(entry('first'),[.5,.5]);await transport.toggle();await until(()=>level()>.05,'first audible buffer');
  const initial=level(),pending=transport.select(entry('slow'),[.5,.5]);await wait(120);const duringLoad=level();await pending;await wait(130);
  const failed=await transport.select(entry('fail'),[.5,.5]);const afterFailure=level(),keptPlaying=transport.playing;
  await Promise.all(['first','slow','first'].map(name=>transport.select(entry(name),[.5,.5])));await wait(130);
  const lastWins=transport.entries[0].file==='/probe-first.wav';
  const pendingCancelled=transport.select(entry('slow-cancelled'),[.5,.5]);await wait(30);transport.cancelSelection();
  const cancelled=await pendingCancelled;await wait(350);
  const cancellationKeptCurrent=transport.entries[0].file==='/probe-first.wav'&&level()>.05&&transport.playing;
  const pendingStop=transport.select(entry('slow-new'),[.5,.5]);transport.pause();await pendingStop;await wait(100);const silent=level();
  const stopped=!transport.playing;
  transport.seek(.6);const pausedSeek=transport.phase();await transport.toggle();await wait(300);
  const resumed=transport.phase(),resumeOffset=transport.group.offset/transport.group.duration;transport.pause();const frozen=transport.phase();await wait(100);const stillFrozen=transport.phase();
  transport.setLoop(false);transport.seek(.94);await transport.toggle();await until(()=>!transport.playing,'nonlooping playback ends');
  const ended=!transport.playing&&transport.phase()===1;
  await transport.toggle();await until(()=>!!transport.group,'replay starts');const replayed=transport.playing&&transport.group.offset===0;
  transport.setLoop(true);
  for(let i=0;i<30;i++)transport.seek(i/40);
  transport.seek(.4);await until(()=>!transport.retiring&&transport.group?.offset/transport.group?.duration===.4,'last seek is applied');const lastSeek=transport.phase(),lastSeekOffset=transport.group.offset/transport.group.duration;
  for(let i=0;i<10;i++){transport.pause();void transport.toggle();}
  await wait(200);transport.pause();await until(()=>!transport.retiring,'paused sources retire');
  transport.restart();await transport.toggle();await until(()=>!!transport.group,'loop starts');await reachAudioTime(transport.group.at+1.35);
  const beforeLoopOff=transport.phase(ctx.currentTime);transport.setLoop(false);
  const afterLoopOff=transport.phase(ctx.currentTime);
  const traversalPreserved=Math.abs(beforeLoopOff-afterLoopOff)<.02&&afterLoopOff<1;
  transport.pause();await until(()=>!transport.retiring,'paused sources retire');
  const timestamp=ctx.getOutputTimestamp.bind(ctx);
  ctx.getOutputTimestamp=()=>({contextTime:Math.max(0,ctx.currentTime-.6),performanceTime:performance.now()});
  transport.seek(.9);await transport.toggle();
  await until(()=>!!transport.group?.ended,'source ends before delayed output');
  const endedBeforeAudible=!!transport.group?.ended&&transport.phase()<1;
  transport.pause();transport.setLoop(true);await transport.toggle();await until(()=>!!transport.group&&!transport.retiring,'pause resumes');
  const endPauseResumed=transport.playing&&!!transport.group&&!transport.retiring;
  ctx.getOutputTimestamp=timestamp;
  await transport.select(entry('first'),[.5,.5],{restart:true,presentation:'first score'});
  await reachAudioTime(transport.group.at);
  let deviceTime=transport.group.at;
  ctx.getOutputTimestamp=()=>({contextTime:deviceTime,performanceTime:performance.now()});
  await transport.select(entry('second'),[.5,.5],{restart:true,presentation:'second score'});
  const oldScoreUntilAudible=transport.audibleSelection()==='first score';
  transport.cancelSelection();
  // Advance the device timestamp across the scheduled transition, regardless
  // of how slowly a loaded host advances its actual AudioContext clock.
  await reachAudioTime(transport.group.at+.001);deviceTime=transport.group.at+.001;
  const newScoreWhenAudible=transport.audibleSelection()==='second score';
  ctx.getOutputTimestamp=timestamp;
  // Chromium can omit `ended` when a replacement starts exactly at buffer end.
  // The transport must finish on the output clock even without that event.
  transport.pause();await until(()=>!transport.retiring,'paused sources retire');transport.setLoop(false);transport.seek(0);
  await transport.toggle();await until(()=>!!transport.group&&!transport.retiring,'restarted source settles');transport.seek(1);
  transport.group.parts[0].source.onended=null;
  await until(()=>!transport.playing,'exact end without source event');const exactEndWithoutEvent=!transport.playing&&transport.phase()===1;
  // Pause must not wait for the missing event while the final audio is delayed.
  ctx.getOutputTimestamp=()=>({contextTime:Math.max(0,ctx.currentTime-.6),performanceTime:performance.now()});
  transport.seek(0);await transport.toggle();await until(()=>!!transport.group&&!transport.retiring,'zero seek settles');
  transport.seek(1);transport.group.parts[0].source.onended=null;await wait(150);
  transport.pause();await transport.toggle();await until(()=>!!transport.group&&!transport.retiring,'empty-end pause resumes');
  const emptyEndPauseResumed=transport.playing&&!!transport.group&&!transport.retiring;
  transport.pause();await until(()=>!transport.retiring,'paused sources retire');
  // Latest seek still wins if an exact-end group retires before its crossfade.
  ctx.getOutputTimestamp=()=>({contextTime:ctx.currentTime,performanceTime:performance.now()});
  transport.seek(0);await transport.toggle();await until(()=>!!transport.group&&!transport.retiring,'zero seek settles');
  transport.seek(1);transport.seek(0);await until(()=>!!transport.group&&!transport.retiring&&transport.group.offset===0,'restart past end wins');
  const restartPastEndWins=transport.playing&&transport.group?.offset===0;
  transport.dispose();await ctx.close();return {initial,duringLoad,failed,afterFailure,keptPlaying,lastWins,silent,stopped,maxSources:max,cancelled,cancellationKeptCurrent,pausedSeek,resumed,resumeOffset,lastSeekOffset,frozen,stillFrozen,ended,replayed,lastSeek,traversalPreserved,endedBeforeAudible,endPauseResumed,oldScoreUntilAudible,newScoreWhenAudible,exactEndWithoutEvent,restartPastEndWins,emptyEndPauseResumed};
 });
 assert.ok(result.initial>.05&&result.duringLoad>.05&&result.afterFailure>.05,JSON.stringify(result));
 assert.equal(result.failed,false);assert.equal(result.cancelled,false);assert.ok(result.cancellationKeptCurrent);assert.ok(result.keptPlaying&&result.lastWins&&result.stopped);assert.ok(result.silent<.0001);assert.ok(result.maxSources<=4,'Only two synchronized pairs may overlap');
 assert.ok(result.emptyEndPauseResumed,'Pause before the output deadline releases a source that started at its end');
 assert.ok(result.restartPastEndWins,'Restart queued after an exact-end seek must keep playing');
 assert.ok(result.exactEndWithoutEvent,'An exact-end seek finishes even when the source emits no ended event');
 assert.ok(result.oldScoreUntilAudible&&result.newScoreWhenAudible,JSON.stringify(result));
 assert.ok(result.traversalPreserved&&result.endedBeforeAudible&&result.endPauseResumed,JSON.stringify(result));
 assert.equal(result.pausedSeek,.6);assert.equal(result.resumeOffset,.6);assert.equal(result.frozen,result.stillFrozen);assert.ok(result.ended&&result.replayed);assert.equal(result.lastSeekOffset,.4,'The last requested seek wins, independently of output latency');
 console.log('PASS decoded player keeps audible output through delayed/failed loads, latest selection wins, stop wins, bounded overlap',result);
}finally{await browser.close();}
