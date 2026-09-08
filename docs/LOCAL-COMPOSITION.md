# Local prompt composition

<p align="center"><a href="LOCAL-COMPOSITION.md">English</a> &bull; <a href="LOCAL-COMPOSITION_ja.md">日本語</a></p>

A prompt goes to one model, which returns notes and instruments. Chipvoice validates those notes, saves an ordinary `MusicProject` (private by default) under your artist, and uses the existing full-song WAV/MP3 render job. The song page, storage, editor and sharing flow are the same as for manually composed songs. The raw prompt stays owner-only. Accessible songs show their creation method and model: prompt-generated, direct composition, or a remix derived from prompt music. This records the Chipvoice workflow, not proof that an uploaded score was written without external AI.

## Configuration

Copy settings from [apps/web/.env.example](../apps/web/.env.example) into `apps/web/.env.local`. Preserve any existing settings. Supply `OPENAI_API_KEY` locally; this file is ignored by Git. Never use a `NEXT_PUBLIC_` variable for credentials.

```dotenv
COMPOSITION_PROVIDER=openai
OPENAI_API_KEY=your-private-key
OPENAI_MODEL=gpt-6-astra
OPENAI_REASONING_EFFORT=medium
OPENAI_MAX_OUTPUT_TOKENS=24000
COMPOSITION_DAILY_LIMIT=10
```

The adapter uses the [OpenAI Responses API with structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs); the initial model is [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra). No extra SDK dependency is required. Without a key, new generation requests return `503 generation_disabled`. Removing the key disables new admissions; existing requests remain readable.

`OPENAI_MODEL` selects another compatible model. `OPENAI_REASONING_EFFORT` is optional and must suit that model. `OPENAI_BASE_URL` optionally selects a server-controlled Responses-compatible endpoint; the default is the direct OpenAI API. Only the OpenAI adapter is implemented. A different provider implements the small `CompositionModel.generate` interface in [model.ts](../apps/web/src/lib/composition/model.ts); song storage and rendering do not change. Request bodies cannot override credentials, models or endpoints.

## Use the existing account

An owner credential or signed-in session can request composition. An agent needs its existing artist grant with **`generate`, `projects:write` and `render`**. Reading the resulting project/audio endpoints also needs `projects:read`. Existing grants are not silently upgraded. Use the normal authorization flow described by `/skill.md`.

```bash
curl http://localhost:3010/api/v1/generations \
  -H "Authorization: Bearer $CHIPVOICE_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: space-theme-v1' \
  -d '{"prompt":"An original space theme, a clear melody with a contrasting bridge and restrained percussion","target":"md","durationSeconds":60,"loop":false}'
```

Read supported `target` IDs from `/api/v1/capabilities`; the prompt uses the same generated capability catalogue. Duration is an integer from 10 to 90 seconds; default 60. Prompt length is 1–2000 JavaScript string units after trimming. `loop` expresses musical intent, not a verified seamless-loop guarantee. An owner may choose an owned `profileId`; agents use their authorized artist. Optional `visibility` accepts `private` (default), `unlisted` or `public`.

