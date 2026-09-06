import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.SITE??'http://127.0.0.1:3070';
const out=new URL('../../.artifacts/continuity/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const buses=new WeakMap(),connect=AudioNode.prototype.connect;
  AudioNode.prototype.connect=function(destination,...args){
   if(destination===this.context.destination){
    let bus=buses.get(this.context);
    if(!bus){bus=this.context.createGain();connect.call(bus,destination);buses.set(this.context,bus);window.audioBus=bus;}
    return connect.call(this,bus,...args);
   }
   return connect.call(this,destination,...args);
  };
  const line=Array(64).fill('.');line[0]='C4';
  localStorage.setItem('chipvoice.draft.v1',JSON.stringify({title:'Continuity probe',chip:'2a03',bpm:120,order:[0],patterns:[{lead:line.join(' '),chord:Array(64).fill('.').join(' '),bass:Array(64).fill('.').join(' '),perc:Array(64).fill('.').join(' '),chordShape:[[0,4,7]]}]}));
 });
 await page.goto(base);await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>window.chipvoice?.position()?.step>0);
 await page.evaluate(async()=>{
  const ctx=window.audioBus.context;
  const code=`class Probe extends AudioWorkletProcessor{process(inputs){const a=inputs[0]?.[0];if(a){let peak=0,sum=0;for(const v of a){peak=Math.max(peak,Math.abs(v));sum+=v*v;}this.port.postMessage({at:currentTime,peak,rms:Math.sqrt(sum/a.length)});}return true;}}registerProcessor('continuity-probe',Probe);`;
  const url=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));await ctx.audioWorklet.addModule(url);URL.revokeObjectURL(url);
  const probe=new AudioWorkletNode(ctx,'continuity-probe');window.audioBlocks=[];probe.port.onmessage=e=>window.audioBlocks.push(e.data);window.audioBus.connect(probe);
  window.phaseTransitions=[];const prototype=Object.getPrototypeOf(window.chipvoice),play=prototype.play;
  prototype.play=function(song,position,at){if(at){const expected=window.chipvoice.phaseAt(at);window.phaseTransitions.push({expected,position,at});}return play.call(this,song,position,at);};
 });
 await page.waitForTimeout(150);
 await page.evaluate(()=>{window.audioBlocks=[];});
 for(const tempo of ['156','132','168']){await page.getByLabel('Tempo',{exact:true}).fill(tempo);await page.waitForTimeout(420);}
 await page.locator('.machines').getByRole('button',{name:'SNES',exact:true}).click();
 await page.waitForFunction(()=>window.chipvoice?.spec.id==='snes');
 await page.waitForTimeout(150);
 const results=await page.evaluate(()=>({blocks:window.audioBlocks,transitions:window.phaseTransitions}));
 assert.ok(results.blocks.length>200,'The audio-clock probe must collect real output blocks');
 let longest=0,run=0;for(const block of results.blocks){run=block.peak<.00001?run+128:0;longest=Math.max(longest,run);}
 const sampleRate=await page.evaluate(()=>window.audioBus.context.sampleRate);
 const gapMs=longest/sampleRate*1000;
 assert.ok(gapMs<20,`Continuous held note has ${gapMs.toFixed(1)} ms of transition silence`);
 assert.ok(results.transitions.length>=4);
 for(const transition of results.transitions){assert.ok(transition.expected);assert.deepEqual(transition.position,transition.expected,'Incoming engine must preserve fractional musical phase');}
 await page.locator('.machines').getByRole('button',{name:'Game Boy',exact:true}).click();
 await page.getByRole('button',{name:'Stop',exact:true}).click();
 await page.waitForTimeout(550);
 assert.equal(await page.getByRole('button',{name:'Play',exact:true}).count(),1,'Stop wins over pending engine creation');
 assert.equal(await page.evaluate(()=>window.chipvoice.playing),false);
 assert.deepEqual(errors,[]);
 const evidence={pass:true,gapMs,transitions:results.transitions,errors};
 await writeFile(new URL('live-audio.json',out),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
}finally{await browser.close();}
