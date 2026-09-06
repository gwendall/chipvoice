import { arrange, validateSong, type Intent, type Measured, type Issue } from "chipvoice";
import { db, newId } from "./db";
import type { Caller } from "./auth";
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
  /** The first ancestor. Equal to `id` for an original. */
  rootId: string;
  /** 0 for an original, 1 for its fork, and so on. */
  depth: number;
  title: string | null;
  bpm: number;
  chip: string;
  patterns: SongInput["patterns"];
  order: number[];
  /** What each role should sound like; null is the default word for every role. */
  intent: Intent | null;
  author: string | null;
  /** Which key published it, when one did. */
  keyId: string | null;
  /** Stable owner; never exposed in public responses. */
  userId: string | null;
  createdAt: number;
}

/** One step of a lineage, for showing where a song sits in its tree. */
export interface Relative {
  id: string;
  title: string | null;
  createdAt: number;
}

export interface Lineage {
  parent: Relative | null;
  /** Null when the root is this song, or is its parent. */
  root: Relative | null;
  children: Relative[];
  /** Everything descended from the same original, this song included. */
  familySize: number;
}

export interface SongResponse extends Omit<StoredSong, "userId"> {
  url: string;
  mp3: string;
  wav: string;
  measured: Measured | null;
  /** Forks made directly from this one. */
  forks: number;
  /**
   * Whether the author line was published with a verified key.
   *
   * The field is free text, so it can say anything. Reporting how it got there
   * is the difference between a credit and a claim - without it, an agent can
   * publish under someone's name and the page states it as a fact.
   */
  authorVerified: boolean;
  lineage?: Lineage;
}

export const SITE =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://chipvoice.dev";

/** Turns stored rows into the library's song shape, which is what plays it. */
/**
 * The stored song as the library plays it: the score, arranged for its chip.
 * The instruments come from the intent through the chip's arranger, and a
 * song with no intent gets the ones every song had before there was one.
 */
export function toLibrarySong(song: StoredSong) {
  return {
    ...arrange(
      { id: song.id, bpm: song.bpm, patterns: song.patterns, order: song.order, gain: 1, intent: song.intent ?? undefined },
      song.chip,
    ),
    intent: song.intent ?? undefined,
  };
}

export function present(
  song: StoredSong,
  forks = 0,
  lineage?: Lineage,
): SongResponse {
  const validation = validateSong(toLibrarySong(song));
  const { userId, ...publicSong } = song;
  return {
    ...publicSong,
    url: `${SITE}/s/${song.id}`,
    mp3: `${SITE}/s/${song.id}.mp3`,
    wav: `${SITE}/s/${song.id}.wav`,
    measured: validation.measured,
    forks,
    authorVerified: userId !== null,
    ...(lineage ? { lineage } : {}),
  };
}

/** Validates against the library, which is the same check the player runs. */
export function check(input: SongInput): { ok: boolean; issues: Issue[]; measured: Measured | null } {
  const result = validateSong(
    toLibrarySong({
      id: "check",
      parentId: null,
      rootId: "check",
      depth: 0,
      title: null,
      bpm: input.bpm,
      chip: input.chip,
      patterns: input.patterns,
      order: input.order,
      intent: input.intent ?? null,
      author: null,
      keyId: null,
      userId: null,
      createdAt: 0,
    }),
  );
  return { ok: result.ok, issues: result.issues, measured: result.measured };
}

