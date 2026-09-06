# Japanese console playground evaluation

<p align="center">
  <a href="JAPANESE-PLAYGROUND-2026-09-06.md">English</a> &bull;
  <a href="JAPANESE-PLAYGROUND-2026-09-06_ja.md">日本語</a>
</p>


## Scope

First-visit Mario default; familiar melodies before composition tools; Japanese
console marks in their source colours; C64 hidden from shared pickers; explicit
JavaScript emulation explanation and About page; first-interaction sound.
No score notes, DSP, SDK release or published listening corpus changed.

## Method

`apps/web/test-arrival.mjs` runs seven independent fresh-browser journeys: tune
selection, console selection, Play, keyboard activation, touch, tempo entry and
mute. It checks the initial score, image loading, four accessible logo-only
buttons, silent passive load/Tab, selected console, actual output RMS and Stop
persistence after subsequent tune/console/tempo changes. It also restores and
plays a saved C64 document and follows the About navigation. The mute-first case
must start silently before unmuting. Chromium and WebKit both passed locally.

The existing composition browser check measures all 12 public classic/console
combinations. Five-chip score/compiler checks retain all 415 reference notes;
the hidden C64 remains part of those technical checks. The held-note audio-clock
probe measured **0 ms transition silence** while changing tempo and console,
with identical fractional musical phase at each handover.

Desktop and 390 px touch layouts were captured and visually inspected. The
first screen exposes the project explanation, familiar choices and Play. Console
logos use two columns on mobile to keep the Famicom wordmark legible. No horizontal
overflow was observed. Navigation, source credits and About remain accessible.

Run browser audio suites sequentially on a busy host: simultaneous Chromium and
WebKit runs produced one failed instantaneous Sonic amplitude measurement; the
same journey passed in isolation. Do not classify host contention or a written
musical rest as an emulation regression. The existing lossless lab check waits
for its loading state rather than assuming that a network recording arrives in
1.3 seconds.

## Reproduce and evidence

- `pnpm --filter chipvoice-web build`
- `pnpm --filter chipvoice-web test` — owns a production server and temporary DB.
- `BROWSER=webkit SITE=http://127.0.0.1:<port> node test-arrival.mjs` from `apps/web`.
- `.artifacts/japanese-playground/{chromium,webkit}/`: initial/stopped/About
  screenshots, interaction videos and measured `result.json`.
- `.artifacts/composition/`: 12 classic adaptation measurements and lab captures.
- `.artifacts/continuity/live-audio.json`: sample-clock continuity evidence.
- `.artifacts/demo/` and `.artifacts/lab/`: full interaction regressions.

CI uploads the new arrival evidence alongside the existing demo evaluation.
The SVG source manifest is `apps/web/public/machines/README.md`; all four downloaded
files parsed as SVG with no executable nodes or external resource references.

Two independent reviews (Spec and Standards), including the final first-gesture
state delta, found no blocking discrepancy. The autoplay policy is deliberately
limited to the musical console: passive load and navigation links stay silent.
The lab retains explicit Play and lazy lossless loading for controlled comparison.
