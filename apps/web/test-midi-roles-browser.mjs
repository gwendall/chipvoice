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
 for(const japanese of [false,true]){
  await page.setViewportSize(japanese?{width:390,height:844}:{width:1280,height:1050});
  await page.goto(base+(japanese?'/ja':''));
  await page.locator('input[type="file"]').setInputFiles({name:'Role review.mid',mimeType:'audio/midi',buffer:roleMidi(true,768)});
  await page.getByRole('heading',{name:'Role review',exact:true}).waitFor({timeout:120000});
  const details=page.locator('.import-roles');await details.locator('summary').click();
  const selects=details.locator('select');await selects.first().waitFor();
  assert.deepEqual(await selects.evaluateAll(nodes=>nodes.map(n=>n.value)),['chord','lead']);
  const download=page.locator('.arrangement-versions a[download][href^="blob:"]');await download.waitFor({timeout:120000});const old=await download.getAttribute('href');
  await selects.first().selectOption('bass');
  await page.waitForFunction(previous=>document.querySelector('a[download][href^="blob:"]')?.getAttribute('href')!==previous,old,{timeout:120000});
  assert.equal(await selects.first().inputValue(),'bass');
  assert.match(await details.innerText(),japanese?/手動設定/:/Chosen by you/);
  const rms=await outputPhraseRms(page);assert.ok(rms>.001,'editing roles retains audible playback');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await details.scrollIntoViewIfNeeded();await page.screenshot({path:new URL(japanese?'roles-mobile-ja.png':'roles-desktop.png',out).pathname,fullPage:true});results.push({japanese,rms});
 }
 assert.deepEqual(errors,[]);await writeFile(new URL('result.json',out),JSON.stringify({results,errors},null,2));await context.close();console.log('PASS MIDI role review, rerender, measured audio, English/Japanese and mobile layout',results);
}finally{await browser.close();}
