# Automatic mixing API and qualification

<p align="center"><a href="MIXING-API.md">English</a> &bull; <a href="MIXING-API_ja.md">日本語</a></p>

## What the policy does

`planPerformance(score, chip)` balances an adaptation using measured instrument
responses. The algorithm never reads a song title, source hash or catalogue ID.
Native command plans from `importVgm` or the NSF captures bypass it entirely.
`mix: false` preserves the previous control levels, while retaining allocation
bug fixes. Existing compact `Score` playback keeps its authored instrument
levels; use `Performance` or the phrase API below to request automatic mixing.

The planner resolves the instrument before choosing a compatible hardware voice.
It then combines the note's velocity/expression, the measured response of that
instrument, explicit part settings and audible simultaneous voices in the same musical role. A
four-note chord shares that role budget even when split across MIDI tracks; it is not four independently normalized
stems. A 30 ms exponential transition smooths changes in that density budget.
Soloing is applied after allocation and uses the same density and bus-headroom decisions. Completely source-silent notes reserve no voices and appear in `plan.silentNotes`, separately from allocated notes and hardware omissions. Notes that become audible later still reserve their voice.

Known native source controls can be translated through a source response profile.
For MIDI or unknown source instruments, a nominal RMS target and conservative role
weights approximate musical balance: lead 1, harmony 0.65, bass 0.55, percussion
0.45. These are defaults, not a rule that the melody must dominate every song.
No backing notes are generated. Authored trim and importance remain separate from
velocity, program selection and the hardware envelope.

```ts
import {planPerformance, renderPerformance, mdChip} from 'chipvoice';
const authored = {
  ...score,
  parts: score.parts.map(part => part.id === 'bass'
    ? {...part, mix: {importance: 1, gainDb: -2}}
    : part),
};
const plan = planPerformance(authored, mdChip, {allowLoss: true});
console.log(plan.mix, plan.losses);
const audio = renderPerformance(plan, mdChip);
```

`importance` accepts 0–1, and `gainDb` accepts −96 to +12 dB. An explicit zero
importance silences a part without removing its source notes or reallocating
its voices. `allowLoss` is still required to omit notes when hardware voices run
out. The policy's automatic attenuation bound refers to role/density trims;
calibration changes hardware controls to achieve those levels and is not an
additional authored gain. An explicitly silent source remains silent.

## Calibration and uncertainty

`MIX_PROFILE_VERSION` identifies the response schema/qualified engine generation.
Factory measurements are bound to compiled chip code and the measurement method
by `scores/mixing/calibration-manifest.json`; CI rejects stale measurements.
An engine/output change requires regeneration and review, and incompatible
published generations must increment the profile version. Do not reuse custom
profiles across SDK releases without requalification.

The factory collection contains 90 sound/voice profiles at 44.1 kHz, with pitch
(or noise-period), duration and control grids. RMS and peak measurements come
from synthetic held notes through the actual driver, chip and output stage at
unity gain. External software amplitude envelopes are applied by the planner,
not baked into the response table. Hardware envelopes remain part of the probe.
The inverse curve maps requested RMS back onto hardware controls. FM retains
fractional precision until carrier attenuation is encoded; Game Boy wave levels
and the NES triangle remain discrete. No extra gain stage changes chip physics.

This is amplitude calibration, not a perceptual loudness model or timbre oracle.
Pitch/duration interpolation, short attacks, release tails, changing duty/waves,
stereo and nonlinear joint mixing can differ from an isolated held-note probe.
The evaluator measures actual full mixes, not a sum of stems. Source NES envelope
observations avoid a second generic software envelope; portable FM observation
still does not recover every held patch change, DAC identity or stereo event.
MIDI retains unsupported events and reports them rather than claiming to play them.

Uncalibrated custom sounds use a disclosed conservative fallback immediately.
To measure one during preparation (for example inside your worker):

```ts
import {calibrateMixInstrument, MixProfileBank, mdChip,
        planPerformance} from 'chipvoice';
const measured = calibrateMixInstrument(mdChip, 'fm1', myInstrument);
const profiles = new MixProfileBank([measured]);
const plan = planPerformance(score, mdChip, {allowLoss: true, mix: {profiles}});
```