export async function insert(
  input: SongInput,
  parent: StoredSong | null,
  caller: Caller,
): Promise<StoredSong> {
  const client = await db();
  const id = newId();
  const song: StoredSong = {
    id,
    parentId: parent?.id ?? null,
    /*
     * The root and the depth are settled at write time and never touched again.
     * A counter that is incremented can drift from the truth it counts; a value
     * copied from the parent at the moment of forking cannot.
     */
    rootId: parent ? parent.rootId : id,
    depth: parent ? parent.depth + 1 : 0,
    title: input.title ?? null,
    bpm: input.bpm,
    chip: input.chip,
    patterns: input.patterns,
    order: input.order,
    intent: input.intent && Object.keys(input.intent).length > 0 ? input.intent : null,
    author: input.author ?? null,
    keyId: caller.keyId,
    userId: caller.userId,
    createdAt: Date.now(),
  };
  await client.execute({
    sql: `insert into songs
            (id, parent_id, root_id, depth, title, bpm, chip, patterns, song_order, intent, author, key_id, user_id, created_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      song.id,
      song.parentId,
      song.rootId,
      song.depth,
      song.title,
      song.bpm,
      song.chip,
      JSON.stringify(song.patterns),
      JSON.stringify(song.order),
      song.intent ? JSON.stringify(song.intent) : null,
      song.author,
      song.keyId,
      song.userId,
      song.createdAt,
    ],
  });
  return song;
}

function rowToSong(row: Record<string, unknown>): StoredSong {
  const id = String(row.id);
  return {
    id,
    parentId: row.parent_id === null ? null : String(row.parent_id),
    // Rows written before the column existed have no root; they are their own.
    rootId: row.root_id === null || row.root_id === undefined ? id : String(row.root_id),
    depth: Number(row.depth ?? 0),
    title: row.title === null ? null : String(row.title),
    bpm: Number(row.bpm),
    chip: String(row.chip),
    patterns: JSON.parse(String(row.patterns)),
    order: JSON.parse(String(row.song_order)),
    intent: row.intent === null || row.intent === undefined ? null : (JSON.parse(String(row.intent)) as Intent),
    author: row.author === null ? null : String(row.author),
    keyId: row.key_id === null || row.key_id === undefined ? null : String(row.key_id),
    userId: row.user_id == null ? null : String(row.user_id),
    createdAt: Number(row.created_at),
  };
}

const relative = (row: Record<string, unknown>): Relative => ({
  id: String(row.id),
  title: row.title === null ? null : String(row.title),
  createdAt: Number(row.created_at),
});

/** Where a song sits in its tree: what it came from, and what came from it. */
export async function lineageOf(song: StoredSong): Promise<Lineage> {
  const client = await db();

  const [parent, root, children, family] = await Promise.all([
    song.parentId
      ? client.execute({
          sql: `select id, title, created_at from songs where id = ? and deleted_at is null`,
          args: [song.parentId],
        })
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    song.rootId !== song.id && song.rootId !== song.parentId
      ? client.execute({
          sql: `select id, title, created_at from songs where id = ? and deleted_at is null`,
          args: [song.rootId],
        })
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    client.execute({
      sql: `select id, title, created_at from songs
            where parent_id = ? and deleted_at is null
            order by created_at desc limit 20`,
      args: [song.id],
    }),
    // One query for the whole tree, which is what root_id is for. Walking
    // parent links would be one round trip per generation.
    client.execute({
      sql: `select count(*) as n from songs where root_id = ? and deleted_at is null`,
      args: [song.rootId],
    }),
  ]);

  return {
    parent: parent.rows[0] ? relative(parent.rows[0] as Record<string, unknown>) : null,
    root: root.rows[0] ? relative(root.rows[0] as Record<string, unknown>) : null,
    children: children.rows.map((r) => relative(r as Record<string, unknown>)),
    familySize: Number((family.rows[0] as { n?: number } | undefined)?.n ?? 1),
  };
}

/** Songs published by one account, newest first. */
export async function listByUser(userId: string, limit = 50): Promise<StoredSong[]> {
  const client = await db();
  const rows = await client.execute({
    sql: `select * from songs where user_id = ? and deleted_at is null
          order by created_at desc limit ?`,
    args: [userId, limit],
  });
  return rows.rows.map((r) => rowToSong(r as Record<string, unknown>));
}

/**
 * Marks a song deleted without removing the row.
 *
 * Its forks keep pointing at it, and a hard delete would orphan them - a
 * lineage with a hole in it is worse than one with a tombstone. The audio and
 * the page stop being served; the tree stays walkable.
 */
export async function softDelete(id: string): Promise<void> {
  const client = await db();
  await client.execute({
    sql: `update songs set deleted_at = ?, title = null, author = null where id = ?`,
    args: [Date.now(), id],
  });
}

export async function find(id: string): Promise<{ song: StoredSong; forks: number } | null> {
  const client = await db();
  const rows = await client.execute({
    sql: `select * from songs where id = ? and deleted_at is null limit 1`,
    args: [id],
  });
  const row = rows.rows[0];
  if (!row) return null;

  const forks = await client.execute({
    sql: `select count(*) as n from songs where parent_id = ? and deleted_at is null`,
    args: [id],
  });

  return {
    song: rowToSong(row as Record<string, unknown>),
    forks: Number(forks.rows[0]?.n ?? 0),
  };
}
