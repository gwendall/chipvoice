# SNES musical palette iteration

<p align="center">
  <a href="SNES-PALETTE.md">English</a> &bull;
  <a href="SNES-PALETTE_ja.md">日本語</a>
</p>


Baseline: main `c0ad640`, listening evidence `.artifacts/listening/current`.
This work improves the factory arrangement, preserving the native DSP and the
portable score format. It does not claim to reproduce a named game's instruments
or an unmeasured physical console output stage.

Phase 1 (`feat/snes-sampled-palette`) covers criteria 1-3, 5 and 6.
Phase 1 merged in PR #24. Phase 2 (`feat/snes-polyphonic-arrangement`) implements
criterion 4 using the evaluated palette.

## Acceptance criteria

1. Original sample-based lead, chord and bass families with an authored attack
   and a separate, deterministic BRR sustain loop. Existing named waveforms remain
   available to explicit instruments. No copyrighted game bank is imported.
2. Sample tuning metadata is shared by the driver and range diagnostics. Sustained
   notes remain correctly pitched after BRR encoding and looping; loop boundaries
   must not repeatedly play the attack or introduce discontinuity spikes.
3. Factory sample generation/BRR encoding happens at build time, not on first play.
   The sample directory and bank fit below the echo buffer in 64 KB of SPC RAM.
4. A subsequent arrangement iteration uses three simultaneous voices for triads (up to five for extended chords), with
   conservative balance and stereo placement. Stop, cut, seek, mute and capture
   semantics apply to every allocated voice. Other console arrangements retain
   byte-identical audio.
5. At each iteration: render the three actual demo scores with isolated roles;
   compare level-matched against the prior evidence; preserve exact native DSP
   parity and capture replay; no dry/echo-input saturation or invalid PCM. Probe
   held notes and all timbre choices, not just the default mix.
6. Review against this spec and repository standards before merging. Record
   objective results and the limits of subjective assessment; automated metrics
   do not certify human preference.

