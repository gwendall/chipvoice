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
| `GET /api/v1/generations/{id}/events` | Authenticated SSE snapshots every two seconds; reconnect after normal stream closure without resubmitting the prompt |
| `DELETE /api/v1/generations/{id}` | Cancel unfinished composition and rendering |
| `GET /api/v1/generations/access` | Whether the signed-in account can compose now and, if not, why (`invite_required`, `monthly_budget`, `daily_limit`, `disabled`) |

Owner accounts use existing credentials. Agents need `generate`, `projects:write` and `render`; existing grants are not upgraded automatically. One streaming model call returns compact patterns, clip placements, named parts, instruments and dynamics. The shared pattern bank is limited to 16 patterns of 24 note rows (384 source rows), independent of duration or part count. Bounded, deterministic expansion produces ordinary absolute-tick notes; repeated accompaniment does not require repeatedly printing the same notes. The public project format is unchanged. The server compiles a normal `Performance`, validates the full allocation with `allowLoss:false`, evaluates the opening two seconds, saves with the requested visibility (private by default) and runs the usual full-song render. There is no automatic model repair. Public posting requires an explicit visibility choice. PATCH on the existing project changes visibility without copying its score or audio.

Identical retries reuse the same job, including after failure. Concurrent requests cannot dispatch the same job twice. Unknown interrupted model outcomes fail instead of automatically spending again. Daily owner admission, model concurrency, response/token/note limits, cancellation, revocation and deadlines bound work. Hosted composition is a closed beta ([decision 42](DECISIONS.md#42-the-server-enforces-the-closed-beta-invitations-and-a-monthly-budget-2026-09-27)): only invited accounts compose (`403 generation_invite_required` otherwise), and a monthly budget, priced from the token usage each generation records, refuses composition once spent (`429 generation_budget`, with `Retry-After` until the first of next month, UTC). Generations whose usage is not known yet count at a worst case, so concurrent admissions cannot overshoot. A spend limit at the provider remains a second fence. Polling/callback execution has the same cooperative limits as existing render jobs.

The SSE endpoint emits `event: progress` with `id`, `status`, `createdAt`, `finishedAt`, `projectId`, `errorCode` and `progress` (`outputCharacters`, `updatedAt`, `render`). It sends no prompt, score text or model reasoning. Streams rotate after about 20 seconds; reconnect to the same URL. `event: unavailable` means recheck authorization/connectivity and reconnect with bounded backoff. Stop on `ready`, `failed` or `cancelled`; use the ordinary GET for final project/audio URLs. Disconnecting does not cancel inference. Snapshots are durable across server instances, with model counters persisted at most once per second. Revoked credentials stop receiving snapshots.

The UI shows elapsed time and four milestones (compose, check, save, audio). Composition is indeterminate because its duration is unknown; audio progress comes from the renderer. No time-based percentage or completion-time promise is fabricated. The model deadline is 210 seconds, the composition worker budget 240 seconds, the abandoned-worker threshold 270 seconds, and the overall job limit ten minutes. Rendering uses its existing separate worker budget. Failures expose safe error codes; reconnecting never starts another paid model request.

## Evidence and limits

A simulated HTTP provider E2E exercises the real adapter request, strict validation, concurrent idempotency, normal database/render storage, WAV/MP3, browser playback, owner-only prompt, desktop/mobile screenshots, quota, busy-worker resumption, cancellation, revocation and provider failures. CI does not spend model credits.

The opt-in live evaluation sends one real configured-model request, saves editable source and full audio, measures complete PCM and decodes MP3. The real local Astra trial produced “Starwake Courier”: 60 seconds, four parts, complete stereo MP3 and no PCM clipping. The streaming regression trial also exposed a 90-second request that timed out after 210 seconds with an insufficiently bounded pattern format. With the final shared pattern bank, real Astra trials produced “Starfire Interceptor” (Super Famicom, 60 seconds, ready after about 92 seconds, 5,270 output tokens) and “Starfire Run” (Mega Drive, 90 seconds, ready after about 126 seconds, 5,294 output tokens). Both complete WAVs had zero clipped samples, activity through the final section and activity in at least 80% of one-second windows; both MP3s decoded at the requested duration. The evaluation recorded 51 and 70 SSE snapshots and mobile/desktop captures while the model wrote. These are measured trials, not latency guarantees. The 384-row bound applies only to model transport, not to manually authored projects or imported MIDI. Integration fixtures and signal measurements do not establish musical taste; full audition was not performed.

`ready` means source validation and full render succeeded. The HTTP acoustic report covers only the opening two seconds; the whole-song checks below extend measurement to the complete render, but neither certifies musical development, prompt fit, original-game fidelity or a seamless loop as a musical judgment - only that the samples are within measured acoustic bounds. The model may produce invalid or unconvincing music. These limits must remain clear in agent documentation and UI.

## Whole-song checks (GEN-03)

`validateSong`/`validateProject` (the engine's own pre-render validation) and the opening-two-seconds evaluation both stop short of the complete render: neither reads the full samples, so neither can see a fault that only exists there - late clipping, a part gone silent for no scored reason, a render that stops mid-note, or a loop seam that pops. `apps/web/src/lib/composition/checks.ts` adds that layer: pure functions over decoded PCM, run once in `jobs.ts` the first time a generation's render job is observed `ready`, with their result stored on the generation (`song_report` column, migration `whole-song-checks`) and returned as `songReport` next to the existing `evaluation`. The module is pure and never touches a chip, a driver or the model; `apps/web/test-whole-song-checks.mjs` exercises every check with synthetic PCM at a clean case and each failure's threshold edge, then runs the same checks against the repository's own arrangement corpus (mario, zelda, sonic, on all four ported chips) and the starter demo project.

Six checks, each against a number this repository already measured rather than one invented for this file:

- **Clipping** - any sample at or past full scale, anywhere in the song (zero tolerance, the same bar `GENERATIVE-COMPOSITION.md`'s own trials already report and the opening-two-seconds evaluation already enforces for its own window).
- **Level jumps** - a one-second window's peak at least 12dB over the song's own median window and above -9dBFS, so an already-loud song with no headroom left does not fire on its own normal level.
- **Silence gaps** - ten or more consecutive seconds under -60dBFS RMS (`eval-composition.mjs`'s existing "activity" floor); ten seconds clears two full bars of rest even at `validateSong`'s slowest accepted tempo (40 BPM). Named to the one part whose scored notes cover the gap, when exactly one part does - a dropout, not a written rest.
- **Abrupt ending** - only when the request did not ask for a loop (`compositionInstructions` writes a resolved ending only then): the last half-second neither reached -36dBFS nor decayed 12dB from its own last three seconds' peak.
- **Loop seam** - only when the request asked for a loop: a click (the single sample step across the seam past six times the song's own typical adjacent-sample step), and a level jump (the seam's level difference past twice the song's own typical window-to-window movement, floored at 6dB so a static song cannot pass on the floor alone). The level-jump bar is relative, not flat: measured against the arrangement corpus, the one genuinely seamless case (zelda, a real game loop, on every ported chip) sits at 0-4.6dB against its own 4.7-6.1dB typical movement, comfortably inside; a flat absolute bar that let that pass had to be wide enough to also miss real jumps, so the check instead asks whether the seam moves more than the song otherwise does.
- **Duration mismatch** - the render more than 0.25s off the requested duration, the exact tolerance `eval-composition.mjs` already asserts for a real Astra render.

**Findings are recorded and returned, never rejected.** A generation that clips or drops out still reaches `ready`; the finding is attached for the author to see and, per [decision 39](DECISIONS.md#39-generation-opens-as-a-closed-beta-familiar-game-melodies-stay-only-while-it-is-free-2026-09-27), to eventually inform pricing from "the share of songs that pass whole-song checks and listening." Building any automatic response to a finding - a repair pass, a re-render, a refusal - is GEN-04, deliberately out of scope here.

The corpus run found no false positives on a render's own native chip or a declared loop: `mario` (native 2a03), `zelda` (all four ported chips - a real game loop) and `sonic` (native `md`) measure clean, as does the starter demo project. Five of the thirteen arrangement renders do flag a `loop_level_jump` - always a chip-adapted excerpt realized on a chip other than the one it was captured from (e.g. `mario` played on `dmg`), never the native rendering. These carry no declared loop intent of their own (unlike a generation's `request.loop`) and the measured jump is a genuine acoustic difference from the chip swap, not a miscalibration of the check.

## Delivery order

Keep the earlier ticket identifiers for continuity; the acceptance scope is simplified here.

| Tickets | State and next action |
| --- | --- |
| GEN-02, GEN-06–08 | Local adapter, normal song saving, bounded execution and three routes implemented; first real local Astra trial passed |
| GEN-01, GEN-05 | Compare a small varied set of original prompts, record latency/usage and listen to the complete songs; expand the benchmark only when useful |
| GEN-03 | Implemented: whole-song acoustic checks (clipping, level jumps, silence gaps, an unresolved ending, a loop seam, a duration mismatch), recorded on the generation and never rejecting; see "Whole-song checks" above |
| GEN-04 | Deferred: add a bounded repair call only if measured failures justify it, preserving exact candidate source and cost visibility |
| GEN-09 | Implemented: prompt form in `/create`, artist/duration controls, progress/reload/cancel, preserved editor draft and links to the saved song |
| GEN-10 | Skill/OpenAPI and downloadable client implemented; agent/API/browser qualification is described in the creator journey report; broader budget and musical qualification remain separate |
| GEN-11–12 | Later: targeted immutable revisions and evaluated console variants, using the existing project lineage and source identity |
| GEN-13 | Public release only after real musical and operational evaluation; green fixture tests alone do not launch paid inference |

The [creator journey](evals/CREATOR-JOURNEY-2026-09-08.md) verifies author attribution, creation method, visibility and complete MP3 delivery. Direct submission records the route used, not proof of human-only authorship. Keep the core emulator fidelity and deterministic adaptation work independent of this optional composition layer.
