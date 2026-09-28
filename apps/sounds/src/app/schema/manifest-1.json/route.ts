import schema from "../../../../../../packages/gamesounds/schema/manifest-1.json";

/**
 * Serves packages/gamesounds/schema/manifest-1.json at the URL its own
 * `$id` names (https://gamesounds.ai/schema/manifest-1.json) and that
 * `buildManifest`'s `$schema` field points at (src/lib/catalog.ts) - one
 * file, read directly, never copied: test/manifest.test.mjs validates
 * against this same import, so the served schema and the tested schema can
 * never drift apart.
 */
export const runtime = "nodejs";

export function GET() {
  return Response.json(schema, { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
