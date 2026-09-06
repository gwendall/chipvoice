import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@libsql/client';
const base = process.env.API_URL;
const url = process.env.TURSO_DEV_DATABASE_URL;
if (!base?.startsWith('http://127.0.0.1:') || !url?.startsWith('file:') || !url.includes('chipvoice-web-')) throw new Error('Only the disposable test-local server/database may run this test.');
const db = createClient({url});
const hash = value=>createHash('sha256').update(value).digest('hex');
const token = randomBytes(24).toString('hex'), key = 'cv_live_'+randomBytes(24).toString('hex');
const userId='httpuser', keyId='httpkey1', now=Date.now();
try {
  await db.batch([
    {sql:'insert into users values (?,?,?)',args:[userId,'browser@example.test',now]},
    {sql:'insert into keys (id,user_id,hash,email,created_at) values (?,?,?,?,?)',args:[keyId,userId,hash(key),'browser@example.test',now]},
    {sql:'insert into login_tokens (hash,user_id,created_at) values (?,?,?)',args:[hash(token),userId,now]},
  ],'write');
  const redeemed = await fetch(`${base}/api/auth/redeem?token=${token}`,{redirect:'manual'});
  assert.equal(redeemed.status,302); assert.equal(redeemed.headers.get('location'),'/');
  const setCookie=redeemed.headers.get('set-cookie'); assert.match(setCookie,/HttpOnly/i); assert.match(setCookie,/SameSite=lax/i);
  assert.equal(redeemed.headers.get('cache-control'),'no-store');
  let cookie=setCookie.split(';')[0];
  assert.equal((await fetch(`${base}/api/auth/redeem?token=${token}`,{redirect:'manual'})).headers.get('set-cookie'),null);
  const me=await fetch(`${base}/api/me`,{headers:{cookie}}); assert.equal(me.status,200); assert.equal((await me.json()).email,'browser@example.test');
  const score={title:'Owned tune',chip:'2a03',bpm:144,order:[0],patterns:[{lead:'C4 . . .',chord:'C3 . . .',bass:'C2 . . .',perc:'K . H .',chordShape:[[0,4,7]]}]};
  const publish=await fetch(`${base}/api/songs`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(score)});
  assert.equal(publish.status,201); const song=await publish.json(); assert.equal(song.authorVerified,true); assert.equal(song.keyId,null); assert.equal('userId' in song,false);
  assert.equal((await (await fetch(`${base}/api/me`,{headers:{authorization:`Bearer ${key}`}})).json()).songs[0].id,song.id);
  const audioURL=`${base}/api/audio/${song.id}/wav?seconds=1`;
  const wav=await fetch(audioURL); assert.equal(wav.status,200); await wav.arrayBuffer();
  const cached=await fetch(audioURL,{headers:{'if-none-match':`W/${wav.headers.get('etag')}`}}); assert.equal(cached.status,304); assert.equal((await cached.arrayBuffer()).byteLength,0);
  for (const seconds of ['0','31','1.5','NaN']) assert.equal((await fetch(`${base}/api/audio/${song.id}/wav?seconds=${seconds}`)).status,400);
  assert.equal((await fetch(`${base}/api/songs/${song.id}`,{method:'DELETE',headers:{cookie,origin:'https://evil.test'}})).status,403);
  const longLine='C4 '+'. '.repeat(2200);
  await db.execute({sql:'insert into songs (id,bpm,patterns,song_order,created_at) values (?,?,?,?,?)',args:['longsong',144,JSON.stringify([{lead:longLine,bass:longLine,chord:longLine,perc:'K '+'. '.repeat(2200),chordShape:Array.from({length:257},()=>[0,4,7])}]),'[0]',Date.now()]});
  assert.equal((await fetch(`${base}/s/longsong`)).status,200,'pre-cap publication still opens in the demo');
  const artifacts=resolve('../../.artifacts/demo');await mkdir(artifacts,{recursive:true});
  const browser=await chromium.launch();
  try {
    const context=await browser.newContext();
    await context.addCookies([{name:'chipvoice_session',value:cookie.slice(cookie.indexOf('=')+1),url:base,httpOnly:true,sameSite:'Lax'}]);
    const page=await context.newPage();await page.goto(base+'/?mode=compose');
    await page.getByRole('button',{name:'Share your tune',exact:false}).click();
    await page.locator('.account-panel summary').click();
    await page.getByText('Signed in as browser@example.test.',{exact:false}).waitFor();
    await page.getByRole('link',{name:'Owned tune',exact:false}).waitFor();
    await page.getByRole('button',{name:'Revoke httpkey1',exact:true}).click();
    await page.getByText('API key revoked. Your songs are still yours.',{exact:true}).waitFor();
    await page.locator('.account-panel').screenshot({path:`${artifacts}/account-signed-in.png`});
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByRole('button',{name:'Send sign-in link',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>!!window.chipvoice),false,'account tools do not start audio');
    await page.goto(`${base}/s/longsong`);
    await page.getByRole('button',{name:'Share your tune',exact:false}).click();
    await page.getByRole('textbox',{name:'Song title',exact:true}).fill('Legacy title edit');
    const forking=page.waitForResponse(response=>response.url().endsWith('/api/songs/longsong/fork') && response.request().method()==='POST');
    await page.getByRole('button',{name:'Publish a fork',exact:true}).click();
    const forked=await forking;assert.equal(forked.status(),201);
    assert.equal('patterns' in forked.request().postDataJSON(),false,'studio sends only changed fields');
    const fork=await forked.json();assert.equal(fork.title,'Legacy title edit');assert.equal(fork.patterns[0].lead,longLine);assert.equal(fork.patterns[0].chordShape.length,257);
    const cleared=await fetch(`${base}/api/songs/${fork.id}/fork`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:null})});
    assert.equal(cleared.status,201);assert.equal((await cleared.json()).title,null);
    await context.close();
  } finally {await browser.close();}
  // The first browser session was revoked by the UI; a fresh session retains ownership.
  const nextToken=randomBytes(24).toString('hex');
  await db.execute({sql:'insert into login_tokens (hash,user_id,created_at) values (?,?,?)',args:[hash(nextToken),userId,Date.now()]});
  const nextLogin=await fetch(`${base}/api/auth/redeem?token=${nextToken}`,{redirect:'manual'});
  cookie=nextLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${base}/api/me`,{headers:{authorization:`Bearer ${key}`}})).status,401);
  assert.equal((await fetch(`${base}/api/songs/${song.id}`,{method:'DELETE',headers:{cookie}})).status,200);
  assert.equal((await fetch(audioURL)).status,404,'cached bytes never resurrect a deleted publication');
  const logout=await fetch(`${base}/api/auth/session`,{method:'DELETE',headers:{cookie}}); assert.equal(logout.status,200); assert.match(logout.headers.get('set-cookie'),/Max-Age=0/i);
  assert.equal((await fetch(`${base}/api/me`,{headers:{cookie}})).status,401);
  console.log('PASS HTTP session cookies, account ownership, key revocation, conditional audio GET, limits and deletion');
} finally {db.close();}
