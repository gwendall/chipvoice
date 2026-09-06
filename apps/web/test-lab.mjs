import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.SITE??'http://127.0.0.1:3070',out=new URL('../../.artifacts/lab/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},recordVideo:{dir:new URL('videos/',out).pathname}});
 const page=await context.newPage(),errors=[],downloads=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.url().endsWith('.flac'))downloads.push(request.url());});
 await page.goto(base+'/lab');await page.getByRole('heading',{name:'Same notes. Different machines.'}).waitFor();await page.getByLabel('Composition',{exact:true}).waitFor();
 assert.equal(downloads.length,0,'Opening the lab must not download audio');
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.getByRole('button',{name:'Listen to B',exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('[aria-label="Listen to B"]').disabled);
 await page.getByRole('button',{name:'Listen to B',exact:true}).click();
 await page.getByRole('button',{name:'Hide & shuffle',exact:true}).click();assert.equal(await page.locator('table').count(),0);
 await page.getByLabel('Listening notes',{exact:true}).fill('QA: lossless audio and uninterrupted selection.');await page.getByRole('button',{name:'Save note',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download notes (1)',exact:true}).click();await(await download).saveAs(new URL('notes.json',out).pathname);
 await page.getByRole('button',{name:'Reveal identities',exact:true}).click();
 await page.screenshot({path:new URL('desktop.png',out).pathname,fullPage:true});
 for(const name of ['NES','Game Boy','Mega Drive','SNES','C64']){
  await page.locator('.machines').getByRole('button',{name,exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="Listen to A"]').disabled);
  assert.equal(await page.getByRole('button',{name:'Stop',exact:true}).count(),1,`Play retained for ${name}`);
 }
 await page.getByLabel('Part',{exact:true}).selectOption('bass');await page.getByLabel('Composition',{exact:true}).selectOption('boss');
 await page.waitForFunction(()=>!document.querySelector('[aria-label="Listen to A"]').disabled);
 assert.equal(await page.getByRole('button',{name:'Stop',exact:true}).count(),1);
 // Delay a real new recording load, then stop while it is pending.
 await page.route('**/*.flac',async route=>{await new Promise(resolve=>setTimeout(resolve,250));await route.continue();});
 await page.getByLabel('Part',{exact:true}).selectOption('chord');await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForTimeout(600);
 assert.equal(await page.getByRole('button',{name:'Play',exact:true}).count(),1,'Stop wins over pending recording load');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:new URL('mobile.png',out).pathname,fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);
 await writeFile(new URL('result.json',out),JSON.stringify({pass:true,errors,losslessRequests:downloads.length,checks:['lazy audio','all five consoles','play intent','A/B','blind/reveal','notes export','part/preset changes','stop during load','mobile overflow']},null,2));
 await context.close();console.log('PASS public lab lazy audio, continuous selection, A/B, notes, stop during load and responsive screenshots');
}finally{await browser.close();}
