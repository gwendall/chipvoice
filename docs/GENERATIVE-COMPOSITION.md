# Generative composition

<p align="center"><a href="GENERATIVE-COMPOSITION.md">English</a> &bull; <a href="GENERATIVE-COMPOSITION_ja.md">日本語</a></p>

**Status: proposed specification, 2026-09-08. No generation endpoint or hosted model is implemented by this document.** The user has requested specifications; implementation, model selection and public release are separate steps. Numeric limits below are initial product decisions to qualify, not measured capacity or provider price claims.

## Product decision

A person or agent submits a musical prompt and receives an original instrumental composition: an editable `MusicProject`, complete WAV/MP3, and an honest evaluation report. The model writes musical structure; Chipvoice renders it with its existing emulators. A generated recording alone is insufficient because notes, independent parts and console adaptations are central to the product.

Build an internal prototype now, evaluate musical usefulness, then an authenticated private beta in `/create`. Keep hosted inference outside the lightweight `chipvoice` package. Existing local creation, agent-written projects and anonymous listening remain independent of this feature. Do not make improved hardware fidelity depend on generation work.

The first version generates one complete song on one discovered target. It includes duration and loop intent, structured source, full audio, cancellation, recovery, evaluation and explicit publication. Later milestones add conversational revision and evaluated console variants. Vocals, lyrics synthesis, audio uploads/transcription, model training, automatic public posting and a marketplace are not part of this specification.

## Current foundations and missing work

| Available now | Required addition |
| --- | --- |
| `MusicProject` v1, `Performance`, capability discovery and deterministic rendering | A bounded prompt-to-project pipeline |
| Owner accounts and artist-scoped agents | Explicit `generate` permission and shared owner budgets |
| `/api/v1/evaluate`: complete allocation plan, opening two seconds of audio | Complete-audio checks for generation, including transitions and endings |
| Immutable published projects and pinned WAV/MP3 | Private generation artifacts that exist without a publication |
| Cooperative publication rendering, resumed by owner polling | Generation execution and recovery independent of an open browser |
| Editor, MIDI import, downloads and artist publication | Prompt UI, real progress, recoverable generated drafts and revisions |

Reuse the actual parser, planner, renderer, encoder and capability catalogue. Do not reproduce their rules in model prompts or a second synthesis implementation. The current publication job cannot simply be called before a publication exists; extract only the reusable rendering/artifact operations needed by both callers. See [Creation](CREATION.md), [Artists and agents](ARTISTS-AND-AGENTS.md), [Mixing](MIXING-API.md) and [agent delivery evidence](evals/SONG-DELIVERY-2026-09-08.md).

## User experience

Add **Describe a song** inside `/create`, alongside existing manual creation. Use the site's compact retro components, with English/Japanese UI and metadata. Accept prompts in the user's language. Show a prompt field, target selector from capabilities, duration slider plus numeric input, and a loop toggle. Default duration: 60 seconds; allowed range: 10–90 seconds. A target is always visible before submission; select the current editor target or a configured supported default. Do not infer a new hidden target on each request.

Before submission, identify that the prompt goes to a hosted model and show the applicable allowance. A signed-out visitor can write a prompt, then sign in without losing it. Beta requires an enabled owner account; it does not create an email identity for an agent. Disable generation clearly when capacity or configuration is unavailable.

After submission, show the actual stage, elapsed time and Cancel. A spinner represents model work whose completion percentage is unknown; use numeric progress only for measured rendering work. A queued position must not be invented. Closing/reopening the page resumes the stored job, not another billable request.

Keep the current song playing while generating. When ready, offer **Listen**, **Open in editor**, **Download** and **Publish**. Do not replace unsaved edits or switch the audible song until the user chooses the result. Opening a result creates a local editable copy; its generated source and audio remain immutable. Explain the seven-day server retention and provide JSON download. Failures preserve the current project and show an actionable reason.

The result card shows title, actual duration, console, a short musical description, material adaptation warnings and evaluation coverage. Detailed diagnostics belong in an expandable panel. A generated song is private until the separate existing publication action. Loop exports contain one complete cycle; normal song exports have an intentional ending, not a truncated preview. Respect browser gesture requirements for playback.

