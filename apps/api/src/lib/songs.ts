import { validateSong, type Measured, type Issue } from "chipvoice";
import { db, newId } from "./db";
import type { SongInput } from "./schema";

/**
 * A stored song, and the shape every route returns.
 *
 * `url`, `mp3` and `wav` are computed rather than stored: they are a function
 * of the id, and a column that repeats a rule is a column that can disagree
 * with it.
 */
export interface StoredSong {
  id: string;
  parentId: string | null;
  title: string | null;
  bpm: number;
  chip: string;
  patterns: SongInput["patterns"];
  order: number[];
  author: string | null;
  createdAt: number;
}

export interface SongResponse extends StoredSong {
  url: string;
  mp3: string;
  wav: string;
  measured: Measured | null;
  /** Forks made from this one. */
  forks: number;
}

export const SITE =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://chipvoice.dev";

/** Turns stored rows into the library's song shape, which is what plays it. */
export function toLibrarySong(song: StoredSong) {
  return {
    id: song.id,
    bpm: song.bpm,
    patterns: song.patterns,
    order: song.order,
    gain: 1,
    lead: {
      duty: 1,
      volume: [15, 15, 14, 13, 12, 12, 11, 11, 10, 10, 10, 9, 9, 9, 8],
      sustain: true,
      vibrato: { depth: 0.18, rate: 8, delay: 12 },
    },
    chord: { duty: 0, volume: [9, 8, 7, 7, 6], sustain: true },
    bass: { volume: [15], sustain: true },
  };
}

export function present(song: StoredSong, forks = 0): SongResponse {
  const validation = validateSong(toLibrarySong(song));
  return {
    ...song,
    url: `${SITE}/s/${song.id}`,
    mp3: `${SITE}/s/${song.id}.mp3`,
    wav: `${SITE}/s/${song.id}.wav`,
    measured: validation.measured,
    forks,
  };
}

/** Validates against the library, which is the same check the player runs. */
export function check(input: SongInput): { ok: boolean; issues: Issue[]; measured: Measured | null } {
  const result = validateSong(
    toLibrarySong({
      id: "check",
      parentId: null,
      title: null,
      bpm: input.bpm,
      chip: input.chip,
      patterns: input.patterns,
      order: input.order,
      author: null,
      createdAt: 0,
    }),
  );
  return { ok: result.ok, issues: result.issues, measured: result.measured };
}

export async function insert(
  input: SongInput,
  parentId: string | null,
): Promise<StoredSong> {
  const client = await db();
  const song: StoredSong = {
    id: newId(),
    parentId,
    title: input.title ?? null,
    bpm: input.bpm,
    chip: input.chip,
    patterns: input.patterns,
    order: input.order,
    author: input.author ?? null,
    createdAt: Date.now(),
  };
  await client.execute({
    sql: `insert into songs (id, parent_id, title, bpm, chip, patterns, song_order, author, created_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      song.id,
      song.parentId,
      song.title,
      song.bpm,
      song.chip,
      JSON.stringify(song.patterns),
      JSON.stringify(song.order),
      song.author,
      song.createdAt,
    ],
  });
  return song;
}

export async function find(id: string): Promise<{ song: StoredSong; forks: number } | null> {
  const client = await db();
  const rows = await client.execute({
    sql: `select * from songs where id = ? limit 1`,
    args: [id],
  });
  const row = rows.rows[0];
  if (!row) return null;

  const forks = await client.execute({
    sql: `select count(*) as n from songs where parent_id = ?`,
    args: [id],
  });

  return {
    song: {
      id: String(row.id),
      parentId: row.parent_id === null ? null : String(row.parent_id),
      title: row.title === null ? null : String(row.title),
      bpm: Number(row.bpm),
      chip: String(row.chip),
      patterns: JSON.parse(String(row.patterns)),
      order: JSON.parse(String(row.song_order)),
      author: row.author === null ? null : String(row.author),
      createdAt: Number(row.created_at),
    },
    forks: Number(forks.rows[0]?.n ?? 0),
  };
}
