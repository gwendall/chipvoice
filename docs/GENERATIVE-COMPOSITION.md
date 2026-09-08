# Generative composition

<p align="center"><a href="GENERATIVE-COMPOSITION.md">English</a> &bull; <a href="GENERATIVE-COMPOSITION_ja.md">日本語</a></p>

**Status: server integration, prompt UI and agent delivery implemented; first real Astra trial passed (2026-09-08).** Deployment qualification and live evidence are recorded in [PR #50](https://github.com/gwendall/chipvoice/pull/50). The implementation reuses ordinary song hosting.

## Product decision

Song hosting already exists. Add **prompt → model → ordinary `MusicProject`**, then reuse the existing artist, private save, render job, WAV/MP3 storage, song page, editor and explicit sharing. Store the prompt as owner-only metadata and expose the creation method/model on accessible songs, outside the musical source hash. Do not add a second gallery, audio store, score format, account system or scheduler.

The initial adapter calls GPT-6 Astra through the OpenAI Responses API. Configuration uses server environment variables. The provider interface has one `generate` method; another provider can implement it without changing project storage or the lightweight SDK. Only the OpenAI adapter is implemented; compatibility with every model is not promised.

## Implemented contract

See [Local prompt composition](LOCAL-COMPOSITION.md) for setup, examples, exact bounds and reproducible evaluations. The generated OpenAPI and `/skill.md` describe the configured-server API.

| Route | Behavior |
| --- | --- |
| `POST /api/v1/generations` | Authenticated prompt, discovered target, 10–90-second duration, loop intent and optional owned artist; required idempotency key |
| `GET /api/v1/generations/{id}` | Authorized progress, prompt/model, usage, evaluation and normal project/render references; polling advances eligible stages |
| `DELETE /api/v1/generations/{id}` | Cancel unfinished composition and rendering |

Owner accounts use existing credentials. Agents need `generate`, `projects:write` and `render`; existing grants are not upgraded automatically. One model call returns strictly structured notes, named parts, instruments and dynamics. The server compiles a normal `Performance`, validates the full allocation with `allowLoss:false`, evaluates the opening two seconds, saves with the requested visibility (private by default) and runs the usual full-song render. There is no automatic model repair. Public posting requires an explicit visibility choice. PATCH on the existing project changes visibility without copying its score or audio.

Identical retries reuse the same job, including after failure. Concurrent requests cannot dispatch the same job twice. Unknown interrupted model outcomes fail instead of automatically spending again. Daily owner admission, model concurrency, response/token/note limits, cancellation, revocation and deadlines bound work. This is not a monetary accounting system: configure the provider budget before shared deployment. Polling/callback execution has the same cooperative limits as existing render jobs.

## Evidence and limits

A simulated HTTP provider E2E exercises the real adapter request, strict validation, concurrent idempotency, normal database/render storage, WAV/MP3, browser playback, owner-only prompt, desktop/mobile screenshots, quota, busy-worker resumption, cancellation, revocation and provider failures. CI does not spend model credits.

The opt-in live evaluation sends one real configured-model request, saves editable source and full audio, measures complete PCM and decodes MP3. The real local Astra trial produced “Starwake Courier”: 60 seconds, four parts, complete stereo MP3 and no PCM clipping. Integration fixtures do not prove model compatibility or musical taste.

`ready` means source validation and full render succeeded. The HTTP acoustic report covers only the opening two seconds; it does not certify complete-song balance, musical development, prompt fit, original-game fidelity or a seamless loop. The model may produce invalid or unconvincing music. These limits must remain clear in agent documentation and UI.

## Delivery order

Keep the earlier ticket identifiers for continuity; the acceptance scope is simplified here.

| Tickets | State and next action |
| --- | --- |
| GEN-02, GEN-06–08 | Local adapter, normal song saving, bounded execution and three routes implemented; first real local Astra trial passed |
| GEN-01, GEN-05 | Compare a small varied set of original prompts, record latency/usage and listen to the complete songs; expand the benchmark only when useful |
| GEN-03 | Extend shared evaluation to whole-song acoustic checks, including late clipping, silence and endings; keep musical judgment separate |
| GEN-04 | Deferred: add a bounded repair call only if measured failures justify it, preserving exact candidate source and cost visibility |
| GEN-09 | Implemented: prompt form in `/create`, artist/duration controls, progress/reload/cancel, preserved editor draft and links to the saved song |
| GEN-10 | Skill/OpenAPI and downloadable client implemented; agent/API/browser qualification is described in the creator journey report; broader budget and musical qualification remain separate |
| GEN-11–12 | Later: targeted immutable revisions and evaluated console variants, using the existing project lineage and source identity |
| GEN-13 | Public release only after real musical and operational evaluation; green fixture tests alone do not launch paid inference |

The [creator journey](evals/CREATOR-JOURNEY-2026-09-08.md) verifies author attribution, creation method, visibility and complete MP3 delivery. Direct submission records the route used, not proof of human-only authorship. Keep the core emulator fidelity and deterministic adaptation work independent of this optional composition layer.