## Generation pipeline

1. Authenticate, validate and admit the request atomically. Resolve target capabilities and record the selected model/prompt/compiler/engine policies. Reserve budget and persist the job before any model call.
2. Ask the model for an original brief and structured composition data: tempo, tonal intention, sections, motifs, parts, notes and dynamics. It should develop musical material rather than repeat an example to fill time. Instrumentation follows the idea and target, not a mandatory six-part template.
3. Compile and validate that data into a detached `MusicProject` with a `Performance` source. The server sets ownership and safe metadata defaults; the model cannot authorize publication, modify accounts or choose tools. No generated JavaScript is executed on the server.
4. Prepare the entire arrangement with the existing planner. Reject invalid notes/timing, forbidden target resources and voice omissions on the primary target. Use `allowLoss:false` for the accepted primary result. Timbre substitutions and mix limits remain explicit; strict allocation is not a fidelity certificate.
5. Render the entire song in a bounded worker and compute complete-audio measurements. Save candidate artifacts privately, then inspect the full result rather than declaring success from the opening excerpt.
6. When a repairable technical failure or actionable musical diagnostic exists, provide concise structured feedback to the model and generate a revised candidate. Keep each candidate and reason. At most two repair calls after the initial call, within one shared deadline and cost budget. Never set `allowLoss:true` just to turn a failure into a success.
7. Accept a technically valid candidate, encode the complete MP3 and atomically publish the private result manifest. If the repair budget is exhausted, return a typed failure and any safe diagnostic/project artifact as an explicitly unaccepted candidate. A failed candidate is never exposed as ready audio.

Start with direct structured `Performance` data if that works reliably. Introduce a private `CompositionPlan` representation only when trials show a material token/consistency benefit. If introduced, it is JSON with versioned motifs and section placements, integer ticks, bounded repetitions and deterministic expansion. No recursion, arbitrary expressions, network references or new public score format. Validate expansion limits before allocating notes. Missing chord/bass lines are not automatically invented by the compiler.

The public request must not expose provider-specific temperature, system instructions or tool configuration. Initially use one provider implementation plus a recorded-response test implementation; add another real provider during comparison if justified. Keep provider I/O behind a small internal interface with cancellation, structured results, usage accounting and typed failures. Its implementation cannot access the database, publication routes or unrestricted tools.

## Proposed HTTP contract

All paths in this section are **new and unimplemented**. They must not appear as available tools in the production skill/OpenAPI until shipped.

```http
POST /api/v1/generations
Authorization: Bearer <authorized credential>
Idempotency-Key: <unique request revision>
Content-Type: application/json
```

```json
{
  "prompt": "A driving space-boss theme with a memorable answering melody",
  "target": "md",
  "durationSeconds": 60,
  "loop": false
}
```

`target` uses a live capability ID (`md` here), not a second alias list. Prompt: 1–2000 Unicode code points after trimming; duration: integer 10–90; loop defaults false. Human owners may supply an owned `profileId`; agents are bound to their authorized artist and cannot override it. Unsupported/unknown fields fail validation. No `visibility` or automatic-publish parameter.

Return 202 with `id`, `status`, `stage`, `statusUrl`, `createdAt`, `deadlineAt` and `expiresAt:null`; set artifact expiry to seven days after terminal completion and send `Retry-After` for polling. Return the same job for an identical idempotent retry without another provider call or budget reservation. Scope the key to the owner; changing artist, request content or revision source with that key yields 409. Defaults are normalized before hashing; the initially selected policy is pinned even if defaults later change.

| Route | Contract |
| --- | --- |
| `POST /api/v1/generations` | Admit one private job; a fresh intentional attempt uses a new key |
| `GET /api/v1/generations` | Own artist-scoped recent jobs, cursor pagination; never public discovery |
| `GET /api/v1/generations/{id}` | Authorized state, stage, elapsed time, attempts, usage, expiry and result manifest |
| `DELETE /api/v1/generations/{id}` | Cancel queued/running work; an already cancelled job returns its state; ready/failed/expired jobs return 409 |
| `GET /api/v1/generations/{id}/project` | Accepted immutable project, or explicitly labelled diagnostic candidate on failure |
| `GET /api/v1/generations/{id}/evaluation` | Full report with measured coverage, candidate history and known limits |
| `GET /api/v1/generations/{id}/audio?format=wav|mp3` | Accepted complete audio only; enforce access on every request |

