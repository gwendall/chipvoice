import { NextResponse } from "next/server";
import { identify } from "@/lib/auth";
import { listByUser, present } from "@/lib/songs";
import { hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

/**
 * What this account has published.
 *
 * The one thing an identity buys that nothing else can: without it a lost id is
 * a lost song, permanently, because nothing anywhere records that you made it.
 */
export async function GET(request: Request) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "no_database" }, { status: 503 });
  }
  const caller = await identify(request);
  if (!caller.userId) {
    return NextResponse.json(
      {
        error: "not_signed_in",
        message:
          "Sign in through /api/auth/signin or use an existing owner API key. Authorized agents use /api/v1/agent.",
      },
      { status: 401 },
    );
  }

  const songs = await listByUser(caller.userId);
  return NextResponse.json(
    {
      email: caller.email,
      count: songs.length,
      songs: songs.map((song) => present(song)),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
