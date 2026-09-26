import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSignInLink } from '@/lib/auth';
import { hasDatabase } from '@/lib/db';
import { allow, clientKey } from '@/lib/limit';
import { admitProject, ProjectHttpError } from '@/lib/projects';
import { sendSignInEmail } from '@/lib/mail';
import { signInDestination } from '@/lib/signin-path';
import { SITE } from '@/lib/songs';
export const runtime = 'nodejs';
const Input = z.object({email:z.email().max(254),locale:z.enum(['en','ja']).default('en'),next:z.string().max(512).optional()});
// Fifteen minutes, at most three links, per address rather than per caller: the
// per-IP gate below stops one machine from flooding many addresses, but not
// many machines (or one behind carrier-grade NAT) flooding a single address.
const SIGNIN_MAIL_WINDOW_MS = 15 * 60_000;
export async function POST(request: Request) {
  if (!hasDatabase()) return NextResponse.json({error:'no_database'}, {status:503});
  const gate = allow(`signin:${clientKey(request)}`);
  if (!gate.ok) return NextResponse.json({error:'rate_limited'}, {status:429,headers:{'Retry-After':String(gate.retryAfter)}});
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({error:'invalid_json'}, {status:400}); }
  const parsed = Input.safeParse(body);
  if (!parsed.success) return NextResponse.json({error:'invalid_request'}, {status:422});
  const address = parsed.data.email.toLowerCase().trim();
  try {
    await admitProject(`signin-mail:${address}`, 3, SIGNIN_MAIL_WINDOW_MS);
  } catch (error) {
    // Same shape as the per-IP gate above, and the same silence: whether this
    // throttle bites reveals nothing about whether the address has an
    // account, because it counts the address, not the account.
    if (error instanceof ProjectHttpError && error.status === 429)
      return NextResponse.json({error:'rate_limited'}, {status:429,headers:{'Retry-After':String(error.retryAfter ?? 900)}});
    throw error;
  }
  const token = await createSignInLink(parsed.data.email);
  const link = new URL('/api/auth/redeem', SITE);
  link.searchParams.set('token', token); link.searchParams.set('locale', parsed.data.locale);
  if (parsed.data.next) link.searchParams.set('next', signInDestination(parsed.data.next, parsed.data.locale));
  const sent = await sendSignInEmail(parsed.data.email, link.href, parsed.data.locale);
  return NextResponse.json({ok:sent,emailed:sent}, {status:sent ? 202 : 503,headers:{'Cache-Control':'no-store'}});
}
