import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { createDb, migrate, admitWindow } from "../dist/db/index.js";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "web-kit-db-test-"));
}

test("createDb applies migrations in order and exposes a working connection", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const migrations = [
    { name: "create-songs", up: async (tx) => tx.execute(`create table songs (id text primary key, title text not null)`) },
    { name: "add-tempo", up: async (tx) => tx.execute(`alter table songs add column tempo integer`) },
  ];
  const db = createDb({ localFile: join(dir, "one.db"), envPrefix: "WEBKIT_TEST_ONE", migrations });
  assert.equal(db.hasDatabase(), true);
  const client = await db.db();
  await client.execute({ sql: `insert into songs (id,title,tempo) values (?,?,?)`, args: ["s1", "Test Song", 120] });
  const rows = (await client.execute("select id,title,tempo from songs")).rows;
  assert.deepEqual(rows, [{ id: "s1", title: "Test Song", tempo: 120 }]);
  const applied = (await client.execute("select version,name from schema_migrations order by version")).rows;
  assert.deepEqual(
    applied.map((r) => ({ version: Number(r.version), name: String(r.name) })),
    [
      { version: 1, name: "create-songs" },
      { version: 2, name: "add-tempo" },
    ],
  );
});

test("migrate is idempotent: re-running against an already-migrated database applies nothing twice", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "two.db");
  const migrations = [
    { name: "create-notes", up: async (tx) => tx.execute(`create table notes (id text primary key)`) },
  ];
  const first = createDb({ localFile: file, envPrefix: "WEBKIT_TEST_TWO", migrations });
  await first.db();
  // A brand new createDb() instance simulates a process restart against the
  // same underlying file: migrate() must see the already-applied row and
  // neither re-run the migration nor throw.
  const second = createDb({ localFile: file, envPrefix: "WEBKIT_TEST_TWO", migrations });
  const client = await second.db();
  const applied = (await client.execute("select version,name from schema_migrations")).rows;
  assert.equal(applied.length, 1, "the migration must not have re-applied");
  // And calling migrate() a third time directly, against the same client, is
  // also a no-op rather than an error.
  await migrate(client, migrations);
  const stillApplied = (await client.execute("select version,name from schema_migrations")).rows;
  assert.equal(stillApplied.length, 1);
});

test("migrate refuses a database whose recorded history no longer matches (renamed or reordered migration)", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "three.db");
  const client = createClient({ url: `file:${file}` });
  await migrate(client, [{ name: "first", up: async (tx) => tx.execute(`create table a (id text primary key)`) }]);
  // Negative gate: an already-applied migration's name must never be able to
  // silently change out from under a database that already ran the original.
  await assert.rejects(
    migrate(client, [{ name: "first-renamed", up: async (tx) => tx.execute(`create table a (id text primary key)`) }]),
    /Unsupported database migration history\./,
  );
});

test("createDb() with no environment configured and no local file falls back to unavailable, not a crash", () => {
  const db = createDb({ localFile: ".never-created.db", envPrefix: "WEBKIT_TEST_MISSING", migrations: [] });
  const previous = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  try {
    assert.equal(db.hasDatabase(), false);
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
});

test("admitWindow allows up to the limit within a window, then rejects with a positive retryAfterMs", async (t) => {
  const dir = await tempDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const client = createClient({ url: `file:${join(dir, "admission.db")}` });
  await client.execute(
    `create table admission (scope text primary key, window integer not null, count integer not null)`,
  );
  const windowMs = 60_000;
  const first = await admitWindow(client, "admission", "pair:client-a", 2, windowMs);
  const second = await admitWindow(client, "admission", "pair:client-a", 2, windowMs);
  const third = await admitWindow(client, "admission", "pair:client-a", 2, windowMs);
  assert.deepEqual(first, { ok: true });
  assert.deepEqual(second, { ok: true });
  assert.equal(third.ok, false);
  assert.ok(third.retryAfterMs > 0 && third.retryAfterMs <= windowMs);
  // A different scope sharing the same table has its own independent budget.
  const other = await admitWindow(client, "admission", "pair:client-b", 2, windowMs);
  assert.deepEqual(other, { ok: true });
});
