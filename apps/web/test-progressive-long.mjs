import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {build} from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
import {installOutputProbe,outputPhraseRms} from './test/audio-probe.mjs';
const base=process.env.SITE??'http://127.0.0.1:3171';
const bundle=await build({stdin:{contents:"export {ProjectPlayer} from 'chipvoice';",resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'PreviewTest',write:false});
const browser=await chromium.launch(),page=await browser.newPage(),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(installOutputProbe);
try {
 await page.goto(base+'/lab/components');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(async()=>{
  const [performance,plan]=await Promise.all(['mario','mario-native'].map(id=>fetch(`/arrangement-data/${id}.json`).then(r=>r.json())));
  window.project={version:1,title:'Long preview fixture',source:{kind:'native',performance,plan},settings:{chip:'2a03',allowLoss:true}};
  const button=document.createElement('button');button.id='long-preview';button.textContent='Start long preview';document.body.append(button);
  button.onclick=()=>{window.engine=new PreviewTest.ProjectPlayer({preview:true});void window.engine.play();void window.engine.load(window.project);};
 });
 await page.locator('#long-preview').click();await page.waitForFunction(()=>window.engine.audibleProject&&!window.engine.preparing,null,{timeout:30000});
 assert.ok(await page.evaluate(()=>window.engine.duration)>80);
 await page.evaluate(()=>window.engine.seek(60));await page.waitForFunction(()=>!window.engine.preparing&&window.engine.position>=60,null,{timeout:30000});
 for (const chip of ['dmg','md','snes','2a03']) {
  await page.evaluate(chip=>{window.started=performance.now();window.done=false;void window.engine.update({chip}).then(ok=>{window.done=ok;window.readyMs=performance.now()-window.started;});},chip);
  await page.waitForFunction(chip=>window.done&&window.engine.audibleProject.settings.chip===chip,chip,{timeout:60000});
  console.log('Prepared',chip);checks.push({chip,...await page.evaluate(()=>({readyMs:window.readyMs,position:window.engine.position,underruns:window.engine.transport.underruns,workers:window.engine.transport.sources.size,playing:window.engine.playing,error:window.engine.error})),rms:await outputPhraseRms(page)});
 }
 // Rapid edits plus a seek/loop action: source choice and transport intent survive together.
 await page.evaluate(async()=>{
  for(const chip of ['dmg','md','snes','dmg','snes']) {void window.engine.update({chip});await new Promise(r=>setTimeout(r,25));}
  window.engine.seek(45);window.engine.loop=false;
 });
 await page.waitForFunction(()=>!window.engine.preparing&&window.engine.audibleProject.settings.chip==='snes'&&window.engine.position>=45,null,{timeout:60000});
 await page.waitForTimeout(4000);
 checks.push({rapid:true,...await page.evaluate(()=>({position:window.engine.position,underruns:window.engine.transport.underruns,workers:window.engine.transport.sources.size,playing:window.engine.playing,error:window.engine.error})),rms:await outputPhraseRms(page)});
 await page.evaluate(()=>window.engine.dispose());
 for(const check of checks){assert.ok(check.playing&&check.rms>.001,JSON.stringify(check));assert.equal(check.error,'');assert.ok(check.workers<=3);assert.equal(check.underruns,0,JSON.stringify(check));}
 assert.deepEqual(errors,[]);await mkdir('../../.artifacts/progressive',{recursive:true});await writeFile('../../.artifacts/progressive/long.json',JSON.stringify({checks,errors},null,2));console.log('PASS long native/adapted playback, cold mid-song console changes, rapid latest settings, seek/loop intent, bounded workers and zero underruns',checks);
}catch(error){console.error('Long preview state',await page.evaluate(()=>({duration:window.engine?.duration,position:window.engine?.position,playing:window.engine?.playing,preparing:window.engine?.preparing,error:window.engine?.error,chip:window.engine?.audibleProject?.settings.chip,done:window.done,underruns:window.engine?.transport.underruns})));throw error;}finally {await browser.close();}
