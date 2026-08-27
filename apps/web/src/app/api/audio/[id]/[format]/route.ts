import { renderSong, toWav } from "chipvoice";
import { RenderQuery, SongId } from "@/lib/schema";
import { find, SITE, toLibrarySong } from "@/lib/songs";
import { hasDatabase } from "@/lib/db";
import { encodeMp3 } from "@/lib/mp3";
import { contentDisposition } from "@/lib/id3";

export const runtime = "nodejs";
// Rendering a minute of audio is a second of CPU. The default would kill it.
export const maxDuration = 60;

/**
 * The audio, computed on request.
 *
 * Nothing is stored. The chip is a pure function of the song and the sample
 * rate, so the same id always produces the same bytes - which means the CDN can
 * hold it forever and there is no bucket to fill, no invalidation to get wrong,
 * and no orphaned files when a song is deleted. A fork is a new id, so a
 * rendered URL is never wrong about what it contains.
 */
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
      { error: "bad_query", message: "seconds must be a number between 1 and 300" },
      400,
    );
  }

  const found = await find(id);
  if (!found) return json({ error: "not_found" }, 404);

  const started = Date.now();
  const audio = renderSong(toLibrarySong(found.song), {
    seconds: query.data.seconds,
    sampleRate: 44100,
  });

  /*
   * The tag matters more than the filename.
   *
   * Telegram, iTunes and every car stereo show what is inside the file, not
   * what it is called - so an untagged song arrives as "unknown" however
   * carefully it was named on the way out.
   */
  const song = found.song;
  const body =
    format === "wav"
      ? toWav(audio)
      : encodeMp3(audio.left, audio.sampleRate, {
          title: song.title ?? `chipvoice ${song.id}`,
          artist: song.author ?? "chipvoice",
          album: "chipvoice",
          year: new Date(song.createdAt).getUTCFullYear().toString(),
          comment: `Written on an emulated Ricoh 2A03. ${SITE}/s/${song.id}`,
          url: `${SITE}/s/${song.id}`,
        });

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": format === "wav" ? "audio/wav" : "audio/mpeg",
      "Content-Length": String(body.length),
      // Immutable because the song behind this id can never change.
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": contentDisposition(found.song.title, id, format),
      "X-Render-Ms": String(Date.now() - started),
    },
  });
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
