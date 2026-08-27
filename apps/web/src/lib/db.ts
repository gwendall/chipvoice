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
        root_id     text,
        depth       integer not null default 0,
        title       text,
        bpm         integer not null,
        chip        text not null default '2a03',
        patterns    text not null,
        song_order  text not null,
        author      text,
        key_id      text,
        created_at  integer not null,
        deleted_at  integer
      )
    `);

    /*
     * A key is an identity, not a password.
     *
     * Nothing here is editable - a published song never changes and a fork is a
     * new id - so a key protects nothing from being written over. It exists to
     * answer three questions: which songs are mine, who actually published this,
     * and may this caller write faster than an anonymous one.
     *
     * The key itself is never stored, only its hash, which is why creating one
     * is the single moment it can ever be read.
     */
    await client.execute(`
      create table if not exists keys (
        id          text primary key,
        hash        text not null unique,
        email       text not null,
        label       text,
        created_at  integer not null,
        last_used   integer,
        revoked_at  integer
      )
    `);

    /* Single-use links, for humans who should never see a key at all. */
    await client.execute(`
      create table if not exists magic (
        token       text primary key,
        key_id      text not null,
        created_at  integer not null,
        used_at     integer
      )
    `);

    for (const index of [
      `create index if not exists songs_parent on songs (parent_id)`,
      `create index if not exists songs_root on songs (root_id)`,
      `create index if not exists songs_key on songs (key_id, created_at)`,
      `create index if not exists keys_email on keys (email)`,
    ]) {
      await client.execute(index);
    }

    // Columns added after the first deployment. SQLite has no `add column if
    // not exists`, so the failure is caught rather than checked for.
    for (const alter of [
      `alter table songs add column root_id text`,
      `alter table songs add column depth integer not null default 0`,
      `alter table songs add column key_id text`,
      `alter table songs add column deleted_at integer`,
    ]) {
      try {
        await client.execute(alter);
      } catch {
        // Already there.
      }
    }

    ready = true;
  }
  return client;
}

const ALPHABET = "0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";

/** A longer random string, for things that are secrets rather than names. */
export function secret(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * What gets stored instead of a key.
 *
 * SHA-256 with no salt on purpose: these are 48 hex characters of CSPRNG
 * output, so there is no dictionary to defend against, and a deterministic
 * hash is what lets a lookup happen in one indexed query rather than by
 * comparing against every row.
 */
export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
