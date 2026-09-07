# Zelda Overworld selection regression — 2026-09-07

<p align="center">
  <a href="ZELDA-SELECTION-2026-09-07.md">English</a> &bull;
  <a href="ZELDA-SELECTION-2026-09-07_ja.md">日本語</a>
</p>

## Cause and correction

PR #38 selected displayed NSF track 2 (zero-based 1) and labelled it Overworld.
Both our recording and the independent reference played that wrong subsong.
Matching their commands proved emulation consistency, not the identity of the song.
The user's report was correct; this was our source-selection error.

The pinned NES NSF's Overworld is displayed track 3 (zero-based 2). Its source
hash remains `ebd279307c158b9561c254e55eaf683c3ea65736d1303144ed56ff89a92a0364`.
The capture now includes its intro and one complete 1,920-frame loop:
38.1705 seconds total, loop starting at 6.2231 seconds (frames 373–2293).
The portable observation contains 592 notes across the four original voices.

## Identity before parity

A reviewed phrase beginning at beat 16 of the separate Colletti MIDI reference
(`scores/references/zelda.json`) has pitch classes
`10, 5, 10, 0, 2, 3, 5, 6, 8, 10, 8, 6`, with adjacent repeated attacks collapsed.
The new gate decodes pulse-register timer writes directly, independently of
our portable note observer, and requires that phrase before capture/publication.

The actual previous source failed both the musical reproduction and the added
`pnpm arrangements:check` assertion. Scanning the first 1,800 frames of all
15 music subsongs found this phrase only in displayed track 3. The corrected
source passes; an unrelated authentic Mario recording fails. The fixture is
also checked against the independently reviewed MIDI phrase.

This is a catalogue-specific identity check. It tolerates octave differences,
but retains key and note order; it does not prove every rhythm, instrument,
phrase or physical output characteristic. Full-source parity is a separate gate.
Track selection is shared by capture and oracle verification, and publication
checks bind the manifest to that selection.

## Independent verification

A fresh pinned Game_Music_Emu build captured track index 2 independently. All
18,137 musical register commands match addresses, bytes, order and absolute CPU
cycles. The ordered-command SHA-256 is
`ffea3e7c6cdcd83e89647ee6210c6dcd9cd2db3ba4bbf0687fd2544712506a21`.
The full 1,920-frame command loop also repeats exactly. The older track-2 oracle
is not reused. Reproduction commands are in the [arrangement guide](../../scores/arrangements/README.md).

## Qualification

The four Zelda recordings and independent reference are regenerated from the
correct source. Publication binds source identity, chosen track, oracle,
recording hashes and decoded durations. Browser regression checks the served
native source's musical identity, the evaluated recording's hash, the 0:38
transport duration, and actual audible A/B output. Desktop/mobile screenshots
and video accompany the browser run. The first 12 seconds of native/reference
spectrograms were also inspected at unchanged source timing. Both recordings
have the opening lead peak at 465.7 Hz (0.1–0.45 s FFT, about B-flat 4); this
spot check supplements, rather than replaces, the phrase and full-command gates.

Local evidence lives in `.artifacts/zelda-selection/` (red/green check logs,
subsong scan, fresh capture and evaluation) and `.artifacts/native-songs/browser/`
(screenshots, video and browser output measurements). Downloaded NSF executables
and native oracle builds remain local. The previous report's Zelda identity
claim is explicitly withdrawn; Mario and Sonic evidence is unchanged.
