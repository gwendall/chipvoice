# Changelog

<p align="center">
  <a href="CHANGELOG.md">English</a> &bull;
  <a href="CHANGELOG_ja.md">日本語</a>
</p>

Notable changes to the `chipvoice` package and the SDK it exposes, newest
first. See [README.md](README.md) for the current quickstart and feature
overview.

## 0.18.0: Progressive interactive playback

The web composer uses `new ProjectPlayer({preview: true})`. This opt-in SDK
mode compiles the same project and renders the same chip cores as offline
export, but schedules bounded PCM blocks as they become available. It does
not encode/decode a complete WAV before playing. `previewMetadata` exposes
duration, native status and mix results; `losses` works in both playback
modes. `prepared` remains `null` in preview mode. Use `prepareProject()` or
`renderProject()` explicitly when you need a downloadable file.

```js
import {ProjectPlayer} from 'chipvoice';

const player = new ProjectPlayer({preview: true});
// Call play from a user gesture to unlock browser audio.
void player.play();
await player.load(project);
await player.update({tempoScale: 1.25});
player.setTitle('New title'); // Metadata only; no audio preparation.
```

The player keeps the current sound during preparation, preserves Play/Pause
intent and follows the audio output clock. A warm worker and bounded
variant/PCM/checkpoint caches accelerate repeated edits and seeks. Cold
mid-song changes still need to reconstruct DSP history: an emulator's
envelopes, samples, filters and echo cannot be restored from note positions
alone. Browser audio unlock, uncached network assets and device latency
remain real costs. Default `ProjectPlayer()` keeps the existing whole-buffer
behavior for compatibility.
