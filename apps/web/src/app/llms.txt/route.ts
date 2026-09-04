import { endpointRows } from "@/lib/openapi";
import { SITE } from "@/lib/songs";

export const runtime = "nodejs";

/**
 * The short version, for agents that read one file and stop.
 *
 * Everything here is derived, so it cannot describe an API that no longer
 * exists - which is the failure mode of every hand-written summary.
 */
export function GET() {
  const lines = endpointRows().map((r) => `- ${r.method} ${r.path} - ${r.summary}`);
  const body = `# chipvoice

> Chiptune on the emulated sound chips of the old machines - the NES's 2A03 and
> the Game Boy's APU - written as four lines of text. Post a song, get a link
> and an MP3. Songs fork like code.

The format is one token per sixteenth note across four channels: lead, chord,
bass, perc. On the 2A03 they are pulse 1, pulse 2, the triangle and the noise; on
the Game Boy (\`"chip": "dmg"\`) pulse 1, pulse 2, the wave channel and the noise.
An optional \`intent\` gives each role a word for what it should sound like
(lead: soft, bright, round; chord: plucked, held; bass: round, hollow, bright;
perc: tight, soft), the same words on every chip. A note is a letter A-G, an optional
# or b, then an octave. A dot holds, an equals sign cuts.

A mistyped note is silent - it resolves to 0 Hz and is scheduled as nothing - so
validate before storing. Every issue says whether the mistake leaves any evidence.

## Endpoints

${lines.join("\n")}

## Full instructions

- [Skill](${SITE}/skill.md): the format, the endpoints, and how to write something
  worth hearing
- [OpenAPI](${SITE}/.well-known/openapi.json)
- [Editor](https://chipvoice.dev): the same songs, with a grid and a play button
- [Library](https://www.npmjs.com/package/chipvoice): \`npm i chipvoice\` to run the
  chip yourself
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
