# SNES musical palette iteration

Baseline: main `c0ad640`, listening evidence `.artifacts/listening/current`.
This work improves the factory arrangement, preserving the native DSP and the
portable score format. It does not claim to reproduce a named game's instruments
or an unmeasured physical console output stage.

Phase 1 (`feat/snes-sampled-palette`) covers criteria 1–3, 5 and 6.
Phase 2 implements criterion 4 after the palette is evaluated and merged.

## Acceptance criteria

1. Original sample-based lead, chord and bass families with an authored attack
   and a separate, deterministic BRR sustain loop. Existing named waveforms remain
   available to explicit instruments. No copyrighted game bank is imported.
2. Sample tuning metadata is shared by the driver and range diagnostics. Sustained
   notes remain correctly pitched after BRR encoding and looping; loop boundaries
   must not repeatedly play the attack or introduce discontinuity spikes.
3. Factory sample generation/BRR encoding happens at build time, not on first play.
   The sample directory and bank fit below the echo buffer in 64 KB of SPC RAM.
4. A subsequent arrangement iteration uses three simultaneous chord voices with
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
