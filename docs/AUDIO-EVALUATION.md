# Evaluating console compositions

A passing emulator test does not mean a good arrangement. Keep three verdicts
separate: **digital correctness**, **signal integrity**, and **musical likeness**.
The listening lab renders the actual demo presets, not a second collection of
lookalike fixtures. It also accepts saved scores.

## Reproduce and compare

From the repository root (Node 22, pnpm, a C++ compiler; FFmpeg is optional):

```sh
pnpm --filter chipvoice build
pnpm --filter chipvoice-conform test:listening
pnpm --filter chipvoice-web eval:audio --out .artifacts/listening/before
# Make one change, rebuild chipvoice, then:
pnpm --filter chipvoice-web eval:audio --out .artifacts/listening/after --baseline .artifacts/listening/before/report.json
python3 -m http.server 3041 --bind 127.0.0.1 --directory .artifacts/listening/after
```

Open `http://127.0.0.1:3041`. Paths passed to the generator resolve from the repo
root. Use a new output directory for each run; existing reports cannot be
replaced. The generated directory is self-contained and has no remote requests.

Options: `--chips snes` (or comma-separated `2a03,dmg,md,snes,c64`),
`--preset overworld`, `--seconds 5`, `--mix-only`, `--skip-oracle`,
`--scores path/to/score.json`. A score file is one `Score`, or an array of
`{id,title,song}` entries. Default duration is one complete score loop, capped at
180 seconds; the report marks truncated excerpts and publication rejects them.

The report contains raw 16-bit stereo WAVs of the mix and four isolated roles,
score files, waveform envelopes, averaged spectra, and measurements before WAV
clamping. Hashes identify the actual built engine files, preset bundle, harness,
vendor oracle sources, scores and WAVs; the Git revision and working diff digest
record whether this came from a working tree. Rebuild before running: the harness
measures the **built** engine. Keep the source revision/patch with shared evidence.

`--baseline` verifies previous WAV hashes and only attaches cases with matching
scores and durations; a sample-rate mismatch is rejected. It compares
engine/arranger changes with fixed input. For a
composition rewrite, keep both reports and judge the changed score explicitly;
do not call that an engine regression test. Baseline cases absent from an earlier
report simply have no version comparison.

## What each check establishes

- **Source melody, familiar cartridges:** independently decode the score and
  observe the real sequencer's note sink on all five role maps. Compare both to
  frozen MIDI note ledgers: pitches, onsets/releases, missing/extra notes, total
  form and unexpected backing. The 415 selected notes are checked with no pitch
  tolerance and at most 1/24 beat per boundary for grid rounding. This verifies
  the selected transcription before the driver/DSP, not the original game's
  recording. See [sources, coverage and mutation tests](../scores/README.md).
- **Capture replay, all five consoles:** replay the captured register writes and
  memory into a fresh chip, compare against offline PCM sample by sample (absolute
  tolerance `1e-7`). This catches scheduling/capture inconsistencies, but both paths
  use our engine: it is not an independent hardware oracle.
- **SNES native oracle, actual compositions:** run the same registers and sample
  RAM through vendored native `snes_spc 0.9.0`, comparing every digital change's
  cycle, channel and integer value. The TypeScript port has the same ancestry;
  this is an independent execution, not an independently designed emulator or
  a physical-console measurement. Existing committed conformance logs still run.
- **Signal measurements:** RMS, DC, peak, crest, invalid/clipped samples and stereo
  cosine; FFmpeg's [loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm)
  additionally measures integrated LUFS and true peak. These describe the signal,
  not whether it sounds like a console. Short loops have limited loudness-range
  significance. A nonzero adjacent-sample step is not automatically a click.
- **SNES internal headroom:** an offline observer counts dry/echo-input voice
  additions outside signed 16-bit range, before the existing DSP clamps them.
  It wraps a private port method; update it if that layout changes. It does not
  alter audio or instrument production playback. Oracle parity also runs on the
  observed instance. It does not instrument every saturation stage (BRR,
  interpolation, FIR and echo feedback are outside this counter).

`technicalPass` means replay, optional native oracle and finite PCM passed.
`signalWarnings` are separate: emulating an overdriven mix correctly still passes
parity. The default SNES regression test rejects dry/echo-input saturation, and
its deliberately overloaded register control proves the observer can detect it.
The metric tests also deliberately introduce silence, pitch/gain changes,
invalid PCM and stereo cancellation. No authenticity score is generated.

## Listening protocol

1. Keep the score, tempo, duration, render options and listening device fixed.
   Start with a mix, then isolate the offending role. Isolation re-renders the
   score; stems need not sum to the mix because voices and nonlinear stages interact.
