import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { build } from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
const directory = await mkdtemp(join(tmpdir(),'chipvoice-identity-'));
const file = resolve('generated/test-foundations.mjs');
process.env.VERCEL_ENV = 'preview';
process.env.TURSO_DEV_DATABASE_URL = `file:${join(directory,'identity.db')}`;
process.env.TURSO_DEV_AUTH_TOKEN = '';
await build({stdin:{contents:`export * from './src/lib/auth'; export * from './src/lib/db'; export * from './src/lib/songs'; export * from './src/lib/migrations';`,resolveDir:process.cwd()},outfile:file,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
const api = await import(pathToFileURL(file));
const legacy = createClient({url:process.env.TURSO_DEV_DATABASE_URL});
const now = Date.now();
try {
  await legacy.batch([
    `create table songs (id text primary key,parent_id text,title text,bpm integer not null,patterns text not null,song_order text not null,author text,created_at integer not null,key_id text)`,
    `create table keys (id text primary key,hash text not null unique,email text not null,label text,created_at integer not null,last_used integer,revoked_at integer)`,
    `create table magic (token text primary key,key_id text not null,created_at integer not null,used_at integer)`,
    {sql:`insert into keys (id,hash,email,created_at) values ('firstkey',?,'Test@Example.com',?),('nextkey',?,'test@example.com',?)`,args:[await api.hashKey('cv_live_legacy'),now,await api.hashKey('cv_live_second'),now]},
    {sql:`insert into magic values ('legacy-token','firstkey',?,null)`,args:[now]},
    {sql:`insert into songs (id,bpm,patterns,song_order,created_at,key_id) values ('oldsong1',144,?, '[0]',?,'firstkey')`,args:[JSON.stringify([{lead:'C4 . . .',chord:'C3 . . .',bass:'C2 . . .',perc:'K . H .',chordShape:[[0,4,7]]}]),now]},
  ],'write');
  await api.migrate(legacy); await api.migrate(legacy);
  assert.equal((await legacy.execute('select * from schema_migrations')).rows.length,3);
  assert.equal(Number((await legacy.execute('select steps_per_beat from songs limit 1')).rows[0].steps_per_beat),4,'legacy songs retain the straight grid');
  assert.equal((await legacy.execute('select * from users')).rows.length,1);
  assert.equal((await legacy.execute(`select count(distinct user_id) as n from keys`)).rows[0].n,1);
  const [db1,db2] = await Promise.all([api.db(),api.db()]); assert.equal(db1,db2);
  const bearer = key=>new Request('https://chipvoice.test/api/me',{headers:{authorization:`Bearer ${key}`}});
  const first = await api.identify(bearer('cv_live_legacy'));
  assert.ok(first.userId); assert.ok(!['firstkey','nextkey'].includes(first.userId), 'account IDs differ from public legacy key IDs'); assert.equal(first.email,'test@example.com');
  const oldSong = (await api.find('oldsong1')).song;
  assert.equal(oldSong.userId,first.userId); assert.equal('userId' in api.present(oldSong),false);
  const redeemed = await Promise.all([api.redeemMagicLink('legacy-token'),api.redeemMagicLink('legacy-token')]);
  assert.equal(redeemed.filter(Boolean).length,1,'one winner under concurrent redemption');
  assert.ok((await legacy.execute(`select used_at from magic`)).rows[0].used_at);
  const session = redeemed.find(Boolean);
  const cookie = (method='GET',origin='https://chipvoice.test')=>new Request('https://chipvoice.test/api/me',{method,headers:{cookie:`${api.SESSION_COOKIE}=${session}`,origin}});
  assert.equal((await api.identify(cookie())).userId,first.userId);
  assert.equal((await api.identify(cookie('POST','https://evil.test'))).userId,null);
  assert.equal((await api.identify(bearer('cv_live_legacy'))).userId,first.userId,'login leaves API keys usable');
  const invalid = cookie(); invalid.headers.set('authorization','Bearer invalid');
  assert.equal((await api.identify(invalid)).userId,null);
  const replacement = await api.createKey('TEST@example.com','replacement');
  const other = await api.createKey('other@example.com','other');
  const caller = await api.identify(bearer(replacement.key)); assert.equal(caller.userId,first.userId);
  const input = {chip:'2a03',bpm:144,order:[0],patterns:oldSong.patterns};
  const song = await api.insert(input,null,caller);
  const browserSong = await api.insert(input,null,await api.identify(cookie()));
  assert.equal(browserSong.keyId,null); assert.equal(api.present(browserSong).authorVerified,true);
  assert.equal((await api.listByUser(first.userId)).length,3);
  const otherCaller = await api.identify(bearer(other.key));
  assert.equal(await api.revokeKey(otherCaller.userId,replacement.id),false);
  assert.equal(await api.revokeKey(first.userId,replacement.id),true);
  assert.equal((await api.identify(bearer(replacement.key))).userId,null);
  assert.equal((await api.find(song.id)).song.userId,first.userId);
  assert.ok((await api.listKeys(first.userId)).every(key=>!('hash' in key) && !('key' in key)));
  await api.revokeSession(cookie()); assert.equal((await api.identify(cookie())).userId,null);
  const token = await api.createSignInLink('test@example.com');
  await db1.execute({sql:'update login_tokens set created_at=0 where hash=?',args:[await api.hashKey(token)]});
  assert.equal(await api.redeemMagicLink(token),null);
  const expired = await api.redeemMagicLink(await api.createSignInLink('test@example.com'));
  await db1.execute({sql:'update sessions set expires_at=0 where hash=?',args:[await api.hashKey(expired)]});
  assert.equal((await api.identify(new Request('https://chipvoice.test/api/me',{headers:{cookie:`${api.SESSION_COOKIE}=${expired}`}}))).userId,null);
  const fresh = createClient({url:`file:${join(directory,'fresh.db')}`});
  await api.migrate(fresh); assert.equal((await fresh.execute('select * from schema_migrations')).rows.length,3); fresh.close();
  const broken = createClient({url:`file:${join(directory,'broken.db')}`});
  await broken.execute('create table users (incompatible text)');
  await assert.rejects(api.migrate(broken),/already exists/);
  assert.equal((await broken.execute(`select name from sqlite_master where name='schema_migrations'`)).rows.length,0,'failed migration rolls back schema and markers');
  broken.close(); db1.close();
  console.log('PASS legacy/fresh/idempotent/atomic migrations; ownership; concurrent/expired login; session isolation; key revocation');
} finally { legacy.close(); await rm(directory,{recursive:true,force:true}); await rm(file,{force:true}); }
