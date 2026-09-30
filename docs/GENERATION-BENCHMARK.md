# Generation benchmark

<p align="center"><a href="GENERATION-BENCHMARK.md">English</a> &bull; <a href="GENERATION-BENCHMARK_ja.md">日本語</a></p>

GEN-01 and GEN-05 from the [delivery order](GENERATIVE-COMPOSITION.md#delivery-order): "a benchmark of about 50 prompts per console, with latency, cost and a listening grid, rerun on every model change." This document explains the harness, how to run it, what each recorded column means, and what the first real sample run measured.

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
pnpm gen-bench --confirm-paid-run --concurrency 4 --max-cost-usd 70
                                            # the full real 250-prompt run (needs the owner's approval; see below)
pnpm gen-bench --confirm-paid-run --resume .artifacts/gen-bench/<run-id>
                                            # continue a run that stopped, without paying again for what it rendered
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
| `--concurrency n` | Runs up to `n` prompts at once (1 to 8, default 1). Records are still written in file order. Render timings measured under concurrency share the machine's cores; the model-call latency is the provider's. |
| `--max-cost-usd n` | Stops handing out new prompts once one more call could take this invocation's spending past `n` USD, counting the calls still in flight at the run's own mean cost so far (a failed call with no usage counts at that rate too). The run then writes its summaries over what it rendered and says how to resume. |
| `--resume dir` | Continues the run in `dir` from its `results.jsonl`: rendered records are kept and their prompts not sent again, failed ones are retried, and the guard and estimate count only the prompts still to send. A mock run cannot resume a real one, nor the other way round. |

A real, non-mock run reads `OPENAI_API_KEY` (and the other `OPENAI_*` variables `model.ts` reads) from the environment exactly like the server does, and no other key is ever tried. The script loads `apps/web/.env.local` itself when it exists, without overriding a variable already set, so the web app's own local configuration (its key, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, `OPENAI_MAX_OUTPUT_TOKENS`) is what a run uses by default. Point it at another file with `node --env-file=path/to/.env.local apps/web/scripts/gen-bench.mjs ...` rather than copying a key anywhere.

Prompts are sent one console at a time in turn (2a03, dmg, md, snes, c64, then each console's second prompt, and so on; `interleaveByConsole` in `bench.ts`), so a run that stops early, at its spending cap or on an interrupt, has covered every console about equally.

## The spending guard

Before any credential is read or any call is made, the script prints the estimated cost of the requested run (`estimateRunCost`: the measured mean cost per call from the most recent real run's `summary.json` under `.artifacts/gen-bench/`, or a fallback of 0.28 USD, [decision 42](DECISIONS.md#42-the-server-enforces-the-closed-beta-invitations-and-a-monthly-budget-2026-09-27)'s measured production average, when no prior real run exists), and, if the run would use fewer than the full prompt set, the extrapolated cost of the complete 250-prompt run at the same per-call rate. Requesting more than 5 real model calls without `--confirm-paid-run` refuses before starting, with no credential read and nothing sent. `--confirm-paid-run` lifts only that call-count guard; a missing or refused key still stops the run immediately, and the script never looks for a different key.

## What each run records

Every prompt produces one record, appended to `results.jsonl` the moment it finishes (so a crash keeps every generation already paid for, and `--resume` reads it back), then written in file order to `results.json` and rolled into `summary.json` at the end:

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
| `melody` | The known-melody gate's best match on the model's output (`similarity`, `referenceId`, `part`), computed by `knownMelodySimilarity` exactly as `jobs.ts` records it in production ([decision 56](DECISIONS.md#56-prompt-moderation-and-a-melodic-similarity-gate-refuse-a-known-work-on-the-input-and-the-output-2026-09-29)), or `null` when no melodic part had anything to compare. Recorded on every generation, below the threshold too: this benchmark is the real negative set `KNOWN_MELODY_THRESHOLD` is recalibrated from. |
| `project` | The generated MusicProject's path under the run directory (`projects/<id>.json`) and its SHA-256, so a later measure can be rerun on the same compositions without paying for them again. |

`summary.json`/`summary.md` aggregate these per console: how many succeeded, each check's pass rate among the renders it applies to, model/render/total latency p50 and p90, the mean cost per generation, and the known-melody similarity's p90 and maximum. A run-wide known-melody section gives the similarity's p50/p90/p99/maximum over every rendered generation, how many sit at or above the threshold (generations production would refuse after the paid call), and the five closest, with the reference each matched. `listening-grid.csv` lists every succeeded song with its audio path and five empty columns for a person to fill in while listening: musicality, fit to prompt, console idiom, defects, notes.

Rendered audio is written as WAV into `.artifacts/gen-bench/<run-id>/audio/` and each generated project into `projects/` beside it, all gitignored (`.artifacts/` already is); nothing from a run is committed.

## Mock mode and CI coverage

`apps/web/test-gen-bench.mjs` runs the harness end to end under `--mock`, checking the written `results.json`/`results.jsonl`/`summary.json`/`summary.md`/`listening-grid.csv`, a rendered WAV's header and length, each record's known-melody match and saved project, that `--resume` sends nothing again for rendered records, that `--concurrency` keeps file order and that `--max-cost-usd` stops before its cap, then runs the spending guard as a real subprocess (with `OPENAI_API_KEY` explicitly cleared, regardless of the ambient environment) to confirm it refuses more than 5 real calls before reading any credential, confirms `--confirm-paid-run` lifts that guard without ever finding or using a stray key, and unit-tests the pure functions in `apps/web/src/lib/composition/bench.ts` directly (`selectPrompts`, `guardPaidRun`, `estimateRunCost`, `costFromUsage` against GPT-6 Astra's list prices, `summarize`, `summarizeMelody`, `interleaveByConsole`, `budgetAllows`, `percentile`, `formatSummaryMarkdown`, `listeningGridCsv`) and validates the committed prompt set. It is wired into `apps/web/test-local.mjs`'s script list next to `test-whole-song-checks.mjs`, so it runs in CI with the rest of the web suite; run it alone locally with `CHIPVOICE_TEST_ONLY=test-gen-bench.mjs node test-local.mjs` from `apps/web`, per the repository's rule against running the full browser suite for a single change.

## The sample run

The ticket calls for one real generation per console (5 real calls total) before any full run, to measure real cost and latency and extrapolate the 250-prompt run's cost for the project owner to approve. A first attempt on 2026-09-29 found no `OPENAI_API_KEY` in the environment file it was pointed at and stopped before any call, spending nothing. The sample ran on 2026-09-30 with `node --env-file=apps/web/.env.local apps/web/scripts/gen-bench.mjs --sample` (the web app's own local configuration, model `gpt-6-astra`); all five generations rendered:

| Prompt | Duration | Cost | Model call | Render | Input / output tokens | Findings |
| --- | --- | --- | --- | --- | --- | --- |
| `2a03-01` | 15s | $0.2302 | 75.9s | 0.9s | 3,277 / 3,949 | `abrupt_ending` |
| `dmg-01` | 12s | $0.2110 | 58.5s | 1.2s | 3,583 / 3,504 | `abrupt_ending` |
| `md-01` | 15s | $0.2833 | 75.3s | 4.5s | 8,600 / 3,946 | `abrupt_ending` |
| `snes-01` | 17s | $0.2275 | 65.7s | 0.6s | 6,583 / 3,234 | `abrupt_ending` |
| `c64-01` | 12s | $0.1516 | 49.9s | 0.8s | 3,897 / 2,253 | `abrupt_ending` |

The measured mean is $0.2207 per generation, which extrapolates the full 250-prompt set to $55.19, under the 70 USD the fallback rate estimated. That extrapolation is a floor rather than a forecast: the five sample prompts ask for 12 to 17 seconds, while the full set averages 45 seconds, and output tokens are most of a call's price, so the full run is started with `--max-cost-usd 70`, the approved amount, rather than trusted to the estimate.

Every sample render passed `duration_mismatch`, `clipping`, `level_jump` and `silence_gap`, and every one failed `abrupt_ending`: its final half second sits 2.1 to 5.8 dB under its own last three seconds' peak, at -29.4 to -33.2 dBFS against the check's -36 dBFS limit. The model writes music that stops rather than ends, on every console; the full run measures how general that is.

## The full run

The approved run started on 2026-09-30 with `node --env-file=<the main checkout's apps/web/.env.local> apps/web/scripts/gen-bench.mjs --confirm-paid-run --concurrency 4 --max-cost-usd 70 --out .artifacts/gen-bench/full-2026-09-30`. It did not finish the set. After 188 generations had rendered, the OpenAI account ran out of prepaid credit, and every later call came back as a streamed `insufficient_quota` error, which `model.ts` reports as `model_error` ("The composition provider interrupted the response"). 43 calls failed that way, the first `dmg-39`, before the run was stopped by hand, and the last 18 prompts of the interleaved order were never sent. One more failure is the model's own: `2a03-03` wrote more simultaneous notes than the 2A03 has voices, and the render refused it ("Arrangement exceeds hardware voices"), a paid call with nothing to hear. `--resume` on the same directory sends the 62 remaining prompts (44 failed, 18 unsent) once the account has credit.

| Console | Rendered / sent | Mean cost | Model call p50 / p90 | Render p50 / p90 | `abrupt_ending` passed | `loop_click` passed | `loop_level_jump` passed |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `2a03` | 37 / 46 | $0.2547 | 89.7s / 106.4s | 2.5s / 5.0s | 10 / 23 | 13 / 14 | 14 / 14 |
| `dmg` | 38 / 47 | $0.2419 | 78.0s / 112.2s | 3.8s / 8.6s | 10 / 23 | 15 / 15 | 14 / 15 |
| `md` | 38 / 47 | $0.2992 | 84.8s / 104.9s | 12.6s / 24.3s | 10 / 23 | 13 / 15 | 15 / 15 |
| `snes` | 38 / 47 | $0.2794 | 85.3s / 110.3s | 1.0s / 2.4s | 11 / 23 | 15 / 15 | 14 / 15 |
| `c64` | 37 / 45 | $0.2547 | 90.2s / 109.7s | 2.9s / 5.9s | 13 / 23 | 14 / 14 | 13 / 14 |

`abrupt_ending` applies to the 115 generations that are not loops, the loop checks to the 73 that are. `duration_mismatch`, `clipping` and `level_jump` passed on all 188, and `silence_gap` on all but one (`dmg`).

- **Cost.** 189 priced calls (the 188 rendered and `2a03-03`) cost $50.29. A rendered generation cost $0.2661 on average ($0.0936 to $0.4530), 21% above the sample's $0.2207, which was a floor as expected: the full set asks for 43.6 seconds on average, the sample for 12 to 17. At that mean the whole set costs about $66.5, inside the approved 70 USD.
- **Latency.** The model call dominates: 86.9s at p50 and 109.6s at p90 (153.4s at most), against a render of 1 to 13 seconds at p50 (`md` is the slowest to render). End to end, 92.7s at p50 and 118.4s at p90.
- **Endings.** 61 of the 115 non-loop generations (53%) fail `abrupt_ending`, their final half second at -35.8 to -26.1 dBFS; the sample's five of five overstated it, but the model still stops rather than ends more often than not, on every console. That is the measured failure GEN-04's repair call was waiting for.
- **Known melodies.** The run is the negative set decision 56 was waiting for. Scored against the gate as it shipped (threshold 0.40), 59 of the 188 would have been refused after the paid call; decision 56's recalibration amendment has why, and what changed. With the corrected references and the 0.65 threshold, none are: p50 0.313, p90 0.385, max 0.571. The 188 generations' pitched notes are committed as `apps/web/test/melody-negatives-gen-bench.json.gz`, which `test-known-melody-similarity.mjs` scores in CI.

## When to rerun

Rerun on every model change: an `OPENAI_MODEL` change, an `OPENAI_REASONING_EFFORT` change, an adapter change in `model.ts`, or a prompt/schema change in `score.ts`. Expand the benchmark's prompt count only when the current set stops being useful, per the backlog's "expand only when useful."
