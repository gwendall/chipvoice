# A libsidplayfp oracle for PSID/RSID playback

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

[PSID/RSID playback](../../docs/chips/c64.md#psidrsid-playback) (`importPsid`,
NEXT-09) runs a PSID or RSID file's own INIT/PLAY machine code against a
from-scratch 6510 and a minimal, disclosed C64 environment, and records every
write the tune makes to the SID. This directory scores that write stream
against an independent second player, libsidplayfp, the same "measure it,
don't infer it" approach [`nsf-corpus`](../nsf-corpus/README.md) already
takes for NSF against Game_Music_Emu - empirically settling INIT's own
calling convention (which registers matter, and which are genuinely
undefined) rather than reading it off the file format document's prose.

## What is in the corpus, and what is not

`sources.json` lists every committed file: its title, author, licence,
licence URL, source URL and SHA-256. Both files here are self-authored (CC0,
this ticket's own), each purpose-built to put one narrow question to both
engines at once rather than relying on a found tune's own incidental
behaviour - see each entry's own `purpose`:

- `convention-probe.sid` stores INIT's own `A`, `X`, `Y` and PHP-pulled `P`
  straight to `$D400`-`$D403` once, nothing else - the calling convention
  itself, read back as a write stream instead of inferred.
- `frame-rate-probe.sid` writes a start marker in INIT, then increments one
  register every PLAY call for many frames - PLAY's own cadence against a
  real per-line VIC-II's own raster IRQ.

A real, independently-authored PSID corpus (mirroring nsf-corpus's own
homebrew/demo NSFs) is future work once a redistributable, small-enough
source is found; HVSC and commercial rips are never eligible, here or
anywhere in this project (decision 41).

A gitignored `.artifacts/psid-private/` directory is scored the same way
nsf-corpus's own `.artifacts/nsf-private/` is, for an owner's own local,
non-redistributable files. CI never populates that directory, so it never
affects a CI run; its results print to the console, tagged private, and are
excluded from the committed JSON and the sheet.

## Running it

```sh
pnpm --filter chipvoice build
node scores/psid-corpus/test-compare.mjs   # the comparator alone, no oracle build
pnpm psid-corpus:check                     # the full corpus against libsidplayfp
pnpm psid-corpus:sheet                     # also rewrites docs/chips/c64.md's marker block
```

`pnpm psid-corpus:check` clones and builds a pinned libsidplayfp revision
into the gitignored `.artifacts/psid-corpus/sidplayfp-oracle/` directory
(`native-oracle.mjs`; GPL-2.0-or-later, never vendored into
`packages/chipvoice`), runs a small purpose-built logger
(`sidplayfp-harness.cpp`) against it through libsidplayfp's own public
`SidConfig::sidEmulation` hook - it emulates no SID audio itself and patches
none of libsidplayfp's own sources - then compares the two write streams
with `comparePsidTrace` (`compare.mjs`). `--no-oracle` skips the build and
the comparison entirely, scoring only how many events our own capture
produces; useful with no network, or while adding a new fixture.

Unlike `nsf-corpus/compare.mjs`'s single shift, this comparator computes two
separate shifts, one for the INIT phase and one for the PLAY phase, because
libsidplayfp's own cold-start routine waits for a fixed raster line before
ever calling INIT (for deterministic timing regardless of how long INIT
itself takes to run), which offsets INIT's own absolute cycle count from
ours by a large, one-time amount that PLAY's own steady-state cadence does
not share. INIT-phase events are matched at zero tolerance after that
shift (confirmed cycle-exact); PLAY-phase events allow a small tolerance (8
cycles) to absorb the real, bounded per-line VIC-II jitter around the
nominal frame period that this project's own simplified once-a-frame raster
pulse does not reproduce. See `compare.mjs`'s own doc comment for the full
account, including the specific cycle deltas measured.

`convention-probe.sid`'s own `X` and `Y` registers are excluded from the
comparison entirely (`sources.json`'s own `undefinedRegisters`, turned into
`compare.mjs`'s own `ignoreAddrs`): the file format spec never defines `X`
or `Y`, this project deliberately zeroes them, and libsidplayfp's own
reference driver leaves them holding whatever incidental value an unrelated
CIA/raster setup branch happened to load last - not a documented value on
either side, so there is no defined answer to score either write against.
Those two writes are never counted as matched or as a divergence, and the
comparison carries on past them instead of stopping there, so the sheet's
own "Matched" column reflects everything else - `A`, `P`, and the whole
PLAY phase - genuinely, not just up to the first expected gap.

## Adding a file

1. Confirm the licence explicitly allows redistribution, and record its URL,
   the author and (if given) the exact licence identifier. HVSC and
   commercial rips are never eligible (decision 41).
2. Place the `.sid` under `files/`, add an entry to `sources.json` (`file`,
   `title`, `author`, `licence`, `licenceUrl`, `url`, `sha256`, and
   optionally `seconds` and `purpose`), then run `pnpm psid-corpus:check
   --no-oracle` to confirm `importPsid` can play it at all before spending
   time on an oracle build.
3. Run `pnpm psid-corpus:sheet` to score it against libsidplayfp and update
   `docs/chips/c64.md`; run `python3 docs/check-translations.py
   --sync-generated` to carry the generated block into the Japanese mirror.

If `importPsid` rejects a file for a missing 6510 opcode, an unsupported
format feature or a one-frame INIT budget too tight, the fix belongs in
`packages/chipvoice/src/psid-import.ts` and/or
`packages/chipvoice/src/chips/c64/cpu6510.ts` (with a unit test), never
hand-waved away here; a genuine divergence against libsidplayfp belongs on
the sheet as a finding, not a silent fix.
