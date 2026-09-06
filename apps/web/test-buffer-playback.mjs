import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
const base=process.env.SITE??'http://127.0.0.1:3070';
const built=await build({entryPoints:['src/audio/BufferPlayback.mjs'],absWorkingDir:new URL('.',import.meta.url).pathname,bundle:true,format:'iife',globalName:'PlaybackTest',write:false});
const wav=Buffer.alloc(44+48000*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<48000;i++)wav.writeInt16LE(Math.round(Math.sin(i/48000*440*2*Math.PI)*12000),44+i*2);
const browser=await chromium.launch();
try{
 const page=await browser.newPage();await page.goto(base+'/lab');await page.getByRole('button',{name:'Play',exact:true}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();
 await page.route('**/probe-*.wav',async route=>{if(route.request().url().includes('slow'))await new Promise(resolve=>setTimeout(resolve,300));if(route.request().url().includes('fail'))return route.fulfill({status:500});return route.fulfill({contentType:'audio/wav',body:wav});});
 await page.addScriptTag({content:built.outputFiles[0].text});
 const result=await page.evaluate(async()=>{
  const ctx=new AudioContext();await ctx.resume();const transport=new PlaybackTest.BufferPlayback(ctx);
  let count=0,max=0;const create=ctx.createBufferSource.bind(ctx);ctx.createBufferSource=()=>{const source=create();count++;max=Math.max(max,count);source.addEventListener('ended',()=>count--);return source;};
  const analyser=ctx.createAnalyser();transport.output.connect(analyser);const samples=new Float32Array(analyser.fftSize);
  const level=()=>{analyser.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((s,x)=>s+x*x,0)/samples.length);};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const entry=name=>[{file:'/probe-'+name+'.wav'},{file:'/probe-'+name+'-b.wav'}];
  await transport.select(entry('first'),[.5,.5]);await transport.toggle();await wait(120);
  const initial=level(),pending=transport.select(entry('slow'),[.5,.5]);await wait(120);const duringLoad=level();await pending;await wait(130);
  const failed=await transport.select(entry('fail'),[.5,.5]);const afterFailure=level(),keptPlaying=transport.playing;
  await Promise.all(['first','slow','first'].map(name=>transport.select(entry(name),[.5,.5])));await wait(130);
  const lastWins=transport.entries[0].file==='/probe-first.wav';
  const pendingStop=transport.select(entry('slow-new'),[.5,.5]);transport.pause();await pendingStop;await wait(100);const silent=level();
  const stopped=!transport.playing;
  transport.dispose();await ctx.close();return {initial,duringLoad,failed,afterFailure,keptPlaying,lastWins,silent,stopped,maxSources:max};
 });
 assert.ok(result.initial>.05&&result.duringLoad>.05&&result.afterFailure>.05,JSON.stringify(result));
 assert.equal(result.failed,false);assert.ok(result.keptPlaying&&result.lastWins&&result.stopped);assert.ok(result.silent<.0001);assert.ok(result.maxSources<=4,'Only two synchronized pairs may overlap');console.log('PASS decoded player keeps audible output through delayed/failed loads, latest selection wins, stop wins, bounded overlap',result);
}finally{await browser.close();}
