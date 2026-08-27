import { db, hashKey, newId, secret } from "./db";

/**
 * Who is calling, when anybody is.
 *
 * Anonymous stays allowed everywhere. Publishing without a key is the shortest
 * path from an idea to a link, and putting a form in front of the only thing
 * this product does would be trading the product for the account system.
 */
export interface Caller {
  keyId: string | null;
  email: string | null;
}

export const ANONYMOUS: Caller = { keyId: null, email: null };

const PREFIX = "cv_live_";

export async function identify(request: Request): Promise<Caller> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return ANONYMOUS;
  const presented = header.slice(7).trim();
  if (!presented.startsWith(PREFIX)) return ANONYMOUS;

  const client = await db();
  const rows = await client.execute({
    sql: `select id, email from keys where hash = ? and revoked_at is null limit 1`,
    args: [await hashKey(presented)],
  });
  const row = rows.rows[0];
  if (!row) return ANONYMOUS;

  // Best effort: a failed timestamp update must not fail the request it was
  // attached to.
  void client
    .execute({ sql: `update keys set last_used = ? where id = ?`, args: [Date.now(), row.id] })
    .catch(() => {});

  return { keyId: String(row.id), email: String(row.email) };
}

export interface IssuedKey {
  id: string;
  /** The only moment this exists in readable form. */
  key: string;
}

export async function createKey(email: string, label: string | null): Promise<IssuedKey> {
  const client = await db();
  const key = PREFIX + secret(24);
  const id = newId();
  await client.execute({
    sql: `insert into keys (id, hash, email, label, created_at) values (?, ?, ?, ?, ?)`,
    args: [id, await hashKey(key), email.toLowerCase().trim(), label, Date.now()],
  });
  return { id, key };
}

/**
 * A single-use link, so a person never has to see a key.
 *
 * The token is what lands in an inbox; following it hands the key to the
 * browser once and burns the token. Nothing here is a session: the browser
 * keeps the key, and there is no server-side state to expire.
 */
export async function createMagicLink(keyId: string): Promise<string> {
  const client = await db();
  const token = secret(24);
  await client.execute({
    sql: `insert into magic (token, key_id, created_at) values (?, ?, ?)`,
    args: [token, keyId, Date.now()],
  });
  return token;
}

const MAGIC_TTL_MS = 30 * 60 * 1000;

export async function redeemMagicLink(token: string): Promise<string | null> {
  const client = await db();
  const rows = await client.execute({
    sql: `select token, key_id, created_at, used_at from magic where token = ? limit 1`,
    args: [token],
  });
  const row = rows.rows[0];
  if (!row || row.used_at !== null) return null;
  if (Date.now() - Number(row.created_at) > MAGIC_TTL_MS) return null;

  await client.execute({
    sql: `update magic set used_at = ? where token = ?`,
    args: [Date.now(), token],
  });

  // The key is re-issued rather than recovered: only its hash was ever stored,
  // which is the point of storing only the hash.
  const keyRow = await client.execute({
    sql: `select email, label from keys where id = ? limit 1`,
    args: [String(row.key_id)],
  });
  const existing = keyRow.rows[0];
  if (!existing) return null;

  const fresh = PREFIX + secret(24);
  await client.execute({
    sql: `update keys set hash = ? where id = ?`,
    args: [await hashKey(fresh), String(row.key_id)],
  });
  return fresh;
}
