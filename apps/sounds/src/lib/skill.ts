import { endpointRows } from "./openapi";
import { SITE } from "./site";
import { listCategories, listSounds, STYLES } from "./catalog";

/** Renders /skill.md: mirrors apps/web's src/lib/skill.ts (same frontmatter
 * shape, same "derived from the OpenAPI spec, not written twice" endpoint
 * table), scoped to this catalogue's own much smaller API surface. */
export function skillMarkdown(): string {
  const sounds = listSounds();
  const categories = listCategories().filter((c) => c.parent !== null);
  const endpoints = endpointRows()
    .map((r) => `| \`${r.method}\` | \`${r.path}\` | ${r.summary} |`)
    .join("\n");

  return `---
name: gamesounds.ai
description: A game sound-effects bank filed by event, with 1 to 8 variants each, loudness-matched, every sound CC0-1.0.
compatibility: The HTTP API needs only a network client. The gamesounds npm package (runtime and CLI) needs Node.js. No authentication anywhere - every endpoint is public and keyless.
homepage: ${SITE}
metadata: {"version":"0.1.0","sounds":${sounds.length},"categories":${categories.length}}
---

# Add real sound effects to a game

This catalogue answers **game events**, not sound descriptions: "the player jumped", not "8-bit blip". Resolve an
event to a category (\`${SITE}/api/v1/categories\` lists the taxonomy, or just guess - \`"jump"\`, \`"ui/confirm"\` and
\`"hit/heavy"\` all resolve directly), then either fetch the files yourself or let the CLI do it.

## The fastest path

\`\`\`
npx gamesounds add jump coin hit/heavy ui/confirm --style 8bit
\`\`\`

Writes the audio files, a \`sounds.json\` manifest (validates against \`${SITE}/schema/manifest-1.json\`) and a
\`SOUNDS-CREDITS.md\` into the current directory, then verifies every downloaded file's SHA-256 against the
manifest before exiting. Run it again after adding more events; it only downloads what \`sounds.json\` does not
already have.

## Playing them

The \`gamesounds\` runtime (MIT, no dependencies, a few KB) reads \`sounds.json\` and gives you round-robin
variants, pitch jitter, a per-event cooldown, a voice cap with priority stealing, and ducking - the difference
between a sound effect and a sound effect that has been triggered forty times in one second. Or skip the runtime
and play the files with whatever your engine already uses; nothing here requires it.

\`\`\`js
import { loadSounds } from "gamesounds";
const sounds = await loadSounds("./sounds.json");
sounds.play("jump");
\`\`\`

## Calling the API directly

Every style: \`${STYLES.join(", ")}\`. Every sound is CC0-1.0: no attribution is legally required, though
\`sound.attribution\` carries a courtesy credit line where the source asks for one. No sound loops in phase 1 -
\`sound.loop\` and a manifest event's \`loop\` are always \`null\`, on purpose, not an oversight.

| Method | Path | What it does |
| --- | --- | --- |
${endpoints}

Full request/response shapes: [OpenAPI](${SITE}/openapi.json). The same API as a flat tool list:
[MCP manifest](${SITE}/.well-known/mcp.json).
`;
}
