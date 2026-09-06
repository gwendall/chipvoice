import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {chromium} from 'playwright';
import {installOutputProbe,outputRms} from './test/audio-probe.mjs';
const base=process.env.SITE??'http://127.0.0.1:3070',out=new URL('../../.artifacts/midi-import/e2e/',import.meta.url);await mkdir(out,{recursive:true});
// A long synthetic SMF keeps the real asynchronous render boundary in CI.
// The user's music is only read when MIDI_FILE is explicitly supplied locally.
const variable=n=>{const bytes=[n&127];while(n>>=7)bytes.unshift((n&127)|128);return bytes;};
const chunk=(name,data)=>{const h=Buffer.alloc(8);h.write(name);h.writeUInt32BE(data.length,4);return Buffer.concat([h,Buffer.from(data)]);};
const tracks=[];for(let channel=0;channel<3;channel++){const rows=[0,0xff,3,6,0xc9,99,108,97,116,0xe9,0,0xc0+channel,channel===2?33:80];for(let i=0;i<165;i++){const pitch=48+channel*12+(i%4)*2;rows.push(0,0x90+channel,pitch,95,...variable(480),0x80+channel,pitch,0);}rows.push(0,0xff,0x2f,0);tracks.push(chunk('MTrk',rows));}
const fixture=Buffer.concat([chunk('MThd',[0,1,0,3,1,224]),...tracks]);
const file=process.env.MIDI_FILE,title=file?basename(file).replace(/\.midi?$/i,''):'Long MIDI';
const machines=(process.env.MIDI_CHIPS??'Famicom').split(',');
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},recordVideo:{dir:new URL('video/',out).pathname}}),page=await context.newPage(),errors=[],results=[];
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(installOutputProbe);
 await page.goto(base+'/lab/arrangements');await page.getByLabel('Import MIDI',{exact:true}).waitFor();
 if(machines[0]!=='Famicom')await page.locator('.machines').getByRole('button',{name:machines[0],exact:true}).click();
 const start=Date.now();await page.getByLabel('Import MIDI',{exact:true}).setInputFiles(file??{name:'Long MIDI.mid',mimeType:'audio/midi',buffer:fixture});
 const preparation=page.getByRole('region',{name:'Audio preparation'}),bar=page.getByRole('progressbar',{name:'Audio rendering progress'});
 await preparation.waitFor({timeout:5000});assert.match(await preparation.textContent(),new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),'the pending file is acknowledged before audio exists');
 assert.match(await preparation.textContent(),machines[0]==='Famicom'?/Playback starts automatically/:/Playback starts automatically|current music keeps playing/);
 for(let index=0;index<machines.length;index++){
  if(index){await page.locator('.machines').getByRole('button',{name:machines[index],exact:true}).click();await preparation.waitFor();}
  await page.waitForFunction(()=>{const p=document.querySelector('[aria-label="Audio rendering progress"]');const value=Number(p?.getAttribute('aria-valuenow'));return value>0&&value<100;},{},{timeout:240000});
  const first=Number(await bar.getAttribute('aria-valuenow'));await page.screenshot({path:new URL(`loading-${index}.png`,out).pathname,fullPage:true});
  await page.waitForFunction(value=>{const p=document.querySelector('[aria-label="Audio rendering progress"]');return !p||Number(p.getAttribute('aria-valuenow'))>value;},first,{timeout:240000});
  await preparation.waitFor({state:'hidden',timeout:240000});
  await page.getByRole('link',{name:'Download audio',exact:false}).waitFor();await page.getByRole('heading',{name:title,exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),1);
  const levels=[];for(let i=0;i<16;i++)levels.push(await outputRms(page));assert.ok(Math.max(...levels)>.001,`${machines[index]} must produce measured audio after completion: ${levels}`);
  const labels=await page.locator('.arrangement-parts strong').allTextContents();assert.ok(!labels.some(s=>s.includes('\ufffd')),JSON.stringify(labels));if(!file)assert.ok(labels.includes('Éclaté'));
  results.push({machine:machines[index],elapsedMs:Date.now()-start,maxRms:Math.max(...levels),labels});
 }
 await page.screenshot({path:new URL('ready.png',out).pathname,fullPage:true});
 // Real render still finishes after Stop; it must not restart playback.
 await page.getByLabel('Transpose',{exact:true}).fill('1');await page.getByLabel('Transpose',{exact:true}).press('Tab');await preparation.waitFor();
 await page.getByRole('button',{name:'Pause',exact:true}).click();assert.match(await preparation.textContent(),/Playback is paused/);
 await preparation.waitFor({state:'hidden',timeout:240000});assert.equal(await page.getByRole('button',{name:'Play',exact:true}).count(),1);assert.ok(await outputRms(page)<.0001,'Stop remains silent after the render completes');
 await page.setViewportSize({width:390,height:844});await page.getByLabel('Transpose',{exact:true}).fill('2');await preparation.waitFor();await page.screenshot({path:new URL('loading-mobile.png',out).pathname,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);await writeFile(new URL('result.json',out),JSON.stringify({pass:true,source:file?basename(file):'generated 82.5-second MIDI',results,errors},null,2));
 await context.close();console.log('PASS long MIDI import: visible file/stage/progress, real completion, measured output, decoded names, Stop and mobile loading',results);
}finally{await browser.close();}
