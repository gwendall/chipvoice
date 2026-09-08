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

## Application playback session

The web layout owns a single `PlaybackSession`; pages attach audio adapters and
release their UI ownership on unmount. The selected adapter survives navigation
and pause. A replacement remains muted while preparing; only a ready explicit
Play request takes ownership. The previous adapter is paused, and detached
resources are retired after their release fade. Merely visiting an editor never
changes the audible track. No route UI tree is kept mounted to preserve sound.

`PlayerControls` is the common transport for arrangements, the listening lab,
the live loop editor, the full composer and published revisions. The fixed bottom
player exposes the same position, restart, repeat and volume controls, with a
compact expandable mobile view. Seek uses seconds and reads the engine's audible
clock. Animation updates isolated DOM nodes instead of publishing a React state
update on every audio frame. Adapter capabilities hide unavailable controls.

Three implementations remain intentional: `BufferPlayback` for prepared A/B
recordings, `ProjectPlayer` for worker-rendered projects, and `LivePlayback` for
pads, recording and immediate note audition. Published songs stream their saved
revision through an HTML media element with custom controls; they are not rendered
again in the browser. Only the chosen publication's details/audio are requested.
Explore, library and artist cards seed a simple queue from the displayed results;
a natural end advances once, while repeat holds the current song. A comparison
clears the queue, and blind identity/download masking persists across routes.
The loop editor can open its existing score in the full composer without changing
the notes or restarting audio merely because the route changed.

The session is scoped to one browser tab. Reloading/closing the tab ends it;
playback cannot be restored automatically around browser autoplay restrictions.
Failed incoming recordings leave the old song playing and report the error.
The local component catalogue includes idle/loading/compact transport examples.

Tests: `apps/web/test-player-session.mjs` exercises ownership, races, failures,
resource retirement and queues through the session interface.
`apps/web/test-player-browser.mjs` checks actual audio-context continuity across
Next navigation, passive editor entry, published WAV playback, creator attribution,
queue completion, desktop/mobile/Japanese layouts and blind comparison navigation.
Existing engine and transport tests retain audio-clock, phase, pending-pause,
recording, MIDI and canvas-touch coverage. Screenshots live under `.artifacts/player`.

## Progressive interactive playback

Since SDK 0.18.0, the web composer uses `new ProjectPlayer({preview: true})`. This opt-in SDK mode compiles the same project and renders the same chip cores as offline export, but schedules bounded PCM blocks as they become available. It does not encode/decode a complete WAV before playing. `previewMetadata` exposes duration, native status and mix results; `losses` works in both playback modes. `prepared` remains `null` in preview mode. Use `prepareProject()` or `renderProject()` explicitly when you need a downloadable file.

```js
import {ProjectPlayer} from 'chipvoice';

const player = new ProjectPlayer({preview: true});
// Call play from a user gesture to unlock browser audio.
void player.play();
await player.load(project);
await player.update({tempoScale: 1.25});
player.setTitle('New title'); // Metadata only; no audio preparation.
```

The player keeps the current sound during preparation, preserves Play/Pause intent and follows the audio output clock. A warm worker and bounded variant/PCM/checkpoint caches accelerate repeated edits and seeks. Cold mid-song changes still need to reconstruct DSP history: an emulator's envelopes, samples, filters and echo cannot be restored from note positions alone. Browser audio unlock, uncached network assets and device latency remain real costs. Default `ProjectPlayer()` keeps the existing whole-buffer behavior for compatibility.