Technical references: [BRR samples](https://snes.nesdev.org/wiki/BRR_samples),
[S-DSP registers](https://snes.nesdev.org/wiki/S-DSP_registers),
[DSP envelopes](https://snes.nesdev.org/wiki/DSP_envelopes).

## Phase 1 measurements

The first palette passed native parity but was too quiet (-24.8 to -27.8 LUFS
across the demo mixes). Peak-scaling each original sample at build time and
raising the mallet/harp sustain made the second iteration -21.1 to -22.6 LUFS,
with zero measured dry/echo-input saturation. These are signal/balance observations,
not a human preference verdict. A slower five-Hz lead vibrato is the final setting.

The new RAM image uses 21,472 bytes including directory space, below the echo
buffer at 57,344. Encoding is build-time only. Each of the eight instrument
families has a separate BRR loop address, with predictor-independent entry.
After attack, isolated native-rate loops repeat exactly; measured held-note
pitch errors at 110/440/880 Hz are below 5 cents (autocorrelation estimate).

The palette expansion exposed a startup bug: a completely silent score produced
PCM with a peak of 0.183 before the fix. Disabling echo writes alone still let
reads wrap into sample RAM during the DSP's initial delay. Echo volume now stays
zero until that delay expires; the same silent-score regression produces exact
silence. Native DSP behavior is unchanged.

During palette authoring, rebuild after editing `scripts/snes-bank-source.ts`
(`pnpm --filter chipvoice build`). The normal development watch does not watch
these build-time recipes; a running demo otherwise retains its previous bank.

Review follow-up: decoded BRR boundary slopes are compared with the original
PCM at initial sustain entry and two subsequent wraps. Worst observed boundary
error is 0.4% of sample peak (limit 1%); deliberately broken BRR entries exceed
50% at all three boundaries and are rejected. Periodicity alone is not used
as proof that a loop is free of discontinuity spikes.

## Phase 2 measurements

SNES chords allocate v1/v4/v5/v6/v7, leaving v0/v2/v3 for lead/bass/percussion.
Every chord interval gets its own pitch and envelope; the amplitude budget is
shared equally and the voices have moderate stereo placement. Shapes larger
than five notes retain all intervals through an arpeggio and emit a capacity
warning. Other chips keep their original arrangement policy.

The three complete demo loops in `.artifacts/listening/snes-polyphony-v1` measure
-22.92/-21.54/-22.90 LUFS (overworld/boss/midnight), against the final phase-1
palette. All three match the native S-DSP exactly, replay their register capture
exactly and show zero observed dry/echo-input clamped additions. These counters
do not cover every saturation stage of the chip.

Regression probes cover simultaneous triads and five-tone chords, capacity
fallback, muted lanes, cuts/stops across the whole chord bank, seeking into held
chords and after cuts, and borrowing an inner chord voice for an SFX. The latter
checks the actual DSP pitch/envelope on restoration and silence after stopping.
The full 36 factory intent combinations are also checked with five-tone chords
for dry/echo-input headroom; intentionally overloaded registers must fail the
same observer. The SNES golden changes intentionally for the simultaneous chord,
stereo placement and rounded volume budget; the four other chip goldens stay fixed.

The remaining musical-reference work is explicit: choose the desired style or
game-like instrument palette and collect level-matched human listening notes.
Neither an exact native oracle nor these signal checks establishes that preference
or reproduces an unmeasured physical console's analog output.

Review corrections: timed chord cuts respect custom `ChannelClaim` ownership.
SNES volume remains fractional until its hardware register conversion, so sharing
an amplitude budget does not first quantize each chord tone to a 4-bit integer.
Quiet triads and five-tone chords remain audible at gain 0.1 and increase at
0.2/0.3. Legacy chip frame quantization is preserved. The default SNES golden
is unchanged by these two review corrections.

Final evidence on engine revision `377636b` is in
`.artifacts/listening/snes-polyphony-reviewed`: all 15 complete demo loops replay
exactly; all three SNES loops match native; every case has no signal warning.
All 60 non-SNES mix/stem WAV hashes are identical to the pre-palette baseline.
All 18 SNES mix/stem/native WAVs match the evaluated phase-2 defaults after the
review corrections. The report fingerprints the built engine separately from
subsequent documentation-only commits. `verification.json` records these checks.
Desktop/mobile A/B screenshots and browser checks are stored under `browser/`.

## Phase 3 evaluation protocol (declared before the bank changed, NEXT-24)

NEXT-24 rewrites the factory bank's brass, strings, picked-bass, kick and snare
(a real consumer's measured pain points) and turns the S-DSP's echo from a
hidden, disabled constant into a documented, public `space` choice. This
section is committed before any bank or driver change, so the probes,
descriptors and comparison systems below are fixed before the new bank exists
to tune against; a later commit fills in the measured numbers under "Phase 3
measurements", never by editing this section.

Five probes, rendered at 44.1 kHz:
- the three demo scores (`overworld`, `boss`, `midnight` in
  `apps/web/src/studio/presets.ts`, criterion 5's own reference set), each
  isolated to its `lead` role by resting every other lane, so a held or
  moving note is measured on its own rather than mixed with chord/bass/perc;
- a sustained-chord probe: a single held C4 major triad for four seconds;
- a drum loop probe: kick/snare/hat on every beat for eight beats at 120
  BPM, with a two-beat silent tail so a release, and any echo, has room to
  show.

Each probe renders on three systems: `2a03` (the control, unaffected by this
ticket), the SNES with the `main`-branch bank preserved as a `dist` build
from before this ticket's changes, and the SNES with the new bank. The S-DSP
core itself is not touched by NEXT-24, so any 2A03-vs-SNES difference on the
same probe is a bank/arrangement effect, not a chip-emulation difference; the
new-bank SNES render is taken twice, once with `space: "dry"` and once with
`space: "room"`, since the echo probes below only make sense as a comparison
between the two.

Descriptors, computed with `packages/conform/src/bench/fft.mjs`'s FFT (a
4096-sample Hann window, at least 100 ms after a note's attack and 100 ms
before its release, for every spectral measurement):

| Descriptor | What it separates |
| --- | --- |
| Spectral flatness | The 2A03's square/triangle are a fixed, narrow harmonic comb; a sampled, detuned-ensemble timbre spreads energy across more bins around each harmonic, raising flatness. |
| Odd/even harmonic balance | The 2A03's square and triangle are odd-harmonic-dominant; a bandlimited, non-square sampled timbre is not. |
| Spectral-centroid movement | A single repeating BRR cycle does not move between two 4096-sample windows 200 ms apart in the sustain; a multi-partial, detuned ensemble loop beats and its centroid drifts. |
| Attack transient energy | The dB ratio of RMS energy in the first 30 ms after note-on to RMS energy in the following 200 ms of sustain. A one-cycle waveform has almost no separate transient; an authored attack (bow noise, pluck, breath) does. |
| Echo tail energy | RMS energy in a 200 ms window starting 50 ms after the probe's last note-off, on the sustained-chord and drum-loop probes only, the only two with a clean release-to-silence gap. This is the descriptor the echo default is decided on, not the four timbre descriptors above. |

"Phase 3 measurements" below reports 2A03 control / SNES main / SNES new
(dry) side by side on the first four descriptors, and adds SNES new (room)
for echo tail energy. The claim under test: the new bank moves away from the
2A03 control on the four timbre descriptors, and `space: "room"` moves echo
tail energy measurably above both dry variants and above SNES main. A
"measurable" move is a threshold derived from the spread actually measured
across the five probes plus a stated margin, fixed after the numbers exist
but never loosened to let a particular probe pass; if a probe fails its own
descriptor, the fix is in the bank or the probe, recorded here, not in the
number.

A zero-shot "which console" classifier check is optional and not run here:
this ticket has no controlled reference (a check that does not first prove
it calls the unmodified 2A03 renders "NES" under the same prompt is not
evidence). The blind listening rubric a real kami consumer used to flag
these instruments is the actual acceptance test, and it runs on the kami
side with their own key, never this branch's; NEXT-24's final report gives
the exact command and a packed tarball for that run, not a quoted result
from it.

## Phase 3 measurements

Four timbre descriptors, 2A03 control / SNES main (pre-ticket) / SNES new
(dry), rounded to 2 decimal places (dB for flatness/odd-even/attack, Hz for
centroid movement):

| Probe (routed instrument) | | Flatness (dB) | Odd/even (dB) | Centroid move (Hz) | Attack (dB) |
| --- | --- | --- | --- | --- | --- |
| overworld lead (brass) | control | -17.86 | 0.51 | 185.0 | 2.01 |
| | main | -27.08 | 6.40 | 137.8 | 1.25 |
| | new dry | -24.79 | 5.22 | 51.1 | 6.93 |
| boss lead (brass) | control | -41.87 | 0.46 | 39.8 | 1.27 |
| | main | -34.67 | 6.91 | 0.8 | 0.99 |
| | new dry | -33.74 | 6.04 | 2.8 | 5.26 |
| midnight lead (mallet) | control | -34.49 | 42.83 | 8.7 | 2.27 |
| | main | -41.22 | 22.45 | 2.5 | 5.90 |
| | new dry | -41.22 | 22.45 | 2.5 | 5.90 |
| sustained chord (strings) | control | -18.01 | 17.47 | 3.0 | 1.28 |
| | main | -38.81 | 6.99 | 4.0 | -4.11 |
| | new dry | -39.06 | 6.72 | 51.6 | -0.54 |

Echo tail energy (RMS, linear), the descriptor the `space` default is
decided on:

| Probe | control | main | new dry | new room |
| --- | --- | --- | --- | --- |
| sustained-chord echo tail | 3.35e-30 | 1.50e-11 | 8.17e-12 | 4.84e-4 |
| drum-loop echo tail | 3.35e-30 | 4.37e-8 | 8.24e-8 | 8.24e-8 |

Peak sample on the three complete demo mixes, rendered whole (not isolated),
new bank: overworld 0.2581 (dry) / 0.2557 (room); boss 0.2796 / 0.2788;
midnight 0.2211 / 0.2155. No dry/echo-input clipping on any probe.

**Reading these honestly, per criterion 6.** Attack transient energy and
echo tail energy are the two descriptors that separate cleanly and in the
direction the protocol predicted: attack jumps 4-6 dB from main to new dry
on both reworked-brass probes, against a 2A03 control that stays near 1-2
dB throughout (a one-cycle pulse has almost no separate transient); echo
tail on `room` sits four to five orders of magnitude above dry and main on
the chord probe, and matches dry and main exactly on the drum probe, since
`EON` excludes the kit voice (v3) by design. Spectral flatness and
centroid movement did not separate in one consistent direction against the
2A03 control: flatness reads the SNES bank (both main and new) as *less*
flat than control on three of four probes and *more* flat only on boss,
and centroid movement's own two-snapshot, 200 ms-apart measurement is
close to the brass ensemble's own beat period at these pitches (about 255
ms for the E5 demo-lead probes, from the brass recipe's `loopCycles`/
`detuneCents`), so it can land anywhere in a beat cycle rather than
reliably tracking "does this timbre wander." We are recording this as a
limit of these two descriptors on this bank's specific probes, per
criterion 6 ("automated metrics do not certify human preference"), not
editing the descriptors or the probes to force a cleaner-looking number:
the protocol above is unchanged from `6e393bc`. Odd/even balance moved for
every reworked-family probe (brass, strings) but not in a single direction
relative to control either, since the 2A03's own odd/even balance varies
widely by patch (0.46-0.51 dB on the two brass-routed demo presets, 17.47
dB on the chord probe's control). Mallet, main and new dry are identical to
two decimal places on every descriptor above, confirming by direct
measurement (not just source diff) that the ensemble formula's
`unison: 1, detuneCents: 0` case renders unchanged audio, exactly as
designed.

## Post-hoc additions (review of PR #125)

These two probes are explicitly **not** part of the pre-declared Phase 3
protocol above: they were added after `6e393bc` was committed and after the
bank changed, in response to review of PR #125, which found two gaps in
the measurements - kick/snare are reworked but the drum-loop probe above
reports only echo tail ("no pitched spectral descriptors for noise/BRR
percussion" was the original, now-corrected reasoning), and picked-bass is
reworked but named by no probe at all. Same three systems, same FFT and
descriptor code as above (`packages/conform/src/bench/fft.mjs`), run with
an ad hoc render script kept outside the repo, like the script that
produced the tables above it - neither is committed, since neither is part
of the shipped package or the conformance harness, only a one-time
measurement.

**Kick and snare.** Both are one-shot, non-looping PCM (`baseHz` 0, no
pitch tracking), about 280 ms (kick) and 240 ms (snare) long in total - too
short for the protocol's own 4096-sample/200 ms-apart window pair, sized
for a multi-second held note. This probe halves both figures
proportionally (2048 samples = 46.4 ms, 100 ms apart); both windows still
land after the initial click transient and before the encoded PCM ends.
`oddEven`'s reference frequency is not a tracked pitch - kick and snare
have none - it is the synthesis recipe's own tonal component: kick's swept
oscillator sampled near the first window (65 Hz), snare's fundamental sine
partial (185 Hz, `snare()`'s own first term).

| Probe | | Flatness (dB) | Odd/even (dB) | Centroid move (Hz) | Attack (dB) |
| --- | --- | --- | --- | --- | --- |
| kick | control | -2.79 | 1.23 | 9449.1 | 13.17 |
| | main | -57.23 | 31.34 | 20.5 | 7.73 |
| | new dry | -55.09 | 27.96 | 20.8 | 8.67 |
| snare | control | -12.37 | 1.73 | 2545.6 | 11.13 |
| | main | -7.42 | 10.83 | 1057.4 | 13.02 |
| | new dry | -10.75 | 21.32 | 349.2 | 12.67 |

Reading these honestly, per criterion 6: attack transient energy, the
descriptor that separated most cleanly on the pre-declared probes, barely
moves here (main 7.73 to new dry 8.67 dB on kick; 13.02 to 12.67 dB on
snare, an actual small decrease) - unsurprising, since both recipes already
had a dedicated attack-click component before this ticket, unlike the
pitched families' single-cycle waveforms with no transient at all. Flatness
and odd/even both move toward the 2A03 control from main to new dry on
kick (flatness -57.23 to -55.09 against a -2.79 control; odd/even 31.34 to
27.96 against a 1.23 control), but odd/even moves away from control on
snare (10.83 to 21.32 against a 1.73 control) while its flatness moves
toward control (-7.42 to -10.75 against a -12.37 control) - the two drums
disagree with each other, not just with the pre-declared probes' own mixed
result for these two descriptors. Centroid move is large on both SNES
variants against a much larger 2A03 control figure in both cases (9449.1 Hz
kick, 2545.6 Hz snare control); it separates main from new dry by far more
on snare (1057.4 to 349.2 Hz) than kick (20.5 to 20.8 Hz, unchanged),
consistent with snare's new second tonal partial and reshaped noise decay
moving its own spectral balance around more than kick's single swept
oscillator does. None of this is a pass/fail claim: 2048 samples/100 ms was
chosen to fit the sample length, not derived from a measured spread, so no
threshold is set for these two rows.

**Picked-bass.** Structured exactly like the sustained-chord probe above
(same bpm, step count, held-then-cut shape), on the bass role instead of
chord, `intent: { bass: "round" }` - the same intent the `overworld` demo
score already uses to route to `picked-bass`. C2 (65.41 Hz) held for 4
seconds, cut at the same step 16 the chord probe cuts at.

| Probe | | Flatness (dB) | Odd/even (dB) | Centroid move (Hz) | Attack (dB) |
| --- | --- | --- | --- | --- | --- |
| picked-bass (C2 held) | control | -35.82 | 18.40 | 1.9 | -0.60 |
| | main | -55.39 | 12.81 | 0.1 | 1.81 |
| | new dry | -58.60 | 11.30 | 0.1 | 3.56 |

Echo tail energy (RMS, linear), same window as the other two sustained
probes:

| Probe | control | main | new dry | new room |
| --- | --- | --- | --- | --- |
| picked-bass echo tail | 3.35e-30 | 3.29e-19 | 2.90e-19 | 6.21e-5 |

Attack transient energy separates cleanly here, the same direction as the
pre-declared brass and strings probes: -0.60 dB (control) to 1.81 dB (main)
to 3.56 dB (new dry), the picked-bass recipe's own `unison: 2,
detuneCents: 8` giving it a real attack transient a single-cycle waveform
does not have. Flatness moves further from control on new dry than main
does (-58.60 vs -55.39, against a -35.82 control), the same direction the
sustained-chord (strings) probe moved, not the direction the two brass
probes moved (both moved toward control); odd/even moves toward control
(12.81 to 11.30 dB, against an 18.40 dB control), which is itself a third,
different direction from strings' own small move away from control on the
same descriptor. This is the same descriptor that criterion 6 already
found does not move in one consistent direction on the pre-declared
probes; picked-bass does not resolve that, it adds a fourth data point
to it. Centroid move is near-zero and identical (0.1 Hz) on both SNES
variants, matching mallet's own finding above that a bin-quantised
two-snapshot centroid measurement is a coarse instrument at these
settings. The echo tail follows the same pattern already established on
the chord and drum probes: `room` measures four to five orders of
magnitude above dry and main (6.21e-5 vs 2.90e-19 dry, 3.29e-19 main).

Decision 53 in [DECISIONS.md](DECISIONS.md) records the `space` default
decision itself and its full evidence, including the historical PR #44
regression this measurement alone does not capture.
