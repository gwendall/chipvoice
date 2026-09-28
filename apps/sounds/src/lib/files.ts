import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads a content-addressed file the catalogue points at (a `Sound.variants[].files.*`
 * URL, always `/f/<sha256>.<ext>`) straight off disk. `apps/sounds/public/f/`
 * is generated, not committed (see .gitignore and docs/GAMESOUNDS.md): a zip
 * route asked for before `catalog:build` has run gets a clear 503, not an
 * ENOENT stack trace, since that is a real, recoverable "run the build"
 * situation in local dev, not a bug.
 */
export function readPublicFile(urlPath: string): Buffer {
  const relative = urlPath.replace(/^\/+/, "");
  const full = join(process.cwd(), "public", relative);
  if (!existsSync(full)) {
    throw new Error(`${urlPath} is not on disk - run "pnpm catalog:build" (or catalog:build:skip-fetch) first`);
  }
  return readFileSync(full);
}
