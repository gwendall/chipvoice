# Changelog

<p align="center">
  <a href="CHANGELOG.md">English</a> &bull;
  <a href="CHANGELOG_ja.md">日本語</a>
</p>

Notable changes to the `chipvoice` package and the SDK it exposes, newest
first. See [README.md](README.md) for the current quickstart and feature
overview.

## Unreleased

Progressive preview playback no longer risks an audible stall on a moving
chip or song handoff (switching mid-playback). The handoff's first
post-handoff read, the one `ProgressivePlayback`'s internal read-ahead loop
fires the instant the new group takes over, used to race a fixed 0.75 s
margin that a rare host stall (a GC pause, scheduler jitter right at the
handoff instant) could still outrun; the previous release proved a real
underrun at exactly that threshold. A history-based adaptive margin was
built and tested first and rejected: it can only react to a source's past
read latency, never the one read racing it, and still underran at 900 ms of
injected delay in testing, no better than the fixed constant it would have
replaced. The fix removes the deadline instead of enlarging it: that first
block is fetched and cached before the new group goes live, so the
read-ahead loop's own next step finds it already there. Proven with 0
underruns at up to 5 full seconds of injected delay in testing, where the
previous code underran past 750 ms. This only covers that one read:
consuming the cached block still advances the group's buffered lead before
the next, genuinely uncached read is issued, so every read after it, in
steady state, still races a deadline, now about 1.25 s instead of 0.75 s; a
second, held-out test scenario confirms that later cliff is still there (0
underruns at 1000 ms of injected delay on that second read, 1 underrun at
1500 ms). Switching chip while playing now takes about 17 to 67 ms longer
(median, n=7 per chip, interleaved before/after runs on the same machine to
cancel out unrelated load: 2a03 +17 ms, md +60 ms, snes -7 ms, c64 +67 ms,
dmg +45 ms), in exchange for no longer cutting out when the new chip's
first read is slow. Paid only on a genuine cross-chip or cross-song
handoff, never on first playback or a same-source settings tweak. No
public API changed. Proven by a new deterministic test,
`packages/chipvoice/test/progressive-handoff-stall.mjs`, alongside the
existing progressive-playback and audio-transition test suites, all green.

SNES songs export as `.spc` files: `exportSpc` freezes a song's
register-write capture into a standard SPC700+S-DSP snapshot that plays in
any SPC player, on real hardware too, with no chipvoice runtime involved -
its own tiny SPC700 player is written straight into the file's own ARAM
(`packages/chipvoice/src/chips/snes/spc-player.ts`, hand-assembled from
Anomie's SPC700 doc and fullsnes, MIT, built from committed source, no
opaque blob), alongside a compacted sample directory holding only the BRR
samples a KON write in the song ever actually plays, and the S-DSP write
stream as tick-delta/register/value (with same-tick bursts and an LZ77-style
back-reference pass over repeated write groups, so a dense song's own
repetition compacts instead of being stored verbatim), timed against Timer
0's own 1000 Hz tick, with the song's loop point so playback repeats forever
the way a game's own track does. A song too big for the SNES's 64 KB of
sound RAM throws `SpcExportSizeError`, carrying `measured` and `limit`,
rather than writing a truncated file - one of the repo's three published
SNES arrangements currently hits this. Proven two ways per song
(`check:spc-export`, numbers on
`docs/chips/snes.md`): round-tripped through this package's own SPC700
(`importSpc(exportSpc(...))`) against a direct render of the original plan,
and played back through `play-spc`, the same real SPC700 oracle `check:spc`
uses - both compare the DSP write sequence exactly and the audio by
per-voice RMS-envelope correlation in short windows, gated at 0.95.
Reachable from the studio as a Download SPC button next to Download VGM for
SNES songs, and from the SDK as `exportSpc`, alongside `recordSong`/`toVgm`.
The flash-cart recording of an exported file on real hardware is out of
scope for now (no hardware yet).

