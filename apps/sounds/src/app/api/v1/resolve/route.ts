import { AUDIO_FORMATS, buildManifest, STYLES, type AudioFormat, type Style } from "@/lib/catalog";
import { corsPreflight, HttpError, json, objectBody, readBody, route } from "@/lib/http";
import { allow, clientKey } from "web-kit/limit";

export const runtime = "nodejs";

const MAX_EVENTS = 64;
const MAX_EXCLUDE = 64;

function isAudioFormat(value: unknown): value is AudioFormat {
  return typeof value === "string" && (AUDIO_FORMATS as readonly string[]).includes(value);
}

/**
 * One call for a whole game (spec's Agent surface): `{events, style,
 * formats, exclude}` in, `{manifest, resolved, unresolved}` out -
 * `manifest` is the exact `sounds.json` shape `buildManifest` produces
 * (src/lib/catalog.ts), schema-checked in test/manifest.test.mjs against the
 * same public/schema/manifest-1.json this API serves at GET
 * /schema/manifest-1.json. Rate-limited per IP (`web-kit/limit`), not per
 * key: Phase 1 has no accounts, and this is the one write-shaped call in an
 * otherwise read-only, keyless API.
 *
 * `formats` (the CLI's `--formats`) picks which content-addressed files a
 * variant's manifest entry names, 1 or 2 of `ogg`/`mp3`/`wav`. `exclude`
 * (the CLI's `swap`) drops given sound ids from the candidate pool before
 * picking, so a caller can ask for "the next best sound, not this one".
 */
export const POST = route(async (request) => {
  const limited = allow(clientKey(request), "anonymous", { anonymous: 60 });
  if (!limited.ok) throw new HttpError(429, "rate_limited", "Too many requests", limited.retryAfter);

  const body = objectBody(await readBody(request), ["events", "style", "formats", "exclude"]);
  if (!Array.isArray(body.events) || body.events.some((e) => typeof e !== "string") || body.events.length === 0) {
    throw new HttpError(422, "invalid_request", "events must be a non-empty array of strings", undefined, 'Send {"events": ["jump", "coin"]}.');
  }
  if (body.events.length > MAX_EVENTS) {
    throw new HttpError(422, "invalid_request", `events must not exceed ${MAX_EVENTS} entries`);
  }
  if (body.style !== undefined && !(STYLES as readonly string[]).includes(body.style as string)) {
    throw new HttpError(422, "invalid_style", `style must be one of: ${STYLES.join(", ")}`);
  }
  let formats: [AudioFormat] | [AudioFormat, AudioFormat] | undefined;
  if (body.formats !== undefined) {
    if (!Array.isArray(body.formats) || body.formats.length < 1 || body.formats.length > 2 || !body.formats.every(isAudioFormat)) {
      throw new HttpError(422, "invalid_request", `formats must be 1 or 2 of: ${AUDIO_FORMATS.join(", ")}`);
    }
    formats = body.formats as [AudioFormat] | [AudioFormat, AudioFormat];
  }
  let exclude: string[] | undefined;
  if (body.exclude !== undefined) {
    if (!Array.isArray(body.exclude) || body.exclude.some((e) => typeof e !== "string")) {
      throw new HttpError(422, "invalid_request", "exclude must be an array of sound ids");
    }
    if (body.exclude.length > MAX_EXCLUDE) throw new HttpError(422, "invalid_request", `exclude must not exceed ${MAX_EXCLUDE} entries`);
    exclude = body.exclude as string[];
  }

  const result = buildManifest(body.events as string[], { style: body.style as Style | undefined, formats, exclude });
  return json(result);
});

export const OPTIONS = corsPreflight;
