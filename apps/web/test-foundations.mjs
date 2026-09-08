import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { build } from "../../packages/chipvoice/node_modules/esbuild/lib/main.js";
const directory = await mkdtemp(join(tmpdir(), "chipvoice-identity-"));
const file = resolve("generated/test-foundations.mjs");
process.env.VERCEL_ENV = "preview";
process.env.TURSO_DEV_DATABASE_URL = `file:${join(directory, "identity.db")}`;
process.env.TURSO_DEV_AUTH_TOKEN = "";
await build({
  stdin: {
    contents: `export * from './src/lib/auth'; export * from './src/lib/db'; export * from './src/lib/songs'; export * from './src/lib/migrations';`,
    resolveDir: process.cwd(),
  },
  outfile: file,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "silent",
});
const api = await import(pathToFileURL(file));
const legacy = createClient({ url: process.env.TURSO_DEV_DATABASE_URL });
const now = Date.now();
try {
  await legacy.batch(
    [
      `create table songs (id text primary key,parent_id text,title text,bpm integer not null,patterns text not null,song_order text not null,author text,created_at integer not null,key_id text)`,
      `create table keys (id text primary key,hash text not null unique,email text not null,label text,created_at integer not null,last_used integer,revoked_at integer)`,
      `create table magic (token text primary key,key_id text not null,created_at integer not null,used_at integer)`,
      {
        sql: `insert into keys (id,hash,email,created_at) values ('firstkey',?,'Test@Example.com',?),('nextkey',?,'test@example.com',?)`,
        args: [
          await api.hashKey("cv_live_legacy"),
          now,
          await api.hashKey("cv_live_second"),
          now,
        ],
      },
      {
        sql: `insert into magic values ('legacy-token','firstkey',?,null)`,
        args: [now],
      },
      {
        sql: `insert into songs (id,bpm,patterns,song_order,created_at,key_id) values ('oldsong1',144,?, '[0]',?,'firstkey')`,
        args: [
          JSON.stringify([
            {
              lead: "C4 . . .",
              chord: "C3 . . .",
              bass: "C2 . . .",
              perc: "K . H .",
              chordShape: [[0, 4, 7]],
            },
          ]),
          now,
        ],
      },
    ],
    "write",
  );
  await api.migrate(legacy);
  await api.migrate(legacy);
  assert.equal(
    (await legacy.execute("select * from schema_migrations")).rows.length,
    8,
  );
  assert.equal(
    Number(
      (await legacy.execute("select steps_per_beat from songs limit 1")).rows[0]
        .steps_per_beat,
    ),
    4,
    "legacy songs retain the straight grid",
  );
  assert.equal((await legacy.execute("select * from users")).rows.length, 1);
  assert.equal(
    (await legacy.execute(`select count(distinct user_id) as n from keys`))
      .rows[0].n,
    1,
  );
  const [db1, db2] = await Promise.all([api.db(), api.db()]);
  assert.equal(db1, db2);
  const bearer = (key) =>
    new Request("https://chipvoice.test/api/me", {
      headers: { authorization: `Bearer ${key}` },
    });
  const first = await api.identify(bearer("cv_live_legacy"));
  assert.ok(first.userId);
  assert.ok(
    !["firstkey", "nextkey"].includes(first.userId),
    "account IDs differ from public legacy key IDs",
  );
  assert.equal(first.email, "test@example.com");
  const oldSong = (await api.find("oldsong1")).song;
  assert.equal(oldSong.userId, first.userId);
  assert.equal("userId" in api.present(oldSong), false);
  const redeemed = await Promise.all([
    api.redeemMagicLink("legacy-token"),
    api.redeemMagicLink("legacy-token"),
  ]);
  assert.equal(
    redeemed.filter(Boolean).length,
    1,
    "one winner under concurrent redemption",
  );
  assert.ok(
    (await legacy.execute(`select used_at from magic`)).rows[0].used_at,
  );
  const session = redeemed.find(Boolean);
  const cookie = (method = "GET", origin = "https://chipvoice.test") =>
    new Request("https://chipvoice.test/api/me", {
      method,
      headers: { cookie: `${api.SESSION_COOKIE}=${session}`, origin },
    });
  assert.equal((await api.identify(cookie())).userId, first.userId);
  assert.equal(
    (await api.identify(cookie("POST", "https://evil.test"))).userId,
    null,
  );
  assert.equal(
    (await api.identify(bearer("cv_live_legacy"))).userId,
    first.userId,
    "login leaves API keys usable",
  );
  const invalid = cookie();
  invalid.headers.set("authorization", "Bearer invalid");
  assert.equal((await api.identify(invalid)).userId, null);
  const replacement = await api.createKey("TEST@example.com", "replacement");
  const other = await api.createKey("other@example.com", "other");
  const caller = await api.identify(bearer(replacement.key));
  assert.equal(caller.userId, first.userId);
  const input = {
    chip: "2a03",
    bpm: 144,
    order: [0],
    patterns: oldSong.patterns,
  };
  const song = await api.insert(input, null, caller);
  const browserSong = await api.insert(
    input,
    null,
    await api.identify(cookie()),
  );
  assert.equal(browserSong.keyId, null);
  assert.equal(api.present(browserSong).authorVerified, true);
  assert.equal((await api.listByUser(first.userId)).length, 3);
  const otherCaller = await api.identify(bearer(other.key));
  assert.equal(await api.revokeKey(otherCaller.userId, replacement.id), false);
  assert.equal(await api.revokeKey(first.userId, replacement.id), true);
  assert.equal((await api.identify(bearer(replacement.key))).userId, null);
  assert.equal((await api.find(song.id)).song.userId, first.userId);
  assert.ok(
    (await api.listKeys(first.userId)).every(
      (key) => !("hash" in key) && !("key" in key),
    ),
  );
  await api.revokeSession(cookie());
  assert.equal((await api.identify(cookie())).userId, null);
  const token = await api.createSignInLink("test@example.com");
  await db1.execute({
    sql: "update login_tokens set created_at=0 where hash=?",
    args: [await api.hashKey(token)],
  });
  assert.equal(await api.redeemMagicLink(token), null);
  const expired = await api.redeemMagicLink(
    await api.createSignInLink("test@example.com"),
  );
  await db1.execute({
    sql: "update sessions set expires_at=0 where hash=?",
    args: [await api.hashKey(expired)],
  });
  assert.equal(
    (
      await api.identify(
        new Request("https://chipvoice.test/api/me", {
          headers: { cookie: `${api.SESSION_COOKIE}=${expired}` },
        }),
      )
    ).userId,
    null,
  );
  const fresh = createClient({ url: `file:${join(directory, "fresh.db")}` });
  await api.migrate(fresh);
  assert.equal(
    (await fresh.execute("select * from schema_migrations")).rows.length,
    8,
  );
  fresh.close();
  // Frozen v4 publication tables exercise the real profile/data upgrade.
  const published = createClient({
    url: `file:${join(directory, "published-v4.db")}`,
  });
  await published.batch(
    [
      "create table schema_migrations(version integer primary key,name text not null,applied_at integer not null)",
      ...[
        "baseline",
        "stable-users-and-sessions",
        "song-grid-resolution",
        "complete-project-publications",
      ].map((name, i) => ({
        sql: "insert into schema_migrations values(?,?,?)",
        args: [i + 1, name, now],
      })),
      "create table profiles(id text primary key,user_id text not null unique,handle text unique collate nocase,display_name text not null default '',bio text not null default '',created_at integer not null)",
      "create table projects(id text primary key,user_id text not null,parent_id text,root_id text not null,document text not null,content_hash text not null,title text not null,chip text not null,tags text not null,visibility text not null,created_at integer not null,deleted_at integer,request_key text,unique(user_id,request_key))",
      "create table project_jobs(id text primary key,project_id text not null,kind text not null,status text not null,engine text not null,created_at integer not null,started_at integer,finished_at integer,error text,bytes integer,etag text,progress real not null default 0,unique(project_id,kind))",
      "create table project_audio(job_id text not null,chunk integer not null,bytes blob not null,primary key(job_id,chunk))",
      {
        sql: "insert into profiles values(?,?,?,?,?,?)",
        args: [
          "stable-artist",
          "stable-owner",
          "old_artist",
          "Original artist",
          "Original biography",
          now,
        ],
      },
      {
        sql: "insert into projects(id,user_id,root_id,document,content_hash,title,chip,tags,visibility,created_at,request_key) values(?,?,?,?,?,?,?,'[]','public',?,?)",
        args: [
          "stable-song",
          "stable-owner",
          "stable-song",
          '{"settings":{"chip":"snes"},"source":{"kind":"score","score":{"title":"Old source"}}}',
          "unchanged-content-hash",
          "Original song",
          "snes",
          now,
          "stable-retry",
        ],
      },
      {
        sql: "insert into project_jobs(id,project_id,kind,status,engine,created_at,bytes,etag) values('stable-job','stable-song','full','ready','old-engine',?,4,'old-etag')",
        args: [now],
      },
      {
        sql: "insert into project_audio values('stable-job',0,?)",
        args: [new Uint8Array([82, 73, 70, 70])],
      },
    ],
    "write",
  );
  await api.migrate(published);
  await api.migrate(published);
  const oldArtist = (
    await published.execute("select * from profiles where id='stable-artist'")
  ).rows[0];
  assert.equal(oldArtist.handle, "old_artist");
  assert.equal(oldArtist.is_default, 1);
  assert.equal(oldArtist.avatar, null);
  const oldPublication = (
    await published.execute("select * from projects where id='stable-song'")
  ).rows[0];
  assert.equal(oldPublication.profile_id, "stable-artist");
  assert.equal(oldPublication.content_hash, "unchanged-content-hash");
  assert.equal(oldPublication.request_key, "stable-retry");
  assert.equal(
    oldPublication.composition_hash,
    await api.hashKey(
      JSON.stringify(JSON.parse(oldPublication.document).source),
    ),
  );
  const oldJob = (
    await published.execute("select * from project_jobs where id='stable-job'")
  ).rows[0];
  assert.equal(oldJob.engine, "old-engine");
  assert.equal(oldJob.etag, "old-etag");
  assert.equal(oldJob.status, "ready");
  assert.equal(oldJob.mp3_status, "none");
  assert.deepEqual(
    new Uint8Array(
      (
        await published.execute("select bytes from project_audio")
      ).rows[0].bytes,
    ),
    new Uint8Array([82, 73, 70, 70]),
  );
  // Freeze the populated database at v6, then verify prompt lineage backfill.
  await published.batch([
    "delete from schema_migrations where version>=7",
    "alter table projects drop column origin",
    "alter table projects drop column origin_model",
    "insert into generations(id,user_id,profile_id,request_key,request_hash,request,model,status,created_at,project_id) values('old-generation','stable-owner','stable-artist','old-generation','hash','{}','recorded-model','ready',0,'stable-song')",
    ...[['same-source', 'stable-song', oldPublication.composition_hash], ['changed-source', 'same-source', 'changed-hash'], ['derived-copy', 'changed-source', 'changed-hash']].map(([id, parent, hash]) => ({
      sql: "insert into projects(id,user_id,parent_id,root_id,document,content_hash,title,chip,tags,visibility,created_at,profile_id,composition_hash) values(?,'stable-owner',?,'stable-song','{}','hash','Test','md','[]','public',0,'stable-artist',?)",
      args: [id, parent, hash],
    })),
  ], 'write');
  await api.migrate(published);
  const origins = (await published.execute("select id,origin,origin_model from projects")).rows;
  for (const [id, method] of [['stable-song','prompt'], ['same-source','prompt'], ['changed-source','prompt-derived'], ['derived-copy','prompt-derived']]) {
    const row = origins.find(row => row.id === id);
    assert.equal(row.origin, method); assert.equal(row.origin_model, 'recorded-model');
  }
  published.close();
  const broken = createClient({ url: `file:${join(directory, "broken.db")}` });
  await broken.execute("create table users (incompatible text)");
  await assert.rejects(api.migrate(broken), /already exists/);
  assert.equal(
    (
      await broken.execute(
        `select name from sqlite_master where name='schema_migrations'`,
      )
    ).rows.length,
    0,
    "failed migration rolls back schema and markers",
  );
  broken.close();
  db1.close();
  console.log(
    "PASS legacy/fresh/idempotent/atomic migrations; ownership; concurrent/expired login; session isolation; key revocation",
  );
} finally {
  legacy.close();
  await rm(directory, { recursive: true, force: true });
  await rm(file, { force: true });
}
