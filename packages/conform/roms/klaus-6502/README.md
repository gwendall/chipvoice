# Klaus Dormann's 6502 functional and decimal tests, run on `Cpu6510`

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

Two self-contained 6502 programs, run against `chipvoice`'s own `Cpu6510`
(`packages/chipvoice/src/chips/c64/cpu6510.ts`) rather than against a
purpose-built oracle: each one checks itself and leaves a verdict in memory
or a fixed program counter, so there is nothing more to compare against.
Vendored under decision 41 in `docs/DECISIONS.md`, the same as `vice-sid/`:
a GPL test program is fine in this private harness, never in the published
package.

- `6502_functional_test.bin` - every documented opcode, addressing mode and
  flag update on an NMOS 6502, from
  `https://github.com/Klaus2m5/6502_65C02_functional_tests`, commit
  `7954e2dbb49c469ea286070bf46cdd71aeb29e4b` (2020-01-05). GPL-3.0, `LICENSE`
  in this directory. This is the repository's own prebuilt `bin_files` copy,
  unmodified; SHA-256
  `fa12bfc761e6f9057e4cc01a665a7b800ff01ae91f598af1e39a1201d01953fd`. Loaded
  as a flat 64 KiB image (file offset = address, as the assembler's own
  build log states), started at `$0400`, decimal mode enabled (the build's
  default): passes by parking itself in a `jmp *` at `$3469`; any other
  `jmp *` is a failure, at the address the runner reports.
- `6502_decimal_test.bin` - Bruce Clark's ADC/SBC decimal (BCD) mode check
  (public domain, `http://www.6502.org/tutorials/decimal_mode.html`), the
  copy carried in the same Klaus2m5 repository, assembled here with `ca65`
  V2.18 (`cc65` 2.19) from the ca65-syntax port at
  `https://github.com/amb5l/6502_65C02_functional_tests`, commit
  `966b1a35049f9d8be44ad092ec6d43d5ba1831b3`, using that port's own
  `example.cfg` linker script - unlike the functional test, Klaus2m5's
  repository does not ship a prebuilt binary for this one. SHA-256 of the
  binary vendored here:
  `b179ca4c5a305de2d0cde9ccaa04861be965e2a85b9d3d1230dcc47a396ca43f`. Started
  at `$0400`; the runner stops the instant the program counter reaches
  `$044b` (`DONE`, right before the 65C02 `STP` byte the source ends on,
  which is not a NMOS opcode `Cpu6510` implements) and reads `ERROR` at `$0b`
  - `0` is a pass, `1` a fail, all 130,050 additions and subtractions this
  covers checked against a computed prediction rather than a second
  emulator.

Both programs are single, deterministic runs with a known outcome, not a
register-by-register comparison, so they are wired into
`packages/conform/src/roms/klaus6502.mjs` and `pnpm check:6510` rather than
into `run.mjs`'s VICE-SID-style dispatch, and their result is its own
`<!-- cpu6510:begin -->` block on `docs/chips/c64.md`, separate from the
`vice-sid` ROM table (which runs on the harness's own, older, `Cpu6502`, a
different file `Cpu6510` is not derived from).
