import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {installOutputProbe,outputRms} from './test/audio-probe.mjs';
const base=process.env.SITE??'http://127.0.0.1:3074';
if(!base.startsWith('http://127.0.0.1:'))throw Error('This test publishes only into a local disposable database.');
const out=new URL('../../.artifacts/i18n/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch(),errors=[],checks=[];
const ready=page=>page.waitForFunction(()=>!!document.querySelector('.arrangement-versions a')&&!document.querySelector('.arrangement-versions button')?.disabled,{},{timeout:120000});
const context=await browser.newContext({viewport:{width:1280,height:1000},recordVideo:{dir:new URL('video/',out).pathname}});
await context.addInitScript(installOutputProbe);
await context.addInitScript(()=>{const create=AudioContext.prototype.createBufferSource;window.sourceStarts=0;AudioContext.prototype.createBufferSource=function(){const source=create.call(this),start=source.start.bind(source);source.start=(...args)=>{window.sourceStarts++;window.activeSource=source;return start(...args);};return source;};});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
try{
 for(const path of ['/','/about','/lab','/lab/components'])assert.equal((await fetch(base+path,{redirect:'manual'})).status,200,`English canonical ${path}`);
 const canonicalRedirect=await fetch(base+'/en/about',{redirect:'manual'});assert.equal(canonicalRedirect.status,307);assert.equal(new URL(canonicalRedirect.headers.get('location'),base).pathname,'/about');
 // Raw HTML, not just post-hydration text: crawlers receive Japanese metadata.
 for(const [path,title]of [['','懐かしいゲーム機'],['/about','chipvoice について'],['/lab','試聴ラボ'],['/lab/components','共通コンポーネント']]){
  const response=await fetch(base+'/ja'+path);assert.equal(response.status,200);const html=await response.text();assert.match(html,/<html lang="ja"/);assert.ok(html.includes(title));assert.ok(html.includes('ja_JP'));assert.ok(html.includes('hrefLang="ja"'));checks.push(`Japanese SSR ${path||'/'}`);
 }
 await page.goto(base+'/?source=language-test');await page.getByRole('button',{name:'Play',exact:true}).click();await ready(page);
 let beforeRms=0;for(let i=0;i<30&&beforeRms<.001;i++)beforeRms=Math.max(beforeRms,await outputRms(page));checks.push({beforeRms});assert.ok(beforeRms>.001,'audio must be audible before changing language');
 const starts=await page.evaluate(()=>window.sourceStarts);const before=Number(await page.locator('.song-seek').inputValue());
 await page.getByLabel('Language',{exact:true}).selectOption('ja');await page.getByRole('button',{name:'一時停止',exact:true}).waitFor();
 assert.equal(new URL(page.url()).pathname,'/ja');assert.equal(new URL(page.url()).search,'?source=language-test');
 assert.equal(await page.evaluate(()=>window.sourceStarts),starts,'changing language must not restart an AudioBufferSource');
 assert.ok(Number(await page.locator('.song-seek').inputValue())>=before,'playback position is retained');
 let rms=0;for(let i=0;i<12;i++)rms=Math.max(rms,await outputRms(page));assert.ok(rms>.001,'real measured audio continues');
 assert.match(await page.title(),/懐かしい/);assert.equal(await page.locator('meta[property="og:locale"]').getAttribute('content'),'ja_JP');
 assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'),'https://chipvoice.dev/ja');
 await page.goBack();await page.getByRole('button',{name:'Pause',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.sourceStarts),starts);
 await page.goForward();await page.getByRole('button',{name:'一時停止',exact:true}).waitFor();
 await page.getByRole('button',{name:'一時停止',exact:true}).click();checks.push({localeSwitchRms:rms,unchangedSourceStarts:starts});
 // Unmodified MIDI bytes and user-written track/title survive locale changes.
 const chunk=(name,data)=>{const h=Buffer.alloc(8);h.write(name);h.writeUInt32BE(data.length,4);return Buffer.concat([h,Buffer.from(data)]);};
 const midi=Buffer.concat([chunk('MThd',[0,0,0,1,1,224]),chunk('MTrk',[0,255,3,4,66,97,115,115,0,192,80,0,144,60,100,0x87,0x40,128,60,0,0,255,47,0])]);
 await page.getByLabel('MIDI を読み込む',{exact:true}).setInputFiles({name:'Play.mid',mimeType:'audio/midi',buffer:midi});await ready(page);
 await page.getByRole('heading',{name:'Play',exact:true}).waitFor();assert.equal(await page.locator('.arrangement-parts strong').first().textContent(),'Bass');
 await page.getByLabel('言語',{exact:true}).selectOption('en');await page.getByLabel('Language',{exact:true}).waitFor();
 assert.equal(await page.locator('.arrangement-parts strong').first().textContent(),'Bass');await page.getByRole('heading',{name:'Play',exact:true}).waitFor();checks.push('MIDI title/track and imported document preserved');
 await page.getByLabel('Language',{exact:true}).selectOption('ja');await page.getByLabel('言語',{exact:true}).waitFor();
 await page.getByLabel('MIDI を読み込む',{exact:true}).setInputFiles({name:'broken.mid',mimeType:'audio/midi',buffer:Buffer.from('invalid MIDI')});
 await page.getByRole('alert').filter({hasText:'MIDI ファイルを選んでください'}).waitFor();checks.push('Japanese MIDI failure and recovery action');
 // Draft hash and edits survive; schema/program identifiers remain canonical.
 await page.getByRole('button',{name:'ループを作る',exact:false}).click();await page.locator('.demo-page').waitFor();
 const studio=page.locator('.demo-page');await studio.getByRole('button',{name:'曲を共有',exact:false}).click();await studio.getByLabel('曲名',{exact:true}).fill('自分の曲');
 await studio.getByLabel('テンポ',{exact:true}).fill('177');await studio.getByLabel('テンポ',{exact:true}).press('Tab');
 await studio.getByRole('button',{name:'コードを見る',exact:false}).click();
 assert.match(await studio.locator('.code-panel pre').innerText(),/button.textContent = "再生 \/ 停止"/);
 await page.evaluate(()=>history.replaceState(null,'',location.pathname+location.search+'#preserved-fragment'));
 await page.getByLabel('言語',{exact:true}).selectOption('en');await studio.getByLabel('Song title',{exact:true}).waitFor();
 assert.equal(await studio.getByLabel('Song title',{exact:true}).inputValue(),'自分の曲');assert.equal(await studio.getByLabel('Tempo',{exact:true}).inputValue(),'177');assert.equal(new URL(page.url()).hash,'#preserved-fragment');assert.equal(new URL(page.url()).search,'?mode=compose');
 await studio.getByRole('button',{name:'Edit loop',exact:false}).click();await page.getByLabel('Language',{exact:true}).selectOption('ja');await studio.getByLabel('ループエディター').waitFor();
 await studio.getByRole('button',{name:'テキストで編集'}).click();await studio.locator('#raw-notes').fill('NOT_A_NOTE');await studio.getByRole('button',{name:'音符を適用'}).click();assert.ok(await studio.locator('.field-error').innerText());assert.doesNotMatch(await studio.locator('.field-error').innerText(),/not a note|not an object|tokens against/);
 await page.screenshot({path:new URL('composer-ja.png',out).pathname,fullPage:true});checks.push('Japanese composer, editable tempo, code sample, validation and unsaved state');
 // All route surfaces and their responsive geometry.
 for(const width of [320,390,768,1280])for(const path of ['/ja','/ja/about','/ja/lab','/ja/lab/components']){
  await page.setViewportSize({width,height:900});await page.goto(base+path);await page.getByLabel('言語',{exact:true}).waitFor();
  if(path==='/ja/lab')await page.getByLabel('楽曲',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow ${path} at ${width}`);
  if(path==='/ja')for(const name of ['ゼルダ 4 パート','ソニック 14 パート','マリオ 4 パート']){await page.getByRole('button',{name}).click();await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  if(width===390||width===1280)await page.screenshot({path:new URL(`${path.split('/').filter(Boolean).join('-')}-${width}.png`,out).pathname,fullPage:true});
 }
 await page.goto(base+'/ja/missing-i18n-page');await page.getByText('このページは見つかりませんでした。',{exact:false}).waitFor();
 await page.goto(base+'/ja/about#credits');assert.equal(await page.locator('.site-header a[href="/ja/lab"]').count(),1);
 await page.getByLabel('言語',{exact:true}).selectOption('en');assert.equal(new URL(page.url()).hash,'#credits');assert.equal(new URL(page.url()).pathname,'/about');
 const sitemap=await (await fetch(base+'/sitemap.xml')).text();assert.match(sitemap,/https:\/\/chipvoice.dev\/ja\/about/);assert.match(sitemap,/hreflang="ja"/);
 // A real locally published Japanese song exercises SSR share tags and Satori.
 const song={title:'Midnight',chip:'dmg',bpm:144,order:[0],patterns:[{lead:'C4 . E4 .',chord:'C3 . . .',bass:'C2 . . .',perc:'K . H .',chordShape:[[0,4,7]]}]};
 const published=await fetch(base+'/api/songs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(song)});assert.equal(published.status,201);const {id}=await published.json();
 await page.goto(base+'/ja/s/'+id);await page.getByLabel('言語',{exact:true}).waitFor();await page.locator('.demo-page .screen-title h2').waitFor();assert.equal(await page.locator('.demo-page .screen-title h2').textContent(),'Midnight');assert.equal(await page.title(),song.title);assert.match(await page.locator('meta[name="description"]').getAttribute('content'),/ゲームボーイ/);assert.match(await page.locator('meta[property="og:image"]').getAttribute('content'),new RegExp(`/ja/s/${id}/card`));
 const card=await fetch(base+`/ja/s/${id}/card`);assert.equal(card.status,200);assert.match(card.headers.get('content-type'),/image\/png/);await writeFile(new URL('share-ja.png',out),Buffer.from(await card.arrayBuffer()));
 assert.match((await fetch(base+'/api/auth/redeem?locale=ja&token=invalid',{redirect:'manual'})).headers.get('location'),/^\/ja\?signin=expired$/);
 const failureContext=await browser.newContext();const failurePage=await failureContext.newPage();
 await failurePage.addInitScript(()=>{window.starts=0;const create=AudioContext.prototype.createBufferSource;AudioContext.prototype.createBufferSource=function(){const s=create.call(this),start=s.start.bind(s);s.start=(...args)=>{window.starts++;return start(...args);};return s;};});
 await failurePage.goto(base);await failurePage.getByLabel('Import MIDI',{exact:true}).setInputFiles({name:'Play.mid',mimeType:'audio/midi',buffer:midi});await ready(failurePage);await failurePage.getByRole('heading',{name:'Play',exact:true}).waitFor();
 const beforeFailure=await failurePage.evaluate(()=>window.starts);
 await failurePage.route('**/_next/static/chunks/*.js',route=>route.abort());await failurePage.getByLabel('Language',{exact:true}).selectOption('ja');
 await failurePage.getByRole('alert').filter({hasText:'Language could not load'}).waitFor();assert.equal(await failurePage.evaluate(()=>window.starts),beforeFailure);await failurePage.getByRole('heading',{name:'Play',exact:true}).waitFor();assert.equal(new URL(failurePage.url()).pathname,'/');assert.equal(await failurePage.locator('.arrangement-parts strong').first().textContent(),'Bass');
 await failureContext.close();checks.push('Failed language download preserves imported MIDI, audio source and URL');
 assert.deepEqual(errors,[]);await writeFile(new URL('result.json',out),JSON.stringify({pass:true,checks,errors},null,2));console.log('PASS Japanese SSR/metadata, language continuity, MIDI, composer, mobile pages, sharing/card and auth locale',checks);
}catch(error){await writeFile(new URL('failure.json',out),JSON.stringify({checks,state:await page.evaluate(()=>({url:location.href,play:document.querySelector('.play-button')?.textContent,starts:window.sourceStarts,context:window.audioBus?.context.state,time:window.audioBus?.context.currentTime,position:document.querySelector('.song-seek')?.value,duration:window.activeSource?.buffer?.duration,gain:window.audioBus?.gain.value,visible:document.visibilityState,stamp:window.audioBus?.context.getOutputTimestamp()})).catch(()=>null)},null,2));await page.screenshot({path:new URL('failure.png',out).pathname,fullPage:true}).catch(()=>{});throw error;}
finally{await context.close();await browser.close();}
