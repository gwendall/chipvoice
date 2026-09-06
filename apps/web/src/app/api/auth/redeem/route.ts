import {localePath} from '@/i18n/core';
import { NextResponse } from 'next/server';
import { redeemMagicLink, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/auth';
import { hasDatabase } from '@/lib/db';
export const runtime = 'nodejs';

/** Single-use email links establish a session without exposing an API key. */
export async function GET(request: Request) {
  if (!hasDatabase()) return new Response('no database', { status:503 });
  const url = new URL(request.url), token = url.searchParams.get('token');
  const home=localePath('/',url.searchParams.get('locale')==='ja'?'ja':'en');
  const session = token ? await redeemMagicLink(token) : null;
  const response = new NextResponse(null, {status:302,headers:{Location:session ? home : `${home}?signin=${token ? 'expired' : 'missing'}`}});
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  if (session) response.cookies.set(SESSION_COOKIE, session, {httpOnly:true, sameSite:'lax', secure:url.protocol === 'https:', path:'/', maxAge:SESSION_TTL_MS/1000});
  return response;
}
