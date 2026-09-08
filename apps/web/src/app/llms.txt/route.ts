import { endpointRows } from "@/lib/openapi";
import { SITE } from "@/lib/songs";
import catalog from "../../../generated/agent-catalog.json";
export const runtime = "nodejs";
export function GET() {
  return new Response(
    `# chipvoice

> Compose, import, arrange and publish complete multi-instrument music for emulated retro sound chips.

Use MusicProject version 1 with a Performance source for new compositions. Independent parts hold exact-tick polyphonic notes, instruments and expression. Automatic allocation/mixing respects finite machine voices and reports losses; it does not guarantee orchestral realism or original-game fidelity. Discover supported targets instead of assuming a fixed console list. Current engine: ${catalog.engineVersion}.

## Start here

- [Skill](${SITE}/skill.md): original composition through full audio delivery, local rendering, evaluation and authorized publication.
- [Capabilities](${SITE}/api/v1/capabilities): generated voices, resource conflicts, instrument palette, pitch ranges and project JSON Schema.
- [OpenAPI](${SITE}/.well-known/openapi.json): exact HTTP bodies, parameters, auth and responses.
- [Composition guide](https://github.com/gwendall/chipvoice/blob/main/docs/AGENT-COMPOSITION.md): musical method and adding future consoles.
- [SDK/API guide](${SITE}/docs): local creation/playback and publication contracts.
- [Create](${SITE}/create): note/code editor and MIDI import.
- [Explore](${SITE}/explore): public publications and remix sources.

A simple song request should produce original music and a complete audio attachment or accessible download, not just a plan or the reference example. Choose a suitable duration and form for the request; short loops remain valid when requested. Local composition needs no account. Publication requires user intent as well as credentials: reuse existing authorization, or offer owner pairing when a page is requested. Keep composing while pairing is pending. HTTP-only agents can evaluate without publishing, but full server rendering requires an authenticated publication. Report actual listening separately from signal measurements.

POST /api/v1/validate takes the raw project. POST /api/v1/projects takes {project, visibility, profileId?, parentId?}, requires authentication and an Idempotency-Key. Render jobs return pinned WAV and MP3, page and cover URLs after polling. POST /api/v1/evaluate evaluates the raw project without publishing (full plan, opening two seconds of audio). Agents request owner authorization through /api/v1/agent-requests and /connect, then use scoped, expiring credentials bound to one artist; no agent mailbox is needed. GET/PUT /api/v1/profile manages the authorized artist and customizable pixel portrait. Identical sources group console variants under an artist; use group=1 in discovery. The older /api/songs service uses four tracker lines and can publish anonymously; it is a separate compatibility path, not the default for complete performances. Never flatten imported polyphony to it.

## Endpoints

${endpointRows()
  .map((r) => `- ${r.method} ${r.path} — ${r.summary}`)
  .join("\n")}
`,
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
