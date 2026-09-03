# <Chip name> (`<id>`)

Copy this file to `docs/chips/<id>.md` the day a chip is added, and fill in what is
true that day. "Unverified" on every line is a valid sheet. The method behind every
section is in [CONFORMANCE.md](../CONFORMANCE.md).

| | |
| --- | --- |
| **Machine** | |
| **Status** | unverified · in progress · verified |
| **Core** | own · ported from `<project>` · compiled from `<project>` |
| **Licence of the core** | |
| **Sheet updated** | YYYY-MM-DD, by hand · by `conform` `<version>` |

## Digital parity

Measured on the per-cycle digital output, before resampling and the analog stage.

| | |
| --- | --- |
| Oracle | |
| Corpus | `<n>` files, `<n>` seconds |
| Identical cycles | `<n>` / `<n>` (`<xx.xxxx>` %) |
| Files with a divergence | |
| First divergence | `<file>`, cycle `<n>` |

## Test ROMs

| ROM | Result | Notes |
| --- | --- | --- |
| | pass · fail · not run | |

## Formula tests

| Test | Result |
| --- | --- |
| | |

## Analog stage

| | |
| --- | --- |
| Reference unit | model, revision, year, output path |
| Capture | rate, depth, script |
| Tolerance | |
| Maximum band error | |
| Corners measured | |
| Resampling | |

## Driver coverage

What the shipped driver actually writes. Everything the chip implements that is
not listed here is implemented but not exercised by any music chipvoice makes,
and is verified only by the corpus and the ROMs, or not at all.

| Voice | Exercised | Not exercised |
| --- | --- | --- |
| | | |

## Known deviations

Every way the core is known to differ from the hardware. Deliberate ones say why
and stay; the rest are work.

| What | Deliberate | Why | Affects |
| --- | --- | --- | --- |
| | yes · no | | |

## Power-on state

What `reset()` returns the core to, and how that differs from the hardware's
power-on state, if it does.

## History

Fixes that changed the sound, newest first, with the commit.

## Sources

The documents the implementation was written from, and the ones it was verified
against.

---

**Done** means: digital parity 100 % on the full corpus; every ROM above passes;
the analog stage within tolerance of the named unit; only deliberate deviations,
each with a reason; the golden hash recorded and the formula tests green in CI.
