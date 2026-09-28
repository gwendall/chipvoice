import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import audioStore from "../../audio-store.json";

const STORE_PATH = /^\/f\/([0-9a-f]{64})\.(?:ogg|mp3|wav)$/;

/**
 * Reads a content-addressed file the catalogue points at (a `Sound.variants[].files.*`
 * URL, always `/f/<sha256>.<ext>`). A zip route builds its response by
 * reading straight off disk (bypassing Next's own HTTP rewrite layer, which
 * only fires for a served page/asset request, not a route handler's own
 * `fs` reads), so it needs the same "fall back to the Blob store" logic
 * next.config.ts's rewrite gives every other `/f/*` request.
 *
 * `apps/sounds/public/f/` is generated, not committed (see .gitignore and
 * docs/GAMESOUNDS.md): a checkout that has not run `pnpm sounds:pull` or
 * `catalog:build` has no local copy, so this falls back to the published
 * store (decision 40) the same way a browser request would. The downloaded
 * bytes are verified against the sha256 already embedded in the url itself
 * before they are trusted - a store answer that does not hash to the path
 * it was served at is refused, not shipped.
 */
export async function readPublicFile(urlPath: string): Promise<Buffer> {
  const relative = urlPath.replace(/^\/+/, "");
  const full = join(process.cwd(), "public", relative);
  if (existsSync(full)) return readFileSync(full);

  const match = STORE_PATH.exec(urlPath);
  if (!match) {
    throw new Error(`${urlPath} is not on disk and is not a content-addressed /f/<sha256>.<ext> path the store can serve`);
  }
  const [, sha256] = match;
  const response = await fetch(`${audioStore.base}${urlPath}`);
  if (!response.ok) {
    throw new Error(`${urlPath} is not on disk and the store answered ${response.status} - run "pnpm sounds:pull" or "pnpm catalog:build" first`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) {
    throw new Error(`${urlPath}: the store's bytes hash to ${actual}, not the sha256 named in the path - refusing to ship them`);
  }
  return bytes;
}
