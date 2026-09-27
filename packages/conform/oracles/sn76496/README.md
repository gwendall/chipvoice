# Oracle: MAME's sn76496

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


MAME's `sn76496.cpp`/`sn76496.h`, the SN76489 family device (`src/devices/sound/sn76496.cpp`),
built natively and driven with a register log, configured as `segapsg_device` -
the Sega VDP PSG the Mega Drive's own driver instantiates. Vendored from
<https://github.com/mamedev/mame>, pinned at commit
`76c7d197ed46e844ffb1fbad5cc21c9ab3cdc9c0`, under the BSD-3-Clause licence its
own file headers carry (see [LICENSE](LICENSE)). It is a tool in this
repository; nothing here ships in the `chipvoice` package, which stays MIT.

## What is MAME's and what is not

`sn76496.cpp` and `sn76496.h` are MAME's, unchanged. Everything else here is
ours:

- `emu.h` is a minimal shim of the slice of MAME's device API the vendored
  files use: `device_t`, `device_sound_interface`, `sound_stream`,
  `machine_config`, `device_type`, `emu_timer`, `attotime`, `save_item`,
  `logerror`, `fatalerror`, `BIT()` and the rest. It ends with `#define
  private public` and `#define protected public`, placed after every shim
  class is fully defined, so only `sn76496.h`/`sn76496.cpp` and the code that
  includes them afterwards (`main.cpp`) see the relaxed access; the shim
  classes above that line keep their real access control. This lets
  `main.cpp` read `m_register[]` and `m_output[]` straight off the device
  without adding an accessor MAME's own code does not have.
- `main.cpp` reads a log, drives the device on the master-clock timebase
  (see "What this oracle is" below), and prints every change of the four PSG
  voices as `<cycle> <voice> <value>`, using the harness's own voice numbers:
  6 (psg1), 7 (psg2), 8 (psg3), 9 (noise). Writes to the YM2612 in the log are
  another chip's and are skipped.
- `LICENSE` is a plain BSD-3-Clause text written for this directory. MAME's
  own repository has no single top-level BSD-3-Clause file to copy verbatim -
  its root `COPYING` covers the whole, differently-licensed project - so this
  one names "Nicola Salmoria and the MAME team" as the vendored files' own
  header tags do, and covers only `sn76496.cpp`/`sn76496.h`. Everything else
  in this directory is chipvoice's own, under the repository's licence.

The harness builds it with the system C++ compiler on first use, into
`build/`.

## What this oracle is

Configured as `segapsg_device`, constructed with `sn76496_base_device(mconfig,
SEGAPSG, tag, 0x8000, 0x01, 0x08, false, false, 8, false, true, owner, clock)`
(`sn76496.cpp:225-228`): feedback mask `0x8000`, white-noise taps `0x01` and
`0x08`, not negated, not stereo, clock divider 8, not NCR style, Sega style.
This is the variant the Mega Drive's own driver instantiates:
`SEGAPSG(config.replace(), m_snsnd, DERIVED_CLOCK(1, 15))` off the VDP
(`315_5313.cpp:248`), the VDP itself clocked from `MASTER_CLOCK_NTSC`
(`megadriv.cpp:763`), with `psg_w` a plain passthrough to the device
(`315_5124.h:66`). So this oracle runs the PSG at exactly the master clock
over fifteen, `53693175 / 15 = 3579545` Hz, matching `dsp.ts`'s own `PSG_STEP`.

Timebase: `segapsg_device` runs its sound stream at `clock() / 2` and further
divides by 8 internally (its fixed `clockdivider`), so one real internal step
- one decrement of every channel's period counter - happens once every 16 raw
PSG clock cycles, matching `sn76489.ts`'s own `/16` divider exactly. To
reproduce that unchanged, `main.cpp` calls `sound_stream_update()` once per 2
raw PSG clock cycles (30 master cycles): calling it more or less often would
change the pitch MAME's own, unmodified code produces. A constant phase
correction of half that window (15 master cycles) is added to every stamp,
because `sn76489.ts`'s own divider starts at 0 and counts up while MAME's
`m_current_clock` starts pre-loaded at `clockdivider - 1` and counts down, so
MAME's first real step lands one raw PSG clock earlier; the correction lines
this oracle's stamps up with `dsp.ts`'s own convention for every step, not
only the first.

Voice value mapping: `output[c] ? (15 - register[2c+1]) : 0`, reading MAME's
raw attenuation register directly, not `m_volume[]` (a dB-table audio
amplitude meant for the mixer). This is the same quantity chipvoice's own
digital trace reports: `packages/chipvoice/src/chips/md/sn76489.ts`'s
`outputs()` computes `output[i] ? 15 - attenuation[i] : 0` for the tones and
`lfsr & 1 ? 15 - attenuation[3] : 0` for the noise, which is the same bit
MAME's `m_output[3]` (set to `m_RNG & 1` on every shift) reflects.

## Known limits of this oracle

Every point below is a genuine, diagnosed difference in behaviour between
MAME's `segapsg_device` and `sn76489.ts`, confirmed against the built oracle
binary; none is a flaw in how this oracle reads or drives the device. The
full findings, with the corpus logs that show each one, are on
[the sheet](../../../../docs/chips/md.md#psg-parity-against-mames-sn76496).

- A tone period of 0 or 1: MAME's `sound_stream_update()` has no special case
  and reloads and toggles every real step regardless, so a period of 0 or 1
  plays the fastest tone the divider can produce, about 111861 Hz.
  `sn76489.ts`'s `clock()` special-cases `period[i] <= 1` and holds the
  output constant high instead. SMS Power's SN76489 notes state both
  readings.
- Reset output polarity: MAME's `device_start()` sets `m_output[0..2] = 0`
  for the tone channels; `sn76489.ts`'s `reset()` sets `output.fill(1)`.
  Both start each channel's counter at 0, so both reach their first reload at
  the same cycle, but that shared reload flips the two models in opposite
  directions - a one-time inversion that then holds for as long as the note
  does, on a channel unsilenced for the first time since reset before its
  first natural reload.
- Tone 3's noise rate: for `(register[6] & 3) == 3`, MAME doubles tone 2's
  period (`m_period[3] = m_period[2] << 1`) and shifts the LFSR on every
  reload; `sn76489.ts`'s `noisePeriod()` returns tone 2's period undoubled
  and shifts only on alternate reloads. The two give the same net shift rate
  in steady state, but neither model resets its counter or output flag on a
  mode-only write to register 6, so the residual phase after (re)configuring
  this mode is history-dependent and can differ between the two.
- The white noise LFSR's period from reset: confirmed separately, with a
  throwaway measurement program run directly against this device (not part
  of the committed corpus - the full period needs about 440 million master
  cycles), at exactly 57337 shifts, matching the sheet's formula-test figure;
  the periodic mode's is exactly 16, also matching.

This oracle is trusted for all four PSG voices - psg1, psg2, psg3, noise -
because every divergence above is MAME's own code, faithfully read; none of
them is this oracle misreporting the device's actual state. Where MAME and
`sn76489.ts` disagree, the baseline records how much of the corpus is
identical today so a future change can be measured against it, not a claim
that either reading is the only correct one.
