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
licence URL, source URL and SHA-256. The first two are self-authored (CC0,
this ticket's own), each purpose-built to put one narrow question to both
engines at once rather than relying on a found tune's own incidental
behaviour - see each entry's own `purpose`:

- `convention-probe.sid` stores INIT's own `A`, `X`, `Y` and PHP-pulled `P`
  straight to `$D400`-`$D403` once, nothing else - the calling convention
  itself, read back as a write stream instead of inferred.
- `frame-rate-probe.sid` writes a start marker in INIT, then increments one
  register every PLAY call for many frames - PLAY's own cadence against a
  real per-line VIC-II's own raster IRQ.

The other four are real tunes exported by a real player's own command-line
packer/relocator, not self-made: `gt2-dojo.sid`, `gt2-sanction-cia.sid`,
`gt2-hyperspace-alt.sid` and `gt2-consultant-alt-cia.sid` are four of
GoatTracker 2's own bundled example songs (official v2.77 distribution,
SourceForge, GPL-2.0-or-later), run through `src/gt2reloc.c` - the
`GT2RELOC`-guarded, non-interactive build of the same relocator the
interactive editor's own F9 calls, `Usage: gt2reloc <songname> <outfile>
[options]`, no UI automation involved. They cover a 2 driver by 2 timing
matrix from that one tool: `gt2-dojo.sid` and `gt2-sanction-cia.sid` use
GoatTracker 2's standard player (`player.s`); `gt2-hyperspace-alt.sid` and
`gt2-consultant-alt-cia.sid` use its alternate one (`altplayer.s`, selected
by `gt2reloc`'s own documented `-A` hardrestart-ADSR flag once its value
reaches `$f000`, exactly as `greloc.c` implements it). `gt2-dojo.sid` and
`gt2-hyperspace-alt.sid` are PAL, 1x speed, so the relocator writes an
all-zero PSID speed word - VBI-timed. `gt2-sanction-cia.sid` and
`gt2-consultant-alt-cia.sid` add `-S2` (a 2x speed multiplier), so the
relocator writes an all-ones speed word instead - CIA #1-timed. See each
entry's own `purpose` in `sources.json` for the exact command line and the
distribution's own md5.

Both VBI-timed files match libsidplayfp in full. Both CIA-timed files
diverge within the first few PLAY-phase writes (`sources.json`'s own
`purpose` names the exact command; the sheet below has the numbers) even
though the register values written are identical on both sides and the
cycle gap at that point is small (about 40 cycles) - a real, narrow
divergence in how this project's own CIA 1 emulation (`psid-import.ts`)
reconciles a non-default timer-A reload value against libsidplayfp's own,
surfaced by a real player's own multispeed output rather than invented for
the purpose. Left on the sheet as a finding, not silently patched over;
see `packages/chipvoice/src/psid-import.ts`'s own CIA 1 model
(`clockFor`/`cia1`) for where to start.

HVSC and commercial rips are never eligible, here or anywhere in this
project (decision 41).

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
