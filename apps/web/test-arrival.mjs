import assert from 'node:assert/strict';
import {chromium, webkit} from 'playwright';
import {mkdir, writeFile} from 'node:fs/promises';
import {installOutputProbe, outputRms} from './test/audio-probe.mjs';
const base = process.env.SITE ?? 'http://127.0.0.1:3074';
const engine = process.env.BROWSER ?? 'chromium';
const out = new URL(`../../.artifacts/japanese-playground/${engine}/`, import.meta.url);
await mkdir(out, {recursive:true});
const browser = await ({chromium, webkit}[engine]).launch();
const results = [], errors = [];
try {
  for (const gesture of ['tune', 'machine', 'play', 'keyboard', 'touch', 'tempo', 'mute']) {
    const context = await browser.newContext({viewport:{width:gesture === 'touch' ? 390 : 1280,height:gesture === 'touch' ? 844 : 1000},hasTouch:gesture === 'touch',recordVideo:{dir:new URL('videos/',out).pathname}});
    await context.addInitScript(installOutputProbe);
    const page = await context.newPage();page.on('pageerror',error => errors.push(error.message));
    await page.goto(base+'/?mode=compose');await page.waitForFunction(() => !document.getElementById('tempo-slider')?.disabled);
    assert.equal(await page.evaluate(() => !!window.audioBus || !!window.chipvoice), false, 'Passive arrival creates no audio');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('chipvoice.draft.v1')));
    assert.equal(saved.title, 'Mario · Ground Theme');
    assert.deepEqual(await page.locator('.machines button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))), ['Famicom','Game Boy','Mega Drive','Super Famicom']);
    assert.deepEqual(await page.locator('.machines button').allTextContents(), ['', '', '', ''], 'No captions beneath console logos');
    assert.ok(await page.locator('.machine-logo').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0 && getComputedStyle(image).maskImage === 'none')));
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(() => !!window.audioBus),false,'Tab navigation is silent');
    if (gesture === 'tune' || gesture === 'touch') await page.screenshot({path:new URL(`${gesture}-initial.png`,out).pathname,fullPage:true});
    if (gesture === 'tune') await page.getByRole('button',{name:'Load Zelda · Overworld',exact:true}).click();
    if (gesture === 'machine') await page.getByRole('button',{name:'Super Famicom',exact:true}).click();
    if (gesture === 'play') await page.getByRole('button',{name:'Play',exact:true}).click();
    if (gesture === 'keyboard') {await page.getByRole('button',{name:'Load Sonic · Green Hill Zone',exact:true}).focus();await page.keyboard.press('Enter');}
    if (gesture === 'touch') await page.getByRole('button',{name:'Game Boy',exact:true}).tap();
    if (gesture === 'tempo') await page.getByRole('spinbutton',{name:'Tempo',exact:true}).fill('183');
    if (gesture === 'mute') await page.getByRole('button',{name:'Mute Melody',exact:true}).click();
    const chip = gesture === 'machine' ? 'snes' : gesture === 'touch' ? 'dmg' : '2a03';
    await page.waitForFunction(id => window.chipvoice?.playing && window.chipvoice.spec.id === id && window.chipvoice.position(), chip);
    const selected = await page.evaluate(() => JSON.parse(localStorage.getItem('chipvoice.draft.v1')));
    assert.equal(selected.title,gesture === 'tune' ? 'Zelda · Overworld' : gesture === 'keyboard' ? 'Sonic · Green Hill Zone' : saved.title);
    if(gesture === 'mute') {assert.ok(await outputRms(page)<.00001,'The first gesture honours mute before starting');await page.getByRole('button',{name:'Mute Melody',exact:true}).click();}
    if(gesture === 'tempo') assert.equal(selected.bpm,183);
    let rms = 0;for(let i=0;i<8&&rms<.0001;i++){rms = await outputRms(page);if(rms<.0001)await page.waitForTimeout(150);}
    assert.ok(rms > .0001,`${gesture} must start audible output`);
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await page.getByRole('button',{name:'Mega Drive',exact:true}).click();
    await page.getByRole('button',{name:'Load Mario · Ground Theme',exact:true}).click();
    await page.getByRole('slider',{name:'Tempo slider',exact:true}).focus();await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.chipvoice?.spec.id === 'md' && !window.chipvoice.playing);
    await page.waitForTimeout(200);assert.ok(await outputRms(page)<.00001,'Stop persists across tunes, consoles and tempo');
    assert.equal(await page.getByRole('button',{name:'Play',exact:true}).count(),1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if(gesture === 'touch') await page.screenshot({path:new URL('touch-stopped.png',out).pathname,fullPage:true});
    await context.close();results.push({gesture,chip,rms,stopRetained:true});
  }
  // Old C64 drafts are valid documents, even while the public picker hides SID.
  const context = await browser.newContext();const page = await context.newPage();
  await page.goto(base+'/?mode=compose');await page.waitForFunction(() => !!localStorage.getItem('chipvoice.draft.v1'));
  await page.evaluate(() => {const song=JSON.parse(localStorage.getItem('chipvoice.draft.v1'));song.chip='c64';song.title='My SID draft';localStorage.setItem('chipvoice.draft.v1',JSON.stringify(song));});
  await page.reload();await page.getByRole('heading',{name:'My SID draft',exact:true}).waitFor();
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(() => window.chipvoice?.spec.id==='c64'&&window.chipvoice.playing);
  await page.getByRole('link',{name:'How it works',exact:false}).click();await page.getByRole('heading',{name:'A tiny orchestra. Made of code.',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Super Famicom',exact:true}).count(),1);
  await page.screenshot({path:new URL('about.png',out).pathname,fullPage:true});await context.close();
  assert.deepEqual(errors,[]);await writeFile(new URL('result.json',out),JSON.stringify({pass:true,results,c64Draft:true,errors},null,2));
  console.log(`PASS ${engine}: familiar default, Japanese logos, seven first-gesture paths, audible output, persistent Stop, C64 draft and About`);
} finally {await browser.close();}