`importGbs(bytes, options)` plays a `.gbs` (Game Boy Sound) file on `dmg`,
returning a `PerformancePlan` for `renderPerformance` the same way `importVgm`
does for the Mega Drive. It runs the file's own INIT and PLAY routines on an
own SM83 (LR35102) CPU - written from Pan Docs, gbdev's opcode tables and the
GBS format spec, never ported from a GPL/LGPL emulator (decision 41) - so the
chip sees the source program's own register writes. `parseGbsHeader(bytes)`
reads a file's header without running it. Unsupported inputs are rejected by
name: an unrecognized header version, a load address outside `$400-$7FFF`,
the undocumented CGB double-speed timer bit, reserved timer-control bits, a
bank-select write past the file's own bank count, a serial transfer-start
write, and an INIT/PLAY call that overruns its frame budget. See
[docs/chips/dmg.md](docs/chips/dmg.md#gbs-playback) for the environment, the
reject list, and how it is measured (not asserted) against Game_Music_Emu's
`Gbs_Emu` on a corpus of real GBS files built from three independent drivers
(hUGEDriver, GBT Player, and Laxity's own driver bundled with gbsplay -
[`scores/gbs-corpus`](scores/gbs-corpus/README.md)). The same SM83 also
passes blargg's `cpu_instrs` and `instr_timing` test ROMs (`packages/conform`,
`roms:cpu-instrs`), which check its behaviour and its timing against real
Game Boy hardware, independently of any reference emulator. Package-only for
now; there is no chipvoice.dev counterpart.

