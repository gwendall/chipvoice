# The portable score

**Status: shipped across five machines.** The first portable score shipped in
0.9.0. Decision 16 records its origin; the capabilities below describe the current
arrangers, with future work identified explicitly.

## The problem

One song, many machines. Chips differ in how many voices they have, in what an
instrument is, and in the conventions that grew up around their limits. A port is
an arrangement, and historically it was done by hand: the Mega Drive and SNES
soundtracks of the same game were different pieces of work by different people.

The format chipvoice started with - four lines of tokens, one per sixteenth, with
fixed instruments - was an arrangement for the 2A03 that did not know it was one.
The job was to separate what the music *is* from what a chip *does with it*.

## Two layers

**The score** says what the music is: roles, notes, and for each role an
*intent*, a word for what it should sound like. It names no waveform and knows
nothing about any chip. `Score` in `packages/chipvoice/src/score.ts`; the API's
wire format is a score.

**The arrangement** is what a chip does with a score, and it happens in two
places:

- The **arranger** maps intents onto the chip's instruments, in its idiom:
  `chips/{nes,gb,md,snes,c64}/arranger.ts`. `arrange(score, chip)` gives
  a `Song`, the same lines with that chip's instruments.
- The **chip's driver** maps the song's roles onto its voices
  (`ChipSpec.roles`) and turns each note's frames into its registers
  (`ChipDriver`): the bass on the wave channel, a volume change as a retrigger,
  a drum's decay as the hardware envelope. Decision 15.

A `Song` with its instruments spelled out still plays, for a host that wants a
timbre of its own. Nothing published before the score existed changed sound: a
score with no intent arranges to the instruments every song had.

## Roles

`lead`, `chord`, `bass`, `perc`. The four the format has always had, under the
names it always used, and the four that every chip from the SN76489 up can
carry in some form. Renaming `chord` to harmony would have broken every stored
song for a nicer word.

Later, and only if a chip with more voices asks for them: a second melodic
line, a sustained pad, and doubling hints.

## Intents

A word per role, from a catalogue that is the one source for the validator, the
OpenAPI schema and the skill's table (`INTENTS` in `score.ts`):

| Role | Words |
| --- | --- |
| `lead` | `soft` (default), `bright`, `round` |
| `chord` | `plucked` (default), `held` |
| `bass` | `round` (default), `hollow`, `bright` |
| `perc` | `tight` (default), `soft` |

Words, not parameters. The lean was decided by writing both down: an agent
writes "a bright lead" more reliably than `brightness: 0.8`, and a word leaves
the arranger free to be idiomatic. A bright lead is a 12.5 % pulse on a 2A03
and on a Game Boy; on a YM2612 it will be a patch with a high modulator level,
on a SNES a particular sample. A parameter would have pushed all three towards
the same wrong answer.

The bass is where the idiom shows. A NES has one bass voice, the triangle, and
plays it whatever the word; a Game Boy's bass is its wave channel, and the word
names the waveform in its RAM. `"hollow"` changes the Game Boy version and
not the NES one, and the skill says so, because that is the machine.

## Idioms per chip

What the shipped arrangers and drivers currently do:

| Chip | Lead | Chord | Bass | Percussion | The signature |
| --- | --- | --- | --- | --- | --- |
| 2A03 | Pulse 1, duty as timbre | Pulse 2, arpeggiated at frame rate | Triangle | Noise; DMC samples when present | Arpeggiated chords, triangle bass |
| DMG | Pulse 1, duty as timbre, retriggered on volume changes | Pulse 2, arpeggiated | Wave channel, the word as its waveform | Noise, the kit fitted to the hardware envelope | The wave channel's bass |
| YM2612 + SN76489 | FM patch | PSG arpeggios | FM patch | PSG noise clocked by tone 3 | FM timbres |
| S-DSP | A sample | One sample voice, arpeggiated | A sample | A sampled kit | BRR samples and echo |
| SID | One voice | Fast arpeggio on one voice, at 50 Hz | One voice | Waveform switches on one voice | Three voices; chord/drums share one |

## The voice budget

The C64 tested it first: three voices for four roles. The lead and the bass
keep a voice each, the chord and the percussion share the third, and the rule
is the sequencer's rather than the driver's, because a driver expands a note
into writes when the note is scheduled and cannot take one back: a drum cuts
the chord, and the chord comes back after it until the next drum, each
segment ending a frame before the drum so its note off cannot land on the
drum's gate (`Sequencer.scheduleStep`, when `roles.chord === roles.perc`).
That is what every C64 tune with drums did, and it means a busy drum line
leaves the chord little room, which the skill tells an agent. Other sharings
- bass and chord alternating, the classic on a three-voice PSG - are the same
rule with other roles, when a chip asks for it. More voices than roles - the
S-DSP has eight - opens real triads, doubling and echo voices, still to come
(P6-10). `canPlay` and `claim` speak in the chip's own voice ids.

## Structure

Patterns and an order, as they were. Open: a loop point, a key, named sections.
Lean unchanged: add a loop point and a key when the validator has something to
check against them; keep sections out until something needs them.

## Validation

Two levels, and the `silent` flag survives both.

- **Score level**, chip-agnostic: notes parse, every line has the same length,
  ranges per role are sane, the loop is long enough, every intent word is in
  the catalogue and names a role that exists.
- **Arrangement level**, per chip: what this chip cannot do with this score.
  Base notes and chord/instrument arpeggio extremes outside the voice's register
  range produce `pitch_range` warnings with role, pattern and step. The score is
  unchanged. Time-varying slides/vibrato and unknown sample banks are not fully
  diagnosed; voice sharing remains an arrangement constraint.

## Export

VGM from the register-event stream: shipped for NES, Game Boy and Mega Drive.
SNES/C64 file exporters remain open. NSF, GBS and the
like need a driver embedded in the file and come later, chip by chip.

## What comes next

SNES triads across spare voices, FM percussion, and exposed SID filter/sweep
controls remain P8-13. NES smooth vibrato through the sweep unit is implemented.
New machines remain demand-driven; finishing these arrangements and physical
verification does not require another chip.
