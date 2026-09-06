import { db, hashKey, newId, secret } from './db';

export interface Caller { userId: string | null; keyId: string | null; email: string | null }
export const ANONYMOUS: Caller = { userId:null, keyId:null, email:null };
export const SESSION_COOKIE = 'chipvoice_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAGIC_TTL_MS = 30 * 60 * 1000;
const PREFIX = 'cv_live_';

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  if (!origin) return true;
  // Next can normalize request.url to localhost; Host retains the public host.
  try {
    const source = new URL(origin), target = new URL(request.url);
    return source.protocol === target.protocol && source.host === (request.headers.get('host') ?? target.host);
  } catch { return false; }
}
function sessionToken(request: Request): string | null {
  return request.headers.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1) ?? null;
}

/** API keys and browser sessions resolve to the same stable account. Explicit
 * invalid bearer credentials do not silently fall back to a browser session. */
export async function identify(request: Request): Promise<Caller> {
  const header = request.headers.get('authorization');
  const presented = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const token = sessionToken(request);
  if (header && !presented?.startsWith(PREFIX)) return ANONYMOUS;
  if (!header && (!token || (!['GET','HEAD','OPTIONS'].includes(request.method) && !sameOrigin(request)))) return ANONYMOUS;
  const client = await db(), now = Date.now();
  if (presented) {
    const result = await client.execute({ sql:`select keys.id,keys.user_id,keys.last_used,users.email from keys join users on users.id=keys.user_id where keys.hash=? and keys.revoked_at is null`, args:[await hashKey(presented)] });
    const row = result.rows[0]; if (!row) return ANONYMOUS;
    if (Number(row.last_used ?? 0) < now - 60_000) void client.execute({sql:`update keys set last_used=? where id=?`,args:[now,row.id]}).catch(()=>{});
    return {userId:String(row.user_id),keyId:String(row.id),email:String(row.email)};
  }
  const result = await client.execute({ sql:`select sessions.user_id,users.email from sessions join users on users.id=sessions.user_id where sessions.hash=? and sessions.revoked_at is null and sessions.expires_at>?`, args:[await hashKey(token!),now] });
  const row = result.rows[0];
  return row ? {userId:String(row.user_id),keyId:null,email:String(row.email)} : ANONYMOUS;
}

async function userFor(email: string): Promise<string> {
  const result = await (await db()).execute({sql:`insert into users (id,email,created_at) values (?,?,?) on conflict(email) do update set email=excluded.email returning id`,args:[newId(),email.toLowerCase().trim(),Date.now()]});
  return String(result.rows[0].id);
}
export async function createKey(email: string, label: string | null) {
  const client = await db(), userId = await userFor(email), key = PREFIX + secret(), id = newId();
  await client.execute({sql:`insert into keys (id,user_id,hash,email,label,created_at) values (?,?,?,?,?,?)`,args:[id,userId,await hashKey(key),email.toLowerCase().trim(),label,Date.now()]});
  return {id,key};
}
async function loginToken(userId: string) {
  const token = secret(), client = await db(), now = Date.now();
  await client.batch([
    {sql:`delete from login_tokens where created_at<?`,args:[now-MAGIC_TTL_MS]},
    {sql:`delete from sessions where expires_at<?`,args:[now]},
    {sql:`insert into login_tokens (hash,user_id,created_at) values (?,?,?)`,args:[await hashKey(token),userId,now]},
  ], 'write');
  return token;
}
export async function createMagicLink(keyId: string): Promise<string> {
  const result = await (await db()).execute({sql:`select user_id from keys where id=? and revoked_at is null`,args:[keyId]});
  if (!result.rows[0]) throw new Error('Unknown key.');
  return loginToken(String(result.rows[0].user_id));
}
export async function createSignInLink(email: string): Promise<string> { return loginToken(await userFor(email)); }

/** The conditional update claims one token; session insertion uses that unique
 * claim in the same transaction. Two simultaneous redeems cannot both win. */
export async function redeemMagicLink(token: string): Promise<string | null> {
  const client = await db(), now = Date.now(), session = 'cv_session_' + secret();
  const [tokenHash, sessionHash] = await Promise.all([hashKey(token),hashKey(session)]);
  const results = await client.batch([
    {sql:`update login_tokens set used_at=?,session_hash=? where hash=? and used_at is null and created_at>=?`,args:[now,sessionHash,tokenHash,now-MAGIC_TTL_MS]},
    {sql:`insert into sessions (hash,user_id,created_at,expires_at) select ?,user_id,?,? from login_tokens where hash=? and session_hash=? returning user_id`,args:[sessionHash,now,now+SESSION_TTL_MS,tokenHash,sessionHash]},
    // Preserve consumed legacy links if the deployment is rolled back.
    {sql:`update magic set used_at=? where token=? and exists(select 1 from login_tokens where hash=? and session_hash=?)`,args:[now,token,tokenHash,sessionHash]},
  ], 'write');
  return results[1].rows.length ? session : null;
}
export async function revokeSession(request: Request) {
  const token = sessionToken(request);
  if (token) await (await db()).execute({sql:`update sessions set revoked_at=? where hash=?`,args:[Date.now(),await hashKey(token)]});
}
export async function listKeys(userId: string) {
  return (await (await db()).execute({sql:`select id,label,created_at,last_used,revoked_at from keys where user_id=? order by created_at desc limit 100`,args:[userId]})).rows;
}
export async function revokeKey(userId: string, id: string) {
  const result = await (await db()).execute({sql:`update keys set revoked_at=coalesce(revoked_at,?) where user_id=? and id=? returning id`,args:[Date.now(),userId,id]});
  return result.rows.length > 0;
}
