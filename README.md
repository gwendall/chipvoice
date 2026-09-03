# chipvoice

Game audio on real sound chips, in a browser and on a server.

A Ricoh 2A03, the NES chip, emulated at the clock level and running in an
AudioWorklet or rendered offline to a file. A driver and a tracker on top, so music
is four lines of text. And the one thing the hardware forced on every game: sound
effects take channels away from the music.

**[chipvoice.dev](https://chipvoice.dev)** to try it. `npm i chipvoice` to use it.

## What is in here

One repository, three things that ship separately and are built from the same code.

| | |
| --- | --- |
| [`packages/chipvoice`](packages/chipvoice) | The npm package: the chip, the driver, the tracker, the validator, the offline renderer. Its [README](packages/chipvoice/README.md) is the API reference |
| [`apps/web`](apps/web) | [chipvoice.dev](https://chipvoice.dev): the editor, the API agents write music with, the shareable links and the MP3s behind them |
| [`docs`](docs) | Where the project is going, how a chip is verified, and what has been decided |

## Running it

```bash
pnpm install
pnpm build            # the package, then the site
pnpm dev              # the editor and the API on http://localhost:3010
pnpm test:unit        # the validator, the clocks against the formulas, the golden hash
pnpm test:e2e         # production, end to end, through the package, the API and a browser
```

The package's `pnpm test` adds the fresh-install test, which packs the tarball,
installs it into an empty project and drives it in a browser. It is the release
gate; CI runs the unit tests on every push.

## How accurate is it

A measurement, not an adjective. Every chip has a conformance sheet, held to the
method in [`docs/CONFORMANCE.md`](docs/CONFORMANCE.md), that says what was verified
against which oracle and what is known to differ. The 2A03's is
[`docs/chips/2a03.md`](docs/chips/2a03.md), and today it says **unverified** on
most lines, honestly. The [roadmap](docs/ROADMAP.md) is the order in which those
lines change.

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
