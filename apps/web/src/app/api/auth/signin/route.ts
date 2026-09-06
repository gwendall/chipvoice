import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSignInLink } from '@/lib/auth';
import { hasDatabase } from '@/lib/db';
import { allow, clientKey } from '@/lib/limit';
import { sendSignInEmail } from '@/lib/mail';
import { SITE } from '@/lib/songs';
export const runtime = 'nodejs';
const Input = z.object({email:z.email().max(254)});
export async function POST(request: Request) {
  if (!hasDatabase()) return NextResponse.json({error:'no_database'}, {status:503});
  const gate = allow(`signin:${clientKey(request)}`);
  if (!gate.ok) return NextResponse.json({error:'rate_limited'}, {status:429,headers:{'Retry-After':String(gate.retryAfter)}});
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({error:'invalid_json'}, {status:400}); }
  const parsed = Input.safeParse(body);
  if (!parsed.success) return NextResponse.json({error:'invalid_request'}, {status:422});
  const token = await createSignInLink(parsed.data.email);
  const sent = await sendSignInEmail(parsed.data.email, `${SITE}/api/auth/redeem?token=${token}`);
  return NextResponse.json({ok:sent,emailed:sent}, {status:sent ? 202 : 503,headers:{'Cache-Control':'no-store'}});
}
