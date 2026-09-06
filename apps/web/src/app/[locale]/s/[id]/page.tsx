import {createTranslator, isLocale, localePath} from '@/i18n/core';
import {getMessages} from '@/i18n/server';
import {alternates} from '@/i18n/metadata';
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { find, present, SITE } from "@/lib/songs";
import Studio from "@/studio/App";
import { readDocument } from "@/studio/document";
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
  params: Promise<{ id: string; locale: string }>;
}): Promise<Metadata> {
  const {id,locale:value}=await params;
  const locale=isLocale(value)?value:'en',t=createTranslator(await getMessages(locale));
  if (!hasDatabase()) return { title: "chipvoice" };
  const found = await find(id);
  if (!found) return { title: t("Page not found · chipvoice") };

  const song = present(found.song, found.forks);
  const title = song.title ?? `chipvoice ${song.id}`;
  const sourceDescription = `${song.bpm} bpm, ${song.measured?.loopSeconds ?? "?"}s loop, on an emulated ${song.chip === 'dmg' ? 'Game Boy' : song.chip === 'md' ? 'Mega Drive' : song.chip === 'snes' ? 'Super Famicom' : song.chip === 'c64' ? 'Commodore 64' : 'Famicom'} sound chip. Written as four lines of text.`;
  const description = t(sourceDescription);

  return {
    title,
    description,
    alternates: alternates(`/s/${id}`,locale),
    other: {'chipvoice:shared-description':sourceDescription},
    openGraph: {
      title,
      description,
      url: SITE+localePath(`/s/${id}`,locale),
      locale:locale==='ja'?'ja_JP':'en_US',
      alternateLocale:locale==='ja'?'en_US':'ja_JP',
      type: "music.song",
      audio: [{ url: song.mp3, type: "audio/mpeg" }],
      images: [{ url: `${SITE}${localePath(`/s/${song.id}/card`,locale)}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "player",
      title,
      description,
      images: [`${SITE}${localePath(`/s/${song.id}/card`,locale)}`],
    },
  };
}

export default async function SongPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  if (!hasDatabase()) notFound();
  const found = await find(id);
  if (!found) notFound();

  // The song is fetched here only to decide whether the page exists at all.
  // The editor loads it for itself from the same id in the path.
  const initial = readDocument({ ...found.song, title: found.song.title ?? undefined, author: found.song.author ?? undefined, intent: found.song.intent ?? undefined });
  if (!initial) notFound();
  return <Studio initial={initial} initialId={found.song.id} />;
}
