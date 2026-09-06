import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {installOutputProbe,outputRms} from './test/audio-probe.mjs';
const base=process.env.SITE??'http://127.0.0.1:3070',out=new URL('../../.artifacts/composition/',import.meta.url);
await mkdir(out,{recursive:true});const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},recordVideo:{dir:new URL('videos/',out).pathname}});
 await context.addInitScript(installOutputProbe);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>!document.getElementById('tempo-slider')?.disabled);
 const number=name=>page.getByRole('spinbutton',{name,exact:true});
 const valueIs=async(name,value)=>page.waitForFunction(({name,value})=>document.querySelector(`input[type=number][aria-label="${name}"]`)?.value===value,{name,value});
 const draft=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('chipvoice.draft.v1')));
 await page.locator('.original-tunes summary').click();await page.getByRole('button',{name:'Load Overworld',exact:true}).click();
 const original=await draft();
 await number('Transpose').fill('7');await number('Transpose').press('Enter');await valueIs('Transpose','7');
 assert.equal((await draft()).patterns[0].lead.split(' ')[0],'B5');
 await number('Drum activity').fill('0');await number('Drum activity').press('Enter');await valueIs('Drum activity','0');
 assert.ok((await draft()).patterns.every(p=>p.perc.split(' ').every(t=>t==='.'||t==='=')));
 await page.getByRole('button',{name:'Undo',exact:true}).click();await valueIs('Drum activity','100');await valueIs('Transpose','7');
 await page.getByRole('button',{name:'Reset feel',exact:true}).click();await valueIs('Transpose','0');assert.deepEqual((await draft()).patterns,original.patterns);
 const results=[];const chips=[['Famicom','2a03'],['Game Boy','dmg'],['Mega Drive','md'],['Super Famicom','snes']];
 for(const title of ['Mario · Ground Theme','Zelda · Overworld','Sonic · Green Hill Zone']){
  const before=await page.evaluate(()=>window.chipvoice?.songId??null);
  await page.getByRole('button',{name:`Load ${title}`,exact:true}).click();
  if(!await page.getByRole('button',{name:'Stop',exact:true}).count())await page.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(id=>window.chipvoice?.playing&&window.chipvoice.songId!==id,before);
  for(const [label,id] of chips){
   await page.locator('.machines').getByRole('button',{name:label,exact:true}).click();
   await page.waitForFunction(id=>window.chipvoice?.playing&&window.chipvoice.spec.id===id,id);
   // Some phrases open with a written rest; measure after their first phrase.
   await page.waitForTimeout(title.startsWith('Sonic')?1000:150);
   let rms=0;for(let attempt=0;attempt<5&&rms<.0001;attempt++){rms=await outputRms(page);if(rms<.0001)await page.waitForTimeout(150);}
   assert.ok(rms>.0001,`${title}/${id} must produce audible output`);results.push({title,chip:id,rms});
  }
 }
 await page.getByText('About this arrangement · credits & source',{exact:true}).click();
 assert.ok(await page.getByRole('link',{name:'View the source transcription ↗'}).getAttribute('href'));
 await number('Transpose').fill('3');await number('Transpose').press('Enter');
 assert.ok(await number('Drum activity').isDisabled());await page.getByText('Edited version · source checks apply to the original cartridge.',{exact:true}).waitFor();await page.waitForTimeout(350);
 assert.equal(await page.getByRole('button',{name:'Stop',exact:true}).count(),1);
 const edited=await draft();await page.screenshot({path:new URL('desktop.png',out).pathname,fullPage:true});
 await page.reload();await page.waitForFunction(()=>!document.getElementById('tempo-slider')?.disabled);assert.deepEqual((await draft()).patterns,edited.patterns);assert.equal(await page.getByRole('button',{name:'Play',exact:true}).count(),1);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:new URL('mobile.png',out).pathname,fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.goto(base+'/lab');await page.getByLabel('Composition',{exact:true}).selectOption('sonic');
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.getByText('Playing continuously · levels matched for comparison.',{exact:true}).waitFor({timeout:60000});let labRms=0;for(let i=0;i<8&&labRms<.0001;i++){labRms=await outputRms(page);if(labRms<.0001)await page.waitForTimeout(150);}assert.ok(labRms>.0001);
 for(const id of ['mario','zelda','sonic']){await page.getByLabel('Composition',{exact:true}).selectOption(id);await page.waitForTimeout(350);assert.equal(await page.getByRole('button',{name:'Stop',exact:true}).count(),1);}
 await page.getByLabel('Composition',{exact:true}).selectOption('zelda');
 await page.getByRole('heading',{name:'Zelda · Overworld',exact:true}).waitFor();
 await page.getByText('About this arrangement · credits & source',{exact:true}).click();
 await page.getByText('128 source notes checked · melody only · no added backing parts',{exact:true}).waitFor();
 assert.equal(await page.locator('.lab-loop').textContent(),'38.92 SEC LOOP');
 assert.deepEqual(await page.getByLabel('Part',{exact:true}).locator('option').evaluateAll(options=>options.map(option=>option.value)),['mix','lead']);
 await page.screenshot({path:new URL('lab-zelda-mobile.png',out).pathname,fullPage:true});
 await page.setViewportSize({width:1280,height:1000});
 await page.screenshot({path:new URL('lab-zelda-desktop.png',out).pathname,fullPage:true});
 assert.deepEqual(errors,[]);await context.close();
 await writeFile(new URL('result.json',out),JSON.stringify({pass:true,results,errors},null,2));console.log('PASS composition controls, Undo/reset, persisted notes, 12 public classic adaptations, public lab and responsive layouts');
}finally{await browser.close();}
