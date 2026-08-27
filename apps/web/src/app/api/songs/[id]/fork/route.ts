import { NextResponse } from "next/server";
import { SongId, SongInput } from "@/lib/schema";
import { check, find, insert, present } from "@/lib/songs";
import { allow, clientKey } from "@/lib/limit";
import { hasDatabase } from "@/lib/db";
import { identify } from "@/lib/auth";
import { cleanAuthor, cleanTitle } from "@/lib/text";

export const runtime = "nodejs";

/**
 * Copies a song, with changes, keeping the link back to it.
 *
 * The body is a partial: send only what differs. That is what makes a fork
 * cheap to write - an agent changing one line does not have to restate the
 * other three, and cannot mangle them by accident while doing so.
 */
const ForkInput = SongInput.partial();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!SongId.safeParse(id).success) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  if (!hasDatabase()) {
    return NextResponse.json({ error: "no_database" }, { status: 503 });
  }

  const caller = await identify(request);
  const gate = allow(clientKey(request), caller.keyId ? "key" : "anonymous");
  if (!gate.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: gate.retryAfter },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
    );
  }

  const parent = await find(id);
  if (!parent) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: unknown = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = ForkInput.safeParse(body);
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

  const merged = {
    title: parsed.data.title ?? parent.song.title ?? undefined,
    bpm: parsed.data.bpm ?? parent.song.bpm,
    patterns: parsed.data.patterns ?? parent.song.patterns,
    order: parsed.data.order ?? parent.song.order,
    chip: (parsed.data.chip ?? parent.song.chip) as "2a03",
    author: parsed.data.author ?? undefined,
  };

  const title = cleanTitle(merged.title);
  const author = cleanAuthor(merged.author);
  if (!title.ok || !author.ok) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: [
          ...(title.ok ? [] : [{ level: "error" as const, path: "title", message: title.message!, silent: false }]),
          ...(author.ok ? [] : [{ level: "error" as const, path: "author", message: author.message!, silent: false }]),
        ],
      },
      { status: 422 },
    );
  }

  const result = check(merged);
  if (!result.ok) {
    return NextResponse.json({ error: "invalid_song", issues: result.issues }, { status: 422 });
  }

  const song = await insert(
    { ...merged, title: title.value || undefined, author: author.value || undefined },
    parent.song,
    caller.keyId,
  );
  return NextResponse.json({ ...present(song), issues: result.issues }, { status: 201 });
}
