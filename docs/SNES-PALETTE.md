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
