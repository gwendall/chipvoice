import type { Client, Transaction } from '@libsql/client';
import { hashKey, newId } from './crypto';

async function addColumns(tx: Transaction, table: string, definitions: Record<string, string>) {
  const present = new Set((await tx.execute(`pragma table_info(${table})`)).rows.map(row => String(row.name)));
  for (const [name, type] of Object.entries(definitions)) if (!present.has(name)) await tx.execute(`alter table ${table} add column ${name} ${type}`);
}

const migrations = [
  { name: 'baseline', async up(tx: Transaction) {
    await tx.execute(`create table if not exists songs (id text primary key, parent_id text, title text, bpm integer not null, patterns text not null, song_order text not null, author text, created_at integer not null)`);
    await addColumns(tx, 'songs', { chip: "text not null default '2a03'", root_id:'text', depth:'integer not null default 0', intent:'text', key_id:'text', deleted_at:'integer' });
    await tx.execute(`create table if not exists keys (id text primary key, hash text not null unique, email text not null, label text, created_at integer not null, last_used integer, revoked_at integer)`);
    await tx.execute(`create table if not exists magic (token text primary key, key_id text not null, created_at integer not null, used_at integer)`);
    for (const [name, columns] of Object.entries({ songs_parent:'songs (parent_id)', songs_root:'songs (root_id)', songs_key:'songs (key_id, created_at)', keys_email:'keys (email)' })) await tx.execute(`create index if not exists ${name} on ${columns}`);
  } },
  { name: 'stable-users-and-sessions', async up(tx: Transaction) {
    await tx.execute(`create table users (id text primary key, email text not null unique, created_at integer not null)`);
    await addColumns(tx, 'keys', { user_id:'text' }); await addColumns(tx, 'songs', { user_id:'text' });
    const accounts = await tx.execute(`select lower(trim(email)) as email, min(created_at) as created_at from keys group by lower(trim(email))`);
    for (const row of accounts.rows) await tx.execute({sql:'insert into users (id,email,created_at) values (?,?,?)',args:[newId(),row.email,row.created_at]});
    await tx.execute(`update keys set user_id = (select id from users where users.email = lower(trim(keys.email)))`);
    await tx.execute(`update songs set user_id = (select user_id from keys where keys.id = songs.key_id)`);
    await tx.execute(`create table sessions (hash text primary key, user_id text not null, created_at integer not null, expires_at integer not null, revoked_at integer)`);
    await tx.execute(`create table login_tokens (hash text primary key, user_id text not null, created_at integer not null, used_at integer, session_hash text)`);
    // Existing emailed links remain redeemable; new tokens are stored hashed.
    const old = await tx.execute(`select magic.*, keys.user_id from magic join keys on keys.id = magic.key_id where keys.revoked_at is null`);
    for (const row of old.rows) await tx.execute({ sql:`insert into login_tokens (hash,user_id,created_at,used_at) values (?,?,?,?)`, args:[await hashKey(String(row.token)),row.user_id,row.created_at,row.used_at] });
    await tx.execute(`create index songs_user on songs (user_id,created_at)`); await tx.execute(`create index keys_user on keys (user_id)`);
    await tx.execute(`create index sessions_expiry on sessions (expires_at)`); await tx.execute(`create index login_tokens_created on login_tokens (created_at)`);
  } },
];

/** Version markers and schema/data changes commit together. No broad ALTER
 * catch: a permission, syntax or connection error aborts and remains visible. */
export async function migrate(client: Client) {
  const tx = await client.transaction('write');
  try {
    await tx.execute(`create table if not exists schema_migrations (version integer primary key, name text not null, applied_at integer not null)`);
    const applied = (await tx.execute(`select version from schema_migrations order by version`)).rows.map(row => Number(row.version));
    if (applied.some((version, i) => version !== i + 1) || applied.length > migrations.length) throw new Error('Unsupported database migration history.');
    for (let i = applied.length; i < migrations.length; i++) {
      await migrations[i].up(tx);
      await tx.execute({ sql:`insert into schema_migrations values (?,?,?)`, args:[i+1,migrations[i].name,Date.now()] });
    }
    await tx.commit();
  } catch (error) { await tx.rollback(); throw error; }
  finally { tx.close(); }
}
