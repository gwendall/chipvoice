# chipvoice

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Five classic sound chips, emulated to the cycle and checked against reference
cores and hardware test ROMs, in a browser and on a server, so that people and their agents can
write music for them and hear it the way the machine played it.

**[chipvoice.dev](https://chipvoice.dev)** to play it. `npm i chipvoice` to use it.

The [playground](https://chipvoice.dev) opens with complete arrangements: Mario's
four native Famicom voices, all four Zelda MIDI parts and all fourteen Sonic parts.
Pick a song or Japanese console logo to start on your first interaction. Play/pause,
restart, a full-song seek slider and a clickable score let you explore the music.
Preset full mixes are lossless renders from these same JavaScript engines.
The cursor follows the audio output clock; console, tempo and solo changes keep
the musical position while the next sound is prepared. Turn Loop off to play once.

Import a MIDI locally, isolate its instruments, or compare native Mario with an
independent NSF renderer. Every port reports voice omissions and substitutions;
no extra accompaniment is invented. Imports show preparation and rendering progress.
The reusable SDK pipeline is `importMidi → planPerformance → renderPerformance`;
[the method and its limits](scores/arrangements/README.md) distinguish original
game verification from MIDI transcription and cross-console adaptation.

**Make a loop** opens the editor, keyboard, pads, recording, undo, code, export and
sharing in the same page. Your saved draft is restored there; shared links still
open their score. Switching modes pauses the previous instrument. C64 is hidden
from the public selector, with SDK and saved-score support retained.

The [listening lab](https://chipvoice.dev/lab) holds engine comparisons; the former
`/lab/arrangements` URL redirects home. The [About page](https://chipvoice.dev/about)
explains browser synthesis, constraints, evaluation and credits. Console marks are
self-hosted colour SVGs; see the [source manifest](apps/web/public/machines/README.md).

The website is available in [English](https://chipvoice.dev) and [Japanese](https://chipvoice.dev/ja), including the composer, listening lab, accessibility labels and sharing metadata. Change language without interrupting the instrument. See [internationalization](docs/INTERNATIONALIZATION.md) for the JSON catalogues, routing and coverage checks.
No account is required. See the [current playground spec](docs/UNIFIED-PLAYGROUND.md).

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
  browser or rendered offline to a file on a server. Five so far: the NES's
  Ricoh 2A03, the Game Boy's DMG APU, the Mega Drive's YM2612 with its
  SN76489, the SNES's S-DSP and the C64's SID 6581; the Mega Drive's and the
  SNES's are ports of reference cores with parity on the checked corpus; the others
  are written from the documents and compared with the community's cores.
- **A driver and a tracker on top**, so a tune is four lines of text - lead,
  chord, bass, percussion - and a word per line for what it should sound like.
  The same four lines and the same words play on every chip, each in its own
  idiom: the [portable score](docs/SCORE.md). Underneath, instruments are the
  per-frame tables the hardware's own drivers used.
- **The one thing the hardware forced on every game**: sound effects take
  channels away from the music, and the music dips. Effects and music share
  the emulated voice budget.
- **Bytes out, not only sound**: a song is also the register writes it makes,
  as VGM for NES, Game Boy and Mega Drive, playable in compatible players.
  SNES and C64 file exports remain open.
- **An API and a skill**, so an agent can write a song, validate it, get a link
  and an MP3, and fork someone else's. [chipvoice.dev](https://chipvoice.dev)
  is the editor and that API.

## Where every machine stands

One row per machine, the numbers written by the harness from what it keeps
(`pnpm --filter chipvoice-conform status`), the notes under the table kept by
hand. Each chip's sheet has the detail behind every cell, and
[`docs/CONFORMANCE.md`](docs/CONFORMANCE.md) says what "verified" means here.

<!-- status:begin -->
| Machine | Chip | Done | Digital | ROMs | Analog | Driver | Sheet |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| NES, Famicom | Ricoh 2A03 | **82 %** | ✅ 98 % | ✅ 29/29 | 🟡 mixer | 🟡 4/5 | [2a03](docs/chips/2a03.md) |
| Game Boy | DMG APU | **74 %** | ✅ 98 % | ✅ 12/12 | ❌ none | ✅ 4/4 | [dmg](docs/chips/dmg.md) |
| Mega Drive, Genesis | YM2612 + SN76489 | **35 %** | ✅ 100 % | ⬜ | ❌ none | 🟡 4/10 | [md](docs/chips/md.md) |
| Super Nintendo | S-DSP | **38 %** | ✅ 100 % | ⬜ | ❌ none | 🟡 4/8 | [snes](docs/chips/snes.md) |
| Commodore 64 | MOS 6581 SID | **50 %** | ✅ 100 % | ⬜ | ❌ profile | ✅ 3/3 | [c64](docs/chips/c64.md) |
| Later | PC Engine, GBA, Amiga, POKEY, YM2151, YM2610 | 0 % | ⬜ | ⬜ | ⬜ | ⬜ | later |

Written by `conform` on 2026-09-04. The columns:

- **Machine**: the console or computer, and **Chip**: its sound chip, as the package names it.
- **Done**: the mean of the four measures that follow, as a rough single number. The sheet, not this, is the contract.
- **Digital**: how much of the chip's digital output matches the reference emulator it is compared with, as the share of runs of edges that line up on step times, a measure that survives an oracle's own conventions. 100 % describes this corpus and oracle, not exhaustive hardware accuracy.
- **ROMs**: the community's test ROMs for the chip passing on a CPU the harness carries; a dash when none exist.
- **Analog**: how much of the stage after the chip's DACs - mixing, filters, the console's output - is measured against a real unit.
- **Driver**: the voices the driver plays, of the chip's; the rest exist and are verified but no song reaches them.
- **Sheet**: the chip's conformance sheet, with the detail behind every cell; or the roadmap phase a machine is planned for.

**NES, Famicom** (Ricoh 2A03, since 0.1.0). Digital: Nes_Snd_Emu 0.1.7 (blargg), 13 logs, 92.2M cycles; runs aligned on step times 97.7 % (6665 of 6820); identical cycles 3.9 %, the rest the oracle's own conventions, read on the sheet. ROMs: blargg's `apu_test`, `apu_reset`, `dmc_tests`, `apu_2005`, 29 of 29 pass. Analog: the mixer measured against blargg's recordings of his console; the filters and the DAC after them unmeasured, and want a unit's line-out. Cancellation against the DMC: square -32.7 dB (console -32.2), triangle -33.0 dB (console -30.9), noise -13.8 dB (console -16.2), dmc -31.0 dB (console -27.2). Driver: every voice but the DMC, which no instrument reaches yet. Remains: a second oracle for the envelope, the sweep and the triangle near a clock; a corpus from real games; a unit for the filters.

**Game Boy** (DMG APU, since 0.8.0). Digital: Gb_Snd_Emu 0.1.4 (blargg), 7 logs, 145.1M cycles; runs aligned on step times 97.5 % (12645 of 12969); identical cycles 57.4 %, the rest the oracle's own conventions, read on the sheet. ROMs: blargg's `dmg_sound`, 12 of 12 pass. Analog: unmeasured; the output stage is a placeholder built to be replaced by a measurement. Driver: all four voices, the bass on the wave channel, drums as the hardware envelope. Remains: a stronger oracle than Gb_Snd_Emu (SameBoy); a unit's line-out; the sweep and the length counters, which no instrument reaches.

**Mega Drive, Genesis** (YM2612 + SN76489, since 0.11.0). Digital: Nuked-OPN2 1.0.12 (Nuke.YKT), 7 logs, 1798.7M cycles; runs aligned on step times 100.0 % (36580 of 36580); identical cycles 100.0 %, the rest the oracle's own conventions, read on the sheet. The YM2612 is Nuked-OPN2 ported line for line and compared with it: parity with the reference on this corpus, not a direct silicon capture. The PSG is from the documents and has no oracle yet. Analog: unmeasured; Nuked's own DAC model is marked unverified, the mix and the Model 1 filter are placeholders. Driver: the lead and the bass on FM, the chord on the PSG, the kit on the noise; four voices of ten. Remains: a PSG oracle; the LFO, SSG-EG and the DAC in the arranger; a unit's line-out.

**Super Nintendo** (S-DSP, since 0.12.0). Digital: snes_spc 0.9.0 (blargg), 5 logs, 23.9M cycles; runs aligned on step times 100.0 % (183 of 183); identical cycles 100.0 %, the rest the oracle's own conventions, read on the sheet. The S-DSP is snes_spc ported line for line and compared with it on the output stream: parity sample for sample, including the echo and its FIR. Analog: unmeasured; the DAC and the console's filter are a placeholder. A capture of the DSP's output would compare directly with the stream. Driver: a build-time BRR sample bank with hardware envelopes; lead, bass and percussion plus up to five simultaneous chord voices, with a shared chord volume budget. Remains: a unit's line-out; SPC export.

**Commodore 64** (MOS 6581 SID, since 0.13.0). Digital: reSID-fp (libsidplayfp, drfiemost), as a 6581, 7 logs, 30.5M cycles; runs aligned on step times 100.0 % (1207 of 1207); identical cycles 100.0 %, the rest the oracle's own conventions, read on the sheet. The SID is written from the documents and compared with reSID-fp, which stays in the harness (GPL): parity on both digital values of every voice, the waveform before its DAC and the envelope counter. Analog: a profile from the documents, unmeasured: the 6581's non-linear DAC ladders, the filter on a measured cutoff curve, the output stage's corners. The 8580 is not modelled. Driver: all three voices, the chord and the kit sharing the third, the drums cutting the chord as C64 tunes did. Remains: the filter in the arranger; the 8580; a unit's line-out; VICE's SID test programs on a 6510.

**Later** (PC Engine, GBA, Amiga, POKEY, YM2151, YM2610). After the five, by demand.
<!-- status:end -->

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
pnpm --filter chipvoice-web test # production build on a local server, temporary DB, measured browser audio
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
on an SM83. The Mega Drive's is [`docs/chips/md.md`](docs/chips/md.md): its
YM2612 is identical to Nuked-OPN2, a reading of the die, on every cycle of the
corpus. The SNES's is [`docs/chips/snes.md`](docs/chips/snes.md): its S-DSP is
identical to snes_spc on every sample of its output stream. The C64's is
[`docs/chips/c64.md`](docs/chips/c64.md): its SID, written from the documents,
is identical to reSID-fp on both digital values of every voice. What still says
**unverified** on all five, honestly: the analog stage, which needs a real
unit's line-out. The [roadmap](docs/ROADMAP.md) is the order
in which those lines change, and the [backlog](docs/BACKLOG.md) is what is being
done about it this week.

## Where it is going

One score, many chips. The [roadmap](docs/ROADMAP.md) has the phases; the short
version is that each chip is either written from the documents and verified by
the community's test ROMs, or borrowed from a core the community has already
verified against silicon; that the sheet is the contract; and that the product
is a [portable score](docs/SCORE.md) that an agent or a person writes once and
that plays on a NES, a Game Boy, a Mega Drive, a SNES or a C64 in that
machine's own idiom. All five play today, and the demo puts their sounds one
gesture apart. The demo also records quantized note and drum taps into a loop,
with one Undo per take, optional MIDI input, controlled variations and producer
exports. Physical-phone usability checks remain open. A sixth chip is not the current priority.

## Releasing

A tag publishes the package from GitHub Actions over trusted publishing. See
[the package README](packages/chipvoice/README.md#releasing).

MIT for the original code; LGPL-2.1-or-later for the derived YM2612 and S-DSP
cores. The package licence is `(MIT AND LGPL-2.1-or-later)`. See the source
headers and bundled licence notices. Console marks retain their owners’ rights.

For composition quality checks, use the [audio listening lab](docs/AUDIO-EVALUATION.md):
actual presets on all five consoles, isolated parts, level-matched comparisons,
and independent SNES DSP execution. Digital parity does not guarantee a good arrangement.

### Melody studies in the composer

The [playground](https://chipvoice.dev) and [listening lab](https://chipvoice.dev/lab)
include Mario (50 bars), Zelda (24 bars with introduction), and a complete Sonic
main-theme cycle (24 bars). These are credited melody transcriptions with **no
invented bass, harmony or drums**. Sonic's separate intro is not included.

A frozen source ledger checks all 415 pitches, onsets, releases and rests against
both the compiled score and the sequencer on every console. Twelve steps per
quarter note retain triplets. See [the source workflow](scores/README.md) for
coverage, source hashes, measured timing tolerances, MIDI extraction and
`pnpm scores:compare`.

Transpose and drum-activity sliders have numeric inputs, Undo and Reset. Drum
activity is disabled on melody-only scores. Edited notes persist through sharing
and exports; the UI distinguishes edited versions from checked source cartridges.

Offline audio now starts at musical time zero so full-loop exports retain their
last note. This deliberately updates the audio golden snapshots; live startup
lookahead is unchanged.
