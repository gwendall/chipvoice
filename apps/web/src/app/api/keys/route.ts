import { NextResponse } from "next/server";
import { z } from "zod";
import { createKey, createMagicLink, identify, listKeys } from "@/lib/auth";
import { allow, clientKey } from "@/lib/limit";
import { hasDatabase } from "@/lib/db";
import { sendKeyEmail } from "@/lib/mail";
import { SITE } from "@/lib/songs";

export const runtime = "nodejs";

const Input = z.object({
  email: z.email().max(254),
  label: z.string().trim().max(60).optional(),
});

/**
 * Issues a key, and sends it rather than returning it.
 *
 * The response says only that mail is on its way. A secret in a response body
 * ends up in a proxy log, a shell history and a terminal buffer, and the person
 * who asked for it has no way to know which. Delivering it to an inbox costs one
 * round trip and removes all three.
 */
export async function POST(request: Request) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "no_database" }, { status: 503 });
  }
  const gate = allow(`keys:${clientKey(request)}`);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: gate.retryAfter },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = Input.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: parsed.error.issues.map((i) => ({
          level: "error" as const,
          path: i.path.join("."),
          message: i.message,
          silent: false,
        })),
      },
      { status: 422 },
    );
  }

  const issued = await createKey(parsed.data.email, parsed.data.label ?? null);
  const token = await createMagicLink(issued.id);
  const sent = await sendKeyEmail(parsed.data.email, issued.key, `${SITE}/api/auth/redeem?token=${token}`);

  return NextResponse.json(
    {
      ok: true,
      message: sent
        ? `the key is on its way to ${parsed.data.email}`
        : `the key was created, but mail could not be sent. Ask for another once that is fixed`,
      emailed: sent,
    },
    { status: 202 },
  );
}

export async function GET(request: Request) {
  if (!hasDatabase()) return NextResponse.json({error:'no_database'}, {status:503});
  const caller = await identify(request);
  if (!caller.userId) return NextResponse.json({error:'not_signed_in'}, {status:401});
  return NextResponse.json({keys:await listKeys(caller.userId)}, {headers:{'Cache-Control':'no-store'}});
}
