import { endpointRows } from "@/lib/openapi";
import { SITE } from "@/lib/site";
import { listCategories, listSounds } from "@/lib/catalog";

export const runtime = "nodejs";

export function GET() {
  const sounds = listSounds();
  const categories = listCategories().filter((c) => c.parent !== null);

  return new Response(
    `# gamesounds.ai

> A game sound-effects bank filed by event, with 1 to 8 variants each, loudness-matched, every sound CC0-1.0.

${sounds.length} sounds across ${categories.length} categories and ${new Set(sounds.map((s) => s.style)).size} styles. Read-only, no
authentication, open CORS: call this API directly, or use the \`gamesounds\` npm package's runtime and CLI, which
call the same endpoints. No sound in this catalogue loops (a \`loop\` field is present on every sound and every
manifest event, and is always \`null\` in phase 1, honestly rather than silently).

## Start here

- [Skill](${SITE}/skill.md): how an agent adds sound to a game with this catalogue.
- [OpenAPI](${SITE}/openapi.json): exact HTTP parameters, bodies and responses.
- [MCP manifest](${SITE}/.well-known/mcp.json): the same API as a flat tool list.
- [Manifest schema](${SITE}/schema/manifest-1.json): what \`sounds.json\` must validate against.
- [Docs](${SITE}/docs): the site's own docs page.

## The fastest path

1. \`GET /api/v1/categories\` to see the taxonomy, or guess a leaf name - \`POST /api/v1/resolve\` accepts
   \`"jump"\`, \`"ui/confirm"\` and \`"hit/heavy"\` directly and tells you what did not resolve.
2. \`POST /api/v1/resolve\` with the events your game needs and an optional \`style\`, and either write its
   \`manifest\` to \`sounds.json\` yourself or run \`npx gamesounds add <events...> --style <style>\`, which calls
   the same endpoint and writes the files, \`sounds.json\` and \`SOUNDS-CREDITS.md\` for you.
3. Load \`sounds.json\` with the \`gamesounds\` runtime (MIT, no dependencies) for round-robin variants, pitch
   jitter, cooldowns, a voice cap with priority stealing, and ducking - or fetch the files yourself and play
   them however your engine already plays audio.

## Endpoints

${endpointRows()
  .map((r) => `- ${r.method} ${r.path} - ${r.summary}`)
  .join("\n")}
`,
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
