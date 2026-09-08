import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {installOutputProbe,outputPhraseRms} from './test/audio-probe.mjs';
const base=process.env.URL??'http://127.0.0.1:3010', out=resolve('../../.artifacts/player');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
page.setDefaultTimeout(90000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(installOutputProbe);
await page.addInitScript(()=>{
 const Native=window.AudioContext;window.audioContexts=[];
 window.AudioContext=class extends Native {constructor(...args){super(...args);window.audioContexts.push(this);}};
});
const button=(name)=>page.getByRole('button',{name,exact:true});
const dock=()=>page.getByRole('complementary',{name:'Now playing'});
const evidence=[];
// Public-list fixtures isolate UI tests from a real account and never publish
// fake songs. The browser still fetches, decodes and plays an actual WAV.
const profile={id:'testartist',handle:'player-eval',displayName:'Player evaluation',avatar:{palette:1,variant:1},kind:'human',bio:'',url:null};
const items=['first001','second02'].map((id,i)=>({id,title:`Player fixture ${i+1}`,profile,chip:'2a03',origin:{method:'direct',model:null},visibility:'public',tags:[],favourites:0,favourited:false,owned:false,renditions:[{id:`job-${id}`,kind:'full',status:'ready',mp3Bytes:0}]}));
const wav=Buffer.alloc(44+48000*16);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<384000;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/48000)*3000),44+i*2);
try {
 await page.goto(base);await button('Play').click();
 await page.waitForFunction(()=>Number(document.querySelector('.persistent-player input[type=range]')?.value)>1,null,{timeout:90000});
 const before=await page.evaluate(()=>window.audioContexts.map(c=>({state:c.state,time:c.currentTime})));
 await page.screenshot({path:resolve(out,'playground-desktop.png'),fullPage:true});
 await page.locator('header').getByRole('link',{name:'Explore',exact:true}).click();await page.waitForURL('**/explore');
 await page.waitForTimeout(500);
 const after=await page.evaluate(()=>window.audioContexts.map(c=>({state:c.state,time:c.currentTime})));
 assert.equal(after.length,before.length);assert.equal(after[0].state,'running');assert.ok(after[0].time>before[0].time);
 const rms=await outputPhraseRms(page);assert.ok(rms>.001,`navigation retains actual audio: ${rms}`);evidence.push({navigation:{before,after,rms}});
 await button('Pause playback').click();const stopped=Number(await dock().getByRole('slider',{name:'Playback position',exact:true}).inputValue());await page.waitForTimeout(300);
 assert.ok(Math.abs(Number(await dock().getByRole('slider',{name:'Playback position',exact:true}).inputValue())-stopped)<.06);
 await button('Back to beginning').click();await page.waitForFunction(()=>document.querySelector('.persistent-player output')?.textContent==='0:00');await button('Start playback').click();
 // Entering a workspace is passive. A new explicit start owns the output.
 await page.locator('header').getByRole('link',{name:'Create',exact:true}).click();await page.waitForURL('**/create');
 assert.ok(await button('Pause playback').isVisible());
 await button('Play').click();await page.waitForFunction(()=>document.querySelector('.persistent-player .player-identity a')?.getAttribute('href')?.startsWith('/create')&&!document.querySelector('.create-status')?.textContent.includes('Preparing'),null,{timeout:180000});
 await page.waitForFunction(()=>window.audioContexts[0].state==='closed');
 assert.equal(await page.evaluate(()=>window.audioContexts.filter(c=>c.state==='running').length),1,'one running owner after handoff');
 await page.waitForFunction(()=>!!document.querySelector('.piano-roll .now'));
 const column=await page.locator('.piano-roll .now').first().getAttribute('data-column');
 await page.waitForFunction(previous=>document.querySelector('.piano-roll .now')?.getAttribute('data-column')!==previous,column);
 evidence.push({composer:'piano-roll playhead advances independently'});
 await page.screenshot({path:resolve(out,'composer-desktop.png'),fullPage:true});
 await page.locator('header').getByRole('link',{name:'Explore',exact:true}).click();await page.waitForURL('**/explore');assert.ok(await button('Pause playback').isVisible());
 // Playback from a catalogue, with queue, author and revision-pinned media.
 await page.route('**/api/v1/projects?*',route=>route.fulfill({json:{items,nextCursor:null}}));
 await page.route('**/api/v1/projects/first001',route=>route.fulfill({json:items[0]}));
 await page.route('**/api/v1/projects/second02',route=>route.fulfill({json:items[1]}));
 await page.route('**/api/v1/jobs/job-*/audio',route=>route.fulfill({body:wav,contentType:'audio/wav'}));
 // Client navigation reloads the list without destroying the current player.
 await page.locator('header').getByRole('link',{name:'Create',exact:true}).click();await page.waitForURL('**/create');
 await page.locator('header').getByRole('link',{name:'Explore',exact:true}).click();await page.waitForURL('**/explore');
 await button('Play Player fixture 1').click();await dock().getByRole('link',{name:'Player fixture 1',exact:true}).waitFor();
 assert.match(await dock().textContent(),/Player evaluation/);
 await page.screenshot({path:resolve(out,'explore-playing.png'),fullPage:true});
 await dock().getByRole('link',{name:'Player fixture 2',exact:true}).waitFor({timeout:15000});
 evidence.push({queue:'natural completion advanced to second recording'});
 await button('Start playback').waitFor({timeout:15000});
 await dock().getByRole('link',{name:'Player fixture 2',exact:true}).click();await page.waitForURL('**/p/second02');
 await button('Play').click();await button('Pause').waitFor();await page.screenshot({path:resolve(out,'publication-desktop.png'),fullPage:true});
 for(const width of [320,390,768]){
   await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no horizontal overflow at ${width}`);
   await page.screenshot({path:resolve(out,`publication-${width}.png`),fullPage:true});
 }
 await page.setViewportSize({width:390,height:844});await button('Expand player').click();await page.screenshot({path:resolve(out,'player-expanded-mobile.png'),fullPage:true});
 assert.ok(await button('Next song').isVisible());
 await page.getByLabel('Language',{exact:true}).selectOption('ja');
 await page.screenshot({path:resolve(out,'player-japanese-mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByLabel('言語',{exact:true}).selectOption('en');
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('footer').getByRole('link',{name:'Listening lab',exact:true}).click();await page.waitForURL('**/lab');
 await page.getByLabel('Reference',{exact:true}).selectOption('native');await button('Play').click();
 await button('Hide & shuffle').click();await page.waitForFunction(()=>document.querySelector('.persistent-player')?.textContent.includes('Blind comparison'));
 assert.ok(!await dock().getByRole('link',{name:'Download current recording'}).count());
 await page.screenshot({path:resolve(out,'lab-blind-desktop.png'),fullPage:true});
 await page.locator('header').getByRole('link',{name:'Explore',exact:true}).click();await page.waitForURL('**/explore');
 assert.match(await dock().textContent(),/Blind comparison/);assert.ok(!await button('Next song').count());
 evidence.push({comparison:'masked across navigation, queue cleared'});
 assert.deepEqual(errors,[]);await writeFile(resolve(out,'evidence.json'),JSON.stringify(evidence,null,2));
 console.log('PASS persistent browser player: real audio navigation, pause/restart, passive editor entry, ownership, published files, queue, attribution, desktop/mobile/JA');
} catch(error) {await page.screenshot({path:resolve(out,'failure.png'),fullPage:true});await writeFile(resolve(out,'failure.json'),JSON.stringify({message:error.message,errors,url:page.url()},null,2));throw error;}
finally {await context.close();await browser.close();}
