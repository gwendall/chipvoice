# Hardware evidence

<p align="center">
  <a href="HARDWARE-EVIDENCE.md">English</a> &bull;
  <a href="HARDWARE-EVIDENCE_ja.md">日本語</a>
</p>


Decision 38 orders how the analog stage gets its evidence: independent emulator
oracles and published recordings of real units first, free; then one purchased
NES to validate a capture bench; then, and only then, another machine. This
document is the first half of that order for all five chips - NES, Game Boy,
Mega Drive, SNES, C64 - carried out before any hardware is bought (ticket
NEXT-04). [CONFORMANCE.md](CONFORMANCE.md#the-analog-stage-protocol) is the
method a captured unit would follow; this is what already exists without one.

## Method

Every source below was opened - fetched or read on the page it lives at - before
it is listed here. A source that could not be opened, that 404s, or that turned
out to be forum speculation with no data behind it, is not listed; the "sources
rejected" notes under each chip name what was checked and set aside, so the
absence of a chip's hardest question from the table is not silence. Nothing
here is redistributed into this repository: `packages/conform/src/evidence/fetch.mjs`
downloads what a licence allows into a gitignored `.artifacts/hardware-evidence/`,
verified against the SHA-256 recorded in `packages/conform/src/evidence/manifest.json`
next to it - see [fetching the evidence](#fetching-the-evidence).

For each source: the URL, the author, the exact unit and revision recorded and
its capture chain, the exact input that produced it and whether chipvoice has
it or could reproduce it, the format and sample rate, the licence, and the
precise question it can and cannot settle for chipvoice's analog stage.

## NES (2A03)

Chipvoice already uses the strongest published NES recordings that exist:
blargg's four `apu_mixer` recordings of his own console, vendored at
`packages/conform/roms/apu_mixer_recordings/` and measured against on every
`pnpm --filter chipvoice-conform mixer` run (`docs/chips/2a03.md`'s mixer
block). What is still unmeasured is the output filter, across the four
revisions (front-loader NES-001, top-loader NES-101, Famicom, AV Famicom).

| Source | Author, unit, capture chain | Exact input; do we have it | Format, sample rate | Licence | Settles / cannot settle |
| --- | --- | --- | --- | --- | --- |
| [NESdev wiki, "APU Mixer"](https://www.nesdev.org/wiki/APU_Mixer) | The NESdev wiki (community-maintained), citing blargg's capture and lidnariq's component analysis; no unit or revision named | A reference page, not a recording or a dataset | Prose and the nonlinear mixing formula chipvoice already implements | Wiki text, freely quotable with attribution | Settles that the `nesdev` filter profile chipvoice already ships (a 90 Hz and a 440 Hz first-order high-pass, a 14 kHz first-order low-pass) is the community's own citation, not a number we invented. Cannot settle which physical unit it came from, or how it varies by revision: the wiki states one nominal set, not a family of measurements |
| [NESdev forums, "what is the cut off freq of the nes?" (2009)](https://forums.nesdev.org/viewtopic.php?t=4946) | blargg, probing his own NES's 2A03 output pin directly against the console's RCA line-out, into a PC sound card at 44.1 kHz; the exact revision is not stated in the thread | An impulse/step response of the analog stage itself, not a register-write test; not something our harness could reproduce even if the file existed, since it needs a physical probe on the die's output pins | WAV, 44.1 kHz (`nes_raw_rca.wav`) plus two PNG plots, originally hosted at `ripway.com`, a defunct free host | None stated | The thread is where the wiki's numbers actually come from: lidnariq's reply in it derives the 90 Hz/442 Hz high-pass and 14 kHz low-pass from blargg's capture and the console's own RC component values (150 ohm/10 uF, 47k/0.011 uF, 47k/220 pF). It settles the provenance of the numbers already on the sheet. It cannot supply new data: the WAV and both PNGs are 404 today (`ripway.com` no longer resolves), so there is nothing left to fetch, refit, or measure a band error against |

**Sources checked and rejected.** [NESdev forums, "Did an original, unmodded Famicom sound like this?" (2015)](https://forums.nesdev.org/viewtopic.php?t=13419): real-game samples from an unspecified Famicom, posted to FileDropper links that are now dead, and the thread's own participants (rainwarrior, lidnariq) note that a camcorder-and-RF-demodulator capture chain cannot be attributed to the chip alone even were the files still live. [NESdev forums, on the Twin Famicom's low-pass (t17487)](https://forums.nesdev.org/viewtopic.php?t=17487): explicitly speculative in the thread itself, no measurement was ever taken.

**What this settles and what it cannot.** The mixer, the part of the analog stage that matters most for the identity of the sound, is already measured against blargg's real recordings and needs nothing further from this search. The filter corners chipvoice assumes trace back to a real capture blargg made and lidnariq's analysis of it, which is better provenance than "a wiki said so" - but that capture's files are gone, no revision was ever named, and nothing published gives a second data point for the top-loader, the Famicom, or the AV Famicom specifically. P2-3 still needs a unit's line-out under the published `apu_mixer`-style script (or a fresh one) to move past "the mixer is measured, the filters are not."

## Game Boy (DMG)

Chipvoice's DMG analog stage (`docs/chips/dmg.md`) is a placeholder: a linear
per-channel DAC summed under NR50/NR51 and one 28 Hz high-pass, unmeasured
against any unit (P3-5).

| Source | Author, unit, capture chain | Exact input; do we have it | Format, sample rate | Licence | Settles / cannot settle |
| --- | --- | --- | --- | --- | --- |
| [gbdev Pan Docs, "Audio details"](https://gbdev.io/pandocs/Audio_details.html) | The gbdev project; no physical unit named. Documents the DC-blocking high-pass as a software model: `capacitor = in - out * 0.999958` (DMG) or `0.998943` (CGB), at the 4,194,304 Hz master clock | A formula, not a recording; reproducible directly, no ROM needed | Not applicable - an algorithm, not audio | CC0-1.0 (public domain), stated in the `gbdev/pandocs` repository | Settles that this is the model our own 28 Hz placeholder already agrees with, and that DMG and CGB are documented as different constants. Cannot settle that either constant was itself measured from a specific real unit: the page cites no hardware provenance for either number, only the convention several emulators share |
| [Ken Shirriff, "Reverse-engineering and comparing the Game Boy and Game Boy Color's audio circuits" (2020)](http://www.righto.com/2020/06/reverse-engineering-and-comparing-two.html) | Ken Shirriff, from die photos (John McMaster, siliconpr0n.org) and oscilloscope waveforms of the two amplifier chips (Sharp IR3R40 for the DMG, an op-amp-based one for the CGB) | An unspecified game's normal audio, on an oscilloscope; not a numeric dataset and not reproducible from a stated input | Waveform images embedded in the post; no raw samples or sample rate given | No licence stated (ordinary blog copyright); the facts can be cited, the images cannot be redistributed | Settles, qualitatively, that the DMG's output is a 100 uF DC-blocked signal into a fixed-gain amplifier (bassy, near-square), and that the CGB's op-amp high-pass is a different, thinner topology - evidence that a DMG profile should not stand in for a CGB one. Cannot settle any corner frequency or gain in dB; there is no curve or downloadable capture to compare against |

**Sources rejected.** A `chipmusic.org` thread analysing LSDJ white noise by ear/spectrum on a hand-modified DMG ("enhanced prosound" mod, which changes the analog output stage itself) with no numbers quoted and its referenced blog not confirmed reachable; a second `chipmusic.org` thread that is speculation with no data; `blargg`'s `Gb_Snd_Emu` and `SameBoy`'s repositories, which document no hardware measurement behind their output stages; an unofficial Verilog reimplementation with no captures.

**What this settles and what it cannot.** Pan Docs gives a citable, public-domain formula for the high-pass that matches the corner chipvoice already assumes, and Shirriff's teardown corroborates the DMG's amplifier topology against the CGB's - useful as corroboration, and as the reason a CGB profile should be a second profile rather than a assumed match for the DMG's. Neither is a measured recording: nothing found ties either the 0.999958 constant or a corner frequency in Hz to a specific real DMG-01 under a stated capture chain, and no DMG-equivalent of blargg's `apu_mixer` - a documented ROM or register log paired with a committed real-hardware recording - exists anywhere searched (gbdev, chipmusic.org, SameBoy, blargg's own repositories). P3-5 still needs a unit's line-out under a known script; what would make a published source usable instead is a stock, unmodified DMG-01's raw or lossless recording of a stated test ROM or register log, with its capture chain, sample rate and a redistribution licence (or a source we only need to fetch, not vendor).

## Mega Drive (YM2612, YM3438, SN76489)

Chipvoice ports Nuked-OPN2 line for line for the YM2612 (decision 17); the
Mega Drive sheet (`docs/chips/md.md`) still has a placeholder Model 1 filter,
no Model 2 profile, and a chosen-not-measured PSG mixing ratio.

| Source | Author, unit, capture chain | Exact input; do we have it | Format, sample rate | Licence | Settles / cannot settle |
| --- | --- | --- | --- | --- | --- |
| [MDFourier](https://junkerhq.net/MDFourier/) ([GitHub](https://github.com/ArtemioUrbina/MDFourier)) | Artemio Urbina. Line-out recordings of named real units, including a Sega Genesis Model 1 VA3 and a Model 2 VA1.8 (per [16bap.theclassicgamer.net's reference search](https://16bap.theclassicgamer.net/mdfourier-search-reference/), 2020), captured through a console-run test-signal ROM into a PC audio interface | A tone/sweep/noise test signal from an open-source ROM (part of the 240p Test Suite family); its exact register-write sequence was not found in the main repository during this search, so we do not yet have it and could not confirm we could rebuild it | A reference recordings archive is reachable at `junkerhq.net/MDFourier/files/MDFourier-Genesis-SegaCD-Recordings-14062020.zip` (over 10 MB, not opened); MDFourier's stated capture format is PCM WAV, 48000 Hz, 16-bit | Not stated on the pages read | Settles that per-model, per-revision real recordings exist and that a documented capture method (an open-source test-signal ROM) produced them - the strongest lead here for a future filter measurement. Cannot settle anything yet: without the ROM's register sequence, chipvoice cannot render the same input to compare against, and the archive itself was not opened |
| [Kabuto (TiTAN), "Sega Mega Drive notes" v1.5, 2018](https://plutiedev.com/mirror/kabuto-hardware-notes) | Kabuto, of the TiTAN demogroup, during Overdrive 2's development. Own hardware, model unspecified beyond "MD1"/"MD2"; a phase-correlation analysis tool playing white noise, frequency response plotted 0 to 26391 Hz | White noise through an unnamed analysis tool; qualitative charts only, no raw data or recording published | Charts embedded in a document; nothing downloadable | Not stated; a public development-notes document | Settles, qualitatively, that a Model 1 is first-order and comparatively linear while a Model 2 is second-order with "severe nonlinearities" in its amplifier and a higher noise floor - agreeing with the sheet's placeholder direction and confirming a Model 2 needs its own profile, not a copy of Model 1's. Cannot settle any corner frequency, Q, or numeric curve: no numbers are quotable, only charts that are not fittable data |
| [Nuked-OPN2's `ym3438.c`](https://raw.githubusercontent.com/nukeykt/Nuked-OPN2/master/ym3438.c) | Nukeykt, the ported core's own author; a source comment | Not applicable | Not applicable | GPL/LGPL (already vendored, decision 17) | Settles that the DAC/ladder model chipvoice inherits through the port is labelled `"YM2612 DAC emulation(not verified)"` by its own author in `OPN2_ChOutput` - the gap the sheet already names, confirmed in the upstream author's own words rather than inferred. Cannot settle anything about correctness; it is a disclaimer |
| [FirebrandX, Genesis audio projects](http://www.firebrandx.com/genesisaudioprojects.html) | A hardware modder's own Model 1 VA2/VA3 and VA5-VA6.8 units, stock versus modded | Game and music playback and mod comparisons, not a controlled register sequence; exact input undocumented | Unknown format, hosted on Google Drive folders | Not stated | Settles, informally, that PSG output was raised via a smaller mixing resistor in mod projects and that later boards changed the line-amp stage - directional community knowledge. Cannot settle anything quantitatively: no controlled input and no stated licence |

**Sources checked and rejected.** `consolemods.org`'s Genesis audio-chip and Model 2 audio-circuit-mod pages: blocked (403) on every attempt. `jsgroth.dev`'s YM2612 emulation write-up: blocked by an anti-bot page. The SpritesMind "YM2612 output buffer" thread and an SMS Power VGM-versus-hardware thread: both opened, both are theoretical discussion with no measurements. `joelkp.frama.io`: connection refused. A community figure of "the PSG is roughly 27 dB louder than the YM2612 before mixing" is not listed as a source: it came back only as a web-search synthesis, not from a page actually opened, so it is flagged here as unverified rather than cited.

**What this settles and what it cannot.** MDFourier is real, uses named physical units across both models, and was captured through a documented open-source test ROM - the shape of what P5-9 needs. It does not settle anything numerically yet: this search did not locate the test signal's exact register sequence, and even with it, replaying it needs a 68000 (and likely a Z80) fixture chipvoice's harness does not have, unlike the NES's 6502 or the Game Boy's SM83. Kabuto's notes and Nuked's own disclaimer corroborate the sheet's placeholders qualitatively but give no fittable numbers. No Mega Drive equivalent of blargg's `apu_mixer` - a known register log paired with a committed real-hardware recording - was found anywhere searched. P5-9 still needs either the MDFourier ROM's register sequence (which would make its recordings usable without a 68000 fixture, if the sequence can be replayed as a plain register log) or a purchased unit.

## SNES (S-DSP)

Chipvoice ports snes_spc's SPC_DSP line for line, so the S-DSP's digital
stereo stream is already identical to that reference on every corpus log
(decision 17). What is unmeasured (`docs/chips/snes.md`) is everything after
it: a placeholder 14 kHz low-pass and 20 Hz high-pass, and the DAC.

| Source | Author, unit, capture chain | Exact input; do we have it | Format, sample rate | Licence | Settles / cannot settle |
| --- | --- | --- | --- | --- | --- |
| [SnesLab wiki, "S-DSP/Gaussian Filter"](https://sneslab.net/wiki/S-DSP/Gaussian_Filter) | The SnesLab wiki (community, citing fullsnes); no unit or capture chain named | The 512-entry coefficient table itself, which chipvoice already has: it is what snes_spc/SPC_DSP hardcodes and our port carries line for line | A table of int16 coefficients, no audio | Wiki text, no explicit licence stated | Confirms the interpolation table's values match what is already in chipvoice. Cannot settle how the table was originally derived - measured from silicon behaviour or reverse-engineered from software observation is not stated |
| [NESdev forums, on the SNES's "muffled" sound (t12025)](https://forums.nesdev.org/viewtopic.php?t=12025) | Forum discussion (tepples, TmEE, lidnariq, Sik); no capture, no unit | Discussion only | Not applicable | Forum post, no licence stated | TmEE's own assessment: "the filters present on the analog side have very low effect on the sound," placing most of the SNES's character in the digital Gaussian interpolation chipvoice already reproduces exactly. Cannot give a number for the analog output stage itself |
| [NESdev forums, SPC output filter simulation (t24985)](https://forums.nesdev.org/viewtopic.php?t=24985) | TmEE, an LTspice simulation of a schematic, not a captured recording of a real unit | A simulation input, not something we could fetch or reproduce as hardware evidence | Not applicable | Forum post, no licence stated | Gives an approximate -3 dB corner "around 12 kHz" for the output filter. This is a plausibility check on the sheet's placeholder corner, not a measurement: a simulated schematic is not a captured real unit |
| [NESdev forums, a logic-analyser capture of a real SNES's S-DSP clock lines (t10518)](https://forums.nesdev.org/viewtopic.php?t=10518) | jwdonal (Jonathan Donaldson), a 250 MHz logic analyser on a real SNES running Super Mario World, tapping the S-SMP/S-DSP's control and serial-clock lines (PD2, PD3, the 64 kHz MCK, SCLK, BCK, the MUTE lines) | Super Mario World played normally, which jwdonal himself calls not a controlled input ("probably doesn't make much of a difference though") | Screenshots and a schematic, hosted on Dropbox's discontinued public-folder service; the links are dead today | Forum post, no licence stated | This thread reads as the source behind CONFORMANCE.md's claim that "captures of [the S-DSP's serial output] exist" - a real logic-analyser tap of a real console. It cannot settle anything today: the files are gone, and even intact, the input was not a documented register sequence chipvoice could reproduce and compare against |
| [`snes_spc`'s own README](https://github.com/blarggs-audio-libraries/snes_spc/blob/main/README.md) | blargg (Shay Green) | Not applicable | Not applicable | LGPL 2.1 (already vendored as chipvoice's oracle, decision 17) | States SPC_DSP "passes over a hundred strenuous timing and behavior validation tests that were also run on the SNES," supporting that the digital model chipvoice already ports carries real-hardware validation. Names no specific test, links no file, and says nothing about the output stage |

**Sources checked and rejected.** [NESdev forums, cartridge audio-input impedance (t10585)](https://forums.nesdev.org/viewtopic.php?t=10585): Near and MaxWar measured a real console's cartridge-port audio *input* mixing path (Super Game Boy, Satellaview, MSU-1), which is not the S-DSP's own output stage. `problemkaputt.de/fullsnes.htm`: loaded truncated before its DSP/DAC sections on the one successful attempt, so nothing from it beyond what SnesLab already attributes to it is cited. A Scribd mirror of "Anomie's S-DSP Doc" and a second mirror at gamepilgrimage.com: the viewer chrome loaded but not the document body, and the second mirror's certificate is expired; neither could be read. `oldmachines.io/supernintendo/audio/`: opened, and states plainly it ships no binary assets or game audio - useful only as confirmation that this particular page is not evidence.

**What this settles and what it cannot.** The community's own reading is that the SNES's sound is dominated by the digital Gaussian interpolation filter, which is already identical to real hardware through the ported, hardware-validated snes_spc core - so the part of the S-DSP most people mean by "that SNES sound" is not actually an open question here. The output stage after it is genuinely unmeasured: the one real logic-analyser capture anyone made of a physical console's S-DSP lines is gone, and the one frequency estimate for the analog filter is a schematic simulation, not a captured unit. P6-8 still needs either a fresh capture (digital, off the serial lines, or analog, off the line-out) under a documented input, or a purchased unit.

## C64 (SID 6581, 8580)

The digital core (`docs/chips/c64.md`) is written from documents, decision 18,
and is already identical to reSID-fp; the analog stage - the two DACs, the
filter, the output stage, in `SID_6581_PROFILE` and, since P7-10, its 8580
counterpart `SID_8580_PROFILE` - has no capture of a unit of our own, for
either chip.

| Source | Author, unit, capture chain | Exact input; do we have it | Format, sample rate | Licence | Settles / cannot settle |
| --- | --- | --- | --- | --- | --- |
| [reSID's `filter.cc`](https://github.com/libsidplayfp/resid/blob/master/filter.cc) | Dag Lem. Direct voltage measurement on the filter's CAP1B/CAP1A pins with the external capacitor removed, on a chip marked "MOS 6581R4AR 0687 14" and a chip marked "CSG 8580R5 1690 25" | A fixed/swept DC voltage on the capacitor pin, not a register sequence; not an input chipvoice runs, but the measured Vin/Vout pairs are embedded as tables in the source itself, fetchable and diffable directly | A source file with embedded numeric op-amp transfer-function tables; not audio | GPL (reSID) | Settles that the sheet's "curve reSID measured on one 6581 R4AR" is a real, named, traceable unit, and hands us an equally named 8580 unit (R5). **Implemented, P7-10**: the 8580's own fixed-point cutoff expression in this file is an exact line, so `SID_8580_PROFILE.cutoff`/`qLow`/`qHigh` (`docs/chips/c64.md#the-8580`) are read straight from it at its two endpoints, not a point-by-point diff of the whole table - whether the op-amp's shape between those two points really is that plain a line, the way the 6581's kinked curve from the same file is not, is still open. Cannot settle the output stage's corners or the DAC ladder's mismatch ratio; those are separate measurements this file does not contain |
| [reSID-fp's `Filter6581` docs](https://sidplay-residfp.sourceforge.io/docs/classreSIDfp_1_1Filter6581.html) | libsidplayfp (reSID-fp) Doxygen documentation, the topology reconstructed from Michael Huth's 2008 die photographs | Not applicable; design documentation, not a capture | Prose and a circuit diagram | GPL-2.0 (libsidplayfp) | States the two-integrator-loop biquad topology `SID_6581_PROFILE` assumes "has been confirmed by Bob Yannes [the SID's designer] to be the actual circuit" - settles that the topology is die-derived and designer-confirmed, not guessed. Cannot settle any corner frequency or Q value; those come from `filter.cc` above |
| [reSID-fp's `Dac` docs](https://sidplay-residfp.sourceforge.io/docs/classreSIDfp_1_1Dac.html) | libsidplayfp (reSID-fp) Doxygen documentation, the R-2R ladder DAC model | Not applicable; a model description | Prose | GPL-2.0 | Settles that the 2R/R mismatch of 2.2 the sheet cites for the 6581 is this project's own figure, and gives the 8580's counterpart, about 2.0 ("very accurately matched," no discontinuities). **Implemented, P7-10**: `SID_8580_PROFILE.ladderRatio = 2.0`, terminated, which the sheet's `test/c64-8580.mjs` checks makes an exactly linear ladder. Cannot settle which physical chip, if any, that 8580 figure was measured from; the page names no unit |
| [`libsidplayfp/combined-waveforms`](https://github.com/libsidplayfp/combined-waveforms) | libsidplayfp; hardware samples contributed by Trurl, ltx128 and reFX-Mike, sampling program by Dag Lem, model-fitting tooling by Antti Lankila and Leandro Nini. Raw OSC3 samplings (the top eight of the waveform generator's twelve bits) of 30 named physical units: 6581 R2/R3/R4AR and 8580 R5, each unit's four combined-waveform selections (`src/dump.cpp` confirms the format: a two-byte PRG header, then 4096 raw bytes, one per accumulator index) | The waveform-select register swept through its combinations with the accumulator's value fixed by the test bit, a documented and reproducible register-level input; chipvoice's own `combinedWaveform()` takes the identical index and waveform-selector arguments, confirmed against `src/parameters.h`'s `GetScore8`/`Score` functions, which shift the model's twelve-bit output down by four bits before comparing - the same shift used below | Raw binary, 4098 bytes per file (fetched: see below) | GPL-2.0 | **Implemented below.** Settles how well chipvoice's combined-waveform model - fitted only to reSID-fp's table, itself a fit to kevtris's samplings of a different 6581 R2 - agrees with a second, independent named 6581 on the pre-DAC waveform generator. Cannot settle anything about the analog stage: this is the digital core, before the DACs, and the README warns that older ("broken") captures in this repository are affected by a saw-top-bit writeback bug - the files used here are from the corrected set, not those |
| [plogue, "SID 6581R3 ADSR tables up close" (2010)](http://ploguechipsounds.blogspot.com/2010/03/sid-6581r3-adsr-tables-up-close.html) | Plogue, already the sheet's cited source for its ADSR findings. A 6581R3, die-photo/LFSR analysis of the rate lookup ROM plus a live capture: CIA-timer-synchronized polling of the real, readable ENV3 register as it decays | A short, reproducible poke-then-poll register sequence is described; we have only Plogue's screen-capture images and a partial ASCII table, not a machine-readable log | Annotated images, an ASCII/LFSR table, a code snippet, a screen-capture image; no raw data file | Not stated (ordinary blog copyright) | Verifies and traces the sheet's existing "plogue's ADSR findings" citation to this specific post and this specific named unit. Cannot supply a numeric conformance input as-is; a from-scratch capture (P7-7, VICE's `testprogs/SID` on a 6510) would have to reproduce this method itself, not read it from the post |
| [VICE manual, chapter 7](https://vice-emu.sourceforge.io/vice_7.html) | The VICE project | Not applicable | Prose | GPL-2.0 (VICE) | Settles that VICE/reSID's own software distinguishes real chip models (`SidModel`: 6581, 8580, 8580 "Digifix", DTVSID) and exposes filter-bias calibration knobs in millivolts per model - confirms that per-unit filter variation is a known, already-parameterized problem in the strongest available software reference. Cannot settle any specific measurement; the manual documents no methodology |

**Sources checked and rejected.** `kevtris.org/Projects/sid/*`: every fetch attempt failed on a TLS "self-signed certificate" error, so the rate-register and die-photo content the sheet already cites from kevtris could not be independently re-verified here, only read through this codebase's existing secondary citations of it. A Lemon64 forum thread on Antti Lankila's filter-curve plotting tools, which appeared (from its title alone) to reference a 256-step filter-cutoff sweep test program by Lord Nightmare: blocked (403), never opened, not cited. `sidmusic.org/sid/sidtech2.html`: connection refused. `daglem/reSID`'s own README on GitHub: 404. The libsidplayfp wiki's ADSR-gate-logic page: opened, but it corroborates only the digital gate logic already covered by the sheet's 100% digital-parity claim, nothing analog.

## Fetching the evidence

`packages/conform/src/evidence/fetch.mjs` (script `evidence:fetch`) downloads
every source above that has a URL to a file rather than a page, into
`.artifacts/hardware-evidence/<chip>/`, and checks its bytes against the
SHA-256 recorded in the committed `packages/conform/src/evidence/manifest.json`.
Nothing is vendored: a redistribution licence, where one is stated above,
still means fetching a fresh copy is preferred to committing one. A dropped
connection is retried with backoff before it is reported as failed.

```sh
pnpm --filter chipvoice-conform evidence:fetch          # every source
pnpm --filter chipvoice-conform evidence:fetch nes c64   # only these chips
```

## Measurement

The one candidate that qualified - a precisely known input chipvoice's own
code could render and compare against a real recording or sampling, beyond
blargg's `apu_mixer` - is the C64's combined waveforms.
`packages/conform/src/evidence/c64-combined.mjs` reads the four files fetched
by `evidence:fetch c64` (one 6581 R4AR, `libsidplayfp/combined-waveforms`),
scores chipvoice's `combinedWaveform()` against each one shifted down to the
eight bits OSC3 would expose, and writes the result onto
[`docs/chips/c64.md`](chips/c64.md#combined-waveforms-against-a-real-6581):

```sh
pnpm --filter chipvoice-conform evidence:fetch c64
pnpm --filter chipvoice-conform evidence:c64:sheet
```

| Combination | Bytes matching a real 6581 R4AR | Wrong bits |
| --- | --- | --- |
| saw+triangle | 82.0 % (3358/4096) | 1500/32768 |
| pulse+triangle | 83.1 % (3404/4096) | 922/32768 |
| pulse+saw | 75.0 % (3072/4096) | 1623/32768 |
| pulse+saw+triangle | 94.1 % (3854/4096) | 457/32768 |

This is not a regression signal - the model was fitted to reSID-fp's table of
a *different* 6581, never to this unit - it is a measurement of how far one
real 6581 sits from another on the part of the chip the sheet already says
varies most. It settles nothing about the analog stage: the combined
waveforms are read before the DACs. `filter.cc`'s op-amp transfer-curve
tables (the C64 table above) were a second candidate that needed no register
log at all; P7-10 read its 8580 entry (an exact fixed-point line, unlike the
6581's kinked one) into `SID_8580_PROFILE`'s cutoff and Q, endpoint to
endpoint rather than a full point-by-point diff of every table row - a
finer-grained diff of the curve's shape between those endpoints, and the same
treatment for the 6581's own kink, remain open for whoever picks up P7-8.

No other chip had a candidate that qualified. NES: blargg's `apu_mixer`
already is this measurement, done before this ticket. Game Boy: no
controlled-input real recording was found anywhere searched. Mega Drive:
MDFourier is real hardware with a documented capture method, but its exact
register sequence was not found, and even found, replaying it needs a
68000/Z80 fixture the harness does not have. SNES: the one real digital
capture anyone made of a physical console's S-DSP lines (a logic-analyser
tap) is dead-linked, and was not a controlled input in the first place. What
would make each of these usable: Mega Drive, the MDFourier ROM's register
writes, or an equivalent register-log-only test; Game Boy and SNES, a stock
unit's raw or lossless recording of a stated test ROM or register log with
its capture chain, sample rate and a redistribution licence, exactly as
blargg's `apu_mixer` recordings already are for the NES.

## Recommendation

Published evidence closes none of the five chips' analog-stage questions
outright; decision 38's order after the NES still holds. What it does change:

- **NES**: already the best-evidenced chip here, and needs nothing further
  from a search - the mixer is measured against a real recording, and the
  filter's provenance (blargg's capture, lidnariq's analysis) is traced even
  though the files themselves are gone. The purchased NES the decision already
  orders should also settle the filter corners across the four revisions,
  since nothing published can.
- **C64**: the combined-waveform model now has one independent hardware check
  the digital side did not have before, and `filter.cc`'s tables gave a
  concrete, register-log-free analog measurement for both a 6581 and an 8580
  without buying either (P7-10, endpoint to endpoint); a finer diff of the
  curve's shape between those endpoints, for both chips, remains the cheapest
  next step of the five.
- **Mega Drive**: MDFourier is the strongest lead of the remaining four - named
  units, both models, a documented capture method - but is blocked on finding
  its ROM's register sequence, not on hardware access. Worth another search
  pass before a unit is bought.
- **Game Boy and SNES**: this search found no usable numeric hardware data for
  either's output stage - only formulas, teardown prose, and dead links. These
  two currently have the least published evidence to fall back on, and are
  where a purchased unit's capture bench (once the NES one exists) would add
  the most that nothing else can supply.

Order after the NES, on what this document found: C64's filter tables first
(no purchase needed, if implemented), then Mega Drive if the MDFourier
register sequence turns up, then Game Boy and SNES, which need a unit
regardless.