The ready manifest contains `projectUrl`, `evaluationUrl`, `wavUrl`, `mp3Url`, `seconds`, `target`, content hashes and `expiresAt`. There is no public song/profile URL until a publication exists. Downloads use private/no-store caching and never embed bearer tokens in URLs. A chat agent downloads bytes with its credential and attaches them with its own chat tool.

HTTP errors use stable codes: 401 invalid credentials; 403 missing scope/beta access; 404 inaccessible job/artist; 409 idempotency or terminal-state conflict; 410 expired owned artifact; 413 body too large; 422 invalid prompt/target/options; 429 quota/capacity with `Retry-After`; 503 disabled/unavailable configuration. An unsupported musical request, provider refusal, invalid generated score, exhausted repairs, budget/deadline limit or interrupted execution is a typed job failure after admission, not a fabricated success.

Use the existing `/api/v1/projects` action for publication, with `projects:write` scope and an explicit visibility choice. Copy the accepted project through its existing validator; retain normal source credits and `reserved` licence unless the user chooses otherwise. Do not automatically make model-generated music CC0. Published audio is pinned through the existing publication flow; generation artifact expiry must not break a publication. Reusing generation audio later requires verified project/engine hashes, not an untrusted client URL.

## State, execution and access

Keep lifecycle separate from explanatory stage. Lifecycle: `queued`, `running`, `ready`, `failed`, `cancelled`, `expired`. Running stages: `composing`, `validating`, `rendering`, `evaluating`, `repairing`, `encoding`; stage progress can restart on a new candidate and is not a global fake percentage. `cancelRequestedAt` exposes a cancellation in progress without conflating it with completion.

Transitions use database compare-and-swap and leased execution epochs. A late worker or provider response cannot overwrite a cancelled job or publish another epoch's candidate. Ready becomes visible only after all artifact writes succeed and the final transaction confirms the job is current and uncancelled. Cancellation requests provider abort where supported and terminates local CPU work before releasing its lease. Already consumed provider work may still cost money; cancellation is not a refund promise.

Do not hold the shared audio CPU lease while waiting for a model. Keep the existing global audio concurrency bound during beta and add fair admission so generation cannot starve normal rendering/evaluation. Model-call concurrency is independently bounded. Total deadline includes queueing, model calls, repairs and rendering. A delayed queue job expires its deadline without calling the provider.

Generation status polling is read-only: it must neither make provider calls nor be the sole scheduler. The internal prototype may use an explicit local runner. The hosted beta needs a persistent queue record plus a separately triggered runner/recovery sweep; validate the deployment mechanism before enabling it. Do not assume the current Next `after` callback guarantees eventual execution. Persist each attempt before dispatch. Where the provider cannot reconcile an ambiguous timeout safely, fail as `provider_outcome_unknown` and retain the budget reservation instead of silently charging for a duplicate call.

Private jobs belong to an owner and artist. Add `generate` as an explicit agent scope for this lifecycle and its internal evaluation/rendering; it does not grant publication or access to external evaluate/render endpoints. Existing credentials are not silently upgraded. Recheck expiry/revocation/artist authorization before each new provider call or CPU stage. Already authorized in-flight work may finish, but later access still requires authorization. Human sessions retain same-origin mutation checks. Another artist's private ID returns 404.

## Bounds, storage and provenance

Initial beta policy: invited owners only; one active job plus at most two queued jobs per owner; ten admitted jobs per owner per day; at most two concurrent model calls globally. Limits aggregate across every agent/profile of an owner and are enforced atomically in the database. Keep admission counts for failed/cancelled attempts to prevent quota bypass; identical retries do not count twice. Existing non-generation quotas remain separate.

