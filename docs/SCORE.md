# The portable score

**Status: draft.** This is the design sketch for phase 4 of the
[roadmap](ROADMAP.md). The split into two layers is decided; almost everything
below the first heading is a lean, not a decision, and is written down so the
leans are visible before the Game Boy forces the real design.

## The problem

One song, many machines. Chips differ in how many voices they have, in what an
instrument is, and in the conventions that grew up around their limits. A port is
an arrangement, and historically it was done by hand: the Mega Drive and SNES
soundtracks of the same game were different pieces of work by different people.

The format chipvoice has today - four lines of tokens, one per sixteenth, with
fixed instruments - is an arrangement for the 2A03 that does not know it is one.
The job is to separate what the music *is* from what a chip *does with it*.

## Two layers

**The score** says what the music is. Roles, notes, and intentions. It knows
nothing about any chip.

**The arrangement** is what a chip does with a score. An arranger per chip maps
roles to voices, intentions to that chip's instruments, and applies the chip's
idioms. Its output is the chip's own instrument definitions and a register-event
stream, which is what the core plays and what VGM export serialises.

The four-line format stays as the wire format for 2A03 songs and as the input to
the 2A03 arranger. Nothing published so far becomes invalid.

## Roles

`lead`, `harmony`, `bass`, `percussion`. These are the four the current format
has, under the name `chord` for harmony, and they are the four that every chip
from the SN76489 up can carry in some form.

Later, and only if a chip with more voices asks for them: `counter`, a second
melodic line; `pad`, sustained harmony; and doubling hints, "the bass also on a
second voice an octave up".

## Intentions

What a role should sound like, without naming a waveform. Two options:

- **Named archetypes** per role: `bright lead`, `soft lead`, `hollow bass`,
  `plucked harmony`. Each arranger maps each archetype to its own instrument in
  its own idiom.
- **Parameters**: brightness, attack, sustain, vibrato, each 0 to 1, that every
  arranger interprets.

Lean: archetypes. Agents and people both write "a bright lead" more reliably than
`brightness: 0.8`, and an archetype leaves the arranger free to be idiomatic: a
bright lead on a 2A03 is a 12.5 % duty pulse, on a YM2612 it is a patch with a high
modulator level, on a SNES it is a particular sample. A parameter would push all
three towards the same wrong answer.

## Idioms per chip

What the arranger knows that the score does not. The table is what each arranger
is built from.

| Chip | Lead | Harmony | Bass | Percussion | The signature |
| --- | --- | --- | --- | --- | --- |
| 2A03 | Pulse 1, duty as timbre | One pulse, arpeggiated at frame rate | Triangle, an octave down | Noise; DMC samples when present | Arpeggiated chords, triangle bass |
| DMG | Pulse 1, with sweep for effects | Pulse 2, arpeggiated | Wave channel with a custom waveform | Noise | The wave channel's bass |
| YM2612 + SN76489 | FM patch | PSG arpeggios or an FM pad | FM, slap or synth bass | FM drums, or PCM on channel 6 | FM bass, the DAC's ladder |
| S-DSP | A sample | Real triads across voices | A sample | A sampled kit | Everything sampled, and the echo |
| SID | One voice | Fast arpeggio on one voice, at 50 Hz | One voice | Waveform switches on one voice | Three voices and the filter sweep |

## The voice budget

Fewer voices than roles - the SN76489 has three tones and a noise: the arranger
holds priorities per role and sharing rules, bass and harmony alternating on one
voice being the classic one. More voices than roles - the S-DSP has eight: real
triads, doubling, and echo voices.

The 2A03's channel stealing generalises here. `canPlay` and `claim` today speak
in the 2A03's four channels; after the arrangement layer they speak in the chip's
voices, and the arranger says which role loses a voice first.

## Structure

Patterns and an order exist today and stay. Open: whether the score adds a loop
point, a key, and named sections. Lean: add a loop point and a key, because the
validator can check against them and an agent benefits from writing them down,
and keep sections out until something needs them.

## Interfaces, as a sketch

```ts
type Role = "lead" | "harmony" | "bass" | "percussion";

interface Score {
  bpm: number;
  key?: string;                       // "A minor"
  patterns: Array<Record<Role, string>>;  // the token lines
  order: number[];
  harmonyShape: number[][];            // today's chordShape, per pattern
  intent: Partial<Record<Role, string>>;  // archetypes
}

interface Arranger {
  chip: ChipSpec;
  arrange(score: Score): ChipSong;    // the chip's instruments, its lines, its claims
}
```

`ChipSong` is what the driver for that chip consumes. It is the existing `Song`
for the 2A03 and will be something else for each chip after.

## Validation

Two levels, and the score's `silent` flag survives both.

- **Score level**, chip-agnostic: notes parse, every line has the same length,
  ranges per role are sane, the loop is long enough to be heard as a piece.
- **Arrangement level**, per chip: what this chip cannot do with this score. The
  SN76489's tone range stops at a certain low note; the DMG's wave channel has its
  own range; the SID has three voices and this score wants four at once.

## Export

VGM from the register-event stream, per chip, once events are in cycles. NSF, GBS
and the like need a driver embedded in the file and come later, chip by chip.

## What has to happen before this is designed for real

The Game Boy. Its wave channel is the first instrument that is not a table of
frame values, and its four voices map to the four roles differently from the
2A03's. The second data point is what turns this sketch into a design.
