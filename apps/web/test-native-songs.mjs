import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {installOutputProbe,outputRms} from './test/audio-probe.mjs';
const base=process.env.SITE??'http://127.0.0.1:3074',out=new URL('../../.artifacts/native-songs/browser/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const results=[];
async function ready(page){await page.waitForFunction(()=>{const button=document.querySelector('.arrangement-versions button');return button&&!button.disabled;},{},{timeout:240000});}
async function audible(page){let peak=0;for(let i=0;i<32;i++){peak=Math.max(peak,await outputRms(page));if(peak>.001)return peak;}assert.fail(`No audible phrase: ${peak}`);}
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},recordVideo:{dir:new URL('video/',out).pathname}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(installOutputProbe);
 await page.goto(base);await page.getByRole('heading',{name:'Old consoles. New JavaScript.'}).waitFor();
 for(const [song,parts,consoleName,id,chip] of [['Mario',4,'Famicom','mario','2a03'],['Zelda',4,'Famicom','zelda','2a03'],['Sonic',8,'Mega Drive','sonic','md']]){
  await page.getByRole('button',{name:`${song} ${parts} parts`,exact:true}).click();
  await page.waitForFunction(file=>document.querySelector('.arrangement-versions a')?.getAttribute('href')===file,`/arrangement-data/${id}-${chip}.flac`,{timeout:240000});await ready(page);
  assert.equal(await page.locator('.machines').getByRole('button',{name:consoleName,exact:true}).getAttribute('aria-pressed'),'true','cartridge selects its original hardware');
  await page.getByRole('button',{name:'Our native rendering',exact:true}).waitFor();
  const download=page.getByRole('link',{name:'Download audio',exact:false});assert.equal(await download.getAttribute('href'),`/arrangement-data/${id}-${chip}.flac`);
  const mixRms=await audible(page);await page.getByRole('button',{name:'Independent original reference',exact:true}).click();
  assert.equal(await download.getAttribute('href'),`/arrangement-data/${id}-reference.flac`);const referenceRms=await audible(page);
  await page.screenshot({path:new URL(`${id}-desktop.png`,out).pathname,fullPage:true});
  await page.getByRole('button',{name:'Our native rendering',exact:true}).click();
  results.push({song,console:consoleName,mixRms,referenceRms});
 }
 await page.getByRole('button',{name:'Drums · DAC',exact:false}).click();
 await page.waitForFunction(()=>document.querySelector('.arrangement-versions a')?.getAttribute('href')?.startsWith('blob:'),{},{timeout:240000});await ready(page);
 assert.equal(await page.getByRole('button',{name:'Independent original reference',exact:true}).isDisabled(),true,'solo never masquerades as the native full mix comparison');
 assert.match(await page.getByRole('link',{name:'Download audio',exact:false}).getAttribute('href'),/^blob:/,'solo was rendered by the worker');
 await page.getByRole('button',{name:'Restart',exact:true}).click();const drumRms=await audible(page);results.push({solo:'original DAC drums',drumRms});
 await page.screenshot({path:new URL('sonic-dac-solo.png',out).pathname,fullPage:true});
 await page.getByRole('button',{name:'Full mix',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.arrangement-versions a')?.getAttribute('href')==='/arrangement-data/sonic-md.flac',{},{timeout:240000});await ready(page);
 for(const width of [320,390,768]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no mobile horizontal overflow');await page.screenshot({path:new URL(`sonic-${width}.png`,out).pathname,fullPage:true});}
 await page.getByLabel('Language',{exact:true}).selectOption('ja');
 await page.getByRole('heading',{name:'ソニック · グリーンヒルゾーン',exact:true}).waitFor();
 await page.getByRole('button',{name:'ソニック 8 パート',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'独立した原曲リファレンス',exact:true}).isDisabled(),false);
 for(const width of [390,1280]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:new URL(`sonic-ja-${width}.png`,out).pathname,fullPage:true});}
 results.push({locale:'ja',nativeReferenceAvailable:true});
 assert.deepEqual(errors,[]);await writeFile(new URL('result.json',out),JSON.stringify({pass:true,results,errors},null,2));await context.close();console.log('PASS three native original-console selections, audible independent A/B, original DAC solo, responsive screenshots/video');
}finally{await browser.close();}
