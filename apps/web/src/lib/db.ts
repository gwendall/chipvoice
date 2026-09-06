import { createClient, type Client } from "@libsql/client";
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
  if (!ready) ready = migrate(client).catch(error => { ready = null; throw error; });
  await ready;
  return client;
}

export { hashKey, newId, secret } from './crypto';
