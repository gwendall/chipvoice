# Continuous playback and a public listening lab

<p align="center">
  <a href="CONTINUOUS-PLAYBACK-LAB.md">English</a> &bull;
  <a href="CONTINUOUS-PLAYBACK-LAB_ja.md">日本語</a>
</p>


The demo and listening lab share a persistent Play intent. Editing tempo,
instruments, score or console must prepare the new sound while the old one
continues, preserve musical phase, then use a short audio-clock crossfade. Stop
wins over pending loads. Rapid edits coalesce; stale work cannot take over and
live transitions use at most two chip engines. Recording keeps its backing take.

The public `/lab` uses the site's paper, hardware and display palette, shared
navigation, machine selector, buttons and panels. It publishes an explicitly
versioned evaluation snapshot: three presets, five consoles, role isolation,
level-matched synchronized A/B, native SNES reference, masked identities,
observations and downloads. It does not run expensive conformance/rendering on
page load or represent historical evidence as live CI. Audio loads on demand.
A small component catalogue documents shared states; Storybook is deferred until
its additional tooling serves a larger component collection.

The local evaluation command remains the authoring/verification source and its
standalone player must also retain Play through selection changes. Publishing
checks source hashes and technical passes, losslessly compresses/deduplicates
assets and records provenance. CI does not regenerate the audio corpus.

Verification: reproduce tempo stop and lab selection reset before fixing;
exercise rapid updates, pause during load, failures, mute/solo, SFX and recording;
measure audio-clock output for transition gaps using a continuous-note fixture;
check musical phase including fractional steps; preserve offline chip goldens;
inspect desktop/mobile screenshots and keyboard behavior; test the production
build, review, then publish in one PR where practical.

## Implementation and publication

`LivePlayback` owns a stable output and serializes chip handoffs. `Chip.phaseAt`
reads the scheduled fractional position without advancing the audible playhead;
`Chip.play(song, position, at)` schedules an incoming engine on that same clock.
The old engine remains audible during initialization and is disposed after the
60 ms fade. The scheduler skips already elapsed percussion and accounts for the
remaining fraction of the sixteenth, including shared SID chord/drum segments.

`BufferPlayback` is shared by the React lab and generated standalone reports.
Its decoded cache holds at most eight recordings. Incoming loads are abortable;
stale results are discarded. Failed replacements preserve the current sound.
Pair changes retain normalized loop phase and both A/B sources start together.
`Fade` supplies the same audio-clock ramp behavior to both playback modules.

The UI shares tokens, navigation, machine selection and buttons. The visual
catalogue is `/lab/components`; no extra component runtime or Storybook build is
needed for this initial collection.

Publish an evaluated report with:

```sh
pnpm --filter chipvoice-web publish:lab .artifacts/listening/NEW/report.json
```

The command refuses failed/incomplete evidence, verifies every WAV hash, encodes
FLAC and verifies decoded 16-bit PCM equality. Identical recordings share one
file. The checked-in initial snapshot is 17 MiB (96 unique recordings), fetched
on demand; its manifest identifies engine `377636b` and the original report hash.
This evidence is historical: updating the live engine does not silently re-label
it. The original local evaluation files remain immutable and uncompressed.

Sources: [Web Audio codec guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs),
[AudioParam ramps](https://developer.mozilla.org/en-US/docs/Web/API/AudioParam/linearRampToValueAtTime).

## Regression evidence

The continuous-note browser probe measures the shared output in 128-sample
audio-clock blocks. Three tempo changes and NES → SNES retain the exact
fractional position and produce zero near-silent blocks (peak threshold 1e-5).
The assertion requires zero milliseconds; it does not tolerate a short dropout.
This is a deterministic continuity check, not a claim that arbitrary timbre
changes produce identical waveforms.

The probe exposed a separate startup bug: register initialization offsets were
anchored at AudioContext time zero when creating a replacement engine later.
Anchoring them at creation preserves SNES startup delays. A regression renders
the same note at origins zero and two seconds and requires identical relative
PCM; before the fix the maximum sample difference was 0.04544. Offline goldens
for the five consoles remain unchanged.

Additional regressions cover a failed stale engine followed by a newer console
request, reuse of stopped engines, recording backing identity, volume set before
the first Play, interrupted buffer loads, and the four-source overlap bound.
Publication rejects incomplete collections and repairs corrupted cached FLAC
files only after checking their decoded PCM against the verified source WAV.
Browser runs save desktop/mobile screenshots, videos and measured audio results
in `.artifacts`; CI uploads these without rendering a new evaluation corpus.