Each job has a 600-second total deadline, at most three provider requests including repairs/retries, at most 16,000 output tokens per request, 4 MB model/project payload limits, at most 20,000 expanded notes and 90 seconds of music. Apply the existing 240-second render deadline and 40 MB ceiling within the remaining job budget, not in addition to it. Cap the generation's stored artifacts at 40 MB total and prune rejected candidate audio after retaining its hashes/report. Refuse oversized expansion before synthesis.

Before any hosted trial, configure finite per-job and daily global monetary caps with a versioned provider pricing/accounting policy; unset caps disable admission. Reserve a conservative upper bound before each provider dispatch and reconcile actual usage. Unknown usage retains its reservation until reconciled; do not assume zero cost. Prototype results must establish sensible numerical money caps and p50/p95 cost/latency before beta. This spec selects no provider, model, price or billing promise.

Keep private prompts, accepted source and audio for seven days after completion, with the actual expiry returned to the caller. Recover queued/running jobs after restart within their deadline. A scheduled purge removes expired bytes/prompts/candidates; retain a minimal idempotency/access tombstone for 30 days after terminal completion so a delayed retry returns 410 rather than generating and charging again. Explain this retry retention window to clients. Account deletion uses the corresponding purge path. Do not send private drafts, account email, tokens or unrelated songs to the model.

Record request, normalized brief, model/provider version, prompt policy version, raw structured response, capability hash, compiler version, engine fingerprint, candidate source/audio hashes, bounded repair feedback, actual duration, usage and measurement coverage. Store raw prompts/responses privately and exclude them from public project metadata and normal logs. Put secrets only in server configuration. CI uses recorded responses; live-provider evaluation is an explicit bounded operator run.

Rendering a stored project with the same qualified engine/settings is reproducible. Repeating a natural-language request is not promised to produce the same composition, even with a provider seed. The initial public contract therefore has no misleading deterministic `seed`. Later revision/variant operations always record the exact source they start from.

## Evaluation and release gates

Maintain three separate forms of evidence. Schema validity and deterministic PCM are necessary; neither proves good music or faithful reproduction of an existing game's patches.

| Layer | Checks | Effect |
| --- | --- | --- |
| Hard technical acceptance | Complete valid source; primary melody and all audible source notes allocated; finite PCM; no samples at or above full scale; non-silent mix; requested duration within 0.25 s in PCM; complete WAV/decodable MP3 | Any failure prevents `ready`; repair or fail |
| Musical diagnostics | Section development and repetition; intentional rests; part audibility/masking; low-register crowding; contrast; ending/loop discontinuity and release tail | Evidence for targeted revision and listening; no universal scalar quality score |
| Human blind listening | Prompt fit, memorable musical development, balance, transitions, desire to replay | Required before public launch; an LLM judge is optional secondary evidence |

Measure the entire mix plus isolated parts and short-time windows across every section. Report PCM duration separately from MP3 encoder padding. Define signal thresholds/versioning in fixtures; avoid treating a quiet introduction, sparse texture, drone or deliberate dissonance as automatically wrong. For loop intent, evaluate the end-to-start junction; for a non-loop, measure the release and unintended tail cut. Do not claim the existing two-second HTTP evaluation covers these checks. “No voice omissions” can coexist with instrument substitutions or a hardware-limited mix; report both.

Prepare 12 original prompts across energetic themes, calm pieces, sparse textures, dense arrangements, short loops and developed songs; three independent outputs per prompt for the first candidate. Keep eight additional prompts withheld from prompt tuning. Include a saved agent-composed baseline under the same durations/targets. Blind comparisons randomize ordering and normalize listening level for taste comparisons while preserving raw PCM for technical tests. At least three listeners judge a representative, balanced subset; record individual votes, disagreements and coverage, not only an average. Human listening can block launch even when code is finished.

Proposed beta gate: every ready artifact passes hard acceptance, at least 90% of benchmark requests finish within configured limits, and no authorization/cancellation/cost-bound regressions. Proposed public gate: on held-out comparisons, at least 70% of ratings judge the result usable without recomposition, no prompt category below 50%, and candidate-versus-baseline preferences/uncertainty, p50/p95 latency and cost are reported. These are targets to discuss after the prototype, not results already achieved. Failure means iterate or keep the feature private.

## Revisions and console variants

