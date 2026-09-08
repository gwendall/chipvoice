# Generative composition

<p align="center"><a href="GENERATIVE-COMPOSITION.md">English</a> &bull; <a href="GENERATIVE-COMPOSITION_ja.md">日本語</a></p>

**Status: local integration implemented, real-model qualification pending (2026-09-08).** This replaces the earlier, larger proposed pipeline following the user's request to keep the implementation simple. No production OpenAI key is configured by this change.

## Product decision

Song hosting already exists. Add **prompt → model → ordinary `MusicProject`**, then reuse the existing artist, private save, render job, WAV/MP3 storage, song page, editor and explicit sharing. Store the prompt and model as owner-only server metadata, outside the musical source hash. Do not add a second gallery, audio store, score format, account system or scheduler.

The initial adapter calls GPT-6 Astra through the OpenAI Responses API. Configuration uses server environment variables. The provider interface has one `generate` method; another provider can implement it without changing project storage or the lightweight SDK. Only the OpenAI adapter is implemented; compatibility with every model is not promised.

## Implemented contract

See [Local prompt composition](LOCAL-COMPOSITION.md) for setup, examples, exact bounds and reproducible evaluations. The generated OpenAPI and `/skill.md` describe the configured-server API.

| Route | Behavior |
| --- | --- |
| `POST /api/v1/generations` | Authenticated prompt, discovered target, 10–90-second duration, loop intent and optional owned artist; required idempotency key |
| `GET /api/v1/generations/{id}` | Authorized progress, prompt/model, usage, evaluation and normal project/render references; polling advances eligible stages |
| `DELETE /api/v1/generations/{id}` | Cancel unfinished composition and rendering |

Owner accounts use existing credentials. Agents need `generate`, `projects:write` and `render`; existing grants are not upgraded automatically. One model call returns strictly structured notes, named parts, instruments and dynamics. The server compiles a normal `Performance`, validates the full allocation with `allowLoss:false`, evaluates the opening two seconds, saves privately and runs the usual full-song render. There is no automatic model repair or public posting.

Identical retries reuse the same job, including after failure. Concurrent requests cannot dispatch the same job twice. Unknown interrupted model outcomes fail instead of automatically spending again. Daily owner admission, model concurrency, response/token/note limits, cancellation, revocation and deadlines bound work. This is not a monetary accounting system: configure the provider budget before shared deployment. Polling/callback execution has the same cooperative limits as existing render jobs.

## Evidence and limits

A simulated HTTP provider E2E exercises the real adapter request, strict validation, concurrent idempotency, normal database/render storage, WAV/MP3, browser playback, owner-only prompt, desktop/mobile screenshots, quota, busy-worker resumption, cancellation, revocation and provider failures. CI does not spend model credits.

The opt-in live evaluation sends one real configured-model request, saves editable source and full audio, measures complete PCM and decodes MP3. A real key and successful run are still needed to qualify Astra output. Integration fixtures do not prove model compatibility or musical taste.

`ready` means source validation and full render succeeded. The HTTP acoustic report covers only the opening two seconds; it does not certify complete-song balance, musical development, prompt fit, original-game fidelity or a seamless loop. The model may produce invalid or unconvincing music. These limits must remain clear in agent documentation and UI.

## Delivery order

Keep the earlier ticket identifiers for continuity; the acceptance scope is simplified here.

| Tickets | State and next action |
| --- | --- |
| GEN-02, GEN-06–08 | Local adapter, normal song saving, bounded execution and three routes implemented; real Astra evaluation pending |
| GEN-01, GEN-05 | After the first live result, compare a small varied set of original prompts, record latency/usage and listen to the complete songs; expand the benchmark only when useful |
| GEN-03 | Extend shared evaluation to whole-song acoustic checks, including late clipping, silence and endings; keep musical judgment separate |
| GEN-04 | Deferred: add a bounded repair call only if measured failures justify it, preserving exact candidate source and cost visibility |
| GEN-09 | Deferred: add a small prompt form to the existing `/create` page after the model produces useful songs; reuse existing progress/result UI |
| GEN-10 | Configured-server skill/OpenAPI documentation implemented; public beta, budget qualification and fresh live-agent trial remain pending |
| GEN-11–12 | Later: targeted immutable revisions and evaluated console variants, using the existing project lineage and source identity |
| GEN-13 | Public release only after real musical and operational evaluation; green fixture tests alone do not launch paid inference |

The next concrete step is a real local Astra trial with the server key. No new user-facing infrastructure is needed to run it. Keep the core emulator fidelity and deterministic adaptation work independent of this optional composition layer.
