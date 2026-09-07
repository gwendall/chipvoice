# One playground, a complete musical transport

<p align="center">
  <a href="UNIFIED-PLAYGROUND.md">English</a> &bull;
  <a href="UNIFIED-PLAYGROUND_ja.md">日本語</a>
</p>


User specification, 2026-09-06. Supersedes the melody-only first-visit default.

- `/` opens with Mario's complete native Famicom arrangement; Zelda and Sonic
  retain every source part. Four Japanese console marks, no public C64 selector.
  Never invent chords, bass or drums to fill a fixed four-track template.
- Songs, consoles, part isolation, MIDI import, tempo and transpose belong to this
  same instrument. `/lab` retains technical listening tests; `/lab/arrangements`
  redirects home. The per-note evidence report is not needed to open the player.
- Play/pause retains position. Restart, elapsed/total time, an accessible full-song
  seek slider and score-click seeking make the entire composition navigable.
  Loop can be disabled; native loops skip the intro after the first traversal.
- Console, tempo, transpose and solo changes preserve musical position and play
  intent. A new song or imported file starts at its beginning. Old audio keeps
  playing during preparation; the latest request wins and Pause stays paused.
- The visual cursor follows the audio output device, including output latency,
  after seeking, resuming and replacing a recording. Source notes omitted by an
  allocation do not flash as if they were sounding. No decorative cursor easing.
- Make a loop exposes the existing editor, keyboard, pads, recording, undo, code,
  export and sharing in this page. Switching modes gives audio to one instrument
  at a time. Drafts and hash/published links retain their formats. Existing drafts
  are restored when entering the composer; a shared hash enters it directly.
- Explain JavaScript sound-chip emulation immediately. Distinguish native Mario, Zelda and Sonic
  command verification from portable observation, MIDI transcription and cross-console instruments.
- Local MIDI import acknowledges the file immediately, reports preparation and
  real rendering progress, preserves errors and never uploads the MIDI.
- Evaluate the production build end to end, including real output RMS, source
  clock versus DOM cursor, first load, pause/seek/restart/loop/end, console/tempo,
  composer handoff, legacy editor and shared-link regressions, long MIDI and
  screenshots/video at desktop and 320/390/768 px.

## Design decisions

The complete-arrangement engine consumes polyphonic `Performance`; the creative
tracker keeps its four-role `SongDocument`. These are deliberately not converted
lossily into each other. The visible mode switch owns which one can play. The
arrangement session remains mounted (paused) while composing, retaining imports
and playback position; the composer's local draft survives its unmount.

`BufferPlayback` owns decoding, bounded source overlap, crossfades, phase, seek,
end and loop. A bounded history of numeric timing segments covers rapid seeks
whose output has not reached the device yet. It does not retain old audio nodes.
The decoded-buffer cache remains bounded to eight entries.

The timestamp clock uses `getOutputTimestamp()` extrapolated to the current
animation frame; when unavailable it uses the reported base and output latency.
A timestamp already includes output delay, so latency must not be subtracted
again. See [MDN's timestamp contract](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp).
Browser estimates cannot certify unreported external speaker/Bluetooth latency.
No wall-clock render benchmark is inferred from this busy development machine.

Build-time projections provide a light catalogue and static note views, including
per-console voice omissions. Worker variants produce the same projection. The
score is rasterized once per resize/selection; animation moves one cursor and
checks each part with a binary search over note intervals. Heavy full evidence,
source expressions and native register streams are loaded only when needed.
