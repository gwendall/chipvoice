import { createHash } from "node:crypto";
import {
  createClient,
  type Client,
  type InStatement,
  type InArgs,
  type Transaction,
  type TransactionMode,
} from "@libsql/client";

export interface Migration {
  name: string;
  up: (tx: Transaction) => Promise<void>;
}

/** Adds any of `definitions`' columns that `table` does not already have.
 * Idempotent: a column present from an earlier run, or from `create table`
 * itself defining it, is left alone. */
export async function addColumns(
  tx: Transaction,
  table: string,
  definitions: Record<string, string>,
) {
  const present = new Set(
    (await tx.execute(`pragma table_info(${table})`)).rows.map((row) => String(row.name)),
  );
  for (const [name, type] of Object.entries(definitions))
    if (!present.has(name)) await tx.execute(`alter table ${table} add column ${name} ${type}`);
}

/** Version markers and schema/data changes commit together. No broad ALTER
 * catch: a permission, syntax or connection error aborts and remains visible.
 * Applied migrations are tracked by name in `schema_migrations`, so renaming
 * or reordering an already-applied entry in `migrations` is unsupported: a
 * database that already ran it sees a mismatched name and refuses to start. */
export async function migrate(client: Client, migrations: Migration[]) {
  const tx = await client.transaction("write");
  try {
    await tx.execute(
      `create table if not exists schema_migrations (version integer primary key, name text not null, applied_at integer not null)`,
    );
    const applied = (
      await tx.execute(`select version,name from schema_migrations order by version`)
    ).rows.map((row) => ({ version: Number(row.version), name: String(row.name) }));
    if (
      applied.some((row, i) => row.version !== i + 1 || row.name !== migrations[i]?.name) ||
      applied.length > migrations.length
    )
      throw new Error("Unsupported database migration history.");
    for (let i = applied.length; i < migrations.length; i++) {
      await migrations[i]!.up(tx);
      await tx.execute({
        sql: `insert into schema_migrations values (?,?,?)`,
        args: [i + 1, migrations[i]!.name, Date.now()],
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

async function waitForLocalWriter<T>(operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (
        !["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT"].includes((error as { code?: string })?.code ?? "") ||
        Date.now() >= deadline
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

export interface CreateDbOptions {
  /** The local file used when no environment (`VERCEL_ENV` unset) and no dev
   * database is configured, e.g. ".chipvoice-dev.db". Passed to libsql as
   * `file:<localFile>`. */
  localFile: string;
  /**
   * Environment variable prefix, e.g. "TURSO". Reads
   * `${envPrefix}_DATABASE_URL` / `${envPrefix}_AUTH_TOKEN` in production and
   * `${envPrefix}_DEV_DATABASE_URL` / `${envPrefix}_DEV_AUTH_TOKEN`
   * otherwise, unchanged in shape from chipvoice's own original names so an
   * app that already sets `TURSO_*` keeps working without renaming anything.
   */
  envPrefix: string;
  migrations: Migration[];
}

export interface Db {
  hasDatabase(): boolean;
  db(): Promise<Client>;
}

/** One connection per process, lazily created and migrated on first use.
 * `VERCEL_ENV === "production"` talks to the hosted database; anything else
 * (preview, CI, local dev) gets its own dev database or a local SQLite file,
 * so a test run cannot write rows somebody later mistakes for real ones. */
export function createDb(options: CreateDbOptions): Db {
  const { localFile, envPrefix, migrations } = options;
  let client: Client | null = null;
  let ready: Promise<void> | null = null;

  function target(): { url: string; token?: string } | null {
    const env = process.env.VERCEL_ENV;
    if (env === "production") {
      const url = process.env[`${envPrefix}_DATABASE_URL`];
      if (!url) return null;
      return { url, token: process.env[`${envPrefix}_AUTH_TOKEN`] };
    }
    if (process.env[`${envPrefix}_DEV_DATABASE_URL`]) {
      const token = process.env[`${envPrefix}_DEV_AUTH_TOKEN`];
      // Its own token, full stop: falling back to the production token would
      // put it to work in whatever preview or branch sets a development URL,
      // and a token that fails against the wrong database looks like a wrong
      // URL. Refuse instead of guessing. `undefined` means the variable was
      // never set; an explicit empty string (every local test fixture's
      // local sqlite file needs no token at all) is a deliberate, different
      // thing and stays allowed.
      if (token === undefined)
        throw new Error(`${envPrefix}_DEV_DATABASE_URL is set without ${envPrefix}_DEV_AUTH_TOKEN`);
      return { url: process.env[`${envPrefix}_DEV_DATABASE_URL`]!, token };
    }
    if (!env) return { url: `file:${localFile}` };
    return null;
  }

  function hasDatabase() {
    return target() !== null;
  }

  async function db(): Promise<Client> {
    const where = target();
    if (!where) throw new Error("no database configured");
    if (!client) {
      client = createClient({ url: where.url, authToken: where.token });
      if (where.url.startsWith("file:")) {
        // libsql replaces its connection after transaction(), losing PRAGMA settings.
        // Retry only explicit SQLite contention, without blocking the Node event loop.
        const execute = client.execute.bind(client),
          transaction = client.transaction.bind(client);
        client.execute = (statement: InStatement, args?: InArgs) =>
          waitForLocalWriter(async () => {
            try {
              return await (typeof statement === "string" ? execute(statement, args) : execute(statement));
            } catch (error) {
              // A failed local statement can retain a read snapshot in libsql's connection.
              // Drop only that standalone connection; explicit transactions own separate ones.
              if (["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT"].includes((error as { code?: string })?.code ?? ""))
                await client!.reconnect();
              throw error;
            }
          });
        client.transaction = async (mode?: TransactionMode) => {
          const tx = await waitForLocalWriter(() => transaction(mode));
          // COMMIT can also meet a short-lived reader on another connection.
          const commit = tx.commit.bind(tx);
          tx.commit = () => waitForLocalWriter(commit);
          return tx;
        };
      }
    }
    if (!ready)
      ready = (async () => {
        // WAL persists across replacement connections and lets readers coexist with a commit.
        if (where.url.startsWith("file:")) await client!.execute("pragma journal_mode=wal");
        await migrate(client!, migrations);
      })().catch((error) => {
        ready = null;
        throw error;
      });
    await ready;
    return client;
  }

  return { hasDatabase, db };
}

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

export type AdmitResult = { ok: true } | { ok: false; retryAfterMs: number };

// The longest window any caller admits with, for any scope sharing the same
// table. `window` is stored as the window's own absolute start time (ms
// since epoch), not a dimensionless index, precisely so that one caller's
// housekeeping delete cannot mistake another caller's longer-lived, still
// current row for garbage: the horizon has to outlive the longest window in
// use, whichever call happens to run it, not just this call's own `windowMs`.
const MAX_ADMISSION_WINDOW_MS = 15 * 60_000;

/**
 * The DB-backed admission-window pattern behind chipvoice's `admitProject`:
 * an `insert ... on conflict` that resets a scope's count when its window
 * has rolled over and rejects once the scope has spent its budget within
 * the current one. Kept table-agnostic and non-throwing (a thin app-specific
 * wrapper turns `{ok:false}` into whatever error type that app raises) so the
 * exact SQL shape, unchanged from chipvoice's original, is reusable by name
 * for a different table.
 */
export async function admitWindow(
  client: Client,
  table: string,
  scope: string,
  limit: number,
  windowMs = 60_000,
): Promise<AdmitResult> {
  const now = Date.now(),
    window = Math.floor(now / windowMs) * windowMs;
  await client.execute({
    sql: `delete from ${table} where window < ?`,
    args: [window - MAX_ADMISSION_WINDOW_MS * 2],
  });
  const result = await client.execute({
    sql: `insert into ${table}(scope,window,count) values(?,?,1) on conflict(scope) do update set window=excluded.window,count=case when ${table}.window=excluded.window then ${table}.count+1 else 1 end where ${table}.window<>excluded.window or ${table}.count<? returning count`,
    args: [digest(scope), window, limit],
  });
  if (!result.rows.length) return { ok: false, retryAfterMs: window + windowMs - now };
  return { ok: true };
}