The part's explicit `instruments` entry must select `myInstrument`. Cache identity
includes complete sound content, voice, sample rate and profile version; external
software volume tables do not change sound identity. The bank copies/freezes data
and retains at most 64 custom entries. Preparation is capped at 256 probe points
and 64 seconds of simulated note time, never invoked by a live note or audio
callback. Those are work bounds, not a promise of 64 seconds of wall-clock time.
A custom profile covers its exact voice; factory FM/NES pulse aliases have separate
onset-offset measurements. Planning defaults to 44.1 kHz. Set `mix.sampleRate`
to the intended chip-render rate when preparing other rates; an unqualified
requested rate uses fallback profiles. Changing `renderPerformance` sample rate
after planning does not recalibrate the already compiled register controls. A
48 kHz sensitivity experiment is not a 48 kHz factory certification.

Inspect `plan.mix.calibratedNotes`, `fallbackNotes` and `diagnostics`, also included
in `plan.losses`. Calibrated means a response table was found, not that the port
is identical to the original. Targets beyond an instrument's maximum are capped
and disclosed. In particular, the NES triangle cannot be turned down continuously;
a loud NES noise part may exceed the Mega Drive PSG's available level. There is
no promise to preserve every ratio when the hardware cannot realize it.

## Bounded game phrases

`prepareMixPhrase` shares the same policy with `planPerformance`, without audio
rendering or a network judge. Supply already allocated voices, at most 128 notes
ending within two seconds. Bounds are checked before allocating frame arrays. Overlapping notes on one physical voice or a shared resource (Mega Drive PSG3/noise) are rejected. Explicit FM percussion uses an FM voice and keeps its drum pitch under melodic transposition.
The caller keeps its existing APU and transport alive, and schedules the returned
note offsets against its audio clock. A phrase does not allocate future voices or
claim to support arbitrary held notes across phrase boundaries; the game's voice
arbiter owns that integration, including release tails from earlier phrases. A SNES headroom guarantee covers notes prepared together; separately prepared overlapping or contiguous phrases with outstanding tails need a combined preparation window before scheduling any of those notes.

```ts
import {APU, mdChip, instrumentsFor, prepareMixPhrase} from 'chipvoice';
const ctx = new AudioContext(); // create/resume from a user gesture
const apu = new APU(ctx, mdChip);
await apu.init(ctx.destination);
const phrase = prepareMixPhrase(mdChip, [{
  voice: 'fm1', part: 'lead', role: 'lead', at: 0,
  note: 'C4', duration: 0.25, instrument: instrumentsFor('md').lead,
}], {sampleRate: ctx.sampleRate});
const boundary = ctx.currentTime + 0.1;
for (const note of phrase.notes)
  apu.playNote(note.voice, {...note, at: boundary + note.at});
// Prepare the next phrase without resetting this APU.
// Stop authority, effects arbitration and stale-job cancellation stay with the host.
```

The phrase response does not inspect an unknown future song. Instruments and
input notes are not mutated. Worklet processing does not import the mix policy,
perform profile searches or allocate these preparation objects per sample. The
web player retains its existing worker cancellation and audio crossfades; changing
parameters prepares the next buffer while the current buffer continues playing.

## Reproducible evaluation

```sh
pnpm --filter chipvoice build
node scores/mixing/check-calibration.mjs
node scores/mixing/diagnose.mjs .artifacts/automatic-mixing/current
node scores/mixing/check-baseline.mjs .artifacts/automatic-mixing/current/report.json
node scores/mixing/validate-profiles.mjs
node scores/mixing/evaluate.mjs
node scores/mixing/benchmark.mjs
node scores/mixing/ablate.mjs
node scores/mixing/analyze.mjs .artifacts/automatic-mixing/current/report.json
```

Regenerate changed factory measurements with `node scores/mixing/calibrate.mjs`,
then rebuild before checking provenance. Development and held-out source families
are declared in `scores/mixing/contract.json`. Freeze the engine/policy before
running `evaluate.mjs --held-out`; a holdout used to change the algorithm becomes
development data and needs a replacement. Original source ledgers are independent
of the policy; derived note observations are not an independent oracle.

The development-only ablation bundles the candidate with exactly two documented
changes: inferred role weights and density sharing are disabled. Calibration,
explicit author controls and voice allocation remain, with the transformation
and bundle hash recorded separately. It does not modify the SDK or retune the
frozen holdout. `analyze.mjs` adds envelope correlation and coarse spectral
overlap proxies; these are not perceptual masking/click detectors.

