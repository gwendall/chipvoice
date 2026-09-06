# chipvoice

Five classic sound chips in a browser or offline: **NES (2A03), Game Boy,
Mega Drive, SNES and Commodore 64**. A score is four musical roles arranged for
the chosen hardware. Sound effects borrow physical voices from the music and
return them when they finish; Stop cancels future musical writes.

The digital cores are checked against reference emulators and hardware test
ROMs. The [conformance sheets](https://github.com/gwendall/chipvoice/tree/main/docs/chips)
state verified behavior and remaining differences; this is not a claim that
every analog characteristic has been measured on physical hardware.

```bash
npm i chipvoice
```

```ts
import { Chip } from "chipvoice";

const chip = await Chip.create();     // from a click, so the browser allows audio
chip.play(THEME);

// The gun. It holds pulse 2 for a tenth of a second, and the chord drops out
// under it - which is most of what makes this sound like a console.
chip.sfx("p2", {
  note: "B6",
  instrument: { duty: 0, volume: [13, 12, 10, 8, 5, 2], slide: -3.4 },
  duration: 0.1,
});
```

No files to copy, no build step, no setup. The worklet is inlined and handed to the
browser as a blob URL, so `npm install` is the whole installation.

The same song on a Game Boy is one option away. Each chip maps the song's four
lines onto its own voices and writes its registers in its own idiom: the bass
moves to the wave channel, a volume change becomes a retrigger, a drum's decay
becomes the hardware envelope.

```ts
const gb = await Chip.create({ chip: "dmg" });
gb.play(THEME);                       // the same four lines
gb.sfx("ch2", { note: "B6", instrument: LASER, duration: 0.1 });
gb.spec.voices;                       // ch1, ch2, ch3, ch4 - what to hand sfx()
```

A song can carry its instruments spelled out, as `THEME` does, or it can be a
**score**: the four lines and a word per role for what it should sound like,
which each chip's arranger turns into its own instruments. The words are the
same on every chip; `INTENTS` lists them with what they mean.

```ts
import { arrange, INTENTS } from "chipvoice";

const song = arrange(
  { bpm: 152, order: [0], patterns: [...], intent: { lead: "bright", bass: "hollow" } },
  "dmg",
);
gb.play(song);                        // a 12.5 % pulse lead, a square wave in wave RAM
INTENTS.bass.hollow;                  // "a square wave on the Game Boy's wave channel; a NES has only the triangle"
```

**[Try it](https://chipvoice.dev)** — three cartridges, five machines, an editor and four arcade pads
that takes a channel away from the music while you watch. The song lives in the URL,
so a link is the save file.

## Why not oscillators

Every other "8-bit" library in a browser is `OscillatorNode` with `type: "square"`
and a gain envelope. That cannot sound like a console, for three reasons that are
structural rather than a matter of tuning:

- **`PeriodicWave` is band-limited.** Web Audio anti-aliases its waveforms. The 2A03
  outputs a raw square with every harmonic intact. There is no setting for this.
- **The 2A03 mixes non-linearly.** The two pulses go through
  `95.88 / (8128/(p1+p2) + 100)`, the triangle and noise through another curve. Two
  notes together are not the sum of two notes.
- **Three analog filters** - high-pass at 90 Hz and 440 Hz, low-pass at 14 kHz - are
  what give the NES its boxy, bass-light voice.

So this steps 8-entry duty sequences and a 15-bit LFSR at the chip clock, mixes them
through the hardware's own DAC curves, and runs the filters. Register writes arrive
stamped with a CPU cycle and land on that cycle, wherever it falls inside a sample,
so a slide lands on the frame it was scheduled for.

## Four channels, and the fight over them

| Channel | Usually music | Usually effects |
| --- | --- | --- |
| `p1` | Lead | Game over |
| `p2` | Arpeggiated chord | Everything else |
| `tri` | Bass | Explosion sub-thump |
| `noi` | Drums | Hits, explosions, whoosh |

There are four voices and no more, so music and effects compete for them. Every
library that generates chiptune in a browser gives the music its own tracks and the
effects theirs - which is the one thing the hardware could not do, and losing it is
most of why those libraries sound wrong. (The chip has a fifth, the DMC, which
plays samples from memory: the drums of most cartridges. The chip here has it too;
no instrument reaches it yet.)

`chip.sfx()` claims a channel for the length of the effect. The sequencer asks before
every note it schedules, and skips the ones it cannot have.

```ts
chip.canPlay("p1");        // is the lead free right now?
```

## Writing music

One token per sixteenth note, four channels, as text.

```ts
const PATTERN = {
  bass:  `A1  .   A1  .   A1  .   A1  .   A1  .   A1  .   A1  .   G1  .`,
  lead:  `E4  .   .   .   G4  .   A4  .   .   .   B4  .   C5  .   .   .`,
  chord: `A3  .   .   .   .   .   .   .   .   .   .   .   .   .   .   .`,
  chordShape: [[0, 3, 7]],   // one held note, arpeggiated at 60 Hz
  perc:  `K   .   H   .   S   .   H   .   K   .   H   K   S   .   H   .`,
};
```

A note name (`A4`, `F#3`), `.` to hold, `=` to cut. Drums use `K` kick, `S` snare,
`H` hat, `O` open hat. **The bass line's token count sets the pattern length**, so a
bar in five is possible.

Instruments are per-frame tables, the shape FamiTracker settled on, because that is
what a driver on the real machine wrote every NMI:

```ts
const LEAD = {
  duty: 1,                                   // 0 = 12.5%, 1 = 25%, 2 = 50%
  volume: [15, 15, 14, 13, 12, 12, 11, 10],  // one entry per frame, at 60 Hz
  sustain: true,                             // hold the last value until note off
  vibrato: { depth: 0.18, rate: 8, delay: 12 },
};
```

Chords are **one held note arpeggiated at frame rate**, not three notes. That is what
the hardware did when it ran out of channels, and it is the most recognisable
chiptune texture there is.

## Snapping effects to the beat

Rez's cheapest trick: snap a player's own sounds to the grid and somebody with no
rhythm still sounds like a musician.

```ts
chip.sfx("noi", { ...boom, delay: chip.beatDelay() });
```

Capped at 120 ms by default - past that it plays immediately, because being on time
matters more than being in time. **Never do it to the gun.** A shot that arrives an
eighth late reads as a mushy trigger, and that is the one thing a shooter cannot
afford.

## Rendering without a browser

Rendering is deterministic for a fixed engine version, score and render options.
Cache keys must include the engine and encoder versions. The hosted API revalidates
stable song URLs, limits public renders to 30 seconds and checks deletion on every request.

```ts
import { renderSong, toWav } from "chipvoice";

const audio = renderSong(THEME, { seconds: 30 });
writeFileSync("theme.wav", toWav(audio));
```

The same DSP runs in both places. `src/chips/nes/dsp.ts` is a TypeScript module like
any other: Node imports it, and the build bundles it with the worklet shell into one
self-contained script - a blob URL has nothing to resolve an import against - and
hands that string to `addModule`. The only difference between real time and a file
is where the sample clock comes from - `currentFrame` in a worklet, a counter
offline.

`test/parity.mjs` measures both and compares. Loudness matches to a thousandth,
brightness to six percent; the rest is the browser starting its context wherever it
likes.

## How accurate is it

Accuracy is a measurement here, not an adjective. The chip's **conformance sheet**,
[`docs/chips/2a03.md`](https://github.com/gwendall/chipvoice/blob/main/docs/chips/2a03.md),
says what has been verified, against which oracle, and what is known to differ - and
[`docs/CONFORMANCE.md`](https://github.com/gwendall/chipvoice/blob/main/docs/CONFORMANCE.md)
is the method every chip is held to. Until the sheet says otherwise, the honest summary is: the clocks match the
formulas, the mixer and filters are the documented curves, and the parts the driver
does not exercise are implemented from the wiki and unverified.

Four tests run on every push:

| | |
| --- | --- |
| `test/validate.mjs` | The validator says the right thing about the wrong song |
| `test/clock.mjs` | Every voice's rate against the datasheet formula, the frame counter's phase, the registers against nesdev |
| `test/driver.mjs` | What the driver writes is what a NES needed: the sweep byte, the phase restarts, silence through the channel's own registers |
| `test/golden.mjs` | A fixed song renders to the same bytes. If the hash moves, the sound moved |

The golden hash is the one to watch. A fix that brings the chip closer to the
hardware changes it, and the commit that does so says what moved and why. A hash
that changes without that sentence is a regression.

And on every push, `conform` - the harness in `packages/conform` - does two more
things. It runs a corpus of register logs through this chip and through
Nes_Snd_Emu, blargg's reference, and compares the two cycle for cycle: the pulses
are identical to it on every song, and what differs, and why it is the oracle's
convention rather than a bug here, is on the sheet. And it runs every one of
blargg's APU test ROMs on a 6502 it carries for the purpose - length counters,
frame timing to the cycle, the IRQ, the reset button, the DMC - and all
twenty-nine pass. Blargg's mixer tests, which cancel each channel against the
DMC's DAC and which he recorded on a real NES, cancel here as well as they did on
his console: the DAC curves are measured, not assumed.

The Game Boy's chip, at `src/chips/gb/dsp.ts` and exported as `gbChip`, is held
to the same method: `test/gb.mjs` checks its clocks against the formulas, the
harness runs blargg's twelve `dmg_sound` ROMs on an SM83 of its own, all of
which pass, and compares it with Gb_Snd_Emu. Its sheet is
[`docs/chips/dmg.md`](https://github.com/gwendall/chipvoice/blob/main/docs/chips/dmg.md).
`test/gb-driver.mjs` checks what the driver writes to it, and `test/golden-dmg.mjs`
locks its render the way `golden.mjs` locks the 2A03's.

The third chip is the Mega Drive's, `mdChip`: a YM2612 at `src/chips/md/ym2612.ts`
that is Nuked-OPN2 ported line for line - the harness compares the two and they
are identical cycle for cycle on every voice - and an SN76489 from the documents.
`Chip.create({ chip: "md" })` puts the lead and the bass on FM patches, the
chord on the PSG and the kit on its noise; `Instrument.fm` is a patch of four
operators for a host that wants its own. Its sheet is
[`docs/chips/md.md`](https://github.com/gwendall/chipvoice/blob/main/docs/chips/md.md).
**Licence:** that one file is a derivative of Nuked-OPN2 and is LGPL 2.1; the
package's licence field says `(MIT AND LGPL-2.1-or-later)` and everything else
is MIT.

The fourth is the SNES's, `snesChip`: an S-DSP at `src/chips/snes/sdsp.ts` that
is snes_spc's ported line for line, the second LGPL file, and identical to it
sample for sample on the DSP's output stream. Everything on it is a sample:
`Chip.create({ chip: "snes" })` plays waveforms and drums the driver synthesises
and encodes to BRR (`encodeBrr` is exported), with the machine's echo on.
`Instrument.sample` names a sample in the driver's bank. Its sheet is
[`docs/chips/snes.md`](https://github.com/gwendall/chipvoice/blob/main/docs/chips/snes.md).

The fifth is the Commodore 64's, `c64Chip`: a 6581 SID at `src/chips/c64/sid.ts`,
written from the documents and identical to reSID-fp, the harness's oracle, on
both digital values of every voice. Three voices for the score's four lines:
`Chip.create({ chip: "c64" })` puts the lead and the bass on a voice each and the
chord and the kit on the third, where a drum cuts the chord and the chord comes
back after it. `Instrument.waveform` picks a voice's waveform, one for the note
or one per frame. The analog stage is a profile, `SID_6581_PROFILE`: the chip's
non-linear DAC ladders, its filter on a measured curve, the output stage. Its
sheet is
[`docs/chips/c64.md`](https://github.com/gwendall/chipvoice/blob/main/docs/chips/c64.md).

## The song, as bytes: VGM

A NES saw a song as register writes, and so does this library, so the most honest
file it can produce is the list of them. That list is a VGM file - the chiptune
world's exchange format - and every chiptune player opens it, and a VGM player on
real hardware plays it on the chip itself.

```ts
import { recordSong, toVgm } from "chipvoice";

const { events, cycles } = recordSong(THEME, { seconds: 30 });
writeFileSync("theme.vgm", toVgm(events, cycles, { title: "Theme", author: "me" }));
```

`recordSong` runs the same driver and sequencer as `renderSong` and keeps what
they write instead of playing it. `toVgm` rounds each write to a sample at
44100 Hz, which is the format's clock, and writes a GD3 tag so a player shows
a name. Pass `loopAtCycle` and the file loops there.

## Checking a song before playing it

```ts
import { validateSong } from "chipvoice";

const { ok, issues, measured } = validateSong(song);
```

There is one property of this format that is hostile to anything writing songs
without ears: **a mistyped note is silent.** A token that is not a note name
resolves to 0 Hz, the driver returns without scheduling anything, and the result is
a hole in the middle of a piece with no error anywhere.

So every issue carries `silent`, which is the difference between a mistake and a
mistake that leaves no evidence:

```json
{ "level": "error", "track": "lead", "step": 12, "token": "H4",
  "message": "not a note name. A note is a letter A-G, an optional # or b, then an octave: A4, F#3, Bb2. Use . to hold and = to cut",
  "silent": true }
```

It also measures - loop length, onset density, melodic range - and warns when a loop
is under fourteen seconds, which is where a piece starts being heard as a repeat.

## Other chips

Five machines ship: NES, Game Boy, Mega Drive, SNES and C64. `ChipSpec` names
voices and role allocation; `ChipCore` consumes timestamped register writes and
fills buffers. Instruments support frame tables, FM patches and samples.

The portable score keeps four musical roles. Arrangers map them onto each machine:
FM lead/bass and PSG chord/drums on Mega Drive, four sample voices on SNES, and
shared chord/percussion on the C64's third voice. SNES triads, FM percussion and
SID filter controls remain backlog items. VGM export supports NES, Game Boy and
Mega Drive; SNES and C64 register logs do not yet have a shipped file exporter.

`validateSong` reports machine-specific base-pitch and arpeggio range warnings.
It preserves the score; it does not guarantee every modulation stays representable.
See the [portable score](../../docs/SCORE.md) and each chip's conformance sheet for
capabilities and the distinction between corpus parity and physical measurements.

## Controlled variations

```ts
import { varyScore } from "chipvoice";
const variation = varyScore(score, {
  kind: "melody", // or "drums", "timbres"
  locked: ["bass", "chord"],
  seed: 42,
});
```

Variations are local and reproducible. Melody reuses existing pitch classes and
keeps rhythm (an empty melody gets a first note); drums choose authored grooves.
Locked roles retain notes and timbres. An edit drops an explicit playback ID so
`arrange` derives a new one. The demo adds Undo, optional MIDI note input, aligned
stems and five-machine ZIP exports with cancellation.

## API

| | |
| --- | --- |
| `Chip.create(options?)` | Starts the chip. Resolves to `null` where AudioWorklet is missing, so a caller degrades instead of crashing |
| `chip.play(song)` | Starts a song. A no-op if that `song.id` is already playing |
| `chip.stop()` | Stops it and frees every channel |
| `chip.position(into?)` | Current audible step and order index; optional caller-owned storage |
| `chip.quantizedPosition()` | Nearest sixteenth at input time, including pattern/loop wrap; `null` before playback or in a scheduling gap |
| `chip.sfx(channel, opts)` | Plays an effect, taking the channel from the music |
| `chip.canPlay(channel, at?)` | Whether a channel is free |
| `chip.beatDelay(maxWait?)` | Seconds until the next eighth, capped |
| `chip.setGain(0..1)` | Ramped, because a step is a click |
| `chip.output` | The node everything runs through, for analysers and recording |
| `chip.audioContext` | For sharing one context with the rest of your audio |
| `chip.dispose()` | Frees the worklet, and closes the context if it made it |

Songs are matched by `id`, not by identity: a variant built at call time - a spread
to change one field - fails an identity check and restarts the piece on every call.

**Bringing your own sequencer.** `Chip` is the whole thing, and what a game should
reach for. A game that already has a music state machine - pause, hold, resume -
wants only the part that turns notes into register writes and talks to the
worklet, and that is exported on its own:

```ts
import { APU, type NoteSink } from "chipvoice";

const apu = new APU(ctx);
await apu.init(master);          // loads the worklet, connects it
apu.playNote("p2", { note: "B6", instrument: LASER, duration: 0.1, at });
```

`OfflineDriver` is the same class writing into a chip core instead of a worklet,
which is what `renderSong` uses.

## Releasing

Publishing runs on a tag, from GitHub Actions, over **trusted publishing**: npm
trades the workflow's OIDC token for a short-lived credential, so no secret is
stored anywhere. There is nothing to leak, rotate, or forget to revoke - and npm
is retiring 2FA-bypass tokens for direct publishing in January 2027, so the
alternative has an expiry date on it.

```
cd packages/chipvoice
npm version patch --no-git-tag-version      # or minor, or major
git commit -am "chipvoice $(node -p 'require("./package.json").version')"
git tag -a "v$(node -p 'require("./package.json").version')" -m "chipvoice $(node -p 'require("./package.json").version')"
git push --follow-tags                         # follows annotated tags only, hence -a
```

Three steps rather than one because `npm version` only commits and tags when the
package sits at the root of the repository, and this one sits in a workspace: run
bare, it bumps the file and quietly does nothing else.

The workflow refuses to publish if the tag and `package.json` disagree, and runs
`test:fresh` first - which installs the tarball into an empty project and drives
it in a browser. It is the only check that sees what `npm install` actually
hands over: a wrong `files` list, a missing export or a worklet left out of the
package all look perfect from inside the repo.

## Where it comes from

Extracted from [redburner.com](https://redburner.com), a wireframe rail shooter drawn
in the four-shade red palette of the 1995 Virtual Boy. Every sound in it comes from
this code, which is the only integration test that means anything.

MIT for the original code; LGPL-2.1-or-later for the derived YM2612 and S-DSP
cores. The package licence is `(MIT AND LGPL-2.1-or-later)`. See the source
headers and bundled licence notices. Console marks retain their owners’ rights.


### Demo and transport

The playable demo preserves the complete score through editing, drafts and
publication. Copy its score and runnable browser example, or export stereo WAV.
Local mute/solo and unrecorded live effects are not part of an exported score.

`chip.play(song, { step, orderIndex })` starts at a musical position. Use
`chip.position()` when replacing an instance to compare the same passage on
another machine. `arrange(score)` retains its target chip, which `renderSong`
honors unless explicitly overridden. Always dispose replaced instances.

Server audio links use the currently deployed renderer and revalidate their
bytes. For reproductions across releases, retain the score and pin the package
version. See [the demo specification](https://github.com/gwendall/chipvoice/blob/main/docs/DEMO.md).
