import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { find, present, SITE } from "@/lib/songs";
import { hasDatabase } from "@/lib/db";

export const runtime = "nodejs";

/**
 * The page a link lands on.
 *
 * Telegram, X and Discord do not read the API - they read meta tags. So this
 * carries og:audio and a generated card, which is what turns a pasted URL into
 * something with a play button rather than a bare string.
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

  const song = present(found.song, found.forks);
  const pattern = song.patterns[song.order[0]] ?? song.patterns[0];

  return (
    <main className="song">
      <p className="eyebrow">chipvoice · Ricoh 2A03</p>
      <h1>{song.title ?? song.id}</h1>

      <audio controls preload="none" src={song.mp3} />

      <dl className="facts">
        <div><dt>Tempo</dt><dd>{song.bpm} bpm</dd></div>
        <div><dt>Loop</dt><dd>{song.measured?.loopSeconds ?? "?"}s</dd></div>
        <div><dt>Density</dt><dd>{song.measured?.onsetsPerSecond ?? "?"}/s</dd></div>
        <div><dt>Range</dt><dd>{song.measured?.range ?? "?"} semitones</dd></div>
        {song.forks > 0 ? <div><dt>Forks</dt><dd>{song.forks}</dd></div> : null}
      </dl>

      {/* The song itself, because the whole claim is that it is readable. */}
      <pre className="tokens">
        <code>
          {(["lead", "chord", "bass", "perc"] as const)
            .map((track) => `${track.padEnd(5)} ${pattern[track]}`)
            .join("\n")}
        </code>
      </pre>

      <p className="links">
        <a href={song.mp3}>MP3</a>
        <a href={song.wav}>WAV</a>
        <a href={`${SITE}/api/songs/${song.id}`}>JSON</a>
        {song.parentId ? <a href={`${SITE}/s/${song.parentId}`}>Forked from</a> : null}
        <a href="https://chipvoice.dev">Open the editor</a>
      </p>

      {song.author ? <p className="by">Written by {song.author}</p> : null}
    </main>
  );
}
