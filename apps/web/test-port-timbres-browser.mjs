import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {installOutputProbe,outputPhraseRms} from './test/audio-probe.mjs';
const base=process.env.SITE??'http://127.0.0.1:3070',out=new URL('../../.artifacts/timbre-review/browser/',import.meta.url);
await mkdir(out,{recursive:true});
const publication=JSON.parse(await readFile(new URL('public/arrangement-data/report.json',import.meta.url))),piece=publication.pieces.find(p=>p.id==='sonic');
const browser=await chromium.launch(),results=[],errors=[];
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},recordVideo:{dir:new URL('video/',out).pathname}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(installOutputProbe);await page.goto(base);
 await page.getByRole('button',{name:'Sonic 8 parts',exact:true}).click();
 for(const [chip,name]of [['2a03','Famicom'],['dmg','Game Boy'],['snes','Super Famicom']]){
  await page.locator('.machines').getByRole('button',{name,exact:true}).click();
  const asset=piece.cases.find(c=>c.chip===chip).asset;
  await page.waitForFunction(file=>document.querySelector('.arrangement-versions a')?.getAttribute('href')===file,asset.file,{timeout:120000});
  const response=await page.request.get(base+asset.file);assert.ok(response.ok());assert.equal(createHash('sha256').update(await response.body()).digest('hex'),asset.sha256,'browser receives exactly the qualified port');
  assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),1,'changing console retains playback');
  const rms=await outputPhraseRms(page);assert.ok(rms>.001,`${name} actual browser output is audible`);
  await page.screenshot({path:new URL(`sonic-${chip}.png`,out).pathname,fullPage:true});results.push({chip,rms,asset:asset.file,sha256:asset.sha256});
 }
 await page.setViewportSize({width:390,height:900});await page.getByLabel('Language',{exact:true}).selectOption('ja');await page.getByRole('heading',{name:'ソニック · グリーンヒルゾーン',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:new URL('sonic-snes-mobile-ja.png',out).pathname,fullPage:true});
 assert.deepEqual(errors,[]);await context.close();await writeFile(new URL('result.json',out),JSON.stringify({pass:true,site:base,engineSha256:publication.engineSha256,results,errors},null,2));
 console.log('PASS Sonic portable assets, audible continuous switching, desktop/mobile Japanese screenshots and video');
}finally{await browser.close();}
