import { NextResponse } from "next/server";
import { SongInput } from "@/lib/schema";
import { check, insert, present } from "@/lib/songs";
import { allow, clientKey } from "@/lib/limit";
import { hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Stores a song and hands back its links.
 *
 * Validation happens before anything is written, and the response on failure is
 * the same shape `/api/validate` returns - so a caller that has been iterating
 * against validate does not meet a new error format at the moment it commits.
 */
export async function POST(request: Request) {
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "no_database", message: "this deployment has no database configured" },
      { status: 503 },
    );
  }

  const gate = allow(clientKey(request));
  if (!gate.ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `too many songs. Try again in ${gate.retryAfter}s`,
        retryAfter: gate.retryAfter,
      },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "the body is not JSON" },
      { status: 400 },
    );
  }

  const parsed = SongInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: parsed.error.issues.map((issue) => ({
          level: "error" as const,
          path: issue.path.join("."),
          message: issue.message,
          silent: false,
        })),
      },
      { status: 422 },
    );
  }

  const result = check(parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: "invalid_song", issues: result.issues },
      { status: 422 },
    );
  }

  const song = await insert(parsed.data, null);
  // Warnings survive a successful write: a short loop is playable and worth
  // saying something about, and swallowing it would make the write look
  // cleaner than it was.
  return NextResponse.json(
    { ...present(song), issues: result.issues },
    { status: 201 },
  );
}
