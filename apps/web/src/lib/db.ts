import { createDb } from "web-kit/db";
import { migrations } from "./migrations";

/**
 * Where songs live.
 *
 * The same split redburner arrived at the hard way: only production talks to
 * the hosted database. Everything else gets a local file, so a test run cannot
 * write rows somebody will later mistake for people.
 *
 * `web-kit/db`'s `createDb` factory does the actual connecting/migrating
 * (decision 47); this file only supplies chipvoice's own local file name,
 * `TURSO_*` environment variable prefix and migration list, unchanged from
 * before this package existed.
 */
const instance = createDb({
  localFile: ".chipvoice-dev.db",
  envPrefix: "TURSO",
  migrations,
});

export const hasDatabase = instance.hasDatabase;
export const db = instance.db;
/** The `web-kit/db` instance itself, for `web-kit` factories (agent-auth,
 * project-http) that take a `Db` rather than two loose functions. */
export const dbInstance = instance;

export { hashKey, newId, secret } from "web-kit/crypto";
