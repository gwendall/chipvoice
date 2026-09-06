import { NextResponse } from 'next/server';
import { sameOrigin, revokeSession, SESSION_COOKIE } from '@/lib/auth';
import { hasDatabase } from '@/lib/db';
export const runtime = 'nodejs';
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({error:'cross_origin'}, {status:403});
  if (!hasDatabase()) return NextResponse.json({error:'no_database'}, {status:503});
  await revokeSession(request);
  const response = NextResponse.json({ok:true}, {headers:{'Cache-Control':'no-store'}});
  response.cookies.set(SESSION_COOKIE, '', {httpOnly:true,sameSite:'lax',secure:new URL(request.url).protocol === 'https:',path:'/',maxAge:0});
  return response;
}
