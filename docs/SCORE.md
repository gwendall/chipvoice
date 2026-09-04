# The portable score

**Status: decided, first version shipped (0.9.0).** The design below is what the
second chip settled; what remains open is marked as such. The history of the
leans is in decision 16 of [DECISIONS.md](DECISIONS.md).

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
  `chips/nes/arranger.ts`, `chips/gb/arranger.ts`. `arrange(score, chip)` gives
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

What the arranger and the driver know that the score does not. The two shipped
rows are what is built; the rest is the plan.

| Chip | Lead | Chord | Bass | Percussion | The signature |
| --- | --- | --- | --- | --- | --- |
| 2A03 | Pulse 1, duty as timbre | Pulse 2, arpeggiated at frame rate | Triangle, an octave down | Noise; DMC samples when present | Arpeggiated chords, triangle bass |
| DMG | Pulse 1, duty as timbre, retriggered on volume changes | Pulse 2, arpeggiated | Wave channel, the word as its waveform | Noise, the kit fitted to the hardware envelope | The wave channel's bass |
| YM2612 + SN76489 | FM patch | PSG arpeggios or an FM pad | FM, slap or synth bass | FM drums, or PCM on channel 6 | FM bass, the DAC's ladder |
| S-DSP | A sample | Real triads across voices | A sample | A sampled kit | Everything sampled, and the echo |
| SID | One voice | Fast arpeggio on one voice, at 50 Hz | One voice | Waveform switches on one voice | Three voices and the filter sweep |

## The voice budget

Both shipped chips have exactly four voices for the four roles, so the budget
has not been tested. Fewer voices than roles - the SN76489 has three tones and
a noise - will need priorities per role and sharing rules, bass and chord
alternating on one voice being the classic one. More voices than roles - the
S-DSP has eight - opens real triads, doubling and echo voices. `canPlay` and
`claim` already speak in the chip's own voice ids, and an arranger will say
which role loses a voice first.

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
  Not needed by the two chips so far, which play any score the first level
  passes; the SN76489's tone floor and the SID's three voices will need it.

## Export

VGM from the register-event stream, per chip: done for both. NSF, GBS and the
like need a driver embedded in the file and come later, chip by chip.

## What comes next

Idioms the arranger could apply beyond timbre: a chord voiced as a pad when the
chip has the voices, a bass doubled an octave up, the lead's vibrato through
the sweep unit on a 2A03 (P4-6). And the third chip, which will be the first
with a voice count other than four and an instrument that is not a table.
