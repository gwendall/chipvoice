import { signInDestination } from '@/lib/signin-path';
import {localePath} from '@/i18n/core';
import { NextResponse } from 'next/server';
import { redeemMagicLink, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/auth';
import { hasDatabase } from '@/lib/db';
import { randomUUID } from 'node:crypto';
import { SESSION_REVISION_COOKIE } from '@/auth/session-config';
export const runtime = 'nodejs';

/** Single-use email links establish a session without exposing an API key. */
export async function GET(request: Request) {
  if (!hasDatabase()) return new Response('no database', { status:503 });
  const url = new URL(request.url), token = url.searchParams.get('token');
  const home=localePath('/',url.searchParams.get('locale')==='ja'?'ja':'en');
  const destination = signInDestination(url.searchParams.get('next'), url.searchParams.get('locale')==='ja'?'ja':'en');
  const retry = url.searchParams.has('next') ? `${localePath('/signin',url.searchParams.get('locale')==='ja'?'ja':'en')}?next=${encodeURIComponent(destination)}&signin=${token ? 'expired' : 'missing'}` : `${home}?signin=${token ? 'expired' : 'missing'}`;
  const session = token ? await redeemMagicLink(token) : null;
  const response = new NextResponse(null, {status:302,headers:{Location:session ? destination : retry}});
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  if (session) {
    response.cookies.set(SESSION_COOKIE, session, {httpOnly:true, sameSite:'lax', secure:url.protocol === 'https:', path:'/', maxAge:SESSION_TTL_MS/1000});
    response.cookies.set(SESSION_REVISION_COOKIE, randomUUID(), {sameSite:'lax',secure:url.protocol==='https:',path:'/',maxAge:SESSION_TTL_MS/1000});
  }
  return response;
}
