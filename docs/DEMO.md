# The playable library demo

Product specification, 2026-09-05. Agreed direction from the project audit and
the following product discussion. Decision 20 updates decision 19. The
[backlog](BACKLOG.md#phase-8-the-site-as-an-instrument) tracks delivery; the
[audit](AUDIT-2026-09-05.md) records defects and evidence.

## Purpose

chipvoice.dev is a playful, immediately usable demonstration of the library.
Someone who does not write music should enjoy exploring it. A developer should
be able to take the sound they made into their own project.

The product is a small musical console: listen, change machine, trigger effects,
change the music, share it, reveal how it works. No account is required to play
or create a draft. The instrument occupies the first screen; documentation and
account management are secondary.

The characteristic interaction is hearing the same passage on five machines,
then seeing and hearing a sound effect borrow a voice from the music.

## First visit

1. A short, composed preset is already loaded. An explicit Play button starts
   it. Merely focusing a field or opening a menu does not start the song.
2. NES, Game Boy, Mega Drive, SNES and C64 are visible selectors. Changing
   machine keeps the musical position and the current edits.
3. Four musical roles animate with the music: lead, chords, bass and drums.
4. Jump, Coin, Laser and Explosion pads trigger sound and a small visual action.
   When an effect borrows a voice, the display shows the actual interruption
   and return of music.
5. The visitor mutes a role, changes a timbre or edits a few notes, then shares
   the result or copies its score and runnable code.

## V1: the whole experience, kept small

### Five machines and three cartridges

Keep all five selectors visible and selected state unambiguous. A switch keeps
the transport position; a stopped song stays stopped. Handle loading and rapid
repeated switches without overlapping players or obsolete async completions.

Ship three excellent short presets with contrasting moods. Working names such
as Overworld, Boss Fight and Midnight are examples, not required final copy.
All play on every machine. Preserve recognizable musical material for useful
comparison while allowing the arrangers to use each machine's idiom. Additional
machine-specific compositions can follow.

### A living display

Show a lane per musical role with note height, duration and playback position.
Each role has a stable visual identity across machines, and mute/solo controls.
Machine identity can change the display accent without recoloring every role.

Distinguish musical roles from hardware voices: four roles do not imply four
independent voices, particularly on C64. Show sharing truthfully. A meter must
reflect measured audio levels; a note animation can reflect scheduled musical
events but must not be described as a measured waveform.

Small geometric characters are an optional treatment for the lanes, not an
additional feature gate. Movements respond to music and stop with it. Respect
reduced motion; retain readable note and voice-ownership state without motion.

### Arcade effects

Four large, labeled pads: Jump, Coin, Laser, Explosion. Mouse, touch and
documented keyboard shortcuts trigger them. Every supported machine gets
appropriate instruments. Sound and visual feedback respond to the same event.

Use a small scene or brief display actions to make effects tangible. This is
not a full game. The essential demonstration is audible voice stealing and
recovery. Held repeats and more elaborate scene behavior are later polish.

### Simple music creation

The initial state is a working tune. An Edit control reveals pitch-by-height
editing for melody and a simple step grid for drums. The selected pattern is a
view into the complete score; other patterns, order, chords and intents survive.
Offer timbre choices per role from the existing intent catalogue.

Audition notes on touch. Provide a scale-assisted mode and retain access to
chromatic notes. An eight-note touch/keyboard palette is the initial live
audition surface; recording that performance into the loop is a later slice.

Use a readable overview plus a sufficiently large editing area on phones.
Sixteen steps is a useful musical unit, not permission to shrink every target
to fit. Scrolling and pinching must not paint notes accidentally. Provide
keyboard activation/navigation, undo/redo, and automatic local draft recovery.
The raw text/tracker view remains an advanced option; text can be temporarily
incomplete while the user types, with validation before applying it.

### Share and reveal the library

Share reopens the complete edited song on the chosen machine. Make publication
distinct from a local draft. A title or account prompt does not precede playing.

"View code" reveals the current portable score and a minimal runnable library
example, with the machine and intent preserved. Offer Copy score, Copy code
and audio download. Verify that the example and export reproduce the arranged
song. V1 captures score edits, not an unrecorded live SFX performance; do not
imply otherwise in the share interface.

Define the engine/arranger/profile identity behind an audio asset. Keep stable
song links while versioning rendered bytes or explicitly revalidating mutable
audio. An immutable cache must never hide a different render under the same
asset identity. Preserve stereo where appropriate and identify the correct
machine in metadata.

## Visual direction

A compact, tactile musical object: large controls, clear pressed states, a dark
animated display, strong but controlled color, and readable labels. Pixel art
belongs in small display details rather than every label. Animation communicates
sound, ownership and interaction. Avoid decorative motion disconnected from the
music, a long marketing introduction, or a wall of technical controls.

The exact shell color, illustration treatment and geometry are implementation
choices to validate on the first working screen. They are not a reason to delay
the audible prototype. Keep the existing framework and audio cores.

## Build order

### A. Repair the two foundations the demo depends on

- Preserve a complete score through API load, editor state, playback and fork.
  A title-only edit changes no musical field. Keep immutable publications intact.
- Make scheduled musical commands cancellable with explicit ownership. Stop
  remains silent; pending music cannot overwrite an effect; restoration after
  the effect is defined. Account for registers shared across voices.
- Add focused regressions that observe resulting register writes/audio and
  score content. Make the conformance command fail on a missing baseline.

These are bounded repairs, not a general engine rewrite. Once they pass, build
the visible instrument immediately.

### B. Deliver the first playable screen

Three presets, explicit Play, five machine switches, four reactive lanes and
four effect pads. Keep position during switches and make the actual voice
interruption visible. Check browser audio lifecycle, first interaction and
phone controls on the production build.

### C. Complete the V1 loop

Simple editing, intent controls, audition palette, undo/redo, draft recovery,
sharing, code/score export and coherent audio downloads. Repair text entry as
part of editing. Add the critical web journeys to CI with a temporary database.

Measure first sound, machine comparisons, edits, effects and shares from the
first playable slice, without collecting score contents or personal identity.
Supplement counts with observed user sessions; numerical targets follow a
baseline rather than being invented in advance.

### D. Expand after testing the demo

The first follow-up implements **tap recording**: Record starts playback when
needed, then note-palette and drum taps overdub the nearest sixteenth on the
audio clock, captured on pointer/key press rather than release. Recording spans
the song order, including unequal/repeated patterns.
One take is one Undo action; draft recovery saves captured edits as they arrive.
The backing score keeps playing unchanged until Finish take, when the updated
score is loaded once. The display follows that backing score during capture.
Tempo, machine, mute/solo and direct score replacement are locked during a take;
role and audition scale may change. Stop, Undo and leaving the tab finish capture.
Arcade effects remain live listening controls, not recorded score events.

Taps use the existing grid's duration convention: a note lasts until the next
note/cut. Held-key duration, free-time audio recording and a metronome/count-in
are not part of this first recording interaction. No schema migration or extra
runtime dependency is needed. `Chip.quantizedPosition()` exposes the same grid
position calculation to library callers.

- Quantized live recording and overdubbing from the eight-note palette.
- "Surprise me": vary melody, drums or timbres, lock roles, undo the result.
  Begin with authored/rule-based variations; no remote AI dependency for play.
- Richer arrangements: SNES triads, FM drums, SID filter controls. Expose real
  chip capabilities rather than a generic effect that only looks equivalent.
- MIDI input, stems and export of one song on all five machines.
- Additional cartridges and effects, then new systems based on demonstrated use.

## Other audit work

Do not make an account-system rewrite a prerequisite for the anonymous musical
demo. Before relying on sign-in/library recovery, separate stable user identity,
API keys and browser sessions; consuming a login link must not invalidate an
agent's API key. Track this alongside rendering limits, migrations, low-rate
offline scheduling and documentation consistency as explicit audit follow-ups.

Prioritize work affecting V1's audible behavior, score integrity and shared
output. MIDI, a full game, a full DAW, collaboration, a large gallery, broad DSP
rewrites and new chips are outside V1. No frontend feature claims that a known
underlying audio defect has been fixed merely because its animation works.

## Acceptance

- A new visitor can start sound, compare machines and trigger an effect without
  an account, a tutorial or knowledge of note names.
- Switching machine preserves score and musical position. Stop produces no
  later musical restart. An effect's displayed ownership matches the sound.
- Loading a multi-pattern score and changing only its title preserves all
  musical fields in the fork. Playback and export use that same score.
- Touch scroll does not edit; controls work by keyboard; editing is usable on
  a phone; text entry preserves what is typed; undo and reload recovery work.
- Shared links and copied runnable code reproduce the current arranged song,
  within the documented render-version contract.
- Automated checks cover these consequences on a production build. Measure
  audio/register output for transport tests, not only UI flags or `canPlay()`.
- Inspect Chromium, Firefox and Safari audio behavior, and touch interaction on
  a real phone before claiming broad browser/mobile support. Record any limits.

The V1 demonstration should make a non-musician want to press another button
and a developer want to copy the code.

## Creative and API follow-up acceptance

The next consolidated slice covers P8-23, P8-11, P8-12 and AUD-1/2/4/5/6:

- Seeded local variations preserve locked roles and allow a single Undo.
- Optional MIDI requests access only on Connect; accepted taps share recording,
  ignore note releases, map channel-10 drums, and stop after disconnect.
- Cancellable worker exports provide WAV, aligned isolated stems, all five
  machine renders and supported VGM, with a score included in ZIP bundles.
- Public audio has finite duration/concurrency/cache/rate bounds and conditional
  GET, and cached bytes cannot revive a deleted publication.
- Account ownership survives browser login, key replacement and key revocation;
  concurrent magic-link redemption has only one winner.
- Legacy/fresh database migration and rollback-on-error are tested; public JSON
  does not expose account IDs or credential secrets.
- Arrangement diagnostics name unrepresentable base pitches/arpeggio extremes;
  documents distinguish shipped arrangements, future work and physical evidence.

Physical MIDI/phone latency, representative CPU/GC numbers, distributed quotas,
new chip implementations and P8-13's richer arrangements remain separate work.
