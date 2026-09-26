# A game's own Mega Drive driver

<p align="center">
  <a href="MD-NATIVE-DRIVER.md">English</a> &bull;
  <a href="MD-NATIVE-DRIVER_ja.md">日本語</a>
</p>

The portable score is four roles that play on five machines. A game written for
one machine wants the whole machine: all six FM channels, hard stereo, PCM drums
on the DAC, three PSG tones, the noise at a rate of its own, and the tricks a
1992 sound programmer used on it. That is what this path is: a native Mega
Drive driver, a bank to start from, a text tracker, and the few steps between a
render and the files a game ships. [Decision 32](DECISIONS.md#32-a-games-own-mega-drive-driver-beside-the-portable-one-2026-09-26)
says why it sits beside `MdDriver` rather than inside it.

It was extracted from Punk Force, a shooter whose whole soundtrack and forty
effects are written on it. The extraction was checked by compiling that score
with the old code and the new: the same register writes, byte for byte, and the
same samples out of every step after them.

## The pieces

| Export | What it does |
| --- | --- |
| `compileMdVoices(voices)` | Voices to `RegisterEvent`s on the master clock, and how late the busiest write landed |
| `arrangeMdTracker(song, {tailBars, bank})` | A song written as text to those voices, with its loop points |
| `MD_BANK`, `MD_PATCHES`, `MD_PSG_INSTRUMENTS`, `MD_NOISE_INSTRUMENTS`, `MD_DRUMS` | FM patches, PSG and noise envelopes, a synthesized PCM kit |
| `mdDrumStream(hits, rate, seconds)`, `mdDrumSample(name, rate)` | The kit mixed into one stream for the DAC |
| `mdPatchWithRelease(patch, rr)` | A patch whose carriers stop faster, for effects |
| `renderMdEvents(events, {seconds, profile, gain})` | The writes played on a fresh Mega Drive |
| `MD_BRIGHT_PROFILE` | The Model 1 stage opened to 12 kHz, so hats keep their top |
| `trimRender`, `levelRender`, `scaleRender`, `packSprite`, `renderOnset` | Trim, level by loudness under a ceiling, pack effects into one file, find where a sound starts |

## Voices

A voice is one of the machine's channels and what it plays. Times are seconds,
pitches MIDI semitones (fractions detune), volumes linear.

| Voice | Takes | Notes |
| --- | --- | --- |
| `fm1` to `fm6` | `pan` (`L`, `R`, `C`), `gain`, `notes` | each note has an `FmPatch`; `levels` shapes it a frame at a time |
| `psg1` to `psg3` | `gain`, `notes` | each note has an `envelope` in dB per frame and a `hold` |
| `noise` | `gain`, `hits` | a hit has an `envelope`, and a `rate` (tone 3's period) or a `fixed` rate; `white: false` is the periodic buzz |
| `dac` | `pan`, `stream` | a PCM stream at `MD_DAC_HZ`, about 13.3 kHz; it takes FM 6 |

Every note can scoop (`bend`, `bendFrames`), slide from the previous one
(`glide`, in frames; a glide onto a note that touches the previous one is
legato, no new attack), fall at its end (`fall`, `fallAt`), take a delayed
vibrato (`vibrato: {delay, hz, depth}`) and sweep (`sweep`, semitones a frame).
Everything moves once a frame, sixty times a second.

`compileMdVoices` refuses what the machine cannot do: an unknown voice, a voice
given twice, `dac` beside `fm6`, and `psg3` beside a noise that uses `rate`
(the rate is tone 3's period).

```ts
import { compileMdVoices, mdDrumStream, mdPatchWithRelease, MD_PATCHES, MD_DAC_HZ } from "chipvoice";

const shot = compileMdVoices([
  { voice: "fm1", notes: [{ at: 0, until: 0.05, pitch: 88, sweep: -4, patch: mdPatchWithRelease(MD_PATCHES.zap, 11) }] },
  { voice: "noise", hits: [{ at: 0, until: 0.033, envelope: [-6, -16], rate: 1 }] },
  { voice: "dac", stream: mdDrumStream([{ at: 0, drum: "boomS", volume: 0.5 }], MD_DAC_HZ, 0.6) },
]);
```

### The bus

Writes are grouped in transactions a driver would not split (a frequency's two
registers, a patch). The YM2612's queue behind its busy flag, thirty-two
internal cycles a write; the PSG's behind its own. A frame that asks for more
than the flag lets through lands late, and `lateCycles` says by how much, in
master cycles (`MD_MASTER_HZ` a second). Punk Force's songs, DAC streaming,
peak between 2.8 and 4.5 ms.

A patch is written once per channel, and a new one writes only the registers
that differ. The LFO is off (power-on writes `$22` = 0), so a patch's `ams`,
`pms` and an operator's `am` have no effect yet; `ssg` reaches register `$90`.

## The tracker

A song is sections of text, one line per channel. A sixteenth is the step.

| Token | Meaning |
| --- | --- |
| `E5:4` | E5 for four sixteenths; the length carries over (`E5:2 G5 A5` are all 2) |
| `r:4` | a rest |
| `-:4` | the previous note held longer |
| `^E5` | scooped up from a whole tone below |
| `~G5` | slid into from the previous note, no new attack |
| `E5'` `E5!` `E5>` | staccato (half), accented (x1.26), falls off at the end |
| `@mute` | the following notes use this patch or PSG instrument |
| `%60` | the following notes at 60 % |
| `\|` | a bar line, checked |

Drum and noise lines take one letter a sixteenth from the bank's `drumLetters`
and `noiseLetters`; `.` and `-` are silence. The default bank reads `k` kick,
`s` snare, `S` loud snare, `x` both, `h` `m` `l` toms on the DAC, and `h` hat,
`H` loud hat, `o` open hat, `c` crash on the noise.

A channel names its `voice` and may set `pan`, `patch`, `volume`, `transpose`
and `vibrato` (on notes of a quarter or longer; defaults 8 frames, 6.3 Hz, 0.3
semitones). `echo: {of, delay, volume}` copies another channel's written notes
later and quieter wherever this channel has no line of its own; a section that
writes one (a harmony) keeps it. `snareWires` on the noise doubles every DAC
snare with the bank's wires, which the DAC's 13 kHz cannot carry.

`tailBars` plays that many bars of the loop section again after the end, so a
loop can be cut where its second pass matches its first. `loopStart` and
`loopEnd` come back in seconds.

```ts
const song = arrangeMdTracker({
  bpm: 160, order: ["intro", "A"], loop: "A",
  channels: {
    lead: { voice: "fm1", patch: "lead", vibrato: {}, volume: 0.52 },
    echo: { voice: "fm2", pan: "R", patch: "lead", echo: { of: "lead", delay: 3, volume: 0.3 } },
    drums: { voice: "dac" },
    hats: { voice: "noise", volume: 0.9, snareWires: true },
  },
  sections: {
    intro: { bars: 1, drums: "k...s...k.k.S..." },
    A: { bars: 1, lead: "^E5:3 G5:3 B5:4 A5:2 G5:2 F#5:2", drums: "k.k.s..kk.k.S...", hats: "h.h.h.h.h.h.h.hH" },
  },
}, { tailBars: 1 });
```

## From writes to the files a game ships

A game that plays pre-rendered audio keeps the cores in its build script and
ships files. The Punk Force script is this, and nothing else of the engine:

```ts
import { arrangeMdTracker, compileMdVoices, renderMdEvents, trimRender, levelRender, packSprite, renderOnset, toWav, MD_BRIGHT_PROFILE } from "chipvoice";

const opts = { profile: MD_BRIGHT_PROFILE, gain: 0.9 };

// A loop: once through plus a bar of its start, so the jump lands on a downbeat
// even when a decoder shifts the audio by a few milliseconds.
const a = arrangeMdTracker(song, { tailBars: 1 });
const loop = levelRender(renderMdEvents(compileMdVoices(a.voices).events, { seconds: a.loopEnd + 16 * a.step, ...opts }), { peak: 0.89 });

// A jingle: rendered past its end, then cut where it died away.
const j = arrangeMdTracker(jingle);
const once = levelRender(trimRender(renderMdEvents(compileMdVoices(j.voices).events, { seconds: j.totalSeconds + 1.2, ...opts })), { peak: 0.89 });

// Effects: each alone on a fresh chip, levelled by loudness under a ceiling, laid end to end.
const parts = Object.entries(SFX).map(([name, fx]) => [name, levelRender(trimRender(renderMdEvents(compileMdVoices(fx.voices).events, { seconds: fx.seconds + 1, ...opts })), { peak: 0.95, rmsDb: fx.rms })]);
const { render, sprites } = packSprite(parts, { gapSeconds: 0.15 });

const wav = toWav(render); // then any encoder
const onset = renderOnset(render);
```

**The decoder's shift.** An MP3 decoder that ignores the encoder's delay starts
the audio a few milliseconds late. Store `renderOnset` of each render beside
the file; at run time, measure the decoded buffer the same way (the first
sample at a quarter of the opening's peak), and add the difference to every
loop point and sprite offset. The measure is a dozen lines; a player can keep
its own copy rather than load chipvoice and its cores at run time.

Encoding is the caller's: `toWav` writes the WAV every encoder takes.

## What is checked

- `test/md-native.mjs`: power-on, the busy flag's spacing, patch diffs, pan,
  legato, levels, vibrato, PSG and noise bytes, the DAC's pace, the refusals,
  the bank, every tracker token, loop points with and without a tail, echoes,
  snare wires; A4 on FM 1 is 440 Hz and hard left is heard on the left only.
- `test/game-audio.mjs`: trim, scale, level, sprite and onset on signals whose
  answer is known, and the bright profile's top end.
- `test/golden-md-native.mjs`: a song on every voice, its writes and its render
  hashed.
- The extraction: Punk Force's five songs (1,515,150 writes for the stage,
  1,001,067 for the boss) and its forty effects compile to the same writes as
  the game's own driver, and render, trim, level and pack to the same samples.
