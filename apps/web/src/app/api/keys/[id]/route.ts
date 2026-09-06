import { NextResponse } from 'next/server';
import { identify, revokeKey } from '@/lib/auth';
import { hasDatabase } from '@/lib/db';
export const runtime = 'nodejs';
export async function DELETE(request: Request, {params}: {params:Promise<{id:string}>}) {
  if (!hasDatabase()) return NextResponse.json({error:'no_database'}, {status:503});
  const caller = await identify(request);
  if (!caller.userId) return NextResponse.json({error:'not_signed_in'}, {status:401});
  const ok = await revokeKey(caller.userId, (await params).id);
  return NextResponse.json(ok ? {ok:true} : {error:'not_found'}, {status:ok ? 200 : 404,headers:{'Cache-Control':'no-store'}});
}
