# Conformance: how a chip is verified

chipvoice says it sounds like the hardware. This is how that claim is tested in a
way that produces a number rather than an adjective. The method is the same for
every chip, so the sheet for the SNES reads like the sheet for the NES, and "done"
means the same thing on both.

## What "the machine" means

A sound chip has two stages, and only one of them admits a 100 %.

**The digital core** is a synchronous circuit. For a given sequence of register
writes at given clock cycles there is exactly one correct sequence of output values,
cycle by cycle. It is a finite state machine, so "is this identical?" has a
mechanical answer. This is where the identity of the sound lives: the duty
sequences, the shift register, the envelopes, the FM operators, the sample
interpolation.

**The analog stage** is everything after the DAC: the mixing curve where it is
analog, the output filters, the modulator, capacitors with tolerances. Two real
consoles of the same model do not match each other. A front-loading NES, a
top-loader, a Famicom and an AV Famicom have different corner frequencies. The
6581's filter varies chip to chip. There is no single truth to reproduce, so the
target is a *reference unit* and a *tolerance*.

So: the digital output is compared **bit for bit**, and the analog stage is
measured **in dB against a named unit**. A sheet that says "100 %" means the
digital core, and it says which unit and how many dB for the rest.

One more distinction. A render being *deterministic* - same input, same bytes - is
not the same as it being *correct*. The noise channel ran an octave low for a
version, deterministically. Determinism is what makes verification possible;
correctness needs an oracle.

## Oracles

Ranked. Use the strongest one available; use the next one down to find bugs faster.

| Rank | Oracle | What it proves | Cost |
| --- | --- | --- | --- |
| 1 | Simulation of the netlist extracted from the die | The truth, transistor by transistor | Thousands of times slower than real time. An arbiter, not a test runner |
| 2 | Logic capture of a real chip's digital output pins | The truth for one physical chip | Needs the chip to have digital pins, and hardware |
| 3 | A reference emulator, itself validated against 1 or 2 | Equal to the state of the art | Cheap. Where most of the work happens |
| 4 | The community's test ROMs | The edge cases people have already found | Needs a CPU to run them |
| 5 | The formulas on the datasheet | Rates, periods, sequence lengths | Nearly free. Catches the embarrassing bugs |

Which oracle each chip gets:

| Chip | Rank 1 or 2 | Rank 3 | Rank 4 |
| --- | --- | --- | --- |
| Ricoh 2A03 | Visual2A03, the netlist simulation | Nes_Snd_Emu (blargg), Mesen | blargg's `apu_test`, `apu_mixer`, `apu_reset` and friends |
| Game Boy DMG | | SameBoy | blargg's `dmg_sound`, `cgb_sound` |
| YM2612, YM3438 | Logic captures of the digital output exist; Nuked-OPN2 was derived from the die | Nuked-OPN2 | |
| SN76489 | | MAME `sn76496` | |
| SNES S-DSP | The DSP outputs a serial digital stream to an external DAC, and captures of it exist | snes_spc (blargg), ares | |
| SID 6581, 8580 | Analog. No digital 100 % exists | reSID-fp, with per-chip profiles | |

For the chips whose reference core came from the die or was matched to captures,
parity with the reference *is* parity with the hardware. That is why the roadmap
borrows those cores rather than writing new ones: the verification comes with them.

## Test vectors

Four kinds, from the most convincing to the cheapest. A chip's sheet reports all
four.

**1. A corpus of real music.** Register-write logs with timestamps in chip cycles,
taken from real games. VGM files are exactly this and exist by the thousand for the
Mega Drive, the Master System, the Game Boy and the PC Engine; the format has
carried NES APU writes since 1.61. For the NES the richer source is an NSF played
by a reference player with a write logger, which turns Mega Man 2 into a test
vector. The corpus is chosen to cover features: sweeps, envelope decay, both noise
modes, the DMC, length counters actually expiring. A small subset of around twenty
short logs runs in CI; the full set runs at release and on demand.

**2. Test ROMs.** They need a CPU. The harness carries one, a 6502 in a few
hundred lines that exists only to run these and never ships, with enough of a
console around it to read a verdict: memory at `$6000` for the newer ROMs, the
screen for the older ones, the beeps for the ones that only beep.
`pnpm --filter chipvoice-conform roms` runs every ROM under `packages/conform/roms`
and `roms:sheet` writes each verdict on the sheet by name.

**3. Formula tests.** `test/clock.mjs` for the 2A03: every voice's rate against
the datasheet formula, the LFSR's sequence lengths, the frame counter's phase.
Every chip gets one. They run in milliseconds and would have caught the noise bug.

**4. The golden hash.** `test/golden.mjs`: a fixed song, rendered and hashed.
It locks the whole path - driver, sequencer, core, resampling, analog stage - and
says when any of it moved. It cannot say whether the move was towards the hardware
or away; that is what the first three are for.

## The harness

`conform`, in `packages/conform`. One command for every chip.

