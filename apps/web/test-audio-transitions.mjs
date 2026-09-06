import assert from 'node:assert/strict';
import {installOutputProbe} from './test/audio-probe.mjs';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.SITE??'http://127.0.0.1:3070';
const out=new URL('../../.artifacts/continuity/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch();
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(installOutputProbe);
 await page.addInitScript(()=>{
  const line=Array(64).fill('.');line[0]='C4';
  localStorage.setItem('chipvoice.draft.v1',JSON.stringify({title:'Continuity probe',chip:'2a03',bpm:120,order:[0],patterns:[{lead:line.join(' '),chord:Array(64).fill('.').join(' '),bass:Array(64).fill('.').join(' '),perc:Array(64).fill('.').join(' '),chordShape:[[0,4,7]]}]}));
 });
 await page.goto(base+'/?mode=compose'); await page.getByRole('button',{name:'Edit loop',exact:false}).waitFor();
 const valueIs=async(locator,value,message)=>{
  const id=await locator.getAttribute('id');
  await page.waitForFunction(({id,value})=>document.getElementById(id)?.value===value,{id,value});
  assert.equal(await locator.inputValue(),value,message);
 };
 const slider=page.getByRole('slider',{name:'Tempo slider',exact:true}),number=page.getByRole('spinbutton',{name:'Tempo',exact:true});
 await page.waitForFunction(()=>document.getElementById('tempo-slider')?.disabled===false && document.getElementById('tempo')?.value==='120');
 await slider.focus();await page.keyboard.press('Home');await valueIs(number,'40');
 await page.keyboard.press('End');await valueIs(number,'300');
 await page.keyboard.press('ArrowLeft');await valueIs(number,'299');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await valueIs(slider,'120','One Undo restores the whole slider gesture');
 const bounds=await slider.boundingBox();
 await page.mouse.move(bounds.x+bounds.width*.35,bounds.y+bounds.height/2);await page.mouse.down();
 await page.mouse.move(bounds.x+bounds.width*.85,bounds.y+bounds.height/2,{steps:12});await page.mouse.up();
 assert.ok(Number(await slider.inputValue())>200);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await valueIs(slider,'120','One Undo restores the entire pointer drag');
 await number.fill('183');await valueIs(slider,'183');await number.press('Enter');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await valueIs(number,'120');
 await number.fill('14');await valueIs(number,'14','Partial numbers remain editable');await valueIs(slider,'120');
 await number.press('Enter');await valueIs(number,'40');
 await number.fill('999');await number.press('Enter');await valueIs(number,'300');
 await number.fill('');await number.press('Enter');await valueIs(number,'300');
 await number.fill('120');await number.press('Enter');
 // Earlier console gestures may already have enabled the one-time autoplay.
 if(!await page.getByRole('button',{name:'Stop',exact:true}).count())await page.getByRole('button',{name:'Play',exact:true}).click();
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
 await slider.focus();await page.keyboard.press('PageUp');await page.waitForTimeout(420);
 await number.fill('132');await number.press('Enter');await page.waitForTimeout(420);
 await slider.focus();await page.keyboard.press('End');await page.waitForTimeout(420);
 await page.locator('.demo-page .machines').getByRole('button',{name:'Super Famicom',exact:true}).click();
 await page.waitForFunction(()=>window.chipvoice?.spec.id==='snes');
 await page.waitForTimeout(150);
 const results=await page.evaluate(()=>({blocks:window.audioBlocks,transitions:window.phaseTransitions}));
 assert.ok(results.blocks.length>200,'The audio-clock probe must collect real output blocks');
 let longest=0,run=0;for(const block of results.blocks){run=block.peak<.00001?run+128:0;longest=Math.max(longest,run);}
 const sampleRate=await page.evaluate(()=>window.audioBus.context.sampleRate);
 const gapMs=longest/sampleRate*1000;
 assert.equal(gapMs,0,`Continuous held note has ${gapMs.toFixed(1)} ms of transition silence`);
 assert.ok(results.transitions.length>=4);
 for(const transition of results.transitions){assert.ok(transition.expected);assert.deepEqual(transition.position,transition.expected,'Incoming engine must preserve fractional musical phase');}
 await page.locator('.demo-page .machines').getByRole('button',{name:'Game Boy',exact:true}).click();
 await page.getByRole('button',{name:'Stop',exact:true}).click();
 await page.waitForTimeout(550);
 assert.equal(await page.getByRole('button',{name:'Play',exact:true}).count(),1,'Stop wins over pending engine creation');
 assert.equal(await page.evaluate(()=>window.chipvoice.playing),false);
 assert.deepEqual(errors,[]);
 const evidence={pass:true,gapMs,silentBlocks:results.blocks.filter(block=>block.peak<.00001),transitions:results.transitions,errors};
 await writeFile(new URL('live-audio.json',out),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
}finally{await browser.close();}
