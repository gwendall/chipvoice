import { NextResponse } from "next/server";
import { SongId } from "@/lib/schema";
import { find, lineageOf, present, softDelete } from "@/lib/songs";
import { hasDatabase } from "@/lib/db";
import { identify } from "@/lib/auth";

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
   * The audio is where caching actually pays, with conditional revalidation.
   */
  const lineage = await lineageOf(found.song);
  return NextResponse.json(present(found.song, found.forks, lineage), {
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Retires a song. The row stays.
 *
 * Its forks point at it, and removing the row would leave them orphaned - a
 * lineage with a hole in it is worse than one with a tombstone. The audio and
 * the page stop being served; the tree stays walkable.
 *
 * Only the account that published it may do this. A song published anonymously
 * cannot be withdrawn by anyone, which is the honest consequence of publishing
 * without identity and is said as much in the skill.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!SongId.safeParse(id).success) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  if (!hasDatabase()) return NextResponse.json({ error: "no_database" }, { status: 503 });

  const found = await find(id);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const caller = await identify(request);
  const admin =
    process.env.CHIPVOICE_ADMIN_KEY &&
    request.headers.get("authorization") === `Bearer ${process.env.CHIPVOICE_ADMIN_KEY}`;

  if (!admin && (!caller.userId || caller.userId !== found.song.userId)) {
    return NextResponse.json(
      {
        error: "not_yours",
        message: found.song.userId
          ? "this song was published with a different account"
          : "this song was published anonymously, so nobody can withdraw it. Publish with a key to keep that option",
      },
      { status: 403 },
    );
  }

  await softDelete(id);
  return NextResponse.json({ ok: true, id });
}
