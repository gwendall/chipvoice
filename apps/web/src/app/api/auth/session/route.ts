import { NextResponse } from 'next/server';
import { sameOrigin, revokeSession, identify, SESSION_COOKIE } from '@/lib/auth';
import { db, hasDatabase } from '@/lib/db';
import { ensureProfile, profile } from '@/lib/projects';
import { SESSION_REVISION_COOKIE } from '@/auth/session-config';
export const runtime = 'nodejs';
/** Identity only: do not load the visitor's song library to render a header. */
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const currentRevision = request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(SESSION_REVISION_COOKIE+'='))?.slice(SESSION_REVISION_COOKIE.length+1) ?? '';
  if (!hasDatabase()) return NextResponse.json({error:'no_database'}, {status:503,headers});
  const caller = await identify(request);
  if (!caller.userId || caller.agent) return NextResponse.json({error:'not_signed_in',revision:currentRevision}, {status:401,headers});
  const row = (await (await db()).execute({sql:'select * from profiles where user_id=? and is_default=1',args:[caller.userId]})).rows[0];
  const artist = row ? profile(row) : await ensureProfile(caller.userId);
  const revision = currentRevision;
  const response = NextResponse.json({revision,userId:caller.userId,email:caller.email,profile:{id:artist.id,displayName:artist.displayName,handle:artist.handle,avatar:artist.avatar}}, {headers});
  return response;
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({error:'cross_origin'}, {status:403});
  if (!hasDatabase()) return NextResponse.json({error:'no_database'}, {status:503});
  await revokeSession(request);
  const response = NextResponse.json({ok:true}, {headers:{'Cache-Control':'no-store'}});
  response.cookies.set(SESSION_COOKIE, '', {httpOnly:true,sameSite:'lax',secure:new URL(request.url).protocol === 'https:',path:'/',maxAge:0});
  response.cookies.set(SESSION_REVISION_COOKIE, '', {sameSite:'lax',secure:new URL(request.url).protocol === 'https:',path:'/',maxAge:0});
  return response;
}
