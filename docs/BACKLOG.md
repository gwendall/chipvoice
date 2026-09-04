# Backlog

The [roadmap](ROADMAP.md) says where this is going. This is the list of what is
being done about it, ticket by ticket, kept current at the start and the end of
every pull request. A ticket moves to *doing* with its branch, and to *done* with
its PR and what was learned. Discoveries that change the plan go in the log at
the bottom, dated, and the ticket they change is updated in the same commit.

Statuses: `todo`, `doing`, `done`, `dropped` (with why).

## Phase 1. The bench

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P1-1 | Events in chip cycles | done | 0.4.0 |
| P1-2 | Register writes are bytes: `RegisterEvent` is `{at, addr, value}`, the core decodes `$4000-$4017`, the driver encodes | done | 0.5.0. Learned: see the log |
| P1-3 | Digital and analog apart: a per-cycle digital output before mixing, resampling and filters; the output stage as its own class with a named profile | done | PR #2. `Nes2A03`, `NesOutputStage`, `NESDEV_PROFILE`; golden unchanged |
| P1-4 | The trace: a change stream per voice, `(cycle, value)`, which is what parity is measured on | done | PR #2. `DigitalChip.trace`, `ChipDefinition.digital()` |
| P1-5 | `conform`: the harness. Corpus in, two cores run, first divergence out, numbers as JSON | done | PR #3, `packages/conform` |
| P1-6 | Oracle 1: Nes_Snd_Emu, built natively from vendored LGPL sources with a recording sink in place of Blip_Buffer | done | PR #3. Its limits are on the sheet |
| P1-7 | Corpus 1: this project's own songs and feature scripts, as byte write logs | done | PR #3, 12 logs |
| P1-8 | The sheet's numbers written by the harness | done | PR #3, `--sheet` between markers |
| P1-9 | `conform` in CI on the subset | done | PR #3, against a committed baseline |
| P1-10 | The 5-step frame sequence and `$4017` write timing | done | 0.5.0, with P1-2: the decoder needed `$4017` anyway |
| P1-11 | A 6502 test fixture to run blargg's APU ROMs | todo | |
| P1-12 | Corpus 2: real games, from NSFs played through a reference with a write logger | todo | needs P1-11 or an NSF player |
| P1-13 | Oracle 2: a modern reference - Mesen 2's APU or puNES - to settle the frame timing and the triangle's start, where Nes_Snd_Emu 0.1.7 predates nesdev | todo | found in P1-6 |
| P1-14 | The triangle metric: compare step times with a per-run shift and a sequencer-position offset, so the triangle reads as identical when it is, rather than a few percent because of the oracle's start convention | todo | found in P1-6 |

## Phase 2. NES to 100 %

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P2-1 | Fix every divergence the harness finds, or document why the oracle is wrong | todo | |
| P2-2 | The DMC | todo | |
| P2-3 | A reference unit for the analog stage, captured and measured | todo | |
| P2-4 | Release with the sheet linked from the package README and the skill | todo | |

## Phase 3. Game Boy

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P3-1 | DMG APU from SameBoy's `apu.c` (MIT), with SameBoy as oracle | todo | |
| P3-2 | `ChipSpec`, `RegisterEvent` and the instrument model rewritten against two chips | todo | |
| P3-3 | The Game Boy sheet, generated | todo | |

## Phase 4. The portable score

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P4-1 | VGM export from the event stream | todo | cheap once P1-2 lands |
| P4-2 | The score: roles and intents | todo | |
| P4-3 | An arranger per chip | todo | |
| P4-4 | Instruments in the API and the wire format | todo | |
| P4-5 | Idioms per chip in the skill and the MCP server | todo | |
| P4-6 | Smooth vibrato through the sweep unit, the FamiStudio trick, so a vibrato across a period high-byte boundary does not reset the phase | todo | found in P1-2 |
| P4-7 | "Agent-written music sounds good" as a named goal with its own measures | todo | |

## Operations

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| OPS-1 | Vercel: the `chipvoice-api` project is still connected to the repository and fails a preview deployment on every push, next to the `chipvoice` project that serves chipvoice.dev. Disconnect or delete it. Needs the Vercel account, not the repository | todo | seen on PR #1 |

## Later phases

Mega Drive, SNES, C64: see the roadmap. Not ticketed until phase 3 is done.

## Discoveries

**2026-09-04, P1-2.** The decoded-command interface let the driver do two things
the hardware cannot. It changed a pulse's period high bits without restarting the
sequencer, which on a NES only a `$4003` write can do, and that write resets the
phase; and it never wrote `$4001`, leaving the sweep negate flag clear, so the
sweep unit's mute condition silenced any pulse note with a period of `$400` or
more - roughly G#2 and below. Drivers on the hardware wrote `$4001 = $08` for
that reason. Both are now what the hardware does: a note that crosses a period
high-byte boundary restarts its phase, and low pulse notes play.

**2026-09-04, P1-6, first run.** The pulses are identical to the oracle cycle
for cycle on every song and on the sweep-down, mute, and restart scripts: not
one edge unmatched. Every divergence found is an oracle convention: its frame
steps land two cycles late, its triangle steps at once when its counters reload
where the hardware waits for the timer, and its `reset()` writes `$4003` to
every voice so that its first frame clock loads every envelope with 15. The
sheet has the reading. CI checks a baseline rather than demanding zero
divergence, because with this oracle zero is not on offer; a second oracle is
ticket P1-13.

**2026-09-04, P1-6.** Nes_Snd_Emu 0.1.7 is from 2005 and predates some of what
nesdev now knows. Its frame sequence is a uniform 7458 cycles, not
7457/14913/22371/29829; its noise register starts at `1 << 14` and outputs the
volume when bit 0 is *set*, the inverse of the documented polarity; and while a
noise channel is muted it does not clock the register exactly, so the LFSR's
phase after any silence is approximate. The oracle is used for the pulses and
the triangle, cycle for cycle. The noise is verified by the formula tests and by
its envelope, which shares code with the pulses. The sheet says so.
