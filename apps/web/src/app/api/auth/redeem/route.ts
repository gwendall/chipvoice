import { signInDestination } from '@/lib/signin-path';
import {localePath} from '@/i18n/core';
import { NextResponse } from 'next/server';
import { magicLinkValid, redeemMagicLink, SESSION_COOKIE, SESSION_TTL_MS } from '@/lib/auth';
import { hasDatabase } from '@/lib/db';
import { randomUUID } from 'node:crypto';
import { SESSION_REVISION_COOKIE } from '@/auth/session-config';
export const runtime = 'nodejs';

function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
function retryDestination(url: URL, token: string | null) {
  const locale = url.searchParams.get('locale') === 'ja' ? 'ja' : 'en';
  const home = localePath('/', locale);
  const destination = signInDestination(url.searchParams.get('next'), locale);
  return url.searchParams.has('next')
    ? `${localePath('/signin', locale)}?next=${encodeURIComponent(destination)}&signin=${token ? 'expired' : 'missing'}`
    : `${home}?signin=${token ? 'expired' : 'missing'}`;
}

/**
 * Single-use email links establish a session without exposing an API key.
 *
 * GET never spends the token: mail providers and clients prefetch links to
 * scan them, and a GET that consumed the token signed the user out before
 * they ever clicked. GET only checks whether the link is still good and, if
 * so, sends the person to a page with a button; that button's POST is the
 * one thing that actually redeems it, because only a person can click it.
 */
export async function GET(request: Request) {
  if (!hasDatabase()) return new Response('no database', { status: 503 });
  const url = new URL(request.url), token = url.searchParams.get('token');
  if (!token || !(await magicLinkValid(token)))
    return noStore(new NextResponse(null, { status: 302, headers: { Location: retryDestination(url, token) } }));
  const locale = url.searchParams.get('locale') === 'ja' ? 'ja' : 'en';
  const confirm = new URL(localePath('/signin/confirm', locale), url.origin);
  confirm.searchParams.set('token', token);
  confirm.searchParams.set('locale', locale);
  if (url.searchParams.has('next')) confirm.searchParams.set('next', url.searchParams.get('next')!);
  return noStore(new NextResponse(null, { status: 302, headers: { Location: confirm.pathname + confirm.search } }));
}

/** The confirm page's button posts here; this is the sole path that spends
 * the token, so it only ever runs after a person clicked something. */
export async function POST(request: Request) {
  if (!hasDatabase()) return new Response('no database', { status: 503 });
  const url = new URL(request.url), token = url.searchParams.get('token');
  const locale = url.searchParams.get('locale') === 'ja' ? 'ja' : 'en';
  const destination = signInDestination(url.searchParams.get('next'), locale);
  const session = token ? await redeemMagicLink(token) : null;
  const response = new NextResponse(null, {
    status: 302,
    headers: { Location: session ? destination : retryDestination(url, token) },
  });
  noStore(response);
  if (session) {
    response.cookies.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', path: '/', maxAge: SESSION_TTL_MS / 1000 });
    response.cookies.set(SESSION_REVISION_COOKIE, randomUUID(), { sameSite: 'lax', secure: url.protocol === 'https:', path: '/', maxAge: SESSION_TTL_MS / 1000 });
  }
  return response;
}
