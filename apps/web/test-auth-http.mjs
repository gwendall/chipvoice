import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
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
  const cookie=setCookie.split(';')[0];
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
  assert.equal((await fetch(`${base}/api/keys/${keyId}`,{method:'DELETE',headers:{cookie}})).status,200);
  assert.equal((await fetch(`${base}/api/me`,{headers:{authorization:`Bearer ${key}`}})).status,401);
  assert.equal((await fetch(`${base}/api/songs/${song.id}`,{method:'DELETE',headers:{cookie}})).status,200);
  assert.equal((await fetch(audioURL)).status,404,'cached bytes never resurrect a deleted publication');
  const logout=await fetch(`${base}/api/auth/session`,{method:'DELETE',headers:{cookie}}); assert.equal(logout.status,200); assert.match(logout.headers.get('set-cookie'),/Max-Age=0/i);
  assert.equal((await fetch(`${base}/api/me`,{headers:{cookie}})).status,401);
  console.log('PASS HTTP session cookies, account ownership, key revocation, conditional audio GET, limits and deletion');
} finally {db.close();}
