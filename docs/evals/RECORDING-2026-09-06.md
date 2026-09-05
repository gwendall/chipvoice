# Loop recording evaluation — 2026-09-06

Follow-up to the playable demo merged in PR #20 (`340fe12`). Scope: P8-10,
quantized note/drum overdubbing and one-take history. The product contract is
in [DEMO.md](../DEMO.md); ownership and timing are in decision 25.

## Behavior checked

- Record starts playback if needed. Note keys and touch/mouse presses capture
  the nearest sixteenth at AudioContext input time, with half steps rounding
  forward. The animation frame does not supply the timestamp.
- A deterministic sequencer test covers startup, half-step boundaries, unequal
  pattern lengths, repeated order entries, loop wrap, Stop and a suspended timer.
  Another 700 clock probes compare against an independent arithmetic grid.
- Pure document tests cover untouched roles/patterns, metadata, shared repeated
  patterns, no-op edits and invalid positions. Inserted chords preserve the
  later chords' voicings and unused authored chord shapes.
- The browser records melody and drums in one take. It checks the entire edited
  score against the actual input positions, observes zero backing `play()` calls
  during capture and one on Finish, and measures sound afterwards. One Undo and
  one Redo restore the complete before/after documents.
- A second interrupted take survives reload through local draft recovery.
  Reload neither rearms recording nor starts audio. Copy-link, publication and
  title-only fork journeys retain the full recorded score.
- The mobile journey records one note per touch, uses the adjacent Undo take
  control, restores the entire prior document and checks page overflow.
  Keyboard audition, editor input and reduced-motion paths remain covered.

## Qualification and artifacts

Production build, typecheck and the complete library unit suite passed. All
five existing song goldens remain unchanged. The production API/browser suite
passed in Chromium, WebKit and Firefox, including pointer-press capture and
mobile one-take undo. CI runs the complete Chromium journey and the existing
five-chip conformance/ROM/mixer qualification.

The export journey checks a stereo WAV byte for byte against a fresh library
render of the recorded document. The WebKit fixture is 44.1 kHz, two channels,
6.667 seconds: normalized peak 0.9317, RMS 0.1661, zero full-scale PCM samples.
These are fixture measurements, not a guarantee about arbitrary compositions.
Live output on all five chips is measured with an analyser; Stop remains silent.

Desktop/mobile recording screenshots and a mobile video frame were inspected:
the active recorder, tap count, disabled backing controls, ownership display
and scrollable chromatic palette remain readable. Persistent review images:
[desktop](recording-desktop.png), [mobile](recording-mobile.png).
The harness also writes full videos, per-engine reports and exported WAVs to
`.artifacts/demo/`; CI retains these in its `demo-evaluation` artifact.

## Limits and diagnosis

An initial Chromium attempt failed its existing NES amplitude assertion before
recording began. An isolated probe observed a running context, silence before
the first scheduled beat, then nonzero output (peak about 0.37). A separate
native-click probe timed out. The full Chromium rerun passed with the original
audio threshold and native interactions; no audio workaround or assertion
relaxation was introduced. These observations do not establish a unique cause
for the first failure. A later cold-start run also observed zero output before
the clock was ready. The harness now waits for the first audible timeline
position before measuring startup output; the amplitude threshold is unchanged.

The first CI run passed desktop recording/export and all five-chip conformance
checks, but its new mobile journey could not find C#4 after tapping Chromatic.
The isolated touch journey and full Chromium rerun passed locally. An explicit
chromatic-mode assertion localized the second CI failure to the palette tap.
Retained failure screenshots showed the grid continuing from column 3 to column
5 after synthetic `touchEnd`: the compositor fling had not finished. A tap
during that motion stops the fling instead of activating the next control.
The gesture check now waits for the grid's `scrollend` event before tapping
Chromatic, then verifies the mode before arming recording. Failure screenshots
and explicit context closure preserve diagnostic videos on assertion errors,
instead of losing the failing page. No product audio or control workaround
was introduced for this harness sequencing issue.

The host is heavily loaded, so these runs establish functional results rather
than representative latency, CPU or GC numbers. WebKit and touch emulation are
not a physical iPhone test. Actual-device timing, interruption, scroll/pinch
and observed human usability sessions remain open in P8-9/P8-14.

This captures grid taps, with existing next-note/cut duration semantics. It
does not capture held-key duration, arcade SFX, MIDI or an audio performance.
Repeated order entries intentionally share edits to their underlying pattern.
