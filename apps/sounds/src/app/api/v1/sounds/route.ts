import { searchSounds, STYLES, type Style } from "@/lib/catalog";
import { corsPreflight, HttpError, json, route } from "@/lib/http";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function isStyle(value: string): value is Style {
  return (STYLES as readonly string[]).includes(value);
}

/** Opaque only in the sense that a client should not construct one by hand -
 * it is a plain offset into the deterministic, sorted result list, so paging
 * through a stable catalogue never skips or repeats a sound. */
function parseCursor(raw: string | null): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(422, "invalid_cursor", "cursor must be a non-negative integer");
  return n;
}

export const GET = route(async (request) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const styleParam = url.searchParams.get("style");
  const loopParam = url.searchParams.get("loop");
  const limitParam = url.searchParams.get("limit");
  const cursor = parseCursor(url.searchParams.get("cursor"));

  if (styleParam && !isStyle(styleParam)) {
    throw new HttpError(422, "invalid_style", `style must be one of: ${STYLES.join(", ")}`, undefined, "Drop the style filter or pick one from the list.");
  }
  const limit = limitParam ? Math.min(MAX_LIMIT, Math.max(1, Number(limitParam) || DEFAULT_LIMIT)) : DEFAULT_LIMIT;
  const loop = loopParam === null ? undefined : loopParam === "true";

  const all = searchSounds({ q, category, style: styleParam as Style | undefined, loop });
  const page = all.slice(cursor, cursor + limit);
  const nextCursor = cursor + limit < all.length ? String(cursor + limit) : null;

  return json({ sounds: page, total: all.length, nextCursor }, { cache: "public, max-age=60" });
});

export const OPTIONS = corsPreflight;