```
pnpm --filter chipvoice-conform conform 2a03 --corpus corpus/2a03 --oracle nes-snd-emu
pnpm --filter chipvoice-conform baseline     # rewrite the baseline and the sheet's numbers
pnpm --filter chipvoice-conform corpus       # regenerate the logs from the songs and scripts
node packages/conform/src/corpus/import-vgm.mjs some.vgm --out packages/conform/corpus/2a03
```

Any NES VGM file - a rip of a real game, a tracker's export - is corpus material
through `import-vgm`. A rip of a commercial game belongs on a developer's machine,
not in this repository, which holds only what it may.

- Reads each log in the corpus, runs it through chipvoice's core and through the
  oracle, and compares the **digital** output on every cycle.
- Reports per file: identical cycles over total, and on the first divergence the
  cycle number, the register writes leading up to it, and both outputs for sixteen
  cycles either side. The point of the report is that the bug is findable from it
  without a debugger.
- Reports per voice: the identical count, the edges that match exactly, within a
  cycle, or not at all, the constant shift that lines the most edges up, and how
  many runs of edges line up under a shift of their own - which is what tells a
  phase convention from a bug. `--dump <voice>` prints both streams side by side
  around the first divergence.
- Exits non-zero on any divergence, or, given `--baseline`, only when a voice's
  identical count fell below the committed baseline. That is what CI runs: an
  imperfect oracle diverges somewhere by design, and what must not happen is a
  regression.
- Writes the sheet's numbers between its parity markers. Nobody types them.

The oracle is a native build of the reference core: its sources are vendored, a
recording sink stands in for its sample synthesis, and the system C++ compiler
builds it on first use. A WebAssembly build would do as well; native was a day
shorter.

## What a core must provide to be testable

- **A byte port.** The core takes writes as the CPU made them, an address and
  a byte, and decodes them itself. That is what every log and every oracle
  speaks, and it is the only interface that cannot let a driver do something
  the hardware could not.
- **Events timestamped in chip cycles.** `ChipSpec.clockHz` names the clock,
  and a write lands on its cycle wherever that falls inside a sample. The
  sample clock is derived from the cycle clock, never the other way round, and
  the same stream applies its writes on the same cycles at any sample rate.
- **A digital output**, one value per cycle, before resampling and before the
  analog stage. This is what parity is measured on.
- **The analog stage as a separate model** with a named profile, so "NES-101" and
  "AV Famicom" are parameters rather than code.
- **A documented power-on state**, and a `reset()` that returns to it.
- **No host globals, no randomness, no time.** A core that reads a clock cannot
  be compared to anything.

## The analog stage protocol

1. Choose a unit and name it on the sheet: model, revision, year, output path.
2. Publish a test script of register writes in the corpus, so anyone with the same
   unit can capture the same thing.
3. Capture the line output at 96 kHz, 24-bit, with the script running.
4. Emulate the same script with the same profile, then compare: spectral error per
   third-octave band, and the estimated corner frequencies of each filter.
5. Put the maximum band error and the corners on the sheet, with the tolerance the
   chip is held to. For first-order stages the target is within 1 dB from 40 Hz to
   15 kHz.

Resampling belongs to this stage too. A box filter over the cycles of a sample and
band-limited step synthesis give different aliasing, and neither is "the hardware":
the hardware's output is continuous. Parity is measured before it; its effect is
reported here.

## The sheet

One per chip, at `docs/chips/<id>.md`, from [chips/TEMPLATE.md](chips/TEMPLATE.md).
Numbers are written by the harness; prose is written by hand. It carries:

- **Status**: unverified, in progress, or verified.
- **Digital parity**: oracle, corpus size, identical cycles over total, files with a
  divergence, first divergence.
- **Test ROMs**: each by name, with its verdict.
- **Analog stage**: unit, tolerance, maximum error, measured corners.
- **Driver coverage**: which features the shipped driver actually exercises. A
  perfect chip driven through three registers has proved three registers.
- **Known deviations**: each with what it is, whether it is deliberate, why, and
  what it affects.
- **Sources**: the documents the implementation was written from.

A chip is **done** when all of the following hold:

1. Digital parity is 100 % on the full corpus.
2. Every test ROM on the sheet passes.
3. The analog stage is within the stated tolerance of the named unit.
4. The deviations list contains only deliberate entries, each with a reason.
5. The golden hash is recorded and the formula tests pass in CI.

"Verified" on a sheet means exactly that list, and nothing less.

## Rules

- **One harness, one sheet, one definition of done**, for every chip.
- **No chip ships without a sheet**, even one that says "unverified" on every line.
  An empty sheet is honest; a missing one is a claim.
- **Digital first, analog second.** The identity of the sound is digital, and that
  is where the 100 % exists.
- **The corpus is real music.** Synthetic tests catch what somebody thought to
  test. A real game catches the rest.
- **A regression is a hash that changes.** The golden hash in CI on every push, the
  corpus hashes at every release.
- **The driver is tested separately from the chip**, and the sheet says what the
  driver exercises.
- **"Accurate" does not appear in a README without a link to the sheet.**
