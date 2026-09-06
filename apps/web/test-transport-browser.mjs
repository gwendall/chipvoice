import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {installOutputProbe,outputRms} from './test/audio-probe.mjs';
const base=process.env.SITE??'http://127.0.0.1:3074';
const out=new URL('../../.artifacts/unified-playground/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch(),checks=[];
const ready=page=>page.waitForFunction(()=>!!document.querySelector('.arrangement-versions a')&&!document.querySelector('.arrangement-versions button')?.disabled,{},{timeout:120000});
async function audible(page){let peak=0;for(let i=0;i<20;i++){peak=Math.max(peak,await outputRms(page));if(peak>.001)break;}assert.ok(peak>.001);return peak;}
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},hasTouch:true,recordVideo:{dir:new URL('video/',out).pathname}});
 await context.addInitScript(installOutputProbe);
 await context.addInitScript(()=>{
  const create=AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource=function(){const source=create.call(this),start=source.start.bind(source);source.start=(at=0,offset=0,...rest)=>{if(window.lastRecording&&window.lastRecording.at!==at)window.previousRecording=window.lastRecording;const recording={context:this,source,at,offset,ended:false};source.addEventListener('ended',()=>{recording.ended=true;});window.lastRecording=recording;return start(at,offset,...rest);};return source;};
 });
 const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 try {
 await page.goto(base);await page.getByRole('button',{name:'Mario 4 parts'}).waitFor();
 assert.equal(await page.locator('.score-part').count(),4,'four native parts on arrival');
 assert.equal(await page.locator('.arrangement-parts button').count(),5);
 assert.ok(!requests.some(u=>u.endsWith('report.json')||u.endsWith('.flac')),'light catalogue and lazy audio');
 await page.screenshot({path:new URL('desktop-arrival.png',out).pathname,fullPage:true});
 await page.getByRole('button',{name:'Play',exact:true}).click();await ready(page);checks.push({nativeRms:await audible(page)});

 // Native input uses React's input value tracking; keyboard navigation also
 // proves the transport is operable without clicking the canvas.
 await page.getByRole('slider',{name:'Song position',exact:true}).focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
 const sync=async label=>{
  await page.waitForTimeout(450);
  const sample=await page.evaluate(()=>{
   const {context,source,at,offset}=window.lastRecording,stamp=context.getOutputTimestamp();
   const audible=Math.max(0,Math.min(context.currentTime,stamp.contextTime+(performance.now()-stamp.performanceTime)/1000));
   const duration=source.buffer.duration;let expected=offset+Math.max(0,audible-at);
   if(expected>=duration)expected=source.loop?source.loopStart+(expected-source.loopStart)%(duration-source.loopStart):duration;
   const node=document.querySelector('.score-cursor'),width=node.getBoundingClientRect().width;
   const displayed=new DOMMatrixReadOnly(getComputedStyle(node).transform).m41/width*duration;
   const previous=window.previousRecording;let phaseError=0;if(previous){const duration=previous.source.buffer.duration;let time=previous.offset+Math.max(0,at-previous.at);if(time>=duration)time=previous.source.loopStart+(time-previous.source.loopStart)%(duration-previous.source.loopStart);phaseError=Math.abs(time/duration-offset/source.buffer.duration);}
   return {expected,displayed,phaseError,errorMs:Math.abs(expected-displayed)*1000,reportedLatencyMs:(context.currentTime-audible)*1000};
  });assert.ok(sample.errorMs<80,`${label}: ${JSON.stringify(sample)}`);if(label==='console change'||label==='tempo change')assert.ok(sample.phaseError<.0001,`Musical phase: ${JSON.stringify(sample)}`);checks.push({label,...sample});
 };
 await sync('native playback');
 const score=page.locator('.score-notes');const box=await score.boundingBox();await score.click({position:{x:box.width*.55,y:20}});await sync('score seek');
 await page.getByRole('button',{name:'Pause',exact:true}).click();const frozen=await page.getByLabel('Elapsed time').textContent();await page.waitForTimeout(1100);assert.equal(await page.getByLabel('Elapsed time').textContent(),frozen);
 await page.getByRole('button',{name:'Restart',exact:false}).click();await page.waitForTimeout(60);assert.equal(await page.getByLabel('Elapsed time').textContent(),'0:00');
 await page.getByRole('slider',{name:'Song position',exact:true}).focus();await page.keyboard.press('End');await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
 assert.equal(await page.getByRole('button',{name:'Play',exact:true}).count(),1,'paused seek stays paused');
 await page.getByRole('button',{name:'Play',exact:true}).click();await sync('resume');
 await page.getByRole('button',{name:'Game Boy',exact:true}).click();await ready(page);await sync('console change');
 await page.getByLabel('Tempo',{exact:true}).fill('125');await page.getByLabel('Tempo',{exact:true}).press('Tab');await ready(page);await sync('tempo change');
 await page.getByRole('button',{name:'Pause',exact:true}).click();await page.getByLabel('Tempo',{exact:true}).fill('100');await page.getByLabel('Tempo',{exact:true}).press('Tab');await ready(page);assert.equal(await page.getByRole('button',{name:'Play',exact:true}).count(),1,'pause wins over render');
 await page.getByRole('button',{name:'Famicom',exact:true}).click();await ready(page);
 await page.getByRole('button',{name:'Loop on',exact:false}).click();
 await page.getByRole('slider',{name:'Song position',exact:true}).focus();await page.keyboard.press('End');await page.keyboard.press('ArrowLeft');await page.waitForFunction(()=>document.querySelector('[aria-label="Song position"]').value==='999');
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>{const r=window.lastRecording;return !r.source.loop&&Math.abs(r.offset/r.source.buffer.duration-.999)<1e-9;});await page.getByRole('button',{name:'Play',exact:true}).waitFor({timeout:5000});assert.equal(await page.getByLabel('Elapsed time').textContent(),'1:28','non-looping song ends');
 await page.getByRole('button',{name:'Play',exact:true}).click();await sync('replay after end');
 await page.getByRole('button',{name:'Loop off',exact:false}).click();await page.getByRole('slider',{name:'Song position',exact:true}).focus();await page.keyboard.press('End');await page.waitForTimeout(600);
 const loopPosition=Number(await page.getByRole('slider',{name:'Song position',exact:true}).inputValue());assert.ok(loopPosition>=25&&loopPosition<60,'native loop skips the introduction');
 await page.getByRole('button',{name:'Independent original reference',exact:true}).click();const referenceDownload=await page.getByRole('link',{name:'Download audio',exact:false}).getAttribute('href');
 await page.getByRole('button',{name:'Make a loop',exact:false}).click();await page.getByRole('button',{name:'Edit loop',exact:false}).waitFor();await page.waitForTimeout(350);assert.ok(await outputRms(page)<.0001,'composer handoff pauses arrangement');
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>window.chipvoice?.playing);await audible(page);
 await page.getByRole('button',{name:'Listen & explore',exact:true}).click();await page.waitForTimeout(350);assert.ok(await outputRms(page)<.0001,'return disposes composer audio');
 assert.equal(await page.getByRole('button',{name:'Independent original reference',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.getByRole('link',{name:'Download audio',exact:false}).getAttribute('href'),referenceDownload);
 await page.getByRole('button',{name:'Play',exact:true}).click();await sync('return from composer');
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});await page.screenshot({path:new URL(`width-${width}.png`,out).pathname,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 // A native vertical gesture must browse parts without seeking the music.
 await page.getByRole('button',{name:'Sonic 14 parts',exact:true}).click();await ready(page);
 await page.waitForFunction(()=>document.querySelector('.screen-title h2')?.textContent.startsWith('Sonic')&&document.querySelectorAll('.score-part').length===14);
 await page.getByRole('button',{name:'Pause',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
 const region=page.getByRole('region',{name:'Source score'});await region.scrollIntoViewIfNeeded();
 const bounds=await region.boundingBox(),beforeScroll=await page.getByRole('slider',{name:'Song position',exact:true}).inputValue(),cdp=await context.newCDPSession(page);
 const touchX=bounds.x+bounds.width*.5,touchY=bounds.y+bounds.height-35;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchX,y:touchY}]});
 for(let step=1;step<=6;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchX,y:touchY-step*35}]});await page.waitForTimeout(20);}
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(250);await cdp.detach();
 assert.ok(await region.evaluate(n=>n.scrollTop)>0,'Touch scroll reaches more parts');
 assert.equal(await page.getByRole('slider',{name:'Song position',exact:true}).inputValue(),beforeScroll,'Scrolling source parts never seeks');
 await region.evaluate(n=>{n.scrollTop=n.scrollHeight;});await page.waitForTimeout(50);
 const last=await page.locator('.score-part').last().boundingBox(),scrolledBounds=await region.boundingBox();assert.ok(last.y>=scrolledBounds.y&&last.y+last.height<=scrolledBounds.y+scrolledBounds.height+1,'Last part remains reachable');
 const heights=await page.locator('.score-notes').evaluate(n=>({cursor:n.querySelector('.score-cursor').getBoundingClientRect().height,canvas:n.querySelector('canvas').getBoundingClientRect().height}));assert.ok(Math.abs(heights.cursor-heights.canvas)<1,'Cursor spans the complete scrolling score');
 await page.locator('.screen-bezel').screenshot({path:new URL('mobile-scrolled-score.png',out).pathname});
 await region.focus();await page.keyboard.press('Home');await page.waitForFunction(()=>document.querySelector('.score-overview').scrollTop===0,{},{timeout:3000});
 const top=await region.boundingBox();await page.touchscreen.tap(top.x+top.width*.25,top.y+35);
 await page.waitForFunction(()=>Math.abs(Number(document.querySelector('[aria-label="Song position"]').value)-250)<10);
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});assert.ok(await page.locator('.score-part-name').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth)),'Source names stay readable');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 checks.push({label:'mobile parts',touchScrollKeepsPosition:true,lastPartReachable:true,tapStillSeeks:true});
 assert.deepEqual(errors,[]);await writeFile(new URL('result.json',out),JSON.stringify({pass:true,checks,errors},null,2));
 console.log('PASS full-mix arrival, audible-clock visuals, seek/pause/restart/loop/end, continuous console/tempo, exclusive composer, mobile screenshots and video',checks);
 }catch(error){await page.screenshot({path:new URL('failure.png',out).pathname,fullPage:true});await writeFile(new URL('failure.json',out),JSON.stringify(await page.evaluate(()=>({position:document.querySelector('[aria-label="Song position"]')?.value,time:document.querySelector('[aria-label="Elapsed time"]')?.textContent,play:document.querySelector('.play-button')?.textContent,loop:document.querySelector('.transport-actions [aria-pressed]')?.textContent,recording:window.lastRecording?{at:window.lastRecording.at,offset:window.lastRecording.offset,duration:window.lastRecording.source.buffer.duration,loop:window.lastRecording.source.loop,ended:window.lastRecording.ended,state:window.lastRecording.context.state,baseLatency:window.lastRecording.context.baseLatency,outputLatency:window.lastRecording.context.outputLatency,contextTime:window.lastRecording.context.currentTime,stamp:window.lastRecording.context.getOutputTimestamp()}:null})),null,2));throw error;}finally{await context.close();}
}finally{await browser.close();}
