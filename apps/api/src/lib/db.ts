import { createClient, type Client } from "@libsql/client";

/**
 * Where songs live.
 *
 * The same split redburner arrived at the hard way: only production talks to
 * the hosted database. Everything else gets a local file, so a test run cannot
 * write rows somebody will later mistake for people.
 */
const LOCAL_FILE = ".chipvoice-dev.db";

let client: Client | null = null;
let ready = false;

function target(): { url: string; token?: string } | null {
  const env = process.env.VERCEL_ENV;
  if (env === "production") {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) return null;
    return { url, token: process.env.TURSO_AUTH_TOKEN };
  }
  if (process.env.TURSO_DEV_DATABASE_URL) {
    return {
      url: process.env.TURSO_DEV_DATABASE_URL,
      // Its own token on purpose: a preview holding the production token and a
      // development URL authenticates against the wrong database and fails in
      // a way that looks like the URL is wrong.
      token: process.env.TURSO_DEV_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN,
    };
  }
  if (!env) return { url: `file:${LOCAL_FILE}` };
  return null;
}

export function hasDatabase() {
  return target() !== null;
}

export async function db(): Promise<Client> {
  const where = target();
  if (!where) throw new Error("no database configured");
  if (!client) {
    client = createClient({ url: where.url, authToken: where.token });
  }
  if (!ready) {
    // Created on first use rather than by a migration step, because there is
    // one table and no scheduler here to run migrations with.
    await client.execute(`
      create table if not exists songs (
        id          text primary key,
        parent_id   text,
        title       text,
        bpm         integer not null,
        chip        text not null default '2a03',
        patterns    text not null,
        song_order  text not null,
        author      text,
        created_at  integer not null
      )
    `);
    await client.execute(
      `create index if not exists songs_parent on songs (parent_id)`,
    );
    ready = true;
  }
  return client;
}

const ALPHABET = "0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * Eight characters of base62, minus the glyphs that look like each other.
 *
 * These end up read aloud, typed from a screenshot and pasted into chat, so
 * `l`, `I`, `O` and `1` being distinguishable is worth more than the handful of
 * extra combinations they would add.
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}
