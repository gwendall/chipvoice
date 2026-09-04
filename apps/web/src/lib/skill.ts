import { INTENTS } from "chipvoice";
import { endpointRows } from "./openapi";
import { SITE } from "./songs";

const VERSION = "0.6.0";
const UPDATED = "2026-09-04";

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
  const intents = Object.entries(INTENTS)
    .flatMap(([role, words]) => Object.entries(words).map(([word, what], i) => `| ${i === 0 ? `\`${role}\`` : ""} | \`"${word}"\`${i === 0 ? " (default)" : ""} | ${what} |`))
    .join("\n");

  return `---
name: chipvoice
description: Write chiptune for the emulated sound chips of the old machines - the NES's 2A03, the Game Boy's APU, the Mega Drive's YM2612 and PSG - as four lines of text, and get back a shareable link and an MP3. No audio files, no samples - each chip is emulated at the clock level, and what has been verified against the hardware is on its conformance sheet. Songs fork like code.
compatibility: Requires curl and network access. Nothing to install.
homepage: ${SITE}
metadata: {"version":"${VERSION}","updated":"${UPDATED}","author":"gwendall","openclaw":{"requires":{"bins":["curl"]},"capabilities":[],"emoji":"musical_keyboard","homepage":"${SITE}"}}
---

# chipvoice - chiptune agents can write

Music for the sound chips of the old machines - the Ricoh 2A03 in the NES, the
APU in the Game Boy, the YM2612 and its PSG in the Mega Drive - as text you can
read and diff. Post four lines, get a link and an MP3 that plays anywhere. The
same four lines play on any of them, each in its own idiom.

> **Skill version ${VERSION} (${UPDATED}).** To check for updates, fetch \`${SITE}/skill.md\`
> and compare the \`updated\` date in the frontmatter with the one above.
>
> Since 0.1.0: the noise channel ran at half the hardware rate, so every drum was
> an octave darker than a NES. Fixed. A song published before this date sounds
> brighter on its drums now than it did when it was written.
>
> Since 0.2.0: the chip now takes register writes as bytes, the way a NES did,
> and two things follow. Pulse notes at G#2 and below were silent - the sweep
> unit mutes them until a register is written - and now sound. And a vibrato or
> a slide on \`lead\` or \`chord\` that crosses a period boundary restarts the
> pulse's phase with a click, as on the hardware: A4 with the default vibrato
> does, E4 does not. The chip is compared with a reference emulator on every
> change; the pulses are identical to it cycle for cycle.
>
> Since 0.4.0: a second chip, the Game Boy's. Send \`"chip": "dmg"\` and the same
> four lines play on it: the bass moves to the wave channel, which reaches an
> octave lower and plays a triangle; a volume change retriggers a pulse; a drum's
> decay becomes the hardware envelope, so the kit is softer and longer than the
> NES's. Every one of blargg's twelve dmg_sound test ROMs passes on it.
>
> Since 0.5.0: \`intent\`. A word per role for what it should sound like - a
> bright lead, a held chord, a hollow bass - the same words on every chip, each
> chip playing them its own way. Before this every song shared one timbre.
>
> Since 0.5.2: the click is gone. A vibrato or a slide across a period
> boundary on the NES no longer restarts the pulse's phase: the driver moves
> the period through the sweep unit, the way FamiStudio's engine does, so A4
> with the default vibrato is as smooth as E4. Only a slide faster than a
> high byte a frame still clicks, as it must.
>
> Since 0.6.0: a third chip, the Mega Drive's. Send \`"chip": "md"\` and the
> lead and the bass become four-operator FM patches, the chord a PSG square,
> the drums the PSG's noise. The FM chip is a port of a reading of the die and
> is identical to it cycle for cycle.

How accurate each chip is, and how that is measured, is on its conformance sheet:
https://github.com/gwendall/chipvoice/blob/main/docs/chips/2a03.md,
https://github.com/gwendall/chipvoice/blob/main/docs/chips/dmg.md and
https://github.com/gwendall/chipvoice/blob/main/docs/chips/md.md

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

| Channel | On the 2A03 | On the Game Boy | On the Mega Drive | Takes |
| --- | --- | --- | --- | --- |
| \`lead\` | Pulse 1 | Pulse 1 | FM 1 | Note names |
| \`chord\` | Pulse 2 | Pulse 2 | PSG 1 | Note names, arpeggiated by \`chordShape\` |
| \`bass\` | Triangle | Wave channel | FM 2 | Note names. **Its token count sets the pattern length** |
| \`perc\` | Noise | Noise | PSG noise | \`K\` kick, \`S\` snare, \`H\` hat, \`O\` open hat |

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
| \`chip\` | no | \`"2a03"\` (the NES, the default), \`"dmg"\` (the Game Boy) or \`"md"\` (the Mega Drive) |
| \`intent\` | no | A word per role for what it should sound like; see below. \`{"lead": "bright", "bass": "hollow"}\` |

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

## What it should sound like: \`intent\`

The score says what the music is; each chip decides what to do with it. An
intent is one word per role, from this list, and it means the same thing on
every chip - a bright lead is a thin 12.5 % pulse on a NES and on a Game Boy,
and will be a sharp FM patch on a Mega Drive. A role you leave out takes the
default, which is what every song sounded like before there was a word for it.

| Role | Word | What it does |
| --- | --- | --- |
${intents}

The bass shows what "the chip's own idiom" means: a NES has one bass voice, the
triangle, and plays it whatever you ask; a Game Boy's bass is its wave channel,
which plays whatever waveform the word names. Ask for \`"hollow"\` and only the
Game Boy version changes. That is not a bug; it is the machine.

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

## Writing for each chip

The same score plays on both, and it is worth knowing what each one does with
it. Send \`"chip"\` with the song; fork a song onto the other chip by sending
only \`{"chip": "dmg"}\`.

**The NES (\`"2a03"\`).** Two pulses, a triangle, a noise. The lead and the chord
are pulses whose only timbre is the duty, which the \`intent\` words pick. The
bass is the triangle: no volume, one waveform, an octave below where you write
it, and it cannot be made brighter or softer - the bass words do nothing here.
It is at its best on steady eighths or sixteenths between A1 and A3. A pulse
note below G#2 sounds; a lead above C7 gets thin. The chord is one pulse
arpeggiated at frame rate, so wide shapes (\`[0,4,7,12]\`) shimmer and tight
ones (\`[0,3,7]\`) sit. Every volume table is free: a note can swell and decay
without a click. This is the chip the format was written for, and the kit is
the classic one.

**The Game Boy (\`"dmg"\`).** Two pulses, a wave channel, a noise. The pulses
are the NES's, duty for duty, with one difference you may hear: a volume
change is a retrigger on this hardware, so a lead with a steep decay is a
little more percussive than on the NES. The bass is the wave channel playing a
waveform from RAM, which is where the bass words matter: \`"round"\` is a
triangle, \`"hollow"\` a square, \`"bright"\` a sawtooth. It reaches an octave
lower than the NES's triangle - down to C1 - and it has four levels rather than
sixteen volumes. The drums are the hardware envelope, which decays more slowly
than the NES's tables: the kit is softer and rounder, and \`"tight"\` is the
sharper of the two words. Everything comes out in stereo, every voice on both
sides. What does not carry over from the NES: nothing you can write; what
carries over differently: the bass and the drums, and those are the machine.

**The Mega Drive (\`"md"\`).** Six FM channels and a PSG. The lead and the bass are
four-operator FM patches, and the words pick them: \`"bright"\` is one modulator
driving three carriers hard, \`"round"\` four carriers added like an organ,
\`"soft"\` a two-stack electric piano. The chord is a PSG square wave, thin and
high like the arpeggios of the era, so keep it above the bass. The drums are
the PSG's noise, white, at the same sixteen rates as the NES kit. FM volume
is a level in decibels rather than a linear 0 to 15, so a decay in a table
sounds longer here; FM notes have their own release after the note ends. The
PSG cannot go below about 110 Hz. Everything comes out in stereo, every voice
on both sides.

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

**It is tagged and named**, which is why the title is worth setting: the file
downloads as \`your title.mp3\` and carries ID3 tags, so Telegram, iTunes and a car
stereo all show the title and the author rather than "unknown". Without a title
both fall back to the id.

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
minutes of audio per request. Three chips today, the 2A03, the Game Boy's and
the Mega Drive's, and \`chip\` picks one; the SNES and the C64 are on the roadmap,
and the same \`intent\` words will play on them.
`;
}
