# NES capture bench

<p align="center">
  <a href="HARDWARE-BENCH.md">English</a> &bull;
  <a href="HARDWARE-BENCH_ja.md">日本語</a>
</p>

Decision 38 orders a purchased NES to validate a capture bench, once the free
evidence in [HARDWARE-EVIDENCE.md](HARDWARE-EVIDENCE.md#nes-2a03) runs out:
the mixer is already measured against a real recording; the filter corners
are not. P2-3 built and proved that bench in software first - a committed
test ROM, `bench:nes:render`/`bench:nes:compare` (sync marker, clock-drift
correction, per-band spectral error, corner fitting), and a CI self-test that
recovers deliberately wrong corners, gain, latency, drift, DC offset and
noise from a synthetic capture within the stated tolerance, with no hardware
at all - see [CONFORMANCE.md's analog stage
protocol](CONFORMANCE.md#the-analog-stage-protocol) and `docs/chips/2a03.md`'s
capture-bench paragraph. This document is the other half: what unit and
capture chain to buy, sourced and dated, and the exact capture-day commands
to run once they arrive.

**Research only. Nothing on this page has been bought, ordered, or put in a
cart.** Every price and spec below carries the source it came from and the
date it was checked (2026-09-27 unless said otherwise); where a number
could not be pinned to one confident figure, that is said plainly rather than
guessed at.

## Unit

The deciding fact is not "NES or Famicom" but which specific model shipped
with a real composite-video-and-audio RCA jack - anything else needs an RF
demodulator between the console and the interface, itself a source of
treble loss chipvoice cannot separate from the chip's own filter (see [what
not to use](#what-not-to-use)).

- **NES-001 (front-loader, 1985), recommended.** Ships stock with RF (via the
  switch box) and true composite video plus mono audio on RCA jacks on the
  side of the unit - no mod needed. [The Silicon Underground, "How to connect
  a NES to a modern TV"](https://dfarq.homeip.net/how-to-connect-a-nes-to-a-modern-tv/)
  (checked 2026-09-27); corroborated by [PCWorld's NES
  teardown](https://www.pcworld.com/article/503959/inside_the_nes.html)
  (checked 2026-09-27).
- **NES-101 (top-loader, 1993), disqualified stock.** The redesign dropped
  the composite/audio jacks for RF only. [RetroFixes' NES-101 composite AV
  upgrade](https://www.retrofixes.com/products/nes-toploader-av-upgrade)
  (checked 2026-09-27); consistent with [Ultimate Pop Culture Wiki's NES-101
  page](https://ultimatepopculture.fandom.com/wiki/Nintendo_Entertainment_System_%28Model_NES-101%29)
  (checked 2026-09-27).
- **Famicom HVC-001 (1983), disqualified stock.** RF only, no AV output at
  all. [NESdev wiki, "Family
  Computer"](https://www.nesdev.org/wiki/Family_Computer) (checked
  2026-09-27).
- **AV Famicom HVC-101 (1993), legitimate second choice.** Ships stock with a
  composite-video plus dual mono-audio "Multi Out" connector (the same shape
  as the Super Famicom's) and has no RF modulator built in at all - composite
  is the only way to use it, which if anything makes its output path cleaner
  than the NES-001's, with no modulator nearby to couple stray RF into the
  audio. [NESdev forums, on the HVC-101's connector
  pinout](https://forums.nesdev.org/viewtopic.php?t=20163); corroborated by
  [gbasp.ru's AV Famicom
  review](https://gbasp.ru/avfamicomreview-en.html) (both checked
  2026-09-27). The better pick when buying from Japan or specifically
  validating Famicom-side hardware; costs more to source outside Japan (see
  [sourcing](#sourcing)) and its board revisions are less documented than the
  NES-001's.

Both run the RP2A03/RP2A07 family at the NTSC clock this bench's script
targets - 1.789773 MHz, confirmed on [NESdev wiki's CPU
page](https://www.nesdev.org/wiki/CPU) (checked 2026-09-27). Buy an
NTSC-region unit, not a PAL one: a PAL RP2A07's own clock and DMA timing
differ from what `packages/conform/src/bench/script.mjs` assumes.

**Recommendation: NES-001.** The same "stock composite, no RF" case applies
to the AV Famicom, but the NES-001 is cheaper and more abundant outside
Japan, with no import step.

### Board revisions

NES-001 boards are silkscreened `NES-CPU-04` through `NES-CPU-11`, visible
only after opening the case - no exterior label maps to a revision, and
listings essentially never mention it. The documented differences across
them are almost entirely the CIC lockout chip and the CPU/PPU die stepping
(2A03E/G/H, 2C02E/G/H): see NESdev admin Lord Nightmare's breakdown in
[NESdev forums, "Anyone know differences between NES-001 (NTSC)
Revisions?"](https://forums.nesdev.org/viewtopic.php?t=15985) (checked
2026-09-27). No source found documents a revision that changes the
composite/audio analog output stage specifically; that is "unresearched,"
not "ruled out." The AV Famicom HVC-101's boards (`HVCN-CPU-01`, `-02`, and
on) have one concretely documented difference - a capacitor near the 7805
regulator changes value between early and later boards - but no source
states what that capacitor does electrically, so it is flagged the same way:
see [famicomworld.com forum, "Capacitor list for Famicom AV
version"](https://www.famicomworld.com/forum/index.php?topic=9993.0)
(checked 2026-09-27). Either way, the only way to know a unit's revision is
to open the case and read the silkscreen after buying it.

### Power

| Unit | Official adapter | Source |
| --- | --- | --- |
| NES-001 | NES-002: 9 V AC, 1.3 A, US 120 V input, a 2-pin barrel, rectified to DC inside the console | NESdev forums (checked 2026-09-27) |
| AV Famicom HVC-101 | HVC-002-style: 10 V DC, 850 mA, center-negative, Japan 100 V input | NESdev forums and iFixit Answers (checked 2026-09-27) |

The two adapters are not interchangeable: feeding the AV Famicom the NES's AC
adapter can damage it, since the Famicom expects DC already ("if you try to
power the Famicom AV... using a NES-002, which outputs AC voltage, you will
blow up the console" - [NESdev forums, "Powersupply for Famicom AV
HVC-101?"](https://forums.nesdev.org/viewtopic.php?t=13926), checked
2026-09-27).

Neither adapter is a switching supply, so a bare plug-shape adapter into the
wrong mains voltage is not safe. On a US NES-001's stock adapter fed 220-240 V,
one NESdev poster measured close to double the rated output - [NESdev
forums, on running a NES-002 at 230
V](https://forums.nesdev.org/viewtopic.php?t=25182) (checked 2026-09-27). The
practical fix either direction (a US console outside the US, or a Japan
console outside Japan) is a purpose-built universal 100-240 V replacement
adapter at the console's own DC output spec, commonly sold for both consoles
under names like "Retro-Bit" or "Retro Game Supply" for roughly $15-25 (via
retail search, checked 2026-09-27) - not a shape-only adapter.

### Sourcing

| Unit | Price | Source |
| --- | --- | --- |
| NES-001, loose (console only) | $108.29 typical | [PriceCharting](https://www.pricecharting.com/game/nes/nintendo-nes-console) (checked 2026-09-27) |
| NES-001, basic bundle (console, controller, PSU, RF switch) | $35-60 | [mcmrose.com, "How Much Is An Original Nintendo Worth In 2026?"](https://www.mcmrose.com/how-much-is-an-original-nintendo-worth/) (published 2026-01-26, checked 2026-09-27) |
| NES-001, boxed/complete | $120-170 | same source |
| AV Famicom HVC-101, loose | $125.00 typical | [PriceCharting](https://www.pricecharting.com/game/famicom/av-famicom) (checked 2026-09-27) |
| AV Famicom HVC-101, Japan domestic auction average | ~¥13,227 (~$78-85 at the ~¥157/$1 rate quoted for late September 2026) | [aucfan.com](https://aucfan.com/search1/q-hvc.2d101/s-mix) (checked 2026-09-27) |
| AV Famicom HVC-101, shipped from Japan | $88-120 plus ~$10 international shipping | eBay listings, via search (checked 2026-09-27) |

A basic NES-001 bundle explicitly includes an RF switch, not a composite
cable - if it does not separately list one, budget for a plain composite/RCA
AV cable too; these are a common, cheap reissue accessory, but no specific
price for one was pinned down in this search, so treat it as a small,
unresearched extra rather than the $0 the table above implies. The NES-101
and the original Famicom HVC-001 are omitted from this table: both are
disqualified stock, above.

## The rest of the bench

### Flash cart

**Krikzz EverDrive N8 Pro (NES, 72-pin), $159.00.** In stock at the
manufacturer's own store: [krikzz.com](https://krikzz.com/our-products/cartridges/everdrive-n8-pro-72pin.html)
(checked 2026-09-27). It emulates mappers 000-255 via FPGA, so NROM/mapper 0 -
this bench's ROM - is the simplest case it supports, confirmed on [NESdev
wiki's Everdrive N8 page](https://www.nesdev.org/wiki/Everdrive_N8) (checked
2026-09-27). Krikzz ships from Ukraine and the product page does not state a
shipping cost, so treat $159.00 as item price only, not landed cost. A
US-based alternative with likely faster fulfillment: Stone Age Gamer sells
the same cartridge for $204.99 ([stoneagegamer.com](https://stoneagegamer.com/everdrive-n8-pro-base-black-nes.html),
checked 2026-09-27). If the unit bought turns out to be a Famicom rather than
an NES, the 60-pin `N8 Pro Fami` is the matching SKU at the same store.

### Audio interface

**Behringer UMC202HD, $86.90 (via Sweetwater, checked 2026-09-27).** 24-bit,
up to 192 kHz (so 96 kHz is a selectable rate), two combo XLR/TRS line
inputs, Midas mic preamps, and no EQ/compressor/limiter anywhere in its
signal path - confirmed on [Behringer's own product
page](https://www.behringer.com/en/products/0805-AAR) (checked 2026-09-27).
Max line input level is +20 dBu.

A solid alternative is the **Focusrite Scarlett 2i2 (4th Gen), $228.00** (B&H,
checked 2026-09-27), also 24-bit/96 kHz. It carries three togglable coloring
features (Air, harmonic coloring, off by default; Auto Gain; Clip Safe), so
it is usable for this measurement provided Air is confirmed off before
recording. Its max line input is 16 dBu. Given the requirement that nothing
in the signal path add coloring by surprise, the UMC202HD is the safer
default of the two.

### Cables and gain staging

An NES/Famicom's audio-out is **mono** - there is no stereo signal to
capture, only one RCA jack - confirmed by retailers selling "simulated
stereo" cables specifically because the stock signal is mono ([Stone Age
Gamer's simulated-stereo AV cable
listing](https://stoneagegamer.com/simulated-stereo-av-cable-for-nes.html),
checked 2026-09-27). One unbalanced RCA-to-1/4" TS (not TRS, not a 1/8" mini
adapter) cable into the **line** side of the interface's combo jack - never
the XLR mic side, which has far too much gain for a line-level source - is
what this bench needs. A **Hosa CPR-100** or equivalent runs roughly
$13-23 depending on length (Hosa/retailer listings, via search, checked
2026-09-27; not pinned to one exact SKU).

On headroom: consumer composite/line audio is nominally -10 dBV, about
-7.8 dBu; both interfaces above accept up to 16-20 dBu on their line input,
roughly 24-28 dB of margin. Plugging into the correct line input with the
gain trim turned down should not clip on this console's nominal signal - the
real risk is plugging into the mic input by mistake, or a modified console
running hotter than stock. A DI/level-matching box is advisable insurance for
clean, repeatable gain staging, not strictly required for level reasons. If
used, the **ART CLEANBoxPro** ($72.89 at Sweetwater, backordered at the time
of this research, checked 2026-09-27) does level conversion; its own product
description states it is **not** a ground-loop isolator.

### Ground loops

Focusrite's own support article on interface hum recommends, in order: a DI
box with a ground-lift switch for unbalanced consumer sources; plugging the
console, the interface and the computer into the same outlet or power strip
to minimize the ground-potential difference that drives a loop; and, if hum
persists, a transformer-based ground-loop isolator, naming the ART CleanBox
line by example - [Focusrite support, "Why is there unwanted hum noise in my
monitors"](https://support.focusrite.com/hc/en-gb/articles/211615185-Why-is-there-unwanted-hum-noise-in-my-monitors)
(checked 2026-09-27). The underlying mechanism - small ground-potential
differences between separately-plugged devices, which a balanced line
rejects at the receiver by common-mode cancellation - is documented in Bill
Whitlock's widely-cited AES paper ["Understanding, Finding & Eliminating
Ground Loops"](https://www.jensen-transformers.com/wp-content/uploads/2014/08/generic-seminar.pdf)
(checked 2026-09-27). If hum shows up despite sharing an outlet, the
practical device is an **ART CleanBox II**, a transformer-isolated hum
eliminator - the specific device Focusrite's article names. Its current
price was not pinned to one confident figure: search results ranged roughly
$61-100 across several retailers with inconsistent listing dates, so treat
that as a flagged, approximate range rather than a solid number.

### What not to use

- **An HDMI capture card or upscaler.** The NES has no native HDMI, so this
  needs an upscaler plus a capture dongle, and cheap capture hardware
  commonly forces audio to a fixed 48 kHz PCM stream regardless of the
  source - one widely-sold card's own spec states it "automatically converts
  input audio formats to 48 kHz PCM stereo audio" ([AGPTEK's USB 3.0 HDMI
  capture card spec](https://www.agptek.com/AGPTEK-USB-3-0-HDMI-HD-Video-Capture-1089-212-1.html),
  checked 2026-09-27) - a forced resample below this bench's 96 kHz target,
  and exactly the kind of added processing CONFORMANCE.md's protocol asks to
  avoid.
- **The RF output**, on any unit. NES/Famicom RF modulation was designed
  assuming playback through an RF-modulated TV and reduces high-frequency
  content in the audio before it ever reaches a demodulator - discussed
  directly by NES developers in [NESdev forums, "What are your opinions on
  RF audio on the NES?"](https://forums.nesdev.org/viewtopic.php?t=11505)
  (checked 2026-09-27) and corroborated by [ConsoleMods' NES video-output
  notes](https://consolemods.org/wiki/NES:Video_Output_Notes). This is what
  disqualifies the NES-101 and the original Famicom HVC-001 above.
- **A Bluetooth or wireless audio adapter.** Built around lossy codecs - SBC
  is the mandatory baseline Bluetooth audio codec - that discard audio data
  and add roughly 250-350 ms of latency ([SoundGuys' Bluetooth codec
  explainer](https://www.soundguys.com/understanding-bluetooth-codecs-15352/),
  checked 2026-09-27); both the lossy compression and the delay disqualify it
  for a clean filter-response measurement.
- **Acoustic recording of a speaker with a microphone.** Adds the room's own
  acoustics and the microphone's own frequency response on top of whatever
  the console's line-out actually does - defeating the point of measuring
  the console's own analog stage in the first place.
- **A USB "game capture" device with automatic gain control.** By
  definition applies a moving, signal-dependent gain, or bakes in a fixed
  sample-rate conversion as the HDMI card above does - either one violates
  the "no added coloring" requirement this bench depends on.

## Shopping list

| Item | Price | Notes |
| --- | --- | --- |
| NES-001 (complete-enough bundle, with a composite AV cable) | $120-170 | [sourcing](#sourcing) above |
| Universal 100-240 V replacement power adapter | $15-25 | recommended insurance even on 120 V mains, mandatory outside it |
| Krikzz EverDrive N8 Pro (NES) | $159.00 | plus Krikzz's own unpinned shipping from Ukraine |
| Behringer UMC202HD | $86.90 | |
| Hosa CPR-100 RCA-to-1/4" TS mono cable | $13-23 | |
| ART CLEANBoxPro (optional, gain-staging insurance) | $72.89 | backordered at the time of this research |
| ART CleanBox II (optional, only if hum appears in practice) | $61-100 | price not pinned to one confident figure |

**Core total (unit, adapter, cart, interface, cable; no optional boxes):**
roughly **$395-465**, before tax, before Krikzz's own shipping from Ukraine,
and before whatever a composite AV cable costs if the bundle bought does not
already include one. Adding the CLEANBoxPro brings it to roughly
**$470-540**; adding the CleanBox II as well, only if hum actually shows up
on the bench, brings it to roughly **$530-640**. Every figure above traces to
a cited source and a check date in this document; none is typed from memory.

## Capture-day procedure

All commands below run from the repository root, and `chipvoice-conform` is
`packages/conform`'s own package name.

1. **Confirm the ROM.** The committed test ROM
   (`packages/conform/roms/bench/nes-analog-script.nes`) should not need
   rebuilding; if it ever does, `pnpm --filter chipvoice-conform bench:nes:build`
   rewrites it and `packages/conform/corpus/2a03/hardware-script.json` from
   `script.mjs`, with the new ROM's SHA-256 recorded in that JSON file - never
   hand-typed. Check the flashed ROM's hash against that file with
   `shasum -a 256 packages/conform/roms/bench/nes-analog-script.nes`.
2. **Render a reference, optional but recommended.**
   `pnpm --filter chipvoice-conform bench:nes:render` writes
   `packages/conform/.artifacts/nes-bench/nes-analog-script.profile.wav` (the
   shipping `nesdev` profile) and `...flat.wav` (the DAC curve alone) - a
   quick sanity listen before flashing anything, though `bench:nes:compare`
   below renders both again on its own.
3. **Flash the cart.** Copy `nes-analog-script.nes` to the EverDrive's SD
   card and boot it directly (no menu navigation needed once selected); it
   plays the whole script once, about 27 seconds, then halts on itself
   forever, so there is no rush once recording has started.
4. **Wire the bench.** Console's composite-audio RCA jack, through the RCA-
   to-1/4" TS cable (and the DI box, if used), into the interface's line
   input - not the mic input. Console, interface and computer on the same
   outlet or power strip, per [ground loops](#ground-loops) above.
5. **Record at 96 kHz, 24-bit, one continuous take.** Start recording, then
   boot the cart; let the whole ~27-second script play with a second or two
   of silence on each end, then stop. Save as a mono WAV.
6. **Compare.**
   ```
   pnpm --filter chipvoice-conform bench:nes:compare \
     /absolute/path/to/capture.wav \
     --json .artifacts/nes-bench/capture-day.json \
     --sheet ../../docs/chips/2a03.md
   ```
   This finds the sync markers, corrects the unit's own clock drift, prints
   the drift, the fitted corners and the maximum per-band error against the
   `nesdev` profile, and - because `--sheet` is given - writes that result
   straight into `docs/chips/2a03.md`'s `bench:begin`/`bench:end` block, the
   same way every other generated number on a sheet is written: by the
   script, never by hand. Exit code 0 is a PASS against CONFORMANCE.md's 1 dB
   tolerance from 40 Hz to 15 kHz; a nonzero exit is a FAIL, still worth
   recording on the sheet as the honest result.
7. **Update `docs/BACKLOG.md`/`_ja` and `CHANGELOG.md`/`_ja`** once a real
   capture lands, since that changes published, user-visible behavior (the
   sheet's own analog-stage numbers) rather than just adding test
   infrastructure.
