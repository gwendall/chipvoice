# Changelog

<p align="center">
  <a href="CHANGELOG.md">English</a> &bull;
  <a href="CHANGELOG_ja.md">日本語</a>
</p>

Notable changes to the `chipvoice` package and the SDK it exposes, newest
first. See [README.md](README.md) for the current quickstart and feature
overview.

## Unreleased

A Game Boy pulse note's trigger (ch1, ch2) keeps the low two bits of its
frequency timer instead of zeroing them, as Pan Docs' "Obscure Behavior"
describes ("When triggering Ch1 and Ch2, the low two bits of the frequency
timer are NOT modified"). A triggered note's first duty step, and every edge
after it, now lands up to 3 cycles later than before. See
[docs/chips/dmg.md](docs/chips/dmg.md#known-deviations) for what of the
remaining gap against the SameBoy oracle stays open.

`validateSong` now diagnoses what a chip cannot do with a well-formed song,
instead of the driver clamping or cutting it in silence. A vibrato that
swings a voice out of its register range or below one register step at that
pitch (`vibrato_range`, `vibrato_resolution`), a vibrato rate the driver's
60Hz frame clock cannot resolve (`vibrato_rate`), a slide that carries a held
note out of range or across a coarse run of a period table - the low end of
the 2A03 and Game Boy tables in particular (`slide_range`,
`slide_resolution`) - and a fractional volume step a chip rounds before it
reaches a register (`volume_step`) are all now reported. So are voice-budget
conflicts: a role sharing a physical voice with another, such as the SID's
chord and percussion both on v3 (`voice_share`), and a drum arriving before
the previous one's own decay has finished on a chip with one shared voice per
kit part, such as the 2A03's single noise channel (`perc_voice`). Every issue
carries `measured` and `limit` alongside its message, including the existing
`pitch_range` and `chord_capacity`. `Issue` gains `voice`, `measured` and
`limit` as optional fields; nothing existing changes shape. No render
changes: these are diagnostics, not fixes.

The SID's filter is now reachable from the arranger's own words, not a
simulated substitute. A lead's `sweep` opens the cutoff across the note; a
bass's `resonant` holds a fixed high resonance; both are low-pass. A voice
sets and clears only its own routing bit in `$D417`; the shared resonance,
cutoff and mode are whichever voice last wrote them, the same arbitration
real hardware has, since the SID has one filter for all three voices. A new
`Instrument.pulseWidth` field gives a per-frame pulse-width sweep at the
driver level; no built-in preset uses it yet. `script-filter` and
`song-filter` join the C64 conformance corpus; parity against reSID-fp holds
at 100%, since the filter is an analog-stage model that never touches the
digital trace the harness compares.

## 0.19.1: Console changes without a dropout

A cold console change in the middle of a song no longer underruns. When the
new source's first block of progressive playback comes back nearly spent, it
is extended with warm contiguous reads until it starts at least 0.75 s ahead
of the playhead. While another source prepares, the one still playing
schedules 3 s ahead instead of 1.5 s, because the cold render competes with it
for the CPU.

`BufferPlayback` is now TypeScript, like `ProgressivePlayback` next to it: its
published declarations type its entries, clock, groups and parts instead of
leaving them `any`. No sound change: every published arrangement renders byte
for byte as with 0.19.0, and the existing APIs are unchanged.

## 0.19.0: A game's own Mega Drive driver

A second Mega Drive driver beside `MdDriver`, for music written for this
machine alone rather than arranged across consoles. The
[native driver guide](docs/MD-NATIVE-DRIVER.md) documents it.

- `compileMdVoices(voices)` drives `fm1` to `fm6` with hard pan and a patch
  per note, `psg1` to `psg3`, the noise channel and a PCM stream on the DAC,
  and refuses what the hardware cannot do.
- `arrangeMdTracker(song, {tailBars, bank})` compiles a text tracker: notes,
  rests, holds, slides, articulations, patches, volumes, drums, echo channels
  and loop points.
- `MD_BANK` ships FM patches, PSG and noise instruments and a synthesized PCM
  drum kit.
- Game-audio helpers render, trim, level and pack sound effects:
  `renderMdEvents`, `trimRender`, `levelRender`, `scaleRender`, `packSprite`
  and `renderOnset`.
- `FmOperator.ssg` sets SSG-EG on either driver; leaving it out keeps the
  previous sound.

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
