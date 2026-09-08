import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { compositionServer } from './test/composition-server.mjs';
const server = await compositionServer();
const browser = await chromium.launch({headless:true});
try {
  const out='../../.artifacts/session'; await mkdir(out,{recursive:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  let checks=0;
  const identity={revision:'',userId:'fixture-user',email:'listener@example.test',profile:{id:'fixture-artist',displayName:'Listener',handle:null,avatar:null},songs:[],count:0};
  for(const path of ['/api/me','/api/auth/session']) await page.route('**'+path,async route=>{
    checks++;
    await new Promise(resolve=>setTimeout(resolve,150));
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(identity)});
  });
  await page.goto(server.base+'/create?compose=1#prompt');
  await page.locator('header').getByRole('link',{name:'Your library',exact:true}).waitFor();
  await page.getByRole('button',{name:'Generate music',exact:true}).waitFor();
  assert.equal(checks,1,'mounting the header, composer and account makes one shared identity request');
  const account=page.locator('header').getByRole('link',{name:'Your library',exact:true});
  assert.equal(await account.textContent(),'','the account entry is an avatar, not a text label');
  assert.equal(await account.locator('svg').count(),1);
  const portrait=await account.locator('svg').innerHTML();
  for(const label of ['Explore','API','Create']) {
    await page.locator('header').getByRole('link',{name:label,exact:true}).click();
    await page.waitForURL(server.base + { Explore: '/explore', API: '/docs', Create: '/create' }[label]);
    await page.locator('header a[aria-current=page]').filter({hasText:label}).waitFor();
    await account.locator('svg').waitFor();
    assert.equal(await account.locator('svg').innerHTML(),portrait);
  }
  await page.reload();
  await account.locator('svg').waitFor();
  await page.evaluate(()=>{for(let i=0;i<5;i++){window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));}});
  assert.equal(checks,1,'navigation, reload and focus bursts reuse the fresh session without network checks');
  await page.locator('header').screenshot({path:out+'/header-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await account.isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const box=await account.boundingBox();assert.ok(box.width>=44&&box.height>=44);
  await page.locator('header').screenshot({path:out+'/header-mobile.png'});
  await page.getByLabel('Language',{exact:true}).selectOption('ja');
  await page.locator('header').getByRole('link',{name:'ライブラリ',exact:true}).waitFor();
  await page.locator('header').screenshot({path:out+'/header-japanese.png'});
  assert.equal(checks,1);
  console.log('PASS shared session: one cold request; zero navigation/reload/focus requests; consistent avatar, keyboard label and 44px mobile target in EN/JA');
} finally {await browser.close();await server.close();}
