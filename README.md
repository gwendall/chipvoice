# chipvoice

Game audio on real sound chips, in a browser and on a server.

A Ricoh 2A03, the NES chip, emulated at the clock level and running in an
AudioWorklet or rendered offline to a file. A driver and a tracker on top, so music
is four lines of text. And the one thing the hardware forced on every game: sound
effects take channels away from the music. The Game Boy's chip is in the package
too, verified the same way; the driver does not speak to it yet.

**[chipvoice.dev](https://chipvoice.dev)** to try it. `npm i chipvoice` to use it.

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
version is that the emulation is borrowed from the cores the community has already
verified against silicon, the sheet is the contract, and the product is a
[portable score](docs/SCORE.md) that an agent or a person writes once and that
plays on a NES, a Game Boy, a Mega Drive, a SNES or a C64 in that machine's own
idiom.

## Releasing

A tag publishes the package from GitHub Actions over trusted publishing. See
[the package README](packages/chipvoice/README.md#releasing).

MIT.
