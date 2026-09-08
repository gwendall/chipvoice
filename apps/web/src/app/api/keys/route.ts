import { NextResponse } from "next/server";
import { z } from "zod";
import { createSignInLink, identify, listKeys } from "@/lib/auth";
import { allow, clientKey } from "@/lib/limit";
import { hasDatabase } from "@/lib/db";
import { sendSignInEmail } from "@/lib/mail";
import { SITE } from "@/lib/songs";

export const runtime = "nodejs";

const Input = z.object({
  email: z.email().max(254),
  label: z.string().trim().max(60).optional(),
});

/** Legacy registration now sends only a short-lived sign-in link. */
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

  const token = await createSignInLink(parsed.data.email);
  const sent = await sendSignInEmail(
    parsed.data.email,
    `${SITE}/api/auth/redeem?token=${token}`,
  );

  return NextResponse.json(
    {
      ok: true,
      message: sent
        ? `Check your email for a sign-in link. Authorize agents from your library.`
        : `Mail could not be sent. Please try signing in again later.`,
      emailed: sent,
    },
    { status: 202 },
  );
}

export async function GET(request: Request) {
  if (!hasDatabase())
    return NextResponse.json({ error: "no_database" }, { status: 503 });
  const caller = await identify(request);
  if (!caller.userId)
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  return NextResponse.json(
    { keys: await listKeys(caller.userId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
