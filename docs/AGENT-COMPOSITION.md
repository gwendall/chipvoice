# Composing with an agent

For scoped agent authorization, separate artist profiles, HTTP evaluation before publication, MP3 sharing and grouped console versions, see [Artists and agents](ARTISTS-AND-AGENTS.md).

<p align="center"><a href="AGENT-COMPOSITION.md">English</a> &bull; <a href="AGENT-COMPOSITION_ja.md">日本語</a></p>

Chipvoice accepts a complete arrangement, not just a melody. Use a versioned `MusicProject` with a `Performance` source for independent instruments, polyphonic chords and exact timing. [The agent skill](https://chipvoice.dev/skill.md) is the executable entry point; [llms.txt](https://chipvoice.dev/llms.txt) is its short discovery index. The compact tracker service remains a separate compatibility path.

## Discover the actual engine

Fetch [capabilities](https://chipvoice.dev/api/v1/capabilities) before selecting a target. The catalogue contains the engine version, project schema, voices, allocator conflicts, unavailable Performance voices, and generic melodic programs grouped by identical instrument behaviour. General MIDI programs are **zero-based**, from 0 to 127. A group is an approximation, not a claim to reproduce a game's original patch bank or a realistic orchestra.

For each program/role, `voices` lists eligible destinations and whether they preserve the selected instrument. Fallback PSG placement may replace an FM patch. `pitchHz` reports base register representability before modulation; `null` means unknown. `voiceConflicts` identifies distinct IDs that cannot occupy the same interval. Do not sum all listed voices into a universal polyphony promise. Rendering and its diagnostics decide whether a specific arrangement fits.

The JSON and skill table are built from the current project targets, `ChipSpec`, `performanceInstrument`, `performanceVoices`, `instrumentFitsVoice` and `pitchRange`. Build-time imports of internal helpers are intentional; they are not additional public SDK exports. Machine-specific facts do not live in a second handwritten table. The content hash identifies the capability document, not audio or a source-game reference.

## Compose parts, then allocate voices

A **part** is a musical line such as melody, strings or bass; a **voice** is one physical sounding resource. Several parts may have the same role. A triad requires three simultaneous voices; a triad plus melody and bass needs five pitched voices, before percussion. The number of instruments used over a song can exceed simultaneous polyphony if they alternate.

For an original piece, define a mood, tonal centre, tempo, phrase structure and foreground. Write a recognisable motif, develop an answering phrase, change texture across sections and resolve or loop intentionally. Add bass, countermelody and percussion only when they serve that idea. Preserve rests. Avoid doubling every melody note, placing dense chords below the bass, or maximising all velocities. These are useful starting points, not a genre-independent quality score.

`priority` protects a part's notes during voice allocation; higher values win even against earlier held notes. It does not set loudness. `mix.importance` controls prominence between 0 and 1, `mix.gainDb` is author trim and note velocity is expression. Automatic mixing uses calibrated responses where available and reports conservative fallbacks. It cannot make every arrangement sound good or defeat a hardware amplitude limit.

On a small machine, explicitly reduce redundant doublings, alternate fills with sustained accompaniment, use two-note harmony or write an arpeggio with timed notes. The Performance allocator **does not automatically compose arpeggios**. Keep canonical source notes intact and save target reductions separately, with the transformation documented. For a transcription, add only verified source parts; MIDI is not proof of original-game instruments.

## Run an original ensemble

Install `chipvoice` in a new directory, copy [compose-project.mjs](examples/compose-project.mjs), and run `node compose-project.mjs TARGET`, using a target ID from the catalogue. The same executable source appears in the skill. It writes an original eight-bar, six-part chamber theme to `project.json`, renders `preview.wav`, and records `evaluation.json`. The title describes an orchestral texture; the generic palette is deliberately synthetic.

The example uses 480 ticks per quarter note and 500000 microseconds per beat (120 BPM). Each note has an exclusive end tick. The source has melody, three-note strings, brass accents, a later countermelody, bass and percussion. Dynamics, phrase changes and rests are authored explicitly. It publishes nothing.

For audition the example enables `allowLoss`; inspect its report before sharing. With `allowLoss=false`, voice omissions fail rendering, but other substitutions still need inspection. Select a target dynamically, rerender and compare the report. Do not simply enable loss acceptance to silence a rejected arrangement.

## Evaluate before sharing

1. Validate source structure and semantics with `validateProject` or HTTP `/api/v1/validate`.
2. Render with `renderProject` in Node/a worker or `prepareProject` in the browser. Read losses and mix diagnostics; retain the report alongside the exact source and engine/sample rate.
3. Count omissions by part. A melody omission is usually more serious than a redundant string doubling. Inspect pitch limitations, timbre substitutions and uncalibrated mix. Make one reasoned change at a time.
4. Check finite PCM, RMS, clipping, duration, dense passages, releases and loop boundaries. Repeated identical input should produce identical bytes at the same engine/sample rate. Different consoles should sound different.
5. Listen to the complete mix and isolated parts. If only signal measurements are available, report that limitation. Determinism and schema validity cannot certify musical taste.
6. Publish only an accepted arrangement, preserve credits, and state any target reductions. Original-game fidelity additionally requires an independently identified native reference.

The HTTP job response contains status, progress and the pinned audio URL; it does not currently include the local arrangement/mix report. Keep that report yourself. See [creation contracts](CREATION.md) for native playback policy, cancellation, audio persistence and resource limits.

## HTTP requests and tool discovery

`POST /api/v1/validate` accepts the **raw project**. `POST /api/v1/projects` accepts `{project, visibility, parentId?}`, requires Bearer/session authentication and an `Idempotency-Key` header. Keep a key for identical retries; changing the source, visibility or parent requires a new revision/key. Start a preview/full job, poll at a modest interval, stop on failed/cancelled and download only after ready. Honour `Retry-After`. A conflict is not an instruction to blindly create another publication.

The [OpenAPI document](https://chipvoice.dev/.well-known/openapi.json) describes exact requests/responses. The historical `/.well-known/mcp.json` URL is an **HTTP tool-discovery manifest**, not an implemented JSON-RPC MCP server. Manifest version 0.2.0 separates `path`, `query`, `headers` and `body`, preserving the complete body schema. An adapter must bind these locations and configure auth separately. This prevents an idempotency header becoming a project field or a project wrapper being sent to validation.

Only the legacy `/api/songs` path permits anonymous publication and returns MP3 links. Complete project publication requires an account and pins ready WAV bytes. Keep secrets outside files committed to Git, never execute another author's stored generator and do not treat the software licence as permission to republish imported music.

## Adding another console

First implement and qualify the engine, driver, palette/resource rules and project schema admission for the new target. `projectCapabilities()` is the authoritative list of targets supported by the project facade; registering a low-level chip alone does not promise complete-project support.

Once a target enters that list, the catalogue, skill voice table, discovery endpoint and evaluation target loop include it automatically. Unknown pitch ranges remain explicitly unknown. Extend the engine's resource/palette helpers if the hardware needs new rules; do not hide exceptions in documentation. Add oracle/audio qualification and musical fixtures for its unique behaviour. `test-agent-guide.mjs` includes a synthetic additional target to check documentation discovery, not to certify an unimplemented emulator.

Changing examples or instructions reruns the executable-document test. It extracts the JavaScript from the served skill, executes it without accessing implementation internals, follows the HTTP requests against a disposable database and checks published/pinned playback. Separate adversarial cases verify overload reporting and an explicit reduction. This is a deterministic agent-workflow rehearsal, not an independent language-model benchmark or proof of subjective musical quality.
