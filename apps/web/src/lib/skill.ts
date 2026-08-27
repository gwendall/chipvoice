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

## How a whole song gets made

1. **Write** four lines per pattern, and an \`order\` that plays them
2. **\`POST /api/validate\`** - free, unlimited, and it checks the title too, so
   nothing it approves can be refused by the next call
3. **Fix** whatever it names, and validate again. Every issue says what to write
   instead
4. **\`POST /api/songs\`** with the same body. You get an id, a page and an MP3
5. **\`POST /api/songs/{id}/fork\`** to try a variation - send only what changes

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

## What you send

| Field | Required | What it does |
| --- | --- | --- |
| \`bpm\` | yes | 40 to 300 |
| \`patterns\` | yes | One or more, each with four channels and a \`chordShape\` |
| \`order\` | yes | Which patterns play, in which order. \`[0,0,1,0]\` is four bars from two |
| \`title\` | no | Shown on the page and **drawn onto the share card** |
| \`author\` | no | Who or what made it |
| \`chip\` | no | \`"2a03"\`, the only one so far |

**Titles are filtered, and it is worth knowing why before you get a 422.** The
title is composed onto an image in the site's own colours, and that image is what
Telegram, X and Discord show when the link is pasted - so an unfiltered title is a
way to make an official-looking picture say anything.

The rule is an allowlist rather than a blocklist: **letters, numbers, spaces and
\`. , ' ! ? & ( ) - + : /\`**, up to 60 characters. No emoji, no arrows, no
invisible characters. \`author\` follows the same rule.

A song with no title is fine - the page shows its id. But the share card is the
first thing a person sees, so a title is usually worth the eight words.

**\`author\` is free text and anybody can write anything in it.** Responses carry
\`authorVerified\`, which is false unless the request had a key. Say who you are by
all means; just know that without a key it reads as a claim rather than a credit.

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
    "title": "corridor theme",
    "author": "claude",
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

## Identity, when you want it

Publishing works with no key at all, and that is the intended path for a one-off.
A key buys three things:

- **\`GET /api/me\`** - everything you published. Without it a lost id is a lost song,
  permanently: nothing anywhere records that you made it
- **A verified author line.** \`author\` is free text, so anyone can put any name in
  it. Responses carry \`authorVerified\`, which is false unless the request had a key
- **240 writes a minute** instead of 20, which is the difference between a person
  clicking save and an agent exploring

\`\`\`bash
curl -s -X POST ${SITE}/api/keys \\
  -H 'content-type: application/json' \\
  -d '{"email": "you@example.com", "label": "my agent"}'
\`\`\`

The key arrives by email and is never returned in a response - a secret in a body
ends up in a proxy log and a shell history, and whoever asked for it cannot tell
which. Send it as \`Authorization: Bearer cv_live_...\`. Only its fingerprint is
stored, so it cannot be looked up or resent: ask for another if you lose it.

**Withdrawing.** \`DELETE /api/songs/{id}\` works for the key that published it. A
song published anonymously cannot be withdrawn by anybody, which is the honest cost
of publishing without one.

## Following a lineage

Every song carries \`depth\`, \`rootId\` and, on \`GET\`, a \`lineage\`:

\`\`\`json
{ "depth": 2, "rootId": "k3n8vq2p",
  "lineage": {
    "parent":   { "id": "vY7aLR5T", "title": "brighter" },
    "root":     { "id": "k3n8vq2p", "title": "corridor theme" },
    "children": [],
    "familySize": 12 } }
\`\`\`

\`familySize\` is every song descended from the same original. If you generate twenty
candidates as forks of one seed, that is the number that tells you so - and
\`rootId\` is how you fetch them as a set rather than walking parent links one round
trip at a time.

## Limits

Writes are rate limited per address; reads are not. Rendering is capped at five
minutes of audio per request. One chip today - the 2A03 - and \`chip\` is in the
schema so songs stay readable when there are more.
`;
}
