import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const artifacts=resolve('../../.artifacts/demo'); await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1280,height:1000},recordVideo:{dir:`${artifacts}/videos`,size:{width:1280,height:1000}}});
const page=await context.newPage(), errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker {constructor(...args){super(...args);window.exportWorker=this;}};
  const access = new EventTarget(), port = new EventTarget();
  Object.assign(port,{id:'test-midi',name:'Test MIDI keyboard',state:'connected',open:async()=>port,close:async()=>{window.midiClosed=(window.midiClosed||0)+1;return port;}});
  access.inputs=new Map([[port.id,port]]);
  window.midiRequests=0;
  window.midiNote=data=>{const event=new Event('midimessage');event.data=new Uint8Array(data);port.dispatchEvent(event);};
  Object.defineProperty(navigator,'requestMIDIAccess',{value:async options=>{if(options.sysex!==false)throw new Error('SysEx must stay disabled');window.midiRequests++;return access;}});
});
try {
  await page.goto(process.env.SITE);
  await page.getByRole('button',{name:'View code',exact:false}).click();
  await page.getByRole('button',{name:'Score JSON',exact:true}).click();
  const score=()=>page.locator('.code-panel pre').textContent().then(JSON.parse);
  const original=await score();
  assert.equal(await page.evaluate(()=>window.midiRequests),0);
  await page.getByRole('button',{name:'Vary timbres',exact:false}).click();
  const varied=await score(); assert.notDeepEqual(varied,original);
  for(const role of ['bass','chord']) {assert.equal(varied.intent?.[role],original.intent?.[role]); for(let i=0;i<original.patterns.length;i++)assert.equal(varied.patterns[i][role],original.patterns[i][role]);}
  await page.getByRole('button',{name:'Undo',exact:true}).click();assert.deepEqual(await score(),original);
  await page.getByRole('button',{name:'Connect MIDI',exact:true}).click();
  await page.getByLabel('MIDI input',{exact:true}).selectOption('test-midi');
  assert.equal(await page.evaluate(()=>window.midiRequests),1);
  await page.getByRole('button',{name:'Record notes',exact:true}).click();
  await page.waitForFunction(()=>window.chipvoice?.position() && document.querySelector('.record-button').getAttribute('aria-pressed')==='true');
  assert.ok(await page.getByRole('button',{name:'Vary melody',exact:false}).isDisabled());
  await page.evaluate(()=>{window.midiNote([0x90,61,100]);window.midiNote([0x99,38,100]);window.midiNote([0x90,61,0]);window.midiNote([0x80,61,0]);});
  await page.waitForFunction(()=>document.querySelector('.take-status').textContent.includes('2 taps captured'));
  assert.notDeepEqual(await score(),original);
  await page.getByRole('button',{name:'Disconnect MIDI',exact:true}).click();
  await page.evaluate(()=>window.midiNote([0x90,70,100]));
  assert.ok((await page.locator('.take-status').textContent()).includes('2 taps captured'));
  assert.equal(await page.evaluate(()=>window.midiClosed),1);
  await page.getByRole('button',{name:'Finish take',exact:true}).click();
  await page.getByRole('button',{name:'Undo',exact:true}).click();assert.deepEqual(await score(),original);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  // Cancel an expensive export, then successfully start a different one.
  await page.getByRole('button',{name:'Download five machines ZIP',exact:true}).click();
  await page.evaluate(()=>{const callback=window.exportWorker.onerror;window.delayedExportError=()=>callback(new Event('error'));});
  await page.getByRole('button',{name:'Cancel export',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Download WAV',exact:true}).isDisabled(),false);
  for(const [name,extension,signature] of [['Download stems ZIP','zip','PK'],['Download VGM','vgm','Vgm ']]) {
    const pending=page.waitForEvent('download',{timeout:120000}); await page.getByRole('button',{name,exact:true}).click();
    await page.evaluate(()=>window.delayedExportError());
    assert.equal((await page.locator('.notice').textContent()).includes('export failed'),false,'a cancelled worker cannot fail a later export');
    const download=await pending, file=`${artifacts}/creative-export.${extension}`;await download.saveAs(file);
    assert.ok((await readFile(file)).subarray(0,signature.length).equals(Buffer.from(signature)));
  }
  await page.screenshot({path:`${artifacts}/creative-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Share your tune',exact:false}).click();
  await page.locator('.account-panel summary').click();
  await page.getByRole('button',{name:'Send sign-in link',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.waitForFunction(()=>!document.querySelector('.notice').textContent);
  await page.locator('.account-panel').screenshot({path:`${artifacts}/creative-account.png`});
  await page.screenshot({path:`${artifacts}/creative-mobile.png`,fullPage:true});
  assert.deepEqual(errors,[]);
  await writeFile(`${artifacts}/creative-report.json`,JSON.stringify({passed:['role locks and Undo','MIDI opt-in and note-on/drum recording','MIDI disconnect cleanup','export cancel/restart','real ZIP and VGM downloads','mobile layout and account discovery'],errors},null,2));
  console.log('PASS creative browser: variations, MIDI recording, cancel/restart, ZIP/VGM downloads, responsive account UI');
} catch(error) {await page.screenshot({path:`${artifacts}/creative-failure.png`,fullPage:true}).catch(()=>{});throw error;}
finally {const video=page.video();await context.close();await video.saveAs(`${artifacts}/creative.webm`);await browser.close();}
