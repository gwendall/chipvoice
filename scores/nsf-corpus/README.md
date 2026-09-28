# A corpus of real NSF command streams

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

[Complete arrangements](../arrangements/README.md) proves, for one song per
game (Mario, Zelda), that our own capture of a real NSF's INIT/PLAY commands
matches an independent NSF player, Game_Music_Emu, at the exact CPU cycle
(decision 29). This directory grows that from one song per game into a
corpus: many real, independently licensed NSFs, across several sound
drivers, each **scored** rather than asserted - commands matched out of
total, and the first divergence's cycle and register, so a driver quirk or a
genuine gap becomes a documented finding instead of a thrown assertion.

## What is in the corpus, and what is not

`sources.json` lists every committed file: its title, author, sound driver,
source URL, licence, licence URL and SHA-256. Every file but one is:

- a **homebrew or demo NSF** whose licence explicitly permits redistribution
  (CC0, CC-BY, public domain or similarly permissive) - not a commercial
  game rip, ever;
- **NTSC, 2A03-only**. Expansion-audio NSFs (VRC7, FDS, N163, Sunsoft 5B,
  MMC5) are out of scope for this ticket (NEXT-14 covers VRC6 alone so
  far); `capture-nsf.mjs` rejects the rest outright.

The one exception is `vrc6-probe` (NEXT-14 round 2): a tiny, self-authored
NSF (CC0, `make-vrc6-probe.mjs`, the same self-authored-fixture convention
`scores/psid-corpus/make-fixtures.mjs` uses for its two SID probes) that
declares Konami VRC6 and writes all three of its oscillators every frame.
No VRC6 NSF this project found carries a licence this corpus's own
convention requires, so a purpose-built probe stands in for one: it proves
`capture-nsf.mjs`'s own VRC6 routing here, and, because `nsf-export`'s own
corpus reads this same `sources.json`, it also proves `exportNsf`'s VRC6
round-trip and Game_Music_Emu's `Nsf_Emu` itself playing a VRC6 file, held
to the exact same gates as every 2A03 file in that corpus.

A gitignored `.artifacts/nsf-private/` directory is scored the same way, for
an owner's own local files that cannot be committed (an unlicensed personal
rip, for instance). CI never populates that directory, so it never affects a
CI run; its results print to the console, tagged private, and are excluded
from the committed JSON and the sheet.

## Running it

```sh
pnpm --filter chipvoice build
node scores/nsf-corpus/test-compare.mjs   # the comparator alone, no oracle build
pnpm nsf-corpus:check                     # the full corpus against Game_Music_Emu
pnpm nsf-corpus:sheet                     # also rewrites docs/chips/2a03.md's marker block
```

`pnpm nsf-corpus:check` builds the same pinned Game_Music_Emu oracle
`scores/arrangements/native-oracle.py` already builds for Mario and Zelda
(revision `fe8da4b6d3876d7542c2fb69d94487e19836d678` - round 2 extended its
patch to also log VRC6 writes from `gme/Nes_Vrc6_Apu.cpp`, for `vrc6-probe`
below), then runs `scores/capture-nsf.mjs` on each committed file and compares the two
traces with `compareNsfTrace` (`compare.mjs`). `--no-oracle` skips the build
and the comparison entirely, scoring only how many commands our own capture
produces; useful with no network, or while adding a new source file.

Unlike `compare-native.mjs`'s exact-cycle assertion (which anchors on a
marker byte specific to Mario's own driver, `$4017 === 255`, that does not
generalize), this comparator makes no assumption about the driver: both
traces' power-on ceremony writes (every one of them stamped at cycle 0; see
`compare.mjs`'s docstring for exactly what each side's ceremony writes and
why) are dropped, and what remains is compared positionally from the start.
A clean match is reported the same way Mario's is; a divergence is reported
with its cycle, register and both values, not thrown as an assertion
failure - this is meant to find and record real gaps, not just confirm
matches that already worked.

## Adding a file

1. Confirm the licence explicitly allows redistribution, and record its URL,
   the author and (if given) the exact licence identifier.
2. Place the `.nsf` under `files/`, add an entry to `sources.json` (`file`,
   `title`, `author`, `driver`, `url`, `licence`, `licenceUrl`, `sha256`,
   and optionally `track` and `frames`), then run `pnpm nsf-corpus:check
   --no-oracle` to confirm `capture-nsf.mjs` can play it at all before
   spending time on an oracle build.
3. Run `pnpm nsf-corpus:sheet` to score it against Game_Music_Emu and update
   `docs/chips/2a03.md`; run `python3 docs/check-translations.py
   --sync-generated` to carry the generated block into the Japanese mirror.

When no real, redistribution-licensed file exists to put a specific
question to (VRC6's own case, above), a self-authored, CC0 fixture
(`make-vrc6-probe.mjs`) is the fallback, the same convention
`scores/psid-corpus/make-fixtures.mjs` uses: a short, hand-assembled `.nsf`
that exercises exactly what is missing, committed alongside the script that
built it, `url` pointing at that script rather than a third party.

If `capture-nsf.mjs` rejects a file for a missing 6502 opcode or a
one-frame INIT budget too tight for that driver, the fix belongs in
`scores/capture-nsf.mjs` and/or `packages/conform/src/roms/cpu6502.mjs`
(with a unit test), never in `packages/chipvoice`; a genuine APU divergence
against Game_Music_Emu belongs on the sheet as a finding, not a silent fix.
