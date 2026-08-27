import { NextResponse } from "next/server";
import { SongId } from "@/lib/schema";
import { find, present } from "@/lib/songs";
import { hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!SongId.safeParse(id).success) {
    return NextResponse.json(
      { error: "bad_id", message: "a chipvoice id is eight base62 characters" },
      { status: 400 },
    );
  }
  if (!hasDatabase()) {
    return NextResponse.json({ error: "no_database" }, { status: 503 });
  }

  const found = await find(id);
  if (!found) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  /*
   * Not cached, and the reason is the fork count.
   *
   * The song itself never changes - a fork is a new id - so the first version
   * of this cached for five minutes at the edge. But the count does change, and
   * a caller that forks and immediately reads the parent got a stale zero from
   * the CDN. Production found it; local never could, because there is no edge
   * cache in front of a dev server.
   *
   * The audio is where caching actually pays, and that stays immutable.
   */
  return NextResponse.json(present(found.song, found.forks), {
    headers: { "Cache-Control": "no-store" },
  });
}