2. Compare current/previous versions with one shared audio clock. Level matching
   uses LUFS only when **both** entries have it, otherwise RMS for both (a rough
   fallback). It attenuates to the quieter source or -23 LUFS/-26 dBFS RMS,
   whichever is lower; never boosts. WAV files remain unmodified.
3. Use “Masquer et tirer au sort”, listen to A/B, save observations before
   revealing. Both sources run continuously; switching has a 5 ms gain time
   constant to suppress a click. This is an exploratory preference test, not
   a statistically qualified ABX trial or compliance with
   [ITU-R BS.1116](https://www.itu.int/rec/R-REC-BS.1116-3-201502-I/en).
4. Export notes with the hidden mapping and WAV hashes. Record the exact note,
   instrument and time; keep timbre likeness, audible defects and musical
   preference separate. Notes are in memory until exported, not saved remotely.
5. For stylistic likeness, choose several explicit references per console, not
   a single “SNES sound”. Describe the sample attacks, sustain/loops, envelopes,
   pitch/vibrato, bass/drum balance, polyphony and space you want. Use recordings
   you can legitimately access. A different game composition cannot be null-tested
   against our score; that comparison needs listening and musical analysis.

The SNES native WAV is the raw 32 kHz DSP, without our placeholder output-stage
filters. Browser resampling and that filter difference can be audible. Starts
share a timeline, without compensating filter delay. Prefer **previous version**
for judging this fix; native A/B alone cannot prove a DSP defect.

Browser verification, against an after-report with a SNES baseline:

```sh
node packages/conform/src/listening/test-browser.mjs http://127.0.0.1:3041 .artifacts/listening/browser
```

It measures non-silent browser output, checks common A/B start times, switches
sources, exercises blind/reveal and notes export, plays a stem and native reference,
and records desktop/mobile screenshots. It does not assess human preference.

## Initial investigation, 2026-09-06

The three demo presets across five machines produced 15 exact capture replays.
All three complete SNES loops also matched native `snes_spc` exactly. Nevertheless,
the musical driver mapped maximum voice level to `$7f`: the sum of several loud
samples clipped **before** master-volume attenuation. No final PCM sample exceeded
full scale, so checking only the exported WAV missed this distortion.

| SNES loop | Dry mix frames clipping before* | After* | LUFS before → after |
| --- | ---: | ---: | ---: |
| Overworld | 19.68% | 0% | -6.15 → -17.43 |
| Boss Fight | 12.65% | 0% | -6.79 → -17.84 |
| Midnight | 15.50% | 0% | -6.83 → -18.13 |

\* 32-clock windows containing at least one overflowing voice addition, either
channel. Both dry and echo-input addition counters are zero after the change.
That initial fix mapped full voice level to `$20`, leaving room for the four arranged
parts. DSP saturation behavior stays intact. This is not a universal promise of
headroom with eight custom full-scale voices or different sample/echo settings.
Native parity remains exact on all three corrected compositions and all five
committed SNES conformance logs. The SNES golden hash intentionally changes from
`5b2fe9e2f23e1872…` to `6b32dac1405316d1…`; the four other chip goldens do not change.

A second confirmed defect was in `recordSong`: stop events were stamped at the
start of the final render block. Setting its clock to the requested end before
stopping removes premature note-offs in captures. A held-note regression failed
at 0.280204 s in a 0.31 s SNES capture before the fix; exact full-duration replay
now passes on all five consoles. This capture correction does not itself change
live sound.

**Subsequent iteration:** the original build-time BRR palette, per-family hardware
envelopes and simultaneous chords are implemented in PRs #24/#25. The driver now
uses `$1f` with a shared chord amplitude budget and moderate stereo placement.
See [palette acceptance and measurements](SNES-PALETTE.md) for the resulting
checks, listening iterations and review corrections.

**Still open:** listening against chosen console-specific musical references and
measuring the analog output stage against SNES line-out. Neither this investigation
nor oracle parity settles those musical/hardware questions.

## Public listening room

`/lab` publishes an explicitly versioned evaluation collection using the site's
shared controls. Audio is lossless FLAC loaded only on demand. The standalone
report and public lab share the same continuous A/B transport: selection changes
retain Play, keep the old audio during loading and crossfade at the new loop
phase. See [publication and playback design](CONTINUOUS-PLAYBACK-LAB.md).

The longer melody collection contains six cartridges on five consoles (30 cases).
Offline exports now start at musical time zero, preserving the end of a full
loop. Register captures use the same sample-rounded endpoint as the WAV and the
cores' cancellable event queue. Regressions cover the final note, fractional-sample
loop lengths at 44.1/48 kHz, and short notes whose obsolete releases must be
cancelled after a rest. These fixes make replay evidence reliable; they are not
a claim of soundtrack authenticity.
