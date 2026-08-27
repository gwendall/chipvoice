import { NextResponse } from "next/server";
import { identify } from "@/lib/auth";
import { listByKey, present } from "@/lib/songs";
import { hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

/**
 * What this key has published.
 *
 * The one thing an identity buys that nothing else can: without it a lost id is
 * a lost song, permanently, because nothing anywhere records that you made it.
 */
export async function GET(request: Request) {
  if (!hasDatabase()) {
    return NextResponse.json({ error: "no_database" }, { status: 503 });
  }
  const caller = await identify(request);
  if (!caller.keyId) {
    return NextResponse.json(
      {
        error: "no_key",
        message:
          "send Authorization: Bearer cv_live_... . Get one with POST /api/keys and an email address",
      },
      { status: 401 },
    );
  }

  const songs = await listByKey(caller.keyId);
  return NextResponse.json(
    {
      email: caller.email,
      count: songs.length,
      songs: songs.map((song) => present(song)),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
