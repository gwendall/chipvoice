# Changelog

<p align="center">
  <a href="CHANGELOG.md">English</a> &bull;
  <a href="CHANGELOG_ja.md">日本語</a>
</p>

Notable changes to the `chipvoice` package and the SDK it exposes, newest
first. See [README.md](README.md) for the current quickstart and feature
overview.

## Unreleased

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
stream matches exactly on every exportable file in a corpus of real
hardware recordings, this project's own 2A03 driver output and
independently authored, redistribution-licensed NSFs (including the three
DMC-using files, now that sample memory is carried through); the source
capture's own writes and GME's trace of the export match exactly, frame for
frame, after one constant offset (a deterministic proof, not an audio one);
a same-DSP export-loss gate compares GME's replay of the export against
this project's own untouched render, both through this project's own
renderer, isolating the residual cost of a write landing at its frame's
start rather than its own real cycle; a GME-vs-ours mixer comparison is
reported for visibility but does not gate. See
[docs/chips/2a03.md#nsf-export](docs/chips/2a03.md#nsf-export). The studio
now offers a Download NSF button next to VGM's, for NES songs.

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
