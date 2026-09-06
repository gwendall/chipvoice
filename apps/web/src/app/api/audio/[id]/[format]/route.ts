import { loopSeconds } from "chipvoice";
import { RenderQuery, SongId } from "@/lib/schema";
import { find, SITE, toLibrarySong } from "@/lib/songs";
import { hasDatabase } from "@/lib/db";
import { renderAudio } from "@/lib/audio-renderer";
import { RenderBusy } from "@/lib/render-cache";
import { allow, clientKey } from "@/lib/limit";
import { contentDisposition } from "@/lib/id3";

export const runtime = "nodejs";
// Cycle-level rendering is CPU-bound; allow the runtime to finish long exports.
export const maxDuration = 60;

/** Stable song URLs render with the current engine. Browsers must revalidate:
 * a deploy can change audio and deletion must be checked before serving it. */
/*
 * Reached through a rewrite from `/s/{id}.mp3`, which is the URL people and
 * agents see. Next cannot put a route handler and a page on the same dynamic
 * segment, and the clean URL is worth more than the tidy file tree - it is what
 * gets pasted into a chat.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  const { id, format } = await params;
  if (format !== "mp3" && format !== "wav") {
    return json({ error: "bad_format", message: "expected mp3 or wav" }, 400);
  }
  if (!SongId.safeParse(id).success) return json({ error: "bad_id" }, 400);
  if (!hasDatabase()) return json({ error: "no_database" }, 503);

  const query = RenderQuery.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) {
    return json(
      { error: "bad_query", message: "seconds must be an integer between 1 and 30" },
      400,
    );
  }

  const found = await find(id);
  if (!found) return json({ error: "not_found" }, 404);

  const song = found.song;
  const seconds = query.data.seconds ?? Math.min(300, loopSeconds(toLibrarySong(song)) * 2);
  if (seconds > 30) return json({ error: "render_too_long", message: "Public exports support up to 30 seconds. Set ?seconds=30 or export the full score in the demo." }, 422);
  try {
    const asset = await renderAudio({
      score: { bpm: song.bpm, chip: song.chip, patterns: song.patterns, order: song.order, intent: song.intent ?? undefined },
      seconds, format,
      tags: {
        title: song.title ?? `chipvoice ${song.id}`, artist: song.author ?? "chipvoice", album: "chipvoice",
        year: new Date(song.createdAt).getUTCFullYear().toString(),
        comment: `Written on an emulated ${song.chip} sound chip. ${SITE}/s/${song.id}`, url: `${SITE}/s/${song.id}`,
      },
    }, () => {
      const gate = allow(`audio:${clientKey(request)}`, "render");
      if (!gate.ok) throw Object.assign(new Error("render_rate_limited"), { retryAfter: gate.retryAfter });
    });
    // A deletion during a render must not resurrect the publication from cache.
    if (!await find(id)) return json({ error: "not_found" }, 404);
    const headers = {
      "Content-Type": format === "wav" ? "audio/wav" : "audio/mpeg", "Cache-Control": "public, no-cache",
      ETag: asset.etag, "Content-Disposition": contentDisposition(song.title, id, format), "X-Render-Ms": String(asset.milliseconds),
    };
    const tags = request.headers.get("if-none-match")?.split(",").map(tag => tag.trim().replace(/^W\//, ""));
    if (tags?.some(tag => tag === "*" || tag === asset.etag)) return new Response(null, { status: 304, headers });
    return new Response(asset.bytes, { headers: { ...headers, "Content-Length": String(asset.bytes.length) } });
  } catch (error) {
    if (error instanceof Error && "retryAfter" in error) {
      return new Response(JSON.stringify({ error: "rate_limited", retryAfter: error.retryAfter }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(error.retryAfter) } });
    }
    return new Response(JSON.stringify({ error: error instanceof RenderBusy ? "render_busy" : "render_unavailable", message: "Audio rendering is busy or unavailable. Try again shortly, or export in the demo." }), { status: 503, headers: { "Content-Type": "application/json", "Retry-After": "5" } });
  }

}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
