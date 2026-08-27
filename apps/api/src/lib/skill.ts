import { endpointRows } from "./openapi";
import { SITE } from "./songs";

const VERSION = "0.1.0";
const UPDATED = "2026-08-27";

/**
 * The file an agent reads first.
 *
 * The endpoint table comes from the OpenAPI spec rather than being typed here,
 * because a hand-kept second copy is the one that goes stale - and the reader
 * of this file has no way to tell that it has.
 *
 * The prose does not come from the spec, and should not: a schema says what a
 * field accepts, and this has to say what makes a piece worth listening to.
 * That is the half an agent cannot infer.
 */
export function skillMarkdown(): string {
  const table = endpointRows()
    .map((row) => `| \`${row.method}\` | \`${row.path}\` | ${row.summary} |`)
    .join("\n");

  return `---
name: chipvoice
description: Write chiptune for a real emulated NES sound chip as four lines of text, and get back a shareable link and an MP3. No audio files, no samples - the 2A03 is emulated cycle by cycle, so what comes out is what the hardware would have made. Songs fork like code.
compatibility: Requires curl and network access. Nothing to install.
homepage: ${SITE}
metadata: {"version":"${VERSION}","updated":"${UPDATED}","author":"gwendall","openclaw":{"requires":{"bins":["curl"]},"capabilities":[],"emoji":"musical_keyboard","homepage":"${SITE}"}}
---

# chipvoice - chiptune agents can write

Music for the Ricoh 2A03, the chip in the NES, as text you can read and diff. Post
four lines, get a link and an MP3 that plays anywhere.

> **Skill version ${VERSION} (${UPDATED}).** To check for updates, fetch \`${SITE}/skill.md\`
> and compare the \`updated\` date in the frontmatter with the one above.

## The one thing to understand first

**A mistyped note is silent.** A token that is not a note name resolves to 0 Hz, the
driver schedules nothing, and you get a hole in the piece with no error anywhere.

So: **call \`/api/validate\` before \`/api/songs\`.** It is free and unlimited. Every
issue it returns carries \`silent: true\` when the mistake would have left no
evidence, which is the class of fault you cannot hear for yourself.

## The format

Four channels, one token per sixteenth note. That is the whole language.

| Channel | Chip voice | Takes |
| --- | --- | --- |
| \`lead\` | Pulse 1 | Note names |
| \`chord\` | Pulse 2 | Note names, arpeggiated by \`chordShape\` |
| \`bass\` | Triangle | Note names. **Its token count sets the pattern length** |
| \`perc\` | Noise | \`K\` kick, \`S\` snare, \`H\` hat, \`O\` open hat |

A note is a letter A-G, an optional \`#\` or \`b\`, then an octave: \`A4\`, \`F#3\`, \`Bb2\`.
\`.\` holds the previous note. \`=\` cuts it.

All four lines must have the same number of tokens. The bass line is what defines
the length, so a longer lead loses its tail every loop - and nothing reports that,
which is why the validator does.

## Writing something worth hearing

The constraints are the instrument. What actually matters, in order:

1. **Loop length beats melody.** A four-bar loop is heard as a repeat within thirty
   seconds. Write several patterns and put them in \`order\` - \`[0,0,1,0,2,2,1,0]\` is
   eight bars of material rather than one. Under fourteen seconds the validator
   warns, and it is right to.
2. **Four voices and no more.** There is no room for a countermelody and a
   pad. Chords are one held note arpeggiated at frame rate, which is what
   \`chordShape\` is - \`[[0,3,7]]\` minor, \`[[0,4,7]]\` major.
3. **The bass is the engine.** Steady eighths or sixteenths on the triangle is what
   makes a piece move. Silence there reads as the music stopping.
4. **Leave the lead room.** A melody in every sixteenth is noise. Notes with holes
   around them are what a listener remembers.
5. **Pick a scale and stay in it.** A minor is the safe one: A B C D E F G. Random
   chromatic notes sound like a mistake, because usually they are.

## Endpoints

| Method | Path | What it does |
| --- | --- | --- |
${table}

## Write a song

\`\`\`bash
curl -s -X POST ${SITE}/api/validate \\
  -H 'content-type: application/json' \\
  -d '{
    "bpm": 152,
    "order": [0, 0, 1, 0],
    "patterns": [
      {
        "lead":  "E4 .  .  .  G4 .  A4 .  .  .  B4 .  C5 .  .  .",
        "chord": "A3 .  .  .  .  .  .  .  .  .  .  .  .  .  .  .",
        "bass":  "A1 .  A1 .  A1 .  A1 .  A1 .  A1 .  A1 .  G1 .",
        "perc":  "K  .  H  .  S  .  H  .  K  .  H  K  S  .  H  .",
        "chordShape": [[0, 3, 7]]
      },
      {
        "lead":  "C5 .  .  .  E5 .  D5 .  .  .  B4 .  A4 .  =  .",
        "chord": "F3 .  .  .  .  .  .  .  G3 .  .  .  .  .  .  .",
        "bass":  "F1 .  F1 .  F1 .  F1 .  G1 .  G1 .  G1 .  G1 .",
        "perc":  "K  .  H  .  S  .  H  H  K  K  S  .  S  .  H  O",
        "chordShape": [[0, 4, 7], [0, 4, 7]]
      }
    ]
  }'
\`\`\`

If \`ok\` is true, post the same body to \`${SITE}/api/songs\`. You get back:

\`\`\`json
{
  "id": "k3n8vq2p",
  "url": "${SITE}/s/k3n8vq2p",
  "mp3": "${SITE}/s/k3n8vq2p.mp3",
  "wav": "${SITE}/s/k3n8vq2p.wav",
  "measured": { "loopSeconds": 25.3, "onsetsPerSecond": 5.3, "range": 13, "steps": 128 }
}
\`\`\`

The MP3 URL is a plain file. Send it to a person, put it in an \`<audio>\` tag, attach
it to a message. It is computed on request and never changes, because the chip is a
pure function of the song.

## Fork instead of rewriting

\`\`\`bash
curl -s -X POST ${SITE}/api/songs/k3n8vq2p/fork \\
  -H 'content-type: application/json' \\
  -d '{"bpm": 168}'
\`\`\`

Send only what differs. The copy keeps a link back to what it came from, so a run of
attempts is a tree rather than a pile.

## Reading the measurements

\`measured\` comes back on every successful call, and is the closest thing to feedback
you have without ears:

- **\`loopSeconds\`** - under 14 and it will be heard as a repeat
- **\`onsetsPerSecond\`** - roughly 5 is a calm piece, 12 is a busy one, past 15 is
  usually a mess
- **\`range\`** - semitones between the highest and lowest note. Under 7 is flat,
  over 24 is usually an octave error

You cannot judge whether it sounds good. Nobody can, from numbers. What you can do is
produce several and hand a person the links.

## Limits

Writes are rate limited per address; reads are not. Rendering is capped at five
minutes of audio per request. One chip today - the 2A03 - and \`chip\` is in the
schema so songs stay readable when there are more.
`;
}
