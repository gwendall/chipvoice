import type { SongDocument } from './document';

/** Forks send only changes. Unchanged legacy patterns need not pass today's
 * admission caps again; null explicitly clears optional publication fields. */
export function publicationBody(song: SongDocument, previous?: SongDocument): Record<string, unknown> {
  if (!previous) return song;
  const body: Record<string, unknown> = {};
  for (const field of ['title','author','chip','bpm','intent','order','patterns'] as const) {
    if (JSON.stringify(song[field]) !== JSON.stringify(previous[field])) body[field] = song[field] ?? null;
  }
  if ((song.stepsPerBeat ?? 4) !== (previous.stepsPerBeat ?? 4)) body.stepsPerBeat = song.stepsPerBeat ?? 4;
  // Fork API credits default to the new request; the studio preserves its document.
  if (song.author !== undefined || previous.author !== undefined) body.author = song.author ?? null;
  return body;
}