After the initial beta, add immutable revision requests referencing an accessible accepted generation and a change instruction, for example “less percussion” or “develop the second theme”. Compute a semantic project diff. Preserve untouched notes/sections/settings for a targeted edit; if the requested change implies broader recomposition, explain its extent before replacing anything. Never mutate a stored result or silently overwrite editor work. Revision requests consume normal budgets and use new idempotency keys.

For another console, first render the same canonical source with target settings and inspect losses/mix. Keep those source-identical versions eligible for existing variant grouping. If a smaller machine needs changed notes, create a separately attributed reduction linked to its source; do not mislabel it as an identical-source variant. Qualify melody preservation and timbre/mix compromises on every requested target. Do not generate every supported console on every request by default.

## Tickets and delivery order

All tickets below are **todo**. The spec is the authoritative acceptance reference; the backlog links here instead of copying detailed rules.

| Ticket | Work and dependencies | Acceptance |
| --- | --- | --- |
| GEN-01 | Record benchmark prompts, hold-out split and saved baseline | Coverage and musical rubric exist before prompt tuning; no live calls in CI |
| GEN-02 | Local prompt-to-project prototype; depends on GEN-01 | Original structured sources rendered through public SDK; usage/candidate artifacts saved; no server execution of model code |
| GEN-03 | Complete-audio evaluator; can proceed with GEN-02 | Fixtures detect late clipping, missing melody, truncated endings and bad loop joins; quiet/sparse controls remain accepted |
| GEN-04 | Bounded repair and candidate selection; depends on GEN-02/03 | At most two repairs; no silent loss-policy change; accepted source and report agree |
| GEN-05 | Prototype comparison and decision; depends on GEN-04 | Blind evidence, hold-outs, costs and latency; choose model/configured caps or keep iterating |
| GEN-06 | Private artifact storage and shared rendering operations; depends on GEN-05 | Full draft WAV/MP3 without publication; current published hashes/access unchanged; expiry purge qualified |
| GEN-07 | Jobs, durable execution, `generate` scope and budgets; depends on GEN-05 | Restart, duplicate dispatch, cancellation races, revoked credentials and ambiguous provider failure cannot bypass limits |
| GEN-08 | Generation HTTP lifecycle; depends on GEN-06/07 | Contract, idempotency, isolation, download and failure E2E pass with recorded provider responses |
| GEN-09 | Prompt/result UI in `/create`; depends on GEN-08 | EN/JA desktop/mobile screenshots; preserved edits/audio; sign-in recovery, cancel/reopen, full downloads and explicit publication E2E |
| GEN-10 | Private beta and agent documentation; depends on GEN-09 | Skill/OpenAPI describe only shipped behavior; fresh agent trial reaches complete audio; monitored budgets and disable switch work |
| GEN-11 | Targeted revisions; depends on qualified GEN-10 | Immutable lineage, semantic diff, scoped ownership and unchanged material verified |
| GEN-12 | Evaluated console variants; depends on qualified GEN-10 | Canonical-source identity preserved; changed-note reductions distinguished; no default all-target render explosion |
| GEN-13 | Public release gate; depends on GEN-10 and scoped release contents | Held-out listening, operational recovery, cost/latency evidence and user-facing limits accepted; no automatic launch on green CI |

Batch coherent work into few PRs: prototype/evaluation (GEN-01–05), private beta (GEN-06–10), then revisions/variants (GEN-11–12). GEN-13 is a release decision, not a reason to merge unqualified infrastructure into an enabled public feature. Every implementation PR updates this plan with evidence and leaves incomplete listening/capacity gates open.

## Decisions to revisit after the prototype

The initial design fixes structured music output, private results, complete audio, explicit publication, authenticated beta, bounded repair and a lightweight SDK. No additional user decision is needed to start GEN-01–04 once implementation is requested.

GEN-05 must settle the actual model/provider and data handling policy, monetary caps and acceptable latency from measured evidence. GEN-13 must settle free/paid access and public capacity after beta usage. A persistent runner deployment must be selected and tested before GEN-07 is considered complete. None of those choices is an implied authorization for a subscription, purchase or public launch in this specifications-only task.
