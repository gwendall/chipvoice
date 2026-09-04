# chipvoice

The sound chips of the old machines, emulated to the cycle and measured against
the hardware, in a browser and on a server, so that people and their agents can
write music for them and hear it the way the machine played it.

**[chipvoice.dev](https://chipvoice.dev)** to try it. `npm i chipvoice` to use it.

## Why

Every console and home computer of the eighties and nineties had a sound chip,
and each one had a voice of its own: the NES's two pulses and a triangle, the
Game Boy's wave channel, the Mega Drive's FM, the SNES's samples, the C64's
filter. A generation of music was written for those chips, under their
constraints, and it survives in two forms: recordings, which are what the music
sounded like through one particular television, and register dumps, which are
what the music *was* - every byte the program wrote to the chip. The
recordings keep the sound. The dumps keep the instrument, but only as long as
something can play them back exactly.

Emulators keep the chips alive for playing the old games. Nothing keeps them
alive for writing new music on them where people now are: in a browser, from a
web page or an editor, by a person with a tune in their head or an agent with a
prompt. The libraries that offer "8-bit sound" in a browser synthesise a
resemblance - a band-limited square wave, a noise generator with its own
character - and call it the chip. It is not the chip, and anyone who grew up
with the machine can hear that it is not.

chipvoice is the chips themselves, as software, held to a measurement rather
than to an adjective. Each one runs at its own clock, takes the same bytes to
the same registers a program on the hardware wrote, and is compared with the
real thing: against reference emulators cycle for cycle, against the test ROMs
the community wrote to probe the silicon, against recordings of real units.
Every chip carries a sheet that says what has been verified and what has not.
The purpose is preservation of the instrument, not only of the sound - and a
way for anyone, human or machine, to pick the instrument up and play it.

## What it is

- **The chips, emulated at the clock level**, running in an AudioWorklet in a
  browser or rendered offline to a file on a server. Two so far: the NES's
  Ricoh 2A03, and the Game Boy's DMG APU. The Mega Drive, the SNES and the C64
  are on the [roadmap](docs/ROADMAP.md).
- **A driver and a tracker on top**, so a tune is four lines of text - lead,
  chord, bass, percussion - with instruments as the per-frame tables the
  hardware's own drivers used. The same four lines play on every chip, each in
  its own idiom; a [portable score](docs/SCORE.md) is where that is going.
- **The one thing the hardware forced on every game**: sound effects take
  channels away from the music, and the music dips. Every other library gives
  the effects their own tracks, and losing that is most of why they sound
  wrong.
- **Bytes out, not only sound**: a song is also the register writes it makes,
  as a VGM file any chiptune player and any real machine with a VGM player
  accepts.
- **An API and a skill**, so an agent can write a song, validate it, get a link
  and an MP3, and fork someone else's. [chipvoice.dev](https://chipvoice.dev)
  is the editor and that API.

## What is in here

One repository, three things that ship separately and are built from the same code.

| | |
| --- | --- |
| [`packages/chipvoice`](packages/chipvoice) | The npm package: the chip, the driver, the tracker, the validator, the offline renderer. Its [README](packages/chipvoice/README.md) is the API reference |
| [`apps/web`](apps/web) | [chipvoice.dev](https://chipvoice.dev): the editor, the API agents write music with, the shareable links and the MP3s behind them |
| [`packages/conform`](packages/conform) | The conformance harness: a corpus of register logs through the chip and through a reference emulator, compared cycle for cycle. Writes the numbers on the chip's sheet |
| [`docs`](docs) | Where the project is going, how a chip is verified, what has been decided, and the backlog |

## Running it

```bash
pnpm install
pnpm build            # the package, then the site
pnpm dev              # the editor and the API on http://localhost:3010
pnpm test:unit        # the validator, the clocks against the formulas, the driver, VGM, the golden hash
pnpm --filter chipvoice-conform check   # the corpus against the reference, no regression against the baseline
pnpm test:e2e         # production, end to end, through the package, the API and a browser
```

The package's `pnpm test` adds the fresh-install test, which packs the tarball,
installs it into an empty project and drives it in a browser. It is the release
gate; CI runs the unit tests on every push.

## How accurate is it

A measurement, not an adjective. Every chip has a conformance sheet, held to the
method in [`docs/CONFORMANCE.md`](docs/CONFORMANCE.md), that says what was verified
against which oracle and what is known to differ. The 2A03's is
[`docs/chips/2a03.md`](docs/chips/2a03.md): its pulses are identical to blargg's
reference emulator cycle for cycle on every song in the corpus, all twenty-nine
of his APU test ROMs pass on a 6502 the harness carries, and its mixer cancels
against his recordings of a real NES as well as the console did. The Game Boy's
is [`docs/chips/dmg.md`](docs/chips/dmg.md): twelve of twelve `dmg_sound` ROMs
on an SM83. What still says **unverified** on both, honestly: the analog stage,
which needs a real unit's line-out. The [roadmap](docs/ROADMAP.md) is the order
in which those lines change, and the [backlog](docs/BACKLOG.md) is what is being
done about it this week.

## Where it is going

One score, many chips. The [roadmap](docs/ROADMAP.md) has the phases; the short
version is that each chip is either written from the documents and verified by
the community's test ROMs, or borrowed from a core the community has already
verified against silicon; that the sheet is the contract; and that the product
is a [portable score](docs/SCORE.md) that an agent or a person writes once and
that plays on a NES, a Game Boy, a Mega Drive, a SNES or a C64 in that
machine's own idiom. Two of the five play today.

## Releasing

A tag publishes the package from GitHub Actions over trusted publishing. See
[the package README](packages/chipvoice/README.md#releasing).

MIT.
