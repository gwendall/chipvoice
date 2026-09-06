# Complete arrangements and repeatable console porting

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


The [arrangement lab](https://chipvoice.dev) is available from the
playground and listening lab. It keeps the whole source arrangement, offers each
part separately, and reports the cost of fitting it onto another console. The
older melody editor remains available for compact tracker compositions.

| Piece | Complete source coverage | Verification |
| --- | --- | --- |
| Mario · Ground Theme | Native NTSC introduction + one 5,184-frame loop; 88.5375 s; four voices, 1,276 extracted notes/hits | 41,999 music writes match independent Game_Music_Emu execution at the exact absolute CPU cycles |
| Zelda · Overworld | Colletti MIDI, all four parts; 592 notes; 38.9147 s | Independent mido ledger: every part, pitch, onset, release, velocity, program and tempo event |
| Sonic · Green Hill Zone | Turret 3471 MIDI, all fourteen parts; introduction and both main cycles; 2,367 notes; 91.45 s | Independent mido ledger, same checks as Zelda |

Mario is a native-source reconstruction. Zelda and Sonic are complete **MIDI
transcriptions**, not verified original-game instruments. The source JSON records
the source URL, author/description, checksum, exact ticks and remaining notices.
No bass, chord, drum or arpeggio is automatically composed to fill a missing part.

## The interface

```ts
import {importMidi, planPerformance, renderPerformance, toWav, snesChip} from 'chipvoice';

const score = importMidi(midiBytes, {title: 'My arrangement'});
// Review score.notices and score.parts before publishing.
const plan = planPerformance(score, snesChip, {allowLoss: true});
console.log(plan.losses); // explicit omissions and timbre/hardware concessions
const wav = toWav(renderPerformance(plan, snesChip));
```

`Performance` complements `Score`; existing tracker documents, API payloads,
drafts and shared songs do not change. It carries exact integer ticks, a tempo
map, independent parts, polyphonic note intervals, velocity, program and timed
expression. Source MIDI channel events are retained for future adapters.

`importMidi` accepts SMF 0/1 with PPQ timing. It handles running status, overlapping
notes, channel-wide program/volume/expression, pitch bend and RPN bend range,
sustain and all-notes-off. It rejects truncated files, bad status/data, unmatched
releases, unclosed notes/pedal, zero-duration notes, SMPTE timing and format 2.
Input is bounded to 8 MiB, 256 tracks and 250,000 channel events; performances have
at most 100,000 notes, expanded MIDI expression is capped at 200,000 points,
and renders at most ten minutes. Controller fan-out is checked before expansion. Nothing executes MIDI data
as code. Unsupported controllers, aftertouch and SysEx configuration are reported;
pan, modulation-wheel interpretation and game-specific samples are not silently
claimed as reproduced. MIDI parsing and rendering stay in replaceable browser workers. MIDI text is read
as UTF-8 first; invalid UTF-8 falls back to Windows-1252 with an explicit notice.
This supports common Western legacy files without claiming universal encoding
detection. Original names are preserved, with channel numbers distinguishing
repeated names in the UI.

Automatic role inference is a draft. Supply reviewed `parts` options by returned
track/channel ID, or edit the returned part's role/priority. Source note IDs survive
allocation, making every omission traceable. A larger priority reserves intervals
first, so an earlier low-priority chord cannot occupy the future melody's voice.
No source note is shortened or stolen mid-note. Allocation uses binary interval
lookup; encoding happens afterward in time order because chip drivers cache state.
All eight SNES DSP voices can carry pitched notes.
Register selectors and their data remain atomic on the bus, including the shared
Mega Drive FM frequency latch. Delayed transactions preserve hardware spacing;
the maximum added delay is reported explicitly. The source checker independently
decodes the generated SNES/FM register destinations and compares every byte to
the driver's intent. Finite, unclipped audio alone cannot detect a wrong register.
The Mega Drive's PSG3 is reserved for its noise clock. The DMC is not a generic
pitched voice. Soloing happens **after allocation**, retaining the same omissions.

By default, exceeding the voice budget throws. `allowLoss: true` is an explicit
choice to accept the returned omissions. Other loss entries identify generic
GM-family instrument substitutions, hardware envelope constraints and out-of-range
pitch/bend. There is no claim that matching a GM program recreates the game's patch.
Custom reviewed `part.instruments[chipId]` (or `[chipId + ':' + program]`) override
the palette. Score expression is applied; an optional palette's extra vibrato,
arpeggio or slide is reported as omitted instead of embellishing the source.

Render in a worker for interactive use. Compilation and full-file rendering are
offline operations; this interface is not a real-time MIDI-input synthesizer.
The audio cores and their per-sample paths are unchanged.
`renderPerformance(plan, chip, {onProgress})` optionally reports the completed
frame fraction (0–1) after each offline block. The worker publishes at most one
update per integer percent. The deck shows the pending filename, preparation
stage, real rendered percentage, elapsed time and whether playback will start
automatically. A displayed title is not evidence that audio is ready.

## Reproduce source import

```sh
pnpm --filter chipvoice build
pnpm arrangements:import song.mid new-arrangement.json reviewed-options.json
# The optional settings file contains {title, parts: {"track-1-ch-1": {role, priority}}}.
# Output creation is exclusive: it cannot accidentally replace a reviewed source.

python3 -m venv .artifacts/arrangement-tools
.artifacts/arrangement-tools/bin/pip install -r scores/requirements.txt
.artifacts/arrangement-tools/bin/python scores/arrangements/extract-midi-reference.py \
  song.mid > .artifacts/independent-reference.json
pnpm arrangements:check
```

The independent Python ledger is for the frozen Zelda/Sonic sources. It deliberately
rejects sustain-bearing sources until their reference methodology is reviewed;
the SDK's sustain behavior has separate hand-authored integration tests. References
are never regenerated by CI or by compiling the candidate. Mutation tests remove
or add parts/notes and alter pitch, timing, velocity, program and tempo; every
mutation must fail. The CLI checker also accounts for every source note across
the four visible consoles, either allocated once or present in the omission report.
This verifies scheduling intent, not the acoustic pitch after hardware quantization.

## Reproduce the native Mario reference

Use the exact NSF identified by `mario.json`'s source hash. NSF/ROM source bytes and
the independent emulator build remain in local artifact storage; they are not
bundled in the website or npm package. The software license does not relicense
the compositions, source transcriptions or game data. Preserve credits and review
redistribution rights when adding a new source.

```sh
python3 scores/arrangements/native-oracle.py source.nsf .artifacts/arrangements
node scores/arrangements/capture-mario.mjs source.nsf .artifacts/arrangements/reproduced
node scores/arrangements/compare-native.mjs .artifacts/arrangements \
  .artifacts/arrangements/reproduced/mario-native.json
```

The native tool builds pinned Game_Music_Emu revision
`fe8da4b6d3876d7542c2fb69d94487e19836d678` with a logging-only APU patch and renders
independent PCM. `captureNsf` uses our separate test CPU to execute unbanked NTSC
NSF v1; banked files, expansion audio, unsupported hardware reads/writes and
undocumented instructions fail explicitly. It is not a universal NSF player.

Mario's legacy 16666 µs header is interpreted as NTSC video timing, matching GME.
The entire repeated 5,184-frame musical command cycle is checked. The reference
ledger pins all music commands after the first PLAY; initialization follows the
explicit NSF reset recipe and is not counted in the 41,999 comparison. A checksum
match covers addresses, bytes, ordering **and exact absolute cycles**, without
time warping, pitch rounding or arbitrary alignment.

Native Famicom playback uses those unchanged commands. For porting, an offline
observer samples effective hardware envelope/timer state at 240 Hz and preserves
hardware note attacks. Leading/trailing silent envelope portions are trimmed;
this avoids starting a Game Boy noise envelope at zero. That observer uses our
core and is **not independent evidence**. The untouched command stream is the
native truth; portable expression and target instruments are adaptations. A separate
reviewed checksum protects that portable extraction against accidental changes,
without presenting it as an independent musical oracle.

## Evaluate and publish a snapshot

```sh
pnpm arrangements:check
pnpm arrangements:eval
node scores/arrangements/verify-publication.mjs
```

Evaluation runs sequentially. It renders all twelve complete mixes twice, checks
exact PCM repeatability, finite/unclipped output and SNES internal dry/echo-add
headroom, then writes lossless FLAC and the report under
`apps/web/public/arrangement-data/`. Intermediate WAVs stay in `.artifacts`.
The reference manifest binds the exact NSF, pinned emulator revision, track,
sample format, complete PCM and write trace to frozen checksums. The publication
verifier checks the twelve-case matrix, current engine/source/evaluation identity,
reference provenance, full decoded duration and lossless FLAC-to-WAV identity.
It runs in the regular web CI suite; incomplete or stale assets cannot qualify.
The original reference is the independent GME render, with its own filter and
resampler. Different PCM does not invalidate exact register evidence. This is
not a recording of a physical console and not a universal musical-quality score.
The existing chip-conformance suite separately qualifies the digital cores.

The public deck loads recordings only after an interaction. Tempo, transpose,
solo and imported MIDI render in a replaceable worker; superseded jobs terminate,
the currently audible recording remains, and the latest completed selection
crossfades into the same musical phase. A parameter change immediately cancels
any pending decode, before its replacement is ready, so stale audio cannot commit.
Import failures keep the current music and a persistent, actionable error.
Stop remains authoritative during loading.
The native introduction plays once; playback loops at the source's loop start.
Short 3 ms playback-only tapers suppress recording-boundary clicks; downloadable
recordings and reference PCM are unchanged. A/B uses synchronized clocks and
attenuation-only RMS matching. Reference comparison is disabled for edited tempo,
transpose or solos. The UI never treats an edited version as the original capture.

## Explicit remaining limits

- Full native Zelda and Sonic instrument validation needs their own independent
  game references and game-specific mappings. MIDI program verification alone is
  insufficient. Those records remain labelled as transcriptions.
- A four-channel console cannot reproduce Sonic's fourteen source parts at once.
  The full source is retained, but adaptation can omit notes. The report is the
  authoritative per-note accounting; a ratio is not an authenticity percentage.
- Imported MIDI roles and GM-family timbres need review. Unsupported expression
  is retained/reported for future adapters; it is not silently synthesized.
- Full arrangements currently have their own lab/player and JSON/SDK workflow.
  The four-role tracker editor and publication API continue using `Score`.

### Long MIDI import regression

```sh
# CI uses a generated 82.5-second MIDI, without shipping a user's file.
SITE=http://127.0.0.1:3074 node apps/web/test-midi-import.mjs
# Optional local reproduction; the file is parsed in the browser, not uploaded.
SITE=http://127.0.0.1:3074 MIDI_FILE=/absolute/path/song.mid \
  MIDI_CHIPS='Famicom,Game Boy,Mega Drive,Super Famicom' \
  node apps/web/test-midi-import.mjs
```

The test waits for visible progress and actual rendering/decode completion, then
measures browser output. It also checks Stop while preparing, legacy track labels,
mobile loading layout and browser errors. Screenshots/video/results are written to
`.artifacts/midi-import/e2e/` and uploaded by CI.

## Unified playground transport

The full arrangement deck is now the homepage. `/lab/arrangements` redirects to
`/`; technical engine comparisons stay at `/lab`. Playback supports pause/resume,
restart, full-song seeking (slider or score), and optional looping. Native Mario
repeats after its introduction. Console/tempo/solo changes preserve source-time
phase. **Make a loop** opens the existing creative tracker with its saved draft.
See [the interaction and timing specification](../../docs/UNIFIED-PLAYGROUND.md).