A NES song can now be exported as a standard NSF v1 file: `exportNsf(events,
cycles, options)`, next to `toVgm`. The file carries its own tiny 6502
player, hand-assembled in `packages/chipvoice/src/nsf.ts` from a small
in-file mnemonic assembler rather than a build tool, so the bytes it emits
are exactly what that source says. PLAY replays one 60 Hz frame's writes at
a time from a compact, bank-switched write log, looping at the capture's own
loop point forever; write timing is quantized to the frame (up to ~16.7 ms
late). DMC/DPCM sample playback is autonomous hardware DMA, so it needs no
mid-frame code at all - only the sample bytes physically present in a fixed
upper bank (`$C000-$FFFF`) for the real DMA read to find; a capture that
carries its sample memory (`options.memory`, the same shape as
`PerformancePlan.memory`) exports normally. A capture that enables DMC
without supplying that memory is rejected by name
(`NsfExportError('dmc_sample_missing', ...)`), and the one case this player
genuinely cannot carry - raw `$4011` PCM streamed straight through the DAC
many times within a single frame, not DMA sample playback - is rejected as
`NsfExportError('dmc_unsupported', ...)`, as is sample memory outside
`$C000-$FFFF`, a loop point outside the capture, over-length or non-ASCII
metadata, and a frame with more writes than the encoding can address -
rather than silently dropped or approximated. Proven four ways against the
same pinned Game_Music_Emu oracle `nsf-corpus` uses: the exported command
stream matches exactly (`matched === total`, gating CI) on every exportable
file in a corpus of real hardware recordings, this project's own 2A03
driver output and independently authored, redistribution-licensed NSFs
(including the three DMC-using files, now that sample memory is carried
through); the source capture's own writes and GME's trace of the export
match exactly, frame for frame, after one constant offset (a deterministic
proof, also gating CI exactly, not an audio one) - a source frame stops
counting once its own real-time slot passes the point where the exported
player wraps back to its loop frame, so a capture's own last frame landing
on its loop point is excluded rather than compared against the wrong lap;
a cheap negative check corrupts one write and confirms the gate reports it
as a mismatch, so the gate's bite is tested, not just its pass case; a
same-DSP export-loss gate compares GME's replay of the export against this
project's own untouched render, both through this project's own renderer,
isolating the residual cost of a write landing at its frame's start rather
than its own real cycle (a coarse secondary gate, on top of the two exact
ones); a GME-vs-ours mixer comparison is reported for visibility but does
not gate. See [docs/chips/2a03.md#nsf-export](docs/chips/2a03.md#nsf-export).
The studio now offers a Download NSF button next to VGM's, for NES songs.

The SID has a second model: `model: "8580"` on `Chip.create`, on
`renderPerformance`/`renderProject`'s options, and on a project's
`settings.model`, next to the default `"6581"`. Every 8580 fact comes from a
document or a measurement against the oracle's own tables, never from porting
its GPL source (decision 41): the combined waveforms are fitted independently
against reSID-fp's own 8580 tables, landing short of the 6581's exact match
since reSID-fp's own 8580 code uses a more detailed transistor model than
this package's shared one; the floating-waveform output and the noise
register's test-bit reset decay over a longer capacitor discharge; OSC3
(`$D41B`) reads the sawtooth/triangle pipeline a cycle later than the
waveform output; the DACs are near-linear instead of kinked; and the filter
reads reSID's `filter.cc` 8580 R5 cutoff line and Q table directly, rather
than the 6581's measured curve. A second oracle block, reSID-fp configured as
an 8580, checks the digital side (`corpus/c64/parity-residfp-8580.json`,
`check:residfp-8580`, in CI): 99.28 % identical, the two divergences both
explained by the combined-waveform fit's own shortfall. See
[docs/chips/c64.md#the-8580](docs/chips/c64.md#the-8580). The 6581 default is
unchanged.

The Mega Drive's `perc: "punchy"` intent plays a kick, a snare and hats as FM
patches on channel 6 instead of the PSG noise kit, which stays the default
percussion. The YM2612's LFO now sounds wherever a patch asks for it -
`ams`/`pms` in register `$B4`, an operator's own `am` in `$60`, the LFO's own
enable and frequency in `$22` - in both the portable arranger (`"bright"`'s
vibrato, the FM kit's hats) and the native driver (`FmPatch.lfoFrequency`,
`MD_PATCHES.shimmer`); previously the registers were written but power-on's
`$22` = 0 left them inert. The native driver also reaches channel 3's special
mode through a note's new `ch3` field (`fm3` only), register `$27` and
`$A8`-`$AE`. See [docs/chips/md.md](docs/chips/md.md#driver-coverage) for why
the noise kit stays the arranger's default and channel 3's special mode stays
out of it. Fixed alongside: `MdDriver.noteOff()` sent a spurious PSG silence
write and never keyed channel 6 off after an FM drum hit; and an FM instrument
on a percussion part (`planPerformance`) could land on fm6 directly instead of
through the noise voice's own redirect, letting it collide with a melodic fm6
note on the same hardware channel. FM percussion now always plays through the
noise voice, and fm6 is unavailable to melodic allocation while the noise
voice is sounding one of its FM patches; `prepareMixPhrase` rejects the same
overlap explicitly, and losing fm6 to the drum kit is reported like any other
substitution, not silent.

`importVgm` now reads NES and Game Boy VGM files, not only Mega Drive ones.
It tells the three apart from the header's clock fields and returns the same
`PerformancePlan`, so `renderPerformance`/`isolateNativePerformance` work
unchanged: register writes (command `0xB4`) and DPCM sample data (data-block
type `0xC2`, "NES APU RAM write") for the NES 2A03; register writes (command
`0xB3`) for the Game Boy DMG, soloed by masking NR51 (`$FF25`) rather than
`$4015`. A PAL or otherwise non-NTSC clock (accepted within 0.01% of the
NES's own 1789773 Hz, admitting the 1789772 most real rips write too), the
Famicom Disk System bit, a second ("dual-chip") chip, another chip's clock in
the same header, and VGM versions outside 1.50-1.71 are rejected, by name.
See [docs/chips/2a03.md](docs/chips/2a03.md#vgm-import) and
[docs/chips/dmg.md](docs/chips/dmg.md#vgm-import).

A Game Boy pulse note's trigger (ch1, ch2) keeps the low two bits of its
frequency timer instead of zeroing them, as Pan Docs' "Obscure Behavior"
describes ("When triggering Ch1 and Ch2, the low two bits of the frequency
timer are NOT modified"). A triggered note's first duty step, and every edge
after it, now lands up to 3 cycles later than before. See
[docs/chips/dmg.md](docs/chips/dmg.md#known-deviations) for what of the
remaining gap against the SameBoy oracle stays open.

`validateSong` now diagnoses what a chip cannot do with a well-formed song,
instead of the driver clamping or cutting it in silence. A vibrato that
swings a voice out of its register range or below one register step at that
pitch (`vibrato_range`, `vibrato_resolution`), a vibrato rate the driver's
60Hz frame clock cannot resolve (`vibrato_rate`), a slide that carries a held
note out of range or across a coarse run of a period table - the low end of
the 2A03 and Game Boy tables in particular (`slide_range`,
`slide_resolution`) - and a fractional volume step a chip rounds before it
reaches a register (`volume_step`) are all now reported. So are voice-budget
conflicts: a role sharing a physical voice with another, such as the SID's
chord and percussion both on v3 (`voice_share`), and a drum arriving before
the previous one's own decay has finished on a chip with one shared voice per
kit part, such as the 2A03's single noise channel (`perc_voice`). Every issue
carries `measured` and `limit` alongside its message, including the existing
`pitch_range` and `chord_capacity`. `Issue` gains `voice`, `measured` and
`limit` as optional fields; nothing existing changes shape. No render
changes: these are diagnostics, not fixes.

The SID's filter is now reachable from the arranger's own words, not a
simulated substitute. A lead's `sweep` opens the cutoff across the note; a
bass's `resonant` holds a fixed high resonance; both are low-pass. A voice
sets and clears only its own routing bit in `$D417`; the shared resonance,
cutoff and mode are whichever voice's write actually lands later in time,
the same arbitration real hardware has, since the SID has one filter for
all three voices. `SidDriver` dedups a filtered voice's writes against that
voice's own last frame only, never against another voice's: a note is
dispatched whole, and notes are dispatched in the order they start rather
than the order their writes land in time, so comparing against a shared,
cross-voice last-written value could skip a write that was actually needed.
`validateSong` gains `filter_conflict`, naming the first step where two
tracks that ask for the filter with different settings both sound at once,
so the one that loses is named rather than just heard. A new
`Instrument.pulseWidth` field gives a per-frame pulse-width sweep at the
driver level; no built-in preset uses it yet. `script-filter` and
`song-filter` join the C64 conformance corpus; parity against reSID-fp holds
at 100%, since the filter is an analog-stage model that never touches the
digital trace the harness compares.

The SNES kit's closed and open hats now default to the S-DSP's own hardware
noise generator (`NON`, and `FLG`'s noise clock set once at power-on) instead
of a BRR sample, the way the NES, Game Boy, Mega Drive and C64 kits already
use their own noise for hats. The kick and the snare stay BRR samples.
`Instrument.noiseMode: false` on a hat opts back into the BRR burst. Every
role's real triads across voices were already shipped; this closes the
ticket's other half. No sound change on any other chip.

`importSpc(spcBytes, options)` plays an `.spc` file - a frozen SPC700 + S-DSP
snapshot, the Super Nintendo's own music format - through a new SPC700 core
written from fullsnes, Anomie's SPC700/S-DSP documents and the SNES developer
wiki, restoring the CPU, the 64 KB of ARAM and every DSP register exactly,
and returns the same `PerformancePlan` shape `importVgm` does. Length comes
from `options.seconds` or the file's ID666 tag; a file with neither throws.
The tag's title, game, artist and length are returned on `id666` when
present. A truncated or misidentified file throws explicitly. Measured
against a real reference SPC700 (`packages/conform`'s new `check:spc`): the
DSP register writes the CPU makes and the output samples both matched on
the first file checked.

PSID/RSID files play through two new exports, `importPsid` and `renderPsid`,
on a from-scratch 6510 (`Cpu6510`) run against a minimal, disclosed C64
environment (CIA1 timer A, the VIC raster IRQ, SID register mirroring) built
entirely from HVSC's own file format document, with no ported GPL code
(decision 41). Every documented 6502/6510 opcode is implemented, along with
the stable illegal opcodes; the 7 unstable and 12 JAM opcodes are named and
rejected (`IllegalOpcodeError`, kind `"unstable"` or `"jam"`) rather than
guessed at, since no document gives their CPU-internal-state-dependent
results. PAL/NTSC clock and 6581/8580 model header flags are honored;
multi-SID files, RSID files that also need BASIC, and the MUS player format
are rejected by name rather than silently misplayed.

Conformance now rests on three legs, none of them shipped or ported GPL code
(decision 41): a hand-written unit suite (every documented opcode's cycle
count and flags, decimal-mode ADC/SBC against 6502.org's own worked
examples, and every stable illegal and named-rejected opcode); Klaus
Dormann's 6502 functional test and Bruce Clark's decimal test, vendored as
non-shipping conformance tools (`packages/conform`, `check:6510`, in CI) and
run against this same `Cpu6510`; and a new independent oracle, libsidplayfp,
cloned and built at a pinned revision into gitignored local artifacts
(`scores/psid-corpus`) and never vendored into `packages/chipvoice`. That
oracle settled INIT's own calling convention by measurement instead of
inference: `A` (the zero-based song number) and `P` (0x24 before the PHP)
match libsidplayfp's own reference driver exactly; `X` and `Y` do not, and
are now confirmed genuinely undefined by both the file format document's
silence and libsidplayfp's own driver's own leftover values, not merely
unconfirmed. The same oracle also found a real conformance gap, now fixed:
`Cpu6510`'s read-modify-write instructions were missing the dummy write real
NMOS 6502 hardware always makes before the modified one, which some real
PSID/RSID tunes deliberately exploit for a fake SID gate retrigger. See
[docs/chips/c64.md#psidrsid-playback](docs/chips/c64.md#psidrsid-playback)
for the oracle's own numbers and the remaining known limits (`X`/`Y`
confirmed undefined rather than merely unconfirmed, a small measured
per-frame cycle wobble against the real per-line VIC-II, and no
self-produced hardware capture corpus).

A DMG song can now be exported as a standard GBS v1 file: `exportGbs(events,
cycles, options)`, next to `exportNsf`. The file carries its own tiny SM83
player, hand-assembled in `packages/chipvoice/src/gbs.ts` from a small
in-file mnemonic assembler rather than a build tool, so the bytes it emits
are exactly what that source says. PLAY replays one VBlank frame's writes at
a time (70224 T-cycles, ~59.73 Hz) from a compact, bank-switched write log
(`$2000-$3FFF` selects the data bank, MBC1/MBC5-style), looping at the
capture's own loop point forever; write timing is quantized to the frame (up
to ~16.7 ms late). Unlike the 2A03's DMC channel, the DMG has no autonomous
sample DMA - the wave channel (CH3) is entirely register-driven through
`$FF30-$FF3F` like every other register - so there is no separate
sample-memory case to handle and `GbsOptions` carries no `memory` field. A
loop point outside the capture, over-length or non-ASCII metadata, and a
frame with more writes than the encoding can address (254) are rejected by
name (`GbsExportError`, with a `code` and, where it applies,
`measured`/`limit`) rather than silently dropped or truncated. Proven four
ways against the same pinned Game_Music_Emu oracle `gbs-corpus` uses: the
exported command stream matches this project's own offline SM83 replay of
the same export on value and order (`valueMatched === total`, gating CI) on
every file in a corpus of this project's own DMG renditions and
independently authored, redistribution-licensed GBS files - not cycle-exact,
since `gbs-corpus`'s own `compare.mjs` already found GME's SM83 core charges
a flat 4 T-cycles per instruction regardless of its real length, a known
timing-model divergence, not an export defect; the source capture's own
writes and GME's trace of the export match exactly, frame for frame, after
one constant offset (also gating CI exactly, not an audio proof) - a source
frame stops counting once its own real-time slot passes the point where the
exported player wraps back to its loop frame, so a capture's own last frame
landing on its loop point is excluded rather than compared against the wrong
lap; a cheap negative check corrupts one write and confirms the gate reports
it as a mismatch; a same-DSP export-loss gate compares GME's replay of the
export against this project's own untouched render, both through this
project's own renderer (3.0-26.2% on this corpus, well under the 30%
threshold); a GME-vs-ours mixer comparison is reported for visibility but
does not gate. No native GB hardware recordings exist in this repo, stated
rather than silently omitted. See
[docs/chips/dmg.md#gbs-export](docs/chips/dmg.md#gbs-export). The studio now
offers a Download GBS button next to VGM's, for Game Boy songs.

NES cartridges that add Konami's VRC6 expansion audio - two pulses with a
16-step duty table and a 7-bit sawtooth, each at its own 12-bit period, one
bit wider than the 2A03's own 11-bit pulses - are now modeled, written from
the nesdev wiki and Konami's own VRC6 documents, never from a ported
GPL/LGPL emulator (decision 41): NEXT-14's first expansion-audio chip
(decision 38). The combined chip is registered as `"2a03-vrc6"`
(`NES_VRC6`), reachable through `chips()`, `getChip("2a03-vrc6")`,
`chipFor("2a03-vrc6")` and `Chip.create({ chip: "2a03-vrc6" })`, but
deliberately absent from the studio's `CHIP_IDS` - a sheet before a chip,
decision 38 - so no project, picker or arranger word can select it yet.
Measured against two independent oracles: Game_Music_Emu's `Nes_Vrc6_Apu`
(LGPL, stays in `packages/conform`'s harness only) and, added in a second
round, Mesen 2's own vendored VRC6 audio. The corpus is split so every
script that avoids both oracles' own known gaps (no disable after the first
enable, no period at or below 4, no `$9003` writes) gates at a literal
100 % against both, and every script that hits one of those gaps gates
exactly against Mesen 2 (which models all three) while Game_Music_Emu
reports the same script without gating CI. The original eight-script
corpus, which drives every voice through several enable/disable cycles at
once, stays on its own no-regression baseline: 38.1 % against
Game_Music_Emu and 23.6 % against Mesen 2, floored by the oracle-specific
gaps documented on the sheet; the per-run, shift-tolerant fraction the
board reads is 79.0 % of 105 runs. The documented pulse-polarity inversion
("roughly equivalent to the pulse channels of the 2A03, except inverted")
is now modeled, not just cited: the mixer subtracts the VRC6 term instead
of adding it. A negative test per exact gate proves each would actually
catch a regression. `exportNsf`/`capture-nsf.mjs` now route a capture's
VRC6 register writes the same way as the 2A03's, through a new indirect,
table-driven dispatch (any write, 2A03 or VRC6 alike, now resolves through
an in-ROM register table rather than a fixed `$4000` offset, since VRC6's
three separate register pages cannot fit a two-page store), and set the
NSF header's expansion-audio bit; a mixed 2A03/VRC6 round-trip is proven
end to end, and a self-authored VRC6 NSF probe (CC0) now proves the same
export/playback path exactly through Game_Music_Emu's own `Nsf_Emu`
player, in `scores/nsf-corpus` and `scores/nsf-export` alongside every
other real-world 2A03 file. See [docs/chips/vrc6.md](docs/chips/vrc6.md)
for the full sheet, both oracles' known limits, and what remains (a
driver/arranger role, a real test ROM - none exists to automate).

## 0.19.1: Console changes without a dropout

A cold console change in the middle of a song no longer underruns. When the
new source's first block of progressive playback comes back nearly spent, it
is extended with warm contiguous reads until it starts at least 0.75 s ahead
of the playhead. While another source prepares, the one still playing
schedules 3 s ahead instead of 1.5 s, because the cold render competes with it
for the CPU.

`BufferPlayback` is now TypeScript, like `ProgressivePlayback` next to it: its
published declarations type its entries, clock, groups and parts instead of
leaving them `any`. No sound change: every published arrangement renders byte
for byte as with 0.19.0, and the existing APIs are unchanged.

## 0.19.0: A game's own Mega Drive driver

A second Mega Drive driver beside `MdDriver`, for music written for this
machine alone rather than arranged across consoles. The
[native driver guide](docs/MD-NATIVE-DRIVER.md) documents it.

- `compileMdVoices(voices)` drives `fm1` to `fm6` with hard pan and a patch
  per note, `psg1` to `psg3`, the noise channel and a PCM stream on the DAC,
  and refuses what the hardware cannot do.
- `arrangeMdTracker(song, {tailBars, bank})` compiles a text tracker: notes,
  rests, holds, slides, articulations, patches, volumes, drums, echo channels
  and loop points.
- `MD_BANK` ships FM patches, PSG and noise instruments and a synthesized PCM
  drum kit.
- Game-audio helpers render, trim, level and pack sound effects:
  `renderMdEvents`, `trimRender`, `levelRender`, `scaleRender`, `packSprite`
  and `renderOnset`.
- `FmOperator.ssg` sets SSG-EG on either driver; leaving it out keeps the
  previous sound.

## 0.18.0: Progressive interactive playback

The web composer uses `new ProjectPlayer({preview: true})`. This opt-in SDK
mode compiles the same project and renders the same chip cores as offline
export, but schedules bounded PCM blocks as they become available. It does
not encode/decode a complete WAV before playing. `previewMetadata` exposes
duration, native status and mix results; `losses` works in both playback
modes. `prepared` remains `null` in preview mode. Use `prepareProject()` or
`renderProject()` explicitly when you need a downloadable file.

```js
import {ProjectPlayer} from 'chipvoice';

const player = new ProjectPlayer({preview: true});
// Call play from a user gesture to unlock browser audio.
void player.play();
await player.load(project);
await player.update({tempoScale: 1.25});
player.setTitle('New title'); // Metadata only; no audio preparation.
```

The player keeps the current sound during preparation, preserves Play/Pause
intent and follows the audio output clock. A warm worker and bounded
variant/PCM/checkpoint caches accelerate repeated edits and seeks. Cold
mid-song changes still need to reconstruct DSP history: an emulator's
envelopes, samples, filters and echo cannot be restored from note positions
alone. Browser audio unlock, uncached network assets and device latency
remain real costs. Default `ProjectPlayer()` keeps the existing whole-buffer
behavior for compatibility.
