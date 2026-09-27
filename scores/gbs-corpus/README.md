# A corpus of real GBS command streams

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

[`importGbs`](../../packages/chipvoice/src/gbs-import.ts) plays a `.gbs`
(Game Boy Sound) file through an own SM83 CPU, built from documents only
(Pan Docs, gbdev's opcode tables, the GBS format spec - decision 41), and
returns a `PerformancePlan` on `dmg`. This directory grows a corpus around
it the same way [`scores/nsf-corpus`](../nsf-corpus/README.md) does for the
2A03: many real GBS files, each **scored** against an independent GBS
player, Game_Music_Emu's `Gbs_Emu`, rather than asserted - address, value and
cycle matched out of total, and the first divergence, so a driver quirk or a
genuine gap becomes a documented finding instead of a thrown assertion.

## What is in the corpus, and what is not

`sources.json` lists every committed file: its title, author, driver, source
URL, licence, licence URL, SHA-256 and how long to capture it for. Every
file is either:

- a **homebrew GBS whose licence explicitly permits redistribution** (CC0,
  CC-BY, public domain or similarly permissive) - not a commercial game rip,
  ever; or
- **self-produced**, written for this corpus and owned by the project (the
  one file it carries today, `pulse-sweep.gbs`, is this: a hand-assembled
  SM83 program, public domain).

A gitignored `.artifacts/gbs-private/` directory is scored the same way, for
an owner's own local files that cannot be committed. CI never populates that
directory, so it never affects a CI run; its results print to the console,
tagged private, and are excluded from the committed JSON and the sheet.

Real, independently authored homebrew GBS files (hUGETracker or GBT Player
demos, for instance) are not yet in the corpus - none had been sourced and
its licence verified in time for this ticket. Growing the corpus with real
driver output, alongside the self-produced file already here, is future
work.

## Running it

```sh
pnpm --filter chipvoice build
node scores/gbs-corpus/corpus.mjs --no-oracle   # our own capture only, no oracle build
pnpm gbs-corpus:check                            # the full corpus against Game_Music_Emu
pnpm gbs-corpus:sheet                            # also rewrites docs/chips/dmg.md's marker block
```

`pnpm gbs-corpus:check` builds the same pinned Game_Music_Emu oracle
`scores/arrangements/native-oracle.py` already builds for NSF (revision
`fe8da4b6d3876d7542c2fb69d94487e19836d678`), patched the same way but against
`gme/Gb_Apu.cpp` instead of `gme/Nes_Apu.cpp` (`native-oracle-gbs.py`), runs
`importGbs` on each committed file, and compares the two write streams with
`compareGbsTrace` (`compare.mjs`). `--no-oracle` skips the build and the
comparison entirely, scoring only how many commands our own capture
produces; useful with no network, or while adding a new source file.

Both `matched` (address, value and cycle, all three) and `valueMatched`
(address and value only, positional, ignoring cycle) are reported. They can
legitimately differ: see `compare.mjs`'s docstring for why `pulse-sweep.gbs`
matches every write's address and value, in order, for its whole run, while
its cycle-exact score against Game_Music_Emu's own CPU core is low - that is
a documented, understood divergence in per-opcode timing between two
independently built CPU cores, not a broken player. A file matching zero
commands *by value*, though, is a structural problem worth investigating,
and the script exits non-zero for that case.

## Adding a file

1. Either confirm the licence explicitly allows redistribution and record
   its URL, the author and the exact licence identifier, or produce the file
   yourself for the project (public domain, and say so).
2. Place the `.gbs` under `files/`, add an entry to `sources.json` (`file`,
   `title`, `author`, `driver`, `url`, `licence`, `licenceUrl`, `sha256`, and
   optionally `track` and `seconds`), then run `node scores/gbs-corpus/corpus.mjs
   --no-oracle` to confirm `importGbs` can play it at all before spending
   time on an oracle build.
3. Run `pnpm gbs-corpus:sheet` to score it against Game_Music_Emu and update
   `docs/chips/dmg.md`; run `python3 docs/check-translations.py
   --sync-generated` to carry the generated block into the Japanese mirror.

If `importGbs` rejects a file for a missing SM83 opcode, an unsupported
header field, or a budget too tight for that driver's own INIT/PLAY, the fix
belongs in `packages/chipvoice/src/chips/gb/cpu.ts` and/or
`packages/chipvoice/src/gbs-import.ts` (with a unit test in
`packages/chipvoice/test/`), built from documents, never by reading what
Game_Music_Emu's own CPU core does for that opcode. A genuine APU or CPU-
timing divergence against Game_Music_Emu belongs on the sheet as a finding,
not a silent fix.
