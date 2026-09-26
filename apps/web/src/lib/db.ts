import { createClient, type Client, type InStatement, type InArgs, type TransactionMode } from "@libsql/client";
import { migrate } from "./migrations";

/**
 * Where songs live.
 *
 * The same split redburner arrived at the hard way: only production talks to
 * the hosted database. Everything else gets a local file, so a test run cannot
 * write rows somebody will later mistake for people.
 */
const LOCAL_FILE = ".chipvoice-dev.db";

let client: Client | null = null;
let ready: Promise<void> | null = null;

async function waitForLocalWriter<T>(operation: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 5000;
  for (;;) {
    try { return await operation(); }
    catch (error) {
      if (!["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT"].includes((error as { code?: string })?.code ?? "") || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}

function target(): { url: string; token?: string } | null {
  const env = process.env.VERCEL_ENV;
  if (env === "production") {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) return null;
    return { url, token: process.env.TURSO_AUTH_TOKEN };
  }
  if (process.env.TURSO_DEV_DATABASE_URL) {
    const token = process.env.TURSO_DEV_AUTH_TOKEN;
    // Its own token, full stop: a preview that fell back to the production
    // token would authenticate against production while pointed at a
    // development URL, and every read and write would go to the wrong
    // database silently instead of failing in a way anyone would notice.
    // `undefined` means the variable was never set; an explicit empty string
    // (every local test fixture's local sqlite file needs no token at all)
    // is a deliberate, different thing and stays allowed.
    if (token === undefined)
      throw new Error("TURSO_DEV_DATABASE_URL is set without TURSO_DEV_AUTH_TOKEN");
    return { url: process.env.TURSO_DEV_DATABASE_URL, token };
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
    if (where.url.startsWith("file:")) {
      // libsql replaces its connection after transaction(), losing PRAGMA settings.
      // Retry only explicit SQLite contention, without blocking the Node event loop.
      const execute = client.execute.bind(client), transaction = client.transaction.bind(client);
      client.execute = (statement: InStatement, args?: InArgs) => waitForLocalWriter(async () => {
        try { return await (typeof statement === "string" ? execute(statement, args) : execute(statement)); }
        catch (error) {
          // A failed local statement can retain a read snapshot in libsql's connection.
          // Drop only that standalone connection; explicit transactions own separate ones.
          if (["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT"].includes((error as { code?: string })?.code ?? "")) await client!.reconnect();
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
  if (!ready) ready = (async () => {
    // WAL persists across replacement connections and lets readers coexist with a commit.
    if (where.url.startsWith("file:")) await client!.execute("pragma journal_mode=wal");
    await migrate(client!);
  })().catch(error => { ready = null; throw error; });
  await ready;
  return client;
}

export { hashKey, newId, secret } from './crypto';
