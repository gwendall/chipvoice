import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {roleMidi} from '../../packages/chipvoice/test/fixtures/midi-roles.mjs';
import {installOutputProbe,outputPhraseRms} from './test/audio-probe.mjs';
const base=process.env.SITE??'http://127.0.0.1:3070',out=new URL('../../.artifacts/cold-review/browser/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1280,height:1050},recordVideo:{dir:new URL('video/',out).pathname}}),page=await context.newPage(),errors=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(installOutputProbe);
 await page.addInitScript(()=>{window.bufferGroups=0;const groups=new WeakSet(),create=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){const source=create.call(this),connect=source.connect.bind(source),start=source.start.bind(source);let group;source.connect=(...args)=>{group=args[0];return connect(...args);};source.start=(...args)=>{if(group&&!groups.has(group)){groups.add(group);window.bufferGroups++;}return start(...args);};return source;};});
 for(const japanese of [false,true]){
  await page.setViewportSize(japanese?{width:390,height:844}:{width:1280,height:1050});
  await page.goto(base+(japanese?'/ja':''));
  await page.locator('input[type="file"]').setInputFiles({name:'Role review.mid',mimeType:'audio/midi',buffer:roleMidi(true,768)});
  await page.getByRole('heading',{name:'Role review',exact:true}).waitFor({timeout:120000});
  const details=page.locator('.import-roles');await details.locator('summary').click();
  const selects=details.locator('select');await selects.first().waitFor();
  assert.deepEqual(await selects.evaluateAll(nodes=>nodes.map(n=>n.value)),['chord','lead']);
  await page.locator('.arrangement-versions button:nth-child(3)').waitFor({timeout:120000});const old=await page.evaluate(()=>window.bufferGroups);
  await selects.first().selectOption('bass');
  await page.waitForFunction(previous=>window.bufferGroups>previous,old,{timeout:120000});
  assert.equal(await selects.first().inputValue(),'bass');
  assert.match(await details.innerText(),japanese?/手動設定/:/Chosen by you/);
  const rms=await outputPhraseRms(page);assert.ok(rms>.001,'editing roles retains audible playback');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await details.scrollIntoViewIfNeeded();await page.screenshot({path:new URL(japanese?'roles-mobile-ja.png':'roles-desktop.png',out).pathname,fullPage:true});results.push({japanese,rms});
 }
 assert.deepEqual(errors,[]);await writeFile(new URL('result.json',out),JSON.stringify({results,errors},null,2));await context.close();console.log('PASS MIDI role review, rerender, measured audio, English/Japanese and mobile layout',results);
}finally{await browser.close();}