Correctness checks cover source accounting, deterministic PCM, invalid/final
clipped samples and internal SNES sum saturation. Acoustic reports separately
include RMS, peaks, crest factor, stereo, attack-envelope summaries and spectrum.
They do not certify subjective preference or prove the absence of perceptual
masking. Same-host interleaved planning measurements isolate policy overhead;
real phone/Safari behavior and controlled human listening require their own evidence.
See the [ordered tickets](AUTOMATIC-MIXING.md) for those explicitly open gates.

## Cold-review corrections and acceptance

The SNES factory palette is dry from 0.16.3 onward. The automatic adaptation
reserves a 120/128 combined voice-volume budget before the DSP's saturating sum,
including release and staggered writes. This replaces the earlier 38-unit budget
for an always-enabled feedback echo. Space is no longer imposed on every note.
Native register playback still supports the complete echo/FIR hardware. Authored
raw echo streams need their own headroom policy. The 30 ms anticipation/recovery,
80 ms release allowance and 12 ms driver staggering remain. Quiet contributions
can fall below a register step (`mix-bus-resolution`). `mix:false` bypasses this
policy; lowering output gain alone cannot prevent internal saturation.

MIDI roles are inferred after reading all notes, using channel, explicit names,
program families, polyphony and pitch register, never the first track's position.
`part.roleInference` exposes confidence and the reason. Ambiguous monophonic lines
remain low-confidence melody candidates. `importMidi(bytes, {parts: {[id]:
{role: 'lead', priority: 100}}})` overrides the inference, including channel-derived
percussion, without deleting original MIDI metadata. The web player's **Review MIDI
roles** panel applies the same correction while the previous audio keeps playing.

The source ledger is the disjoint union of `plan.notes`, `plan.silentNotes ?? []`
and losses with kind `voice-omitted`. A source-silent note is not a hardware loss.
Explicit `mix.importance: 0` remains an author mute with stable allocation.

Run `node scores/mixing/acceptance.mjs` for audible output and bounded velocity/
author-prominence contrasts on five consoles. CI also enforces a 3 dB maximum
off-grid amplitude error for the declared 44.1 kHz lead probes; this is not a
certification of every patch, pitch or duration. The general evaluator now renders
complete performances, including late sections. The held-out corpus additionally
contains counterpoint, long-note expression, program/tempo changes and sparse
percussion families. These tests supplement source accounting and internal
saturation checks; they do not claim universal timbre fidelity or human preference.

## Measured native FM projections

Native FM patch IDs are **not** General MIDI program numbers. A register's base
frequency also need not be the audible fundamental: operator multipliers and
modulation change it. Unmeasured native patches use a neutral role palette and
report `timbre-unmeasured`; the planner never silently renders a patch to guess it.

Prepare reusable descriptors explicitly, outside playback:

```sh
node scores/analyze-fm-timbres.mjs source-performance.json prepared-performance.json
```

`PerformancePart.portableTimbres` maps source instrument keys such as `md:4` to
`PortableTimbre`: source signature, measured pitch offset, a generic target GM
family, a normalized 60 Hz amplitude envelope, source RMS and confidence. The
planner applies it to substitute instruments, preserves source ticks and IDs,
and reports the resulting pitch in `plan.notes`. An explicit target instrument
wins. Source-chip patches and native command replay stay unchanged. Stale
signatures and invalid/beyond-bound descriptors are rejected. Descriptor RMS
provides source balance when a complete response profile is unavailable.

The supplied analyzer renders each distinct FM patch at 220 and 440 Hz. It
compares waveform periods, requires agreement and correlation >= 0.9, samples
0.8 seconds of amplitude, and makes a coarse soft/bright family choice. It is
bounded to 128 patches. Unstable pitch retains zero offset with a diagnostic.
It does not solve arbitrary inharmonic FM, pitch-dependent envelopes, unbounded
sustains or exact sample-bank reconstruction. The final envelope value holds
past the probe. These are measured approximations, not an equivalence proof.

`importVgm` optionally reports `onDacStream(sample, offset)` for PCM seek
boundaries. `scores/extract-dac-percussion.mjs` also finds repeated 32-byte
attacks when samples are concatenated without a seek. It estimates kick/snare
families using waveform crossings, preserves observed timestamps, and reports
quiet candidates below its 4/128 RMS activity floor separately. This heuristic
is intended for DAC percussion streams, not arbitrary sampled speech/music.
The Sonic capture command composes both preparation steps reproducibly.
