import { buildManifest, STYLES, type Style } from "@/lib/catalog";
import { corsPreflight, HttpError, json, objectBody, readBody, route } from "@/lib/http";
import { allow, clientKey } from "web-kit/limit";

export const runtime = "nodejs";

const MAX_EVENTS = 64;

/**
 * One call for a whole game (spec's Agent surface): `{events, style}` in,
 * `{manifest, resolved, unresolved}` out - `manifest` is the exact
 * `sounds.json` shape `buildManifest` produces (src/lib/catalog.ts),
 * schema-checked in test/manifest.test.mjs against the same
 * public/schema/manifest-1.json this API serves at GET /schema/manifest-1.json.
 * Rate-limited per IP (`web-kit/limit`), not per key: Phase 1 has no
 * accounts, and this is the one write-shaped call in an otherwise read-only,
 * keyless API.
 */
export const POST = route(async (request) => {
  const limited = allow(clientKey(request), "anonymous", { anonymous: 60 });
  if (!limited.ok) throw new HttpError(429, "rate_limited", "Too many requests", limited.retryAfter);

  const body = objectBody(await readBody(request), ["events", "style"]);
  if (!Array.isArray(body.events) || body.events.some((e) => typeof e !== "string") || body.events.length === 0) {
    throw new HttpError(422, "invalid_request", "events must be a non-empty array of strings", undefined, 'Send {"events": ["jump", "coin"]}.');
  }
  if (body.events.length > MAX_EVENTS) {
    throw new HttpError(422, "invalid_request", `events must not exceed ${MAX_EVENTS} entries`);
  }
  if (body.style !== undefined && !(STYLES as readonly string[]).includes(body.style as string)) {
    throw new HttpError(422, "invalid_style", `style must be one of: ${STYLES.join(", ")}`);
  }

  const result = buildManifest(body.events as string[], { style: body.style as Style | undefined });
  return json(result);
});

export const OPTIONS = corsPreflight;
