import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
import {installOutputProbe,outputPhraseRms} from './test/audio-probe.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.SITE??'http://127.0.0.1:3171';
const built=await build({stdin:{contents:"export {ProjectPlayer} from 'chipvoice';export {starterProject} from './src/create/starter';",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'PreviewTest',write:false});
const browser=await chromium.launch(),page=await browser.newPage();const errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(installOutputProbe);
try{
 await page.goto(base+'/lab/components');await page.addScriptTag({content:built.outputFiles[0].text});
 await page.evaluate(()=>{
  const button=document.createElement('button');button.id='probe-start';button.textContent='Start progressive test';document.body.append(button);
  button.onclick=()=>{window.testStarted=performance.now();window.project=PreviewTest.starterProject();window.engine=new PreviewTest.ProjectPlayer({preview:true});void window.engine.play();void window.engine.load(window.project);};
 });
 await page.locator('#probe-start').click();await page.waitForFunction(()=>window.engine.audibleProject&&!window.engine.preparing,null,{timeout:30000});
 checks.push({firstReady:await page.evaluate(()=>performance.now()-window.testStarted),rms:await outputPhraseRms(page)});
 await page.waitForTimeout(1800);
 for(const settings of [{tempoScale:1.25},{transpose:2},{chip:'dmg'},{chip:'snes'}]){
  await page.evaluate(settings=>{window.testStarted=performance.now();window.changedReady=false;window.previousPosition=window.engine.position;void window.engine.update(settings).then(ok=>{window.changedReady=ok;window.readyMs=performance.now()-window.testStarted;});},settings);
  await page.waitForFunction(settings=>window.changedReady&&Object.entries(settings).every(([k,v])=>window.engine.audibleProject.settings[k]===v),settings,{timeout:30000});
  checks.push({settings,...await page.evaluate(()=>({readyMs:window.readyMs,playing:window.engine.playing,position:window.engine.position,underruns:window.engine.transport.underruns,error:window.engine.error})),rms:await outputPhraseRms(page)});
 }
 await page.evaluate(()=>{window.engine.pause();window.engine.seek(15);});assert.equal(await page.evaluate(()=>window.engine.position),15);
 await page.evaluate(()=>window.engine.play());await page.waitForFunction(()=>!window.engine.preparing&&window.engine.position>=15,null,{timeout:30000});
 checks.push({seekRms:await outputPhraseRms(page)});
 await page.evaluate(()=>{void window.engine.update({chip:'md'});window.engine.pause();});await page.waitForFunction(()=>!window.engine.preparing,null,{timeout:30000});assert.equal(await page.evaluate(()=>window.engine.playing),false,'pause wins over preparation');
 await page.evaluate(()=>{window.engine.restart();window.engine.loop=false;void window.engine.play();});await page.waitForFunction(()=>!window.engine.preparing,null,{timeout:30000});
 await page.evaluate(()=>window.engine.seek(window.engine.duration-.15));await page.waitForFunction(()=>!window.engine.playing,null,{timeout:30000});assert.equal(await page.evaluate(()=>window.engine.position),await page.evaluate(()=>window.engine.duration));
 await page.evaluate(()=>window.engine.play());await page.waitForFunction(()=>window.engine.playing&&window.engine.position<3&&!window.engine.preparing,null,{timeout:30000});
 await page.evaluate(()=>window.engine.dispose());assert.equal(await page.evaluate(()=>window.engine.context.state),'closed');
 assert.deepEqual(errors,[]);for(const check of checks)if(check.rms!==undefined)assert.ok(check.rms>.001,JSON.stringify(check));
 await mkdir('../../.artifacts/progressive',{recursive:true});await writeFile('../../.artifacts/progressive/browser.json',JSON.stringify({checks,errors},null,2));console.log('PASS progressive playback, edits, seeks, pause, end/replay and disposal',checks);
}finally{await browser.close();}
