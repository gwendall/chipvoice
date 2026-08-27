import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { find, present, SITE } from "@/lib/songs";
import Studio from "@/studio/App";
import { hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

/**
 * The page a link lands on: the editor, with the song in it.
 *
 * It was a separate read-only page for an hour, and that was one page too many -
 * the editor already shows the grid, plays the song and can fork it, so a second
 * view of the same thing is a second thing to keep in step. A link opens what
 * the person who sent it was looking at, which is what CodePen gets right.
 *
 * The metadata still matters and still lives here: Telegram, X and Discord do
 * not read the API, they read meta tags. og:audio and a generated card are what
 * turn a pasted URL into something with a play button.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!hasDatabase()) return { title: "chipvoice" };
  const found = await find(id);
  if (!found) return { title: "Not found - chipvoice" };

  const song = present(found.song, found.forks);
  const title = song.title ?? `chipvoice ${song.id}`;
  const description =
    `${song.bpm} bpm, ${song.measured?.loopSeconds ?? "?"}s loop, on an emulated NES sound chip. ` +
    `Written as four lines of text.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: song.url,
      type: "music.song",
      audio: [{ url: song.mp3, type: "audio/mpeg" }],
      images: [{ url: `${SITE}/s/${song.id}/card`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "player",
      title,
      description,
      images: [`${SITE}/s/${song.id}/card`],
    },
  };
}

export default async function SongPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!hasDatabase()) notFound();
  const found = await find(id);
  if (!found) notFound();

  // The song is fetched here only to decide whether the page exists at all.
  // The editor loads it for itself from the same id in the path.
  void present(found.song, found.forks);
  return <Studio />;
}
