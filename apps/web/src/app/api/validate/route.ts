import { NextResponse } from "next/server";
import { SongInput } from "@/lib/schema";
import { checkAll } from "@/lib/check";

export const runtime = "nodejs";

/**
 * Checks a song without storing it.
 *
 * The route an agent calls in a loop while it writes. Public and unlimited on
 * purpose: it does no work worth rationing, and making it expensive to ask
 * "is this right yet" would push callers to guess instead.
 */
export async function POST(request: Request) {
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

  // The same check the store route runs, so an answer here means the next call
  // will not refuse for a reason this one did not mention.
  const result = checkAll(parsed.data);
  return NextResponse.json(
    { ok: result.ok, issues: result.issues, measured: result.measured },
    { status: result.ok ? 200 : 422 },
  );
}
