# chipvoice

Game audio on a real sound chip.

A **Ricoh 2A03** - the NES chip - emulated at the clock level and running in an
AudioWorklet, with a driver and a tracker on top, and one thing no other browser
library does: **sound effects take channels away from the music**, the way the
hardware forced them to.

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

**[Try it](https://chipvoice.dev)** - a grid, a playhead, and a Fire button
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
most of why those libraries sound wrong.

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

The chip is a pure function of the song and the sample rate. Same input, same bytes,
every time - which is what lets a server compute a file on demand and cache it
forever instead of storing one.

```ts
import { renderSong, toWav } from "chipvoice";

const audio = renderSong(THEME, { seconds: 30 });   // ~1.4s for 30s of sound
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

And on every push, `conform` - the harness in `packages/conform` - runs a corpus
of register logs through this chip and through Nes_Snd_Emu, blargg's reference,
and compares the two cycle for cycle. The pulses are identical to it on every
song; what differs, and why it is the oracle's convention rather than a bug here,
is on the sheet.

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

There is one implementation, and the shape is ready for the second without
pretending to have it.

`ChipSpec` describes what actually differs between machines: the voices, in number
and in kind; whether an instrument is per-frame tables, an FM patch or a sample; and
whether a voice takes a pitch, a noise period, or a sample. `ChipCore` is what does
not differ - something that takes timestamped register writes and fills a buffer.

What is still 2A03 in disguise, named rather than hidden:

- `Channel` is the literal union `"p1" | "p2" | "tri" | "noi"`
- `Instrument` is volume, duty, arpeggio, slide, vibrato - the model for simple
  waveform chips. An FM patch is four operators with an envelope each, an algorithm
  and a feedback level, and should not be forced into this shape
- `Pattern` names four voices. Eight do not fit four named fields
- percussion assumes a noise channel; the SNES has none, its drums are samples

**Each chip is a project, not a file.** The 2A03 is the simplest and best-documented
one; the SNES is a small sampler with a 64 KiB budget and BRR compression.
Generalising against a single case produces a bad abstraction, so the shape above is
deliberately concrete and will be rewritten against the second chip rather than
guessed at now.

## API

| | |
| --- | --- |
| `Chip.create(options?)` | Starts the chip. Resolves to `null` where AudioWorklet is missing, so a caller degrades instead of crashing |
| `chip.play(song)` | Starts a song. A no-op if that `song.id` is already playing |
| `chip.stop()` | Stops it and frees every channel |
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

MIT.
