import { endpointRows } from "./openapi";
import { SITE } from "./songs";
import catalog from "../../generated/agent-catalog.json";
import example from "../../generated/agent-example.json";

export function skillMarkdown(): string {
  const endpoints = endpointRows()
    .map((r) => `| \`${r.method}\` | \`${r.path}\` | ${r.summary} |`)
    .join("\n");
  const targets = catalog.targets
    .map(
      (t) =>
        `| \`${t.id}\` | ${t.system} | ${t.voices.map((v) => `${v.id} (${v.kind})`).join(", ")} | ${t.voiceConflicts.map((pair) => pair.join(" / ")).join(", ") || "None declared"} |`,
    )
    .join("\n");
  return `---
name: chipvoice
description: Compose, import, arrange, evaluate and publish complete multi-instrument music for emulated retro sound chips. Exact-tick projects, machine capabilities and explicit adaptation reports.
compatibility: HTTP discovery and publication require a network client. Local composition and rendering require Node.js and the chipvoice npm package. Publishing projects requires an account key.
homepage: ${SITE}
metadata: {"version":"0.11.0","updated":"2026-09-08","engineVersion":"${catalog.engineVersion}","author":"gwendall"}
---

# Compose complete music with chipvoice

Use **MusicProject version 1 with a Performance source** for new multi-instrument music and MIDI imports. Parts are independent musical lines; roles (lead, chord, bass, perc) describe their purpose, not a four-part limit. Each part can contain overlapping notes. Physical voices are limited by the selected chip.

Create locally without an account. Publish only when asked, with an authenticated account. A valid project or a deterministic render does not prove musical quality or fidelity to an original game. Generic programs are approximations, not a complete orchestral sample library.

## Discover before composing

1. GET ${SITE}/api/v1/capabilities: supported targets, current engine version, actual voices, resource conflicts, generic instrument mappings and the project JSON Schema. Do not hard-code the number of consoles.
2. GET ${SITE}/.well-known/openapi.json: exact bodies, path/query/header parameters, authentication and response schemas.
3. Use ${SITE}/create for interactive editing, ${SITE}/docs for SDK examples and ${SITE}/explore for public music.
4. Detailed guide: https://github.com/gwendall/chipvoice/blob/main/docs/AGENT-COMPOSITION.md (Japanese: AGENT-COMPOSITION_ja.md).

The catalogue is generated at build time from the same chip definitions, palette and allocation helpers as the renderer. Its contentHash identifies this capability document. It is not an original-game audio fingerprint.

| Target | System | Declared voices | Shared resource pairs |
| --- | --- | --- | --- |
${targets}

Read each target's melodicPalette: programs are zero-based General MIDI numbers. voices lists eligible destinations; preservesInstrument=false means fallback substitution. pitchHz is the base register range before modulation; null means unknown. excludedPerformanceVoices may exist in raw/native APIs without being allocated by Performance. percussionVoices describes the generic drum path, not every custom patch. A voice count is not a promise that all combinations fit. The planner's report is decisive.

## Compose deliberately

- Decide an original musical brief: mood, form, tempo, tonal centre, foreground and supporting lines. Develop complete phrases and an ending or intentional loop. Vary rhythm, register and instrumentation across sections.
- Write melody, harmony, bass, counterpoint and percussion only when useful. For transcriptions, preserve identifiable source parts and rests; never invent backing or claim a repeated fragment is the full source.
- One chord tone consumes one voice. A held triad plus melody plus bass consumes five pitched voices before drums and counterpoint. Instrument names do not create additional hardware.
- Use priority to protect musically essential notes when voices run out; higher values win. Priority is allocation order, not volume. mix.importance (0–1) controls prominence, mix.gainDb is an explicit trim, velocity (0–127) is note expression. Lower priority does not automatically lower volume.
- Keep melody intelligible, avoid unnecessary unison doubling and crowded low-register chords, and leave rhythmic space. These are starting points, not universal genre rules. Automatic mixing cannot repair a poor arrangement.
- On constrained targets, make an explicit adaptation: remove redundant doublings, alternate accompaniment with fills, use two-note voicings or write a timed arpeggio. The Performance allocator reports omitted notes; it does not invent arpeggios or choose an artistically optimal reduction.
- Percussion uses note.drum: 35/36 kick, 38/40 snare, 46 open hat; other keys currently use the generic closed-hat fallback. Preserve imported keys, but do not claim a complete GM drum kit.
- Inspect the catalogue for each build. Sample voices can suggest chamber/orchestral textures, FM voices offer synthetic timbres, pulses have a narrow palette. Realistic strings/brass or a game's exact patches require appropriate explicit instruments/sample memory; a GM number alone does not provide them.

## Exact source units

Performance has version, title, ticksPerBeat, endTick, tempos, parts and notices. All ticks are absolute integers, not milliseconds. At ticksPerBeat=480, one quarter note lasts 480 ticks. microsecondsPerBeat=500000 means 120 BPM. Note endTick is exclusive and must exceed tick. An intentional rest is the absence of notes, not a fake zero-velocity voice. Distinct part IDs and per-part note IDs make losses traceable.

Each part needs id, name, role, priority and notes. Set part.program for its default instrument; note.program overrides it. Notes need id, tick, endTick, pitch (MIDI semitones), velocity and optionally drum or absolute-tick expression. Do not attach origin to an original GM composition: native patch IDs have different semantics.

Project settings select chip, mix ('auto' or 'authored'), allowLoss, tempoScale, transpose and gain. Full contracts and limits: https://github.com/gwendall/chipvoice/blob/main/docs/CREATION.md.

## Executable original ensemble

In a new directory run npm install chipvoice@${catalog.engineVersion}. Save the following JavaScript as compose.mjs and run node compose.mjs TARGET, using a target ID from the catalogue. It writes project.json, preview.wav and evaluation.json. The eight-bar source has six parts; overlapping strings consume separate voices. No network publication occurs.

\`\`\`js
${example.trim()}
\`\`\`

The example deliberately enables allowLoss for **audition**, so it runs on small machines and reveals their compromises. Read evaluation.json before sharing. For strict production, set allowLoss=false; voice omissions then reject rendering. This flag does not reject every timbre substitution or certify fidelity.

## Evaluate and iterate

1. Validate the complete source. POST /api/v1/validate takes the **raw project**, not {project}. SDK validateProject works offline.
2. Render an audition with renderProject, or prepareProject in a browser worker (progress/cancellation). Read plan.losses and plan.mix; prepared results expose losses and mix too. HTTP jobs currently expose status/progress/audio, not the full arrangement report: retain your local evaluation.
3. Count omissions by part, identify substitutions, out-of-range and uncalibrated-mix diagnostics. Protect the melody and intentional bass line. Do not hide warnings by merely setting allowLoss=true.
4. Make one explicit musical change, record why, and rerender. Keep the original project as the canonical source and target-specific reductions as separate documents with attribution.
5. Check finite samples, non-silent RMS, clipping, complete duration, section transitions and endings. Compare identical inputs at the same sample rate/engine for determinism. Bit equality across different engines or consoles is not expected.
6. Listen to the full mix and isolated parts, especially dense passages. Measurements do not measure taste. If no listening tool is available, say that auditory judgement remains unverified.
7. For an existing game, compare against an independently identified native reference. Imported MIDI is a transcription, not proof of original instruments or register timing. Untouched native projects preserve original commands; transposition, tempo changes or part isolation create adaptations.

## Validate, publish and render over HTTP

Save the source as project.json. These commands use jq for response extraction. Use a Bearer key already provided by the user; never put it in source control or output it in logs. Read auth routes below if an account needs setup; sending a login email is a separate user-authorized action.

\`\`\`bash
set -eu
# CHIPVOICE_API_KEY must already contain the user's account key.
: "\${CHIPVOICE_API_KEY:?Provide an account key through the environment}"
API_BASE="\${CHIPVOICE_URL:-https://chipvoice.dev}"
# Validate the raw project. A 422 response contains path/code/message/level issues.
curl --fail-with-body -sS "$API_BASE/api/v1/validate" \\
  -H 'Content-Type: application/json' --data-binary @project.json

# Keep this file for retries of THIS revision. For an intentional new revision,
# choose a fresh working directory or remove request-key.txt before running.
if [ ! -s request-key.txt ]; then
  node -e "console.log(require('node:crypto').randomUUID())" > request-key.txt
fi
REQUEST_KEY=$(cat request-key.txt)
jq '{project: ., visibility: "unlisted"}' project.json > publication.json
curl --fail-with-body -sS "$API_BASE/api/v1/projects" \\
  -H "Authorization: Bearer $CHIPVOICE_API_KEY" \\
  -H "Idempotency-Key: $REQUEST_KEY" \\
  -H 'Content-Type: application/json' --data-binary @publication.json > published.json
PROJECT_ID=$(jq -r '.id' published.json)
curl --fail-with-body -sS "$API_BASE/api/v1/projects/$PROJECT_ID/render" \\
  -H "Authorization: Bearer $CHIPVOICE_API_KEY" \\
  -H 'Content-Type: application/json' --data '{"kind":"preview"}' > job.json
JOB_ID=$(jq -r '.id' job.json)
ATTEMPTS=0
while [ "$ATTEMPTS" -lt 300 ]; do
  STATUS=$(jq -r '.status' job.json)
  case "$STATUS" in
    ready) break ;;
    failed|cancelled) jq '{status,error}' job.json; exit 1 ;;
    queued|rendering|cancelling) ;;
    *) echo 'Unknown job state'; exit 1 ;;
  esac
  sleep 1
  curl --fail-with-body -sS "$API_BASE/api/v1/jobs/$JOB_ID" \\
    -H "Authorization: Bearer $CHIPVOICE_API_KEY" > job.json
  ATTEMPTS=$((ATTEMPTS + 1))
done
[ "$(jq -r '.status' job.json)" = ready ] || { echo 'Polling deadline reached; retain the job ID'; exit 1; }
curl --fail-with-body -sS "$API_BASE/api/v1/jobs/$JOB_ID/audio" \\
  -H "Authorization: Bearer $CHIPVOICE_API_KEY" -o published.wav
\`\`\`

Never assume the ready state immediately. queued, rendering and cancelling are nonterminal; ready, failed and cancelled are terminal. Owner polling also advances the cooperative queue. Honour Retry-After on 429/503; retain the same idempotency key for uncertain identical publication retries. A 409 means a conflicting key/body or state: inspect it, do not blindly change keys and duplicate a publication. A 401 needs authentication; a 422 needs corrected input.

public appears in Explore; unlisted is accessible by link; private is owner-only. To remix, GET the accessible project's full document, edit a copy, and publish with parentId set to the original ID. Source/ready audio are immutable; publishing another revision gets another ID. Software licensing grants no rights to imported music. Keep source credits and set the music's reuse licence deliberately. Never execute somebody else's stored generator code.

Server bodies are capped at 4 MB. preview covers at most 30 seconds; full source is bounded to ten minutes, while server output additionally has a 40 MB ceiling and 240-second worker deadline. Full WAV can fail before ten minutes. This is a bounded cooperative queue, not an unlimited render farm. Browser preparation retains prior audio during updates and applies ready buffers with a crossfade; it is not zero-latency live synthesis.

## Compact legacy songs

The existing /api/validate and /api/songs endpoints accept a different format: bpm, patterns, order, optional chip, title, author and intent. Each pattern has equally long lead/chord/bass/perc token strings and chordShape. Four steps per beat is the default; stepsPerBeat:12 supports triplets. Notes use C4/F#3/Bb2; '.' holds, '=' cuts; percussion uses K/S/H/O. The bass token count determines pattern length. A mistyped note is silent in direct legacy playback, so validate before publishing.

Legacy /api/songs can publish anonymously and provides MP3/WAV URLs. Complete /api/v1/projects requires authentication and pins WAV through jobs. Their bodies, ownership and audio persistence differ: do not mix them. Preserve an existing compact Score with projectFromScore; do not flatten a polyphonic Performance into tracker lines. See OpenAPI for the complete legacy schema. Revalidated legacy audio URLs can change after an engine deployment; only ready project renditions are pinned to stored bytes.

## Endpoint reference

| Method | Path | Purpose |
| --- | --- | --- |
${endpoints}
`;
}
