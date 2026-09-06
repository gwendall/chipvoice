# Composition controls and recognizable music

<p align="center">
  <a href="COMPOSITION-CONTROLS.md">English</a> &bull;
  <a href="COMPOSITION-CONTROLS_ja.md">日本語</a>
</p>


## Current request / implemented scope

Replace tempo stepper buttons with a native 40–300 BPM slider, visible endpoints
and a synchronized integer input. Keep the existing validated score range and
live playback transport. Pointer gestures and focused keyboard edits form one
Undo group. Partial input remains editable; blur/Enter clamps to the supported
range, and an empty value restores the last valid tempo. Both controls lock
during recording. Expose the reusable primitive in `/lab/components`.

## Composition controls after the cartridge update

- Implemented: transposition, −12 to +12 semitones, with a zero detent and explicit reset.
  Apply to pitched roles, retain chords and leave percussion unchanged. Preserve
  the original score so repeated movement cannot compound rounding or clipping.
- Swing: 50–75%, with 50% labelled straight. This requires an SDK timing field
  shared by real-time playback, recording, export and register capture. Do not
  add a cosmetic slider that affects only the browser or changes beat duration.
- Implemented: drum activity, 0–100% of the current groove, deterministic and reversible. Strong kick/snare beats are retained first. Timbre/role locks continue to govern the separate variation buttons.
- Per-role level: useful for composing a balance, but it must be serialized in
  the score and share export behavior. Keep global listening volume separate.

Instrument families, musical keys and rhythmic patterns are discrete choices:
buttons or selects express them more clearly than an arbitrary numeric slider.
The listening lab remains a fixed-recording comparison tool; changing the pitch
or playback rate of its reference audio would compromise those comparisons.

## Sources found on 2026-09-06

- [Alfred: Super Mario Series for Piano](https://www.alfred.com/products/super-mariotm-series-for-piano-00-38600): licensed piano arrangements; a musical reference, not original register data.
- [Alfred: The Legend of Zelda Series for Piano](https://www.alfred.com/products/the-legend-of-zeldatm-series-for-piano-00-38601): includes the main theme, Lost Woods, Gerudo Valley and Song of Storms.
- [Musicnotes: Green Hill Zone, Piano Music Bros.](https://www.musicnotes.com/sheetmusic/piano-music-bros/green-hill-zone/MN0244710): an identified arrangement of Masato Nakamura's composition.
- [VGLeadSheets: Green Hill Zone](https://www.vgleadsheets.com/view/sonic-the-hedgehog/green-hill-zone): community melody/chord transcriptions suited to arrangement research; transcription accuracy should be checked against the original music.

Suggested first comparison set: Mario overworld (articulation and syncopation),
Zelda main theme (held melody and harmonic support), Green Hill Zone (bass and
rhythmic drive). These now ship as longer source melodies (50/24/24 bars), without generated backing; see [the source workflow](../scores/README.md).

Use a single reviewed canonical score with melody, bass, harmony and percussion,
then the existing five-console orchestrators. Keep notes, tempo, excerpt length
and loop boundaries fixed in comparison mode. A separate arrangement mode could
exploit each machine more freely, but would answer a different question.
Piano reductions and lead sheets are reference material: they are not full
original multitrack scores. Record transcription provenance and any reductions.

Before adding any repertoire, inspect its rhythm against the score format:
current tokens sit on a sixteenth-note grid. Unsupported tuplets, meter changes
or tempo maps must be reported or supported explicitly, never silently quantized.
Evaluate the canonical notes independently, then compare full loops and isolated
roles on all five engines with the existing replay/native checks and listening
protocol. Familiarity helps listening judgments; it does not replace DSP tests.

Source PDFs and MIDI files are local research inputs. The shipped cartridge recipes contain short adapted phrases and newly arranged supporting parts. Availability
of sheet music is evidence of a usable reference, not evidence of permission to
redistribute an adaptation in the public demo. Track publication permission as
part of each cartridge's provenance rather than assuming the sheet-music or
transcription site's code license covers the composition.