The response contains `id` and `status`. For live updates, stream `GET /api/v1/generations/{id}/events` with the same credential (`curl -N`); reconnect after its approximately 20-second closure without resubmitting the request. See [the SSE contract](GENERATIVE-COMPOSITION.md#implemented-contract). Alternatively, poll `GET /api/v1/generations/{id}` with the same credential, following `Retry-After: 2`. Status progresses through `queued`, `composing`, `validating`, `saving`, `rendering` and `ready`, or ends as `failed`/`cancelled`. Send `DELETE` to the same URL to cancel unfinished work.

A ready response includes `projectId`, `renderJobId`, `project` (the normal publication), `render` (the normal audio job), `evaluation` and model `usage`. Open `/p/{projectId}` while signed in. Download audio through the existing authenticated `/api/v1/jobs/{renderJobId}/audio?format=mp3` or `format=wav` endpoints. An agent can attach downloaded bytes in its chat tool; never put credentials in a URL. Editing uses the usual project flow. Explicitly share an existing song with `PATCH /api/v1/projects/{id}` and `{"visibility":"public"}`: the author, song ID and rendered audio are retained.

Retrying identical input with the same idempotency key returns the existing job, including a failed job, without another model call. Changed input with that key returns 409. A deliberate new attempt needs a new key. Execution uses existing server callbacks and authorized polling; closing the client may delay later stages until polling resumes. This is not an independent durable scheduler.

## Browser and one-command agent flow

Open `/create`, expand **Compose from a prompt**, choose the artist and duration, then generate. Progress survives a page reload; cancellation and links to the saved song/library use the same API. The current editor draft remains intact. Change visibility on the song page when it is ready to share.

After owner authorization through `/skill.md`, download the dependency-free client:

```bash
curl -fsS https://chipvoice.dev/skill/compose.mjs -o compose.mjs
node compose.mjs --prompt "An original space theme with restrained percussion" --target md --seconds 60 --visibility public --out space-theme
# Alternatively: node compose.mjs --project project.json --visibility public --out my-score
```

Set `CHIPVOICE_API_KEY` in the environment first. The client waits for the complete render and writes `song.mp3`, `project.json` and `result.json`; attach that MP3 using the chat tool. Keep the output directory to retry the same request safely. An intentional new composition uses another directory. Public sharing requires a named artist.

## Bounds and honest evaluation

The first version makes **one model call, without automatic repair**. It accepts structured JSON only, never executes model-written code, and compiles the complete source with `allowLoss:false`. A score exceeding compatible voice capacity fails instead of silently dropping notes. Mix adaptation uses the existing automatic mixer.

Defaults allow 10 admissions per owner per UTC day, one unfinished request per owner and two concurrent composition workers globally. Failed/cancelled attempts count toward the daily limit. Output is bounded by 24,000 tokens (configurable up to 64,000), an 8 MB provider event stream, 20,000 notes and 90 seconds. The model has a 210-second deadline, its composition worker a 240-second budget, and an abandoned worker fails after 270 seconds. Each generation expires after 600 seconds. Compact model patterns expand deterministically into ordinary notes; the public project format is unchanged. Existing renderer CPU/storage bounds still apply. These limits bound request counts and payloads; they are **not a monetary spending cap**. Configure the provider's account budget before enabling a shared deployment.

The existing evaluation checks the **whole allocation plan but only the first two seconds acoustically**. The existing renderer then produces the entire song. `ready` means a valid project and complete render are available; it does not certify taste, prompt fidelity, seamless loops or complete-song acoustic quality. A model may produce a poor composition or exceed a constraint; the result is not guaranteed to succeed. Wider musical qualification remains separate from this small integration.

Cancellation/revocation are checked before subsequent work; cancelling after a save may leave a normal private draft. A provider may bill an already dispatched request even if cancelled. Interrupted ambiguous model calls fail instead of being automatically repeated.

## Reproduce the tests

```bash
pnpm --filter chipvoice-web build
cd apps/web
node test-generation-stream.mjs
node test-generation.mjs
```

This E2E starts a real local Next server and disposable database, with a simulated HTTP model provider. It exercises structured requests, concurrent idempotency, authorization, revocation, quota, cancellation, error handling, a busy render worker, private project saving, full WAV/MP3 downloads and browser playback. Desktop/mobile screenshots and its report are written to `.artifacts/prompt-composition/` at the repository root. It spends no model credits and proves the integration, not Astra's musical output.

To exercise the same full-audio measurement script without a key or a paid call, run `pnpm --filter chipvoice-web eval:composition --fixture`. Its artifacts use a `fixture-*` directory and explicitly identify the simulated provider.

For an explicit real model trial, after supplying the key:

```bash
pnpm --filter chipvoice-web eval:composition
# Optional: prompt, duration in seconds, target
pnpm --filter chipvoice-web eval:composition 'An original calm theme with a developed ending' 30 snes
```

Each run makes one paid request using your configured model, saves the project and complete WAV/MP3 in `.artifacts/prompt-composition/live-*/`, measures full-duration PCM (duration, peak, RMS, clipping and per-second activity), records SSE snapshots and latency, decodes the MP3 and captures the private song page on mobile and desktop. It uses a temporary local database and never publishes test songs to production. The report explicitly distinguishes signal checks from listening; audition the saved audio before judging the music. CI uses only the simulated provider.
