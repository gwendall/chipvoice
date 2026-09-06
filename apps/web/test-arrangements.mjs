import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {installOutputProbe,outputRms} from './test/audio-probe.mjs';
const base=process.env.SITE??'http://127.0.0.1:3070',out=new URL('../../.artifacts/arrangements/browser/',import.meta.url);await mkdir(out,{recursive:true});
const chunk=(name,bytes)=>{const b=Buffer.alloc(8+bytes.length);b.write(name);b.writeUInt32BE(bytes.length,4);Buffer.from(bytes).copy(b,8);return b;};
const midi=Buffer.concat([chunk('MThd',[0,0,0,1,1,224]),chunk('MTrk',[0,0x90,60,100,0,64,90,0,67,80,0x8f,0,0x80,60,0,0,64,0,0,67,0,0,0xff,0x2f,0])]);
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},recordVideo:{dir:new URL('video/',out).pathname}}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));await page.addInitScript(installOutputProbe);
 await page.goto(base+'/lab/arrangements');await page.getByRole('heading',{name:'Every part. Every little chip.'}).waitFor();await page.getByRole('button',{name:'Mario 4 parts'}).waitFor();
 assert.equal(requests.filter(u=>u.endsWith('.flac')).length,0,'lazy audio');
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.getByRole('link',{name:'Download audio',exact:false}).waitFor({timeout:60000});
 assert.ok(await outputRms(page)>.001,'complete native arrangement is audible');
 await page.getByRole('button',{name:'Independent original reference',exact:true}).click();assert.ok(await outputRms(page)>.001,'independent NSF renderer is audible');
 await page.screenshot({path:new URL('desktop.png',out).pathname,fullPage:true});
 for(const name of ['Game Boy','Mega Drive','Super Famicom','Famicom']){
  await page.locator('.machines').getByRole('button',{name,exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.arrangement-versions button').disabled,{},{timeout:60000});
  assert.equal(await page.getByRole('button',{name:'Stop',exact:true}).count(),1);
 }
 await page.getByRole('button',{name:'Sonic 14 parts'}).click();await page.waitForFunction(()=>!document.querySelector('.arrangement-versions button').disabled,{},{timeout:60000});
 assert.equal(await page.locator('.arrangement-parts button').count(),15,'all fourteen source parts are selectable');
 await page.screenshot({path:new URL('sonic.png',out).pathname,fullPage:true});
 await page.getByLabel('Import MIDI',{exact:true}).setInputFiles({name:'three-voices.mid',mimeType:'audio/midi',buffer:midi});
 await page.getByRole('heading',{name:'three-voices',exact:true}).waitFor({timeout:60000});
 assert.ok(await outputRms(page)>.001,'imported polyphony rendered locally');
 await page.getByLabel('Tempo',{exact:true}).fill('130');await page.getByLabel('Tempo',{exact:true}).press('Tab');
 await page.getByLabel('Transpose',{exact:true}).fill('7');await page.getByLabel('Transpose',{exact:true}).press('Tab');
 await page.waitForFunction(()=>!document.querySelector('.arrangement-versions button').disabled,{},{timeout:60000});
 assert.equal(await page.getByRole('button',{name:'Stop',exact:true}).count(),1,'edits retain Play');
 assert.ok(await outputRms(page)>.001,'edits remain audible');
 await page.getByLabel('Tempo',{exact:true}).fill('90');await page.getByLabel('Tempo',{exact:true}).press('Tab');await page.getByRole('button',{name:'Stop',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.arrangement-versions button').disabled,{},{timeout:60000});assert.equal(await page.getByRole('button',{name:'Play',exact:true}).count(),1,'Stop wins over pending worker');
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});await page.screenshot({path:new URL(`width-${width}.png`,out).pathname,fullPage:true});const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,tiny:[...document.querySelectorAll('p,button,a,label,span,strong')].filter(e=>e.getBoundingClientRect().height&&getComputedStyle(e).display!=='none'&&parseFloat(getComputedStyle(e).fontSize)<14).map(e=>e.textContent)}));assert.equal(layout.overflow,false,JSON.stringify({width,layout}));assert.deepEqual(layout.tiny,[]);}
 assert.deepEqual(errors,[]);assert.equal(requests.some(u=>u.includes('/api/')&&u.includes('midi')),false);
 await writeFile(new URL('result.json',out),JSON.stringify({pass:true,errors,checks:['lazy assets','native/reference audio','continuous four-console selection','14 source parts','local polyphonic MIDI','tempo and transpose','Stop wins','320/390/768 typography and overflow']},null,2));
 await context.close();console.log('PASS complete arrangement deck, native A/B, local MIDI, continuous edits, responsive screenshots and video');
}finally{await browser.close();}
