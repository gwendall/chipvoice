import { createHash } from "node:crypto";
import type { Client, Transaction } from "@libsql/client";
import { hashKey, newId } from "./crypto";

async function addColumns(
  tx: Transaction,
  table: string,
  definitions: Record<string, string>,
) {
  const present = new Set(
    (await tx.execute(`pragma table_info(${table})`)).rows.map((row) =>
      String(row.name),
    ),
  );
  for (const [name, type] of Object.entries(definitions))
    if (!present.has(name))
      await tx.execute(`alter table ${table} add column ${name} ${type}`);
}

const migrations = [
  {
    name: "baseline",
    async up(tx: Transaction) {
      await tx.execute(
        `create table if not exists songs (id text primary key, parent_id text, title text, bpm integer not null, patterns text not null, song_order text not null, author text, created_at integer not null)`,
      );
      await addColumns(tx, "songs", {
        chip: "text not null default '2a03'",
        root_id: "text",
        depth: "integer not null default 0",
        intent: "text",
        key_id: "text",
        deleted_at: "integer",
      });
      await tx.execute(
        `create table if not exists keys (id text primary key, hash text not null unique, email text not null, label text, created_at integer not null, last_used integer, revoked_at integer)`,
      );
      await tx.execute(
        `create table if not exists magic (token text primary key, key_id text not null, created_at integer not null, used_at integer)`,
      );
      for (const [name, columns] of Object.entries({
        songs_parent: "songs (parent_id)",
        songs_root: "songs (root_id)",
        songs_key: "songs (key_id, created_at)",
        keys_email: "keys (email)",
      }))
        await tx.execute(`create index if not exists ${name} on ${columns}`);
    },
  },
  {
    name: "stable-users-and-sessions",
    async up(tx: Transaction) {
      await tx.execute(
        `create table users (id text primary key, email text not null unique, created_at integer not null)`,
      );
      await addColumns(tx, "keys", { user_id: "text" });
      await addColumns(tx, "songs", { user_id: "text" });
      const accounts = await tx.execute(
        `select lower(trim(email)) as email, min(created_at) as created_at from keys group by lower(trim(email))`,
      );
      for (const row of accounts.rows)
        await tx.execute({
          sql: "insert into users (id,email,created_at) values (?,?,?)",
          args: [newId(), row.email, row.created_at],
        });
      await tx.execute(
        `update keys set user_id = (select id from users where users.email = lower(trim(keys.email)))`,
      );
      await tx.execute(
        `update songs set user_id = (select user_id from keys where keys.id = songs.key_id)`,
      );
      await tx.execute(
        `create table sessions (hash text primary key, user_id text not null, created_at integer not null, expires_at integer not null, revoked_at integer)`,
      );
      await tx.execute(
        `create table login_tokens (hash text primary key, user_id text not null, created_at integer not null, used_at integer, session_hash text)`,
      );
      // Existing emailed links remain redeemable; new tokens are stored hashed.
      const old = await tx.execute(
        `select magic.*, keys.user_id from magic join keys on keys.id = magic.key_id where keys.revoked_at is null`,
      );
      for (const row of old.rows)
        await tx.execute({
          sql: `insert into login_tokens (hash,user_id,created_at,used_at) values (?,?,?,?)`,
          args: [
            await hashKey(String(row.token)),
            row.user_id,
            row.created_at,
            row.used_at,
          ],
        });
      await tx.execute(`create index songs_user on songs (user_id,created_at)`);
      await tx.execute(`create index keys_user on keys (user_id)`);
      await tx.execute(`create index sessions_expiry on sessions (expires_at)`);
      await tx.execute(
        `create index login_tokens_created on login_tokens (created_at)`,
      );
    },
  },
  {
    name: "song-grid-resolution",
    async up(tx: Transaction) {
      await addColumns(tx, "songs", {
        steps_per_beat:
          "integer not null default 4 check (steps_per_beat in (4,12))",
      });
    },
  },

  {
    name: "complete-project-publications",
    async up(tx: Transaction) {
      await tx.execute(
        `create table profiles (id text primary key, user_id text not null unique, handle text unique collate nocase, display_name text not null default '', bio text not null default '', created_at integer not null)`,
      );
      await tx.execute(
        `create table projects (id text primary key, user_id text not null, parent_id text, root_id text not null, document text not null, content_hash text not null, title text not null, chip text not null, tags text not null, visibility text not null check(visibility in ('public','unlisted','private')), created_at integer not null, deleted_at integer, request_key text, unique(user_id,request_key))`,
      );
      await tx.execute(
        `create index projects_public on projects(visibility,deleted_at,created_at,id)`,
      );
      await tx.execute(
        `create index projects_owner on projects(user_id,created_at,id)`,
      );
      await tx.execute(`create index projects_parent on projects(parent_id)`);
      await tx.execute(
        `create table favourites (project_id text not null,user_id text not null,created_at integer not null,primary key(project_id,user_id))`,
      );
      await tx.execute(
        `create table project_jobs (id text primary key,project_id text not null,kind text not null check(kind in ('preview','full')),status text not null,engine text not null,created_at integer not null,started_at integer,finished_at integer,error text,bytes integer,etag text,progress real not null default 0,unique(project_id,kind))`,
      );
      await tx.execute(
        `create table project_audio (job_id text not null,chunk integer not null,bytes blob not null,primary key(job_id,chunk))`,
      );
      await tx.execute(
        `create table project_admission (scope text primary key, window integer not null, count integer not null)`,
      );
      await tx.execute(
        `create table project_reports (project_id text not null,user_id text not null,reason text not null,created_at integer not null,primary key(project_id,user_id))`,
      );
    },
  },

  {
    name: "artists-and-agent-grants",
    async up(tx: Transaction) {
      await tx.execute(`alter table profiles rename to old_profiles`);
      await tx.execute(
        `create table profiles (id text primary key,user_id text not null,handle text unique collate nocase,display_name text not null default '',bio text not null default '',created_at integer not null,is_default integer not null default 0,kind text not null default 'human',avatar text)`,
      );
      await tx.execute(
        `insert into profiles(id,user_id,handle,display_name,bio,created_at,is_default) select id,user_id,handle,display_name,bio,created_at,1 from old_profiles`,
      );
      await tx.execute(`drop table old_profiles`);
      await tx.execute(
        `create unique index profiles_default on profiles(user_id) where is_default=1`,
      );
      await tx.execute(`create index profiles_owner on profiles(user_id)`);
      await addColumns(tx, "projects", {
        profile_id: "text",
        composition_hash: "text",
      });
      await tx.execute(
        `update projects set profile_id=(select id from profiles where profiles.user_id=projects.user_id and is_default=1)`,
      );
      const publications = await tx.execute("select id,document from projects");
      for (const row of publications.rows) {
        // Stored project documents already use recursively sorted canonical JSON.
        const source = JSON.parse(String(row.document)).source;
        await tx.execute({
          sql: "update projects set composition_hash=? where id=?",
          args: [
            createHash("sha256").update(JSON.stringify(source)).digest("hex"),
            row.id,
          ],
        });
      }
      await tx.execute(
        `create index projects_artist on projects(profile_id,composition_hash,created_at)`,
      );
      await tx.execute(
        `create table agent_requests (hash text primary key,code_hash text not null unique,label text not null,scopes text not null,created_at integer not null,expires_at integer not null,status text not null default 'pending',user_id text,profile_id text,grant_days integer,next_poll integer not null)`,
      );
      await tx.execute(
        `create table agent_grants (id text primary key,user_id text not null,profile_id text not null,hash text not null unique,label text not null,scopes text not null,created_at integer not null,expires_at integer not null,revoked_at integer,last_used integer)`,
      );
      await tx.execute(
        `create index agent_grants_owner on agent_grants(user_id)`,
      );
      await tx.execute(
        `create table evaluation_lease (singleton integer primary key default 1 check(singleton=1),id text not null,expires_at integer not null)`,
      );
      await tx.execute(
        `create table project_mp3 (job_id text not null,chunk integer not null,bytes blob not null,primary key(job_id,chunk))`,
      );
      await addColumns(tx, "project_jobs", {
        mp3_bytes: "integer",
        mp3_status: "text not null default 'none'",
        mp3_error: "text",
      });
    },
  },
];

/** Version markers and schema/data changes commit together. No broad ALTER
 * catch: a permission, syntax or connection error aborts and remains visible. */
export async function migrate(client: Client) {
  const tx = await client.transaction("write");
  try {
    await tx.execute(
      `create table if not exists schema_migrations (version integer primary key, name text not null, applied_at integer not null)`,
    );
    const applied = (
      await tx.execute(`select version from schema_migrations order by version`)
    ).rows.map((row) => Number(row.version));
    if (
      applied.some((version, i) => version !== i + 1) ||
      applied.length > migrations.length
    )
      throw new Error("Unsupported database migration history.");
    for (let i = applied.length; i < migrations.length; i++) {
      await migrations[i].up(tx);
      await tx.execute({
        sql: `insert into schema_migrations values (?,?,?)`,
        args: [i + 1, migrations[i].name, Date.now()],
      });
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
