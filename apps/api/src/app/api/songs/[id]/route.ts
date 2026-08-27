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
  return NextResponse.json(present(found.song, found.forks), {
    // A song never changes - a fork is a new id - so this is safe to cache for
    // a long time, and the fork count is not worth a shorter one.
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
  });
}
