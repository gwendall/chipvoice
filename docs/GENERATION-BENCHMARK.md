# Generation benchmark

<p align="center"><a href="GENERATION-BENCHMARK.md">English</a> &bull; <a href="GENERATION-BENCHMARK_ja.md">日本語</a></p>

GEN-01 and GEN-05 from the [delivery order](GENERATIVE-COMPOSITION.md#delivery-order): "a benchmark of about 50 prompts per console, with latency, cost and a listening grid, rerun on every model change." This document explains the harness, how to run it, what each recorded column means, and the state of the one sample run attempted so far.

## What it drives

`pnpm gen-bench` (`apps/web/scripts/gen-bench.mjs`) drives the same generation path the server uses: `compositionInstructions`/`compositionSchema`/`compositionProject` and `openAIModel` from [`apps/web/src/lib/composition/`](../apps/web/src/lib/composition/) (`model.ts`, `score.ts`), unmodified, then `renderProject`/`toWav` from the `chipvoice` package, the exact render path `project-render-worker.ts` uses in production. The whole-song checks from [GEN-03](GENERATIVE-COMPOSITION.md#whole-song-checks-gen-03) (`checks.ts`) run over the decoded render, and cost is priced by `priceUsage` in `apps/web/src/lib/composition/admission.ts`, the same function the monthly budget totals a month of rows with, so a benchmark row's cost cannot drift from what the budget would have charged for it.

## The prompt set

`apps/web/scripts/gen-bench-prompts.json` is a committed set of 250 original prompts, 50 per console (`2a03`, `dmg`, `md`, `snes`, `c64`), varied in genre, mood, tempo, duration (10 to 90 seconds, the request schema's bound) and structure, with console-specific instrumentation hints. Per [decision 39](DECISIONS.md#39-generation-opens-as-a-closed-beta-familiar-game-melodies-stay-only-while-it-is-free-2026-09-27), generation declines known-melody reproduction; that rule applies to the benchmark's own prompts too, so none names, quotes or describes a known game or film theme. `validatePromptSet` (`apps/web/src/lib/composition/bench.ts`) checks the set on every run: duplicate ids, an unknown console, a duration or prompt length outside the request schema's bounds, too few prompts for a console, and a denylist of well-known franchises and composers, matched on whole words so a common word like "contrasting" is never flagged for containing "contra".

## Running it

```bash
pnpm gen-bench --mock                       # the full 250-prompt set, no network, no cost
pnpm gen-bench --mock --sample              # one prompt per console, mock
pnpm gen-bench --sample                     # one real prompt per console (5 calls; needs OPENAI_API_KEY)
pnpm gen-bench --console md,snes --limit 10 # a filtered slice
pnpm gen-bench --confirm-paid-run           # the full real 250-prompt run (needs the owner's approval; see below)
```

| Flag | Effect |
| --- | --- |
| `--mock` | Runs against a loopback HTTP server that speaks the same OpenAI Responses SSE protocol `model.ts` expects, bound to `127.0.0.1` only. No network call leaves the machine and nothing is spent. |
| `--console a,b` | Restricts the run to the listed console ids. |
| `--sample` | One prompt per selected console, in file order, instead of the whole set. |
| `--limit n` | Keeps only the first `n` prompts after console filtering and `--sample`. |
| `--prompts path` | Uses a different prompt-set file (for trying a variant set without editing the committed one). |
| `--out path` | Writes the run's output to a specific directory instead of the default `.artifacts/gen-bench/<run-id>/`. |
| `--confirm-paid-run` | Required to run more than 5 real (non-mock) model calls in one invocation. |

A real, non-mock run reads `OPENAI_API_KEY` (and the other `OPENAI_*` variables `model.ts` reads) from the environment exactly like the server does, and no other key is ever tried. Point it at the checkout that has your key with `node --env-file=path/to/.env.local apps/web/scripts/gen-bench.mjs ...` rather than copying the key anywhere.

## The spending guard

Before any credential is read or any call is made, the script prints the estimated cost of the requested run (`estimateRunCost`: the measured mean cost per call from the most recent real run's `summary.json` under `.artifacts/gen-bench/`, or a fallback of 0.28 USD, [decision 42](DECISIONS.md#42-the-server-enforces-the-closed-beta-invitations-and-a-monthly-budget-2026-09-27)'s measured production average, when no prior real run exists), and, if the run would use fewer than the full prompt set, the extrapolated cost of the complete 250-prompt run at the same per-call rate. Requesting more than 5 real model calls without `--confirm-paid-run` refuses before starting, with no credential read and nothing sent. `--confirm-paid-run` lifts only that call-count guard; a missing or refused key still stops the run immediately, and the script never looks for a different key.

## What each run records

Every prompt produces one record in `results.json` (and rolls into `summary.json`):

| Field | Meaning |
| --- | --- |
| `model` | The model id the response reported. |
| `usage` | The Responses API's `input_tokens`, `output_tokens` and cached input tokens, exactly as returned. |
| `costUsd` | `usage` priced by `admission.ts`'s `priceUsage`, the same formula the monthly budget uses. |
| `timings.modelMs` | Wall time for the model call alone. |
| `timings.renderMs` | Wall time for the full-song render alone (`renderProject` + `toWav`). |
| `timings.totalMs` | Wall time for the whole prompt, model call through the written WAV. |
| `findings` | The GEN-03 whole-song checks' findings for this render (`clipping`, `level_jump`, `silence_gap`, `abrupt_ending` when not looping, `loop_level_jump`/`loop_click` when looping, `duration_mismatch`). Checks never reject; a finding is recorded, not a failure. |
| `audio` | The rendered WAV's path under the run directory, its length in seconds and its SHA-256, for the listening grid. |

`summary.json`/`summary.md` aggregate these per console: how many succeeded, each check's pass rate among the renders it applies to, model/render/total latency p50 and p90, and the mean cost per generation. `listening-grid.csv` lists every succeeded song with its audio path and five empty columns for a person to fill in while listening: musicality, fit to prompt, console idiom, defects, notes.

Rendered audio is written as WAV into `.artifacts/gen-bench/<run-id>/audio/`, which is gitignored (`.artifacts/` already is); nothing from a run is committed.

## Mock mode and CI coverage

`apps/web/test-gen-bench.mjs` runs the harness end to end under `--mock`, checking the written `results.json`/`summary.json`/`summary.md`/`listening-grid.csv` and a rendered WAV's header and length, then runs the spending guard as a real subprocess (with `OPENAI_API_KEY` explicitly cleared, regardless of the ambient environment) to confirm it refuses more than 5 real calls before reading any credential, confirms `--confirm-paid-run` lifts that guard without ever finding or using a stray key, and unit-tests the pure functions in `apps/web/src/lib/composition/bench.ts` directly (`selectPrompts`, `guardPaidRun`, `estimateRunCost`, `costFromUsage` against GPT-6 Astra's list prices, `summarize`, `percentile`, `formatSummaryMarkdown`, `listeningGridCsv`) and validates the committed prompt set. It is wired into `apps/web/test-local.mjs`'s script list next to `test-whole-song-checks.mjs`, so it runs in CI with the rest of the web suite; run it alone locally with `CHIPVOICE_TEST_ONLY=test-gen-bench.mjs node test-local.mjs` from `apps/web`, per the repository's rule against running the full browser suite for a single change.

## The sample run

The ticket calls for one real generation per console (5 real calls total) before any full run, to measure real cost and latency and extrapolate the 250-prompt run's cost for the project owner to approve. That sample was attempted with `node --env-file=/Users/gwendall/Code/chipvoice/.env.local apps/web/scripts/gen-bench.mjs --sample` from the main checkout's environment file, as directed. `OPENAI_API_KEY` is not present in that file (it holds `BLOB_READ_WRITE_TOKEN` and `VERCEL_OIDC_TOKEN` only), so the run stopped immediately with `Cannot start a real run: Set OPENAI_API_KEY on the server to enable composition`, spending nothing. Per the ticket's instruction, no other key was tried and no other location was searched.

The harness itself is exercised end to end by `--mock` (see above) and by `apps/web/test-gen-bench.mjs`, so the pipeline from prompt through model call, render, checks and cost is verified, but no real per-console latency or cost numbers exist yet. The full 250-prompt run's cost, at decision 42's 0.28 USD/generation fallback average (no measured run exists to use instead), is estimated at **70.00 USD**; the harness prints this same estimate before any real run. Once `OPENAI_API_KEY` is available to this checkout, `pnpm gen-bench --sample` produces the real 5-generation sample and this section should be updated with its measured per-console latency, cost and check pass rates before a full run is approved.

## When to rerun

Rerun on every model change: an `OPENAI_MODEL` change, an `OPENAI_REASONING_EFFORT` change, an adapter change in `model.ts`, or a prompt/schema change in `score.ts`. Expand the benchmark's prompt count only when the current set stops being useful, per the backlog's "expand only when useful."
