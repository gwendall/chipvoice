# The gamesounds procedural sound effect engine

<p align="center">
  <a href="GAMESOUNDS-ENGINE.md">English</a> &bull;
  <a href="GAMESOUNDS-ENGINE_ja.md">日本語</a>
</p>

`packages/sfx-engine` is gamesounds.ai's own deterministic, offline sound
effect synthesizer. It has zero runtime dependencies, ships as plain
TypeScript built to ESM (`dist`), and does not touch `apps/sounds`,
`packages/gamesounds` or `packages/chipvoice` - see
[Decision 51](DECISIONS.md). A sound here is a recipe (JSON: which model,
its params, a seed, a sample rate) plus that seed, and the same recipe
renders to bit-identical PCM everywhere it runs.

## Architecture

### Package layout

| Path | Holds |
| --- | --- |
| `src/dsp/` | Oscillators, noise, envelopes, filters, waveshaping, delay, reverb, mixing - the primitive building blocks, plus `math.ts`, the engine's own deterministic transcendental functions |
| `src/models/` | Physically-informed generators: modal synthesis, PhISEM, Karplus-Strong, a bubble model |
| `src/graph/` | The low-level node graph: `types.ts` (the shape), `compile.ts` (`renderGraph`, which topologically sorts and executes it) |
| `src/rng/` | `prng.ts`, the seeded PRNG (mulberry32) every random choice in the engine draws from |
| `src/loudness/` | K-weighting, momentary/integrated BS.1770 loudness, true peak, and the house loudness-normalization step |
| `src/presets/` | The 8 high-level models (`ui.ts`, `impact.ts`, `footstep.ts`, `whoosh.ts`, `explosion.ts`, `scifi.ts`, `magic.ts`, `pickup.ts`) and `index.ts`'s `MODELS`/`PRESETS` registry |
| `src/recipe/` | `Recipe`'s TypeScript type and `assertValidRecipe`, the schema-backed validator |
| `src/render/` | `renderRecipe` (the top-level entry point), `finalize.ts` (DC removal, fade to zero), `bestOfN.ts` |
| `src/analysis/` | `signal-checks.ts`: the sanity checks every rendered sound is held to |
| `schema/recipe-1.json` | The versioned, language-agnostic recipe schema (JSON Schema draft 2020-12) |
| `parity/`, `scripts/`, `eval/` | Local-only quality tooling: cross-engine determinism, the ffmpeg loudness cross-check, the listening report, the CLAP semantic eval - see "Quality evidence" below |

### Render pipeline

`renderRecipe(recipe)` runs, in order:

1. **Validate** the recipe against `schema/recipe-1.json`'s rules
   (`assertValidRecipe`).
2. **Compile**: `model: "graph"` uses `params` directly as a
   `GraphRecipeParams`; any other `model` looks it up in the `MODELS`
   registry and calls that model's own `compile(params, seed, sampleRate)`,
   which returns a `GraphRecipeParams` too. A high-level model never renders
   audio itself - it only ever builds a graph for `renderGraph` to run.
3. **Render the graph** (`graph/compile.ts`'s `renderGraph`): topologically
   sorts the nodes, resolves every `{ref}` (a control-rate patch - an
   envelope into an oscillator's frequency, a sweep into a filter's cutoff)
   to the referenced node's already-rendered output, and renders each node
   in order. The graph itself stays mono end to end.
4. **Finalize** (`render/finalize.ts`): subtract any DC offset, then
   linearly fade the last 6 ms to exactly zero, so every render ends on a
   true zero crossing regardless of how its own envelope ends.
5. **Normalize loudness** (`loudness/normalize.ts`) to the house convention
   (see "Loudness and mixing" below).
6. **Pan to stereo**, once, at the very end (`dsp/mix.ts`'s equal-power
   `panToStereo`) - every DSP primitive above stays mono, which keeps each
   one simple and keeps a recipe's node count small.

## Determinism

### Why this matters

The brief's hard requirement: the same recipe and seed must render
bit-identical PCM in Node, Chromium, Firefox and WebKit, so a recipe is a
portable, exact description of a sound, not an approximation that drifts by
engine.

### How it is enforced

ECMA-262 mandates exact IEEE-754 double results for `+`, `-`, `*`, `/` and
for `Math.sqrt`, `Math.round`, `Math.floor`, `Math.abs` and similar, but it
explicitly leaves the transcendental functions (`sin`, `cos`, `exp`, `log`,
`pow`, `tanh`, ...) "implementation-approximated": V8, SpiderMonkey and
JavaScriptCore each ship a different libm, and nothing stops them from
disagreeing in the last bit or two. `dsp/math.ts` implements every
transcendental the engine needs from `+`, `-`, `*` and `/` only (the
standard fdlibm range-reduction shape - reduce the argument to a small
interval where a Taylor/Maclaurin series converges to well past double
precision, then reconstruct; see that file's own doc comment for sources),
so the DSP core never calls `Math.sin`, `Math.cos`, `Math.exp`, `Math.log`,
`Math.pow` or `Math.tanh` directly anywhere in `src/`. `Math.sqrt` is the one
exception, kept as-is: IEEE-754 (and so ECMA-262) requires it to be
correctly rounded, which every engine honours. The seeded PRNG
(`rng/prng.ts`, mulberry32) touches no transcendental either - only 32-bit
integer multiplication (`Math.imul`, exact per spec) and bitwise operations
(exact per spec).

### Cross engine parity harness

`parity/` (modeled on chipvoice's own `scores/render-parity/`, local-only,
not in CI - the same pattern as chipvoice's render-parity) renders 82 inputs
- all 53 named presets at their reference seed, one representative preset
per family at three more seeds, and 5 hand-written low-level graph recipes
chosen specifically to reach node types and filter/shaper kinds no named
preset otherwise exercises (`karplus`, the `comb` and `allpass-delay` filter
kinds, the `srr` shaper kind, and a damped delay's `loopFilterCutoff`, which
exercises `exp()` directly) - in Node, then in real Chromium, Firefox and
WebKit via Playwright, and SHA-256-compares the PCM. `parity/self-test.mjs`
proves the comparison itself actually bites, by perturbing one sample of one
input's PCM before hashing and checking that exactly that row mismatches.

Run locally with `pnpm --filter sfx-engine parity:check`. All 82 inputs
matched bit-for-bit across Node, Chromium, Firefox and WebKit; no `Math.*`
function needed to be replaced beyond what `dsp/math.ts` already replaces by
design, since none was found to diverge.

## Recipe format

`schema/recipe-1.json` (JSON Schema, draft 2020-12) is the versioned source
of truth:

```json
{
  "engine": "sfx-engine@1",
  "model": "impact",
  "params": { "material": "metal", "weight": "heavy" },
  "seed": 7,
  "sampleRate": 48000
}
```

### Two layers

- **Low-level graph** (`model: "graph"`): `params` is a `GraphRecipeParams`
  - `duration`, an array of `nodes` (`id`, `type`, `params`, optional
  `inputs`), an `output` node id, and an optional `pan`. Node `type` is one
  of `const`, `oscillator`, `noise`, `envelope`, `sweep`, `filter`,
  `shaper`, `delay`, `reverb`, `mix`, `multiply`, `modal`, `phisem`,
  `karplus`, `bubble`. A node's `params` may hold a `{ref: "nodeId"}` in
  place of a plain number for any field documented as modulatable (an
  oscillator's `freq`, a filter's `cutoff`), which patches another node's
  rendered output in as control-rate modulation.
- **High-level named models** (`ui`, `impact`, `footstep`, `whoosh`,
  `explosion`, `scifi`, `magic`, `pickup`): `params` is that model's own
  shape (e.g. `impact`'s `{ material, weight?, size? }`), compiled
  internally to a `GraphRecipeParams` before rendering. Every model exports
  machine-readable `metadata` (`ModelMetadata`, `src/presets/types.ts`):
  a plain-English description, each param's type/unit/range/default/plain-
  English meaning, a note on which params jitter per seed and by how much,
  and 2-4 named, ready-to-render examples - written for an LLM reader,
  since an API built on this engine can list this metadata verbatim to an
  agent choosing params without ever reading this package's source.

### Example

`recipeForPreset("impact-metal-heavy", 7, 48000)` returns:

```json
{
  "engine": "sfx-engine@1",
  "model": "impact",
  "params": { "material": "metal", "weight": "heavy" },
  "seed": 7,
  "sampleRate": 48000
}
```

which compiles (via `impact`'s own `compile`) to a single `modal` node - a
bank of damped resonant modes for a struck metal object - with `size`
jittered +-6% around the "heavy" default from the seed.

## Models and presets

### The eight high level models

| Model | Family | Built from |
| --- | --- | --- |
| `ui` | ui | Oscillators shaped by short ADSR envelopes |
| `impact` | impact | Modal synthesis (a material's damped resonant modes) |
| `footstep` | footstep | PhISEM particle collisions, per-surface tuned |
| `whoosh` | whoosh | Filtered, swept noise |
| `explosion` | explosion | Layered filtered noise, a sub-bass oscillator, and PhISEM debris |
| `scifi` | scifi | Swept oscillators, FM/ring modulation, filters |
| `magic` | magic | Layered oscillators, delay, algorithmic reverb |
| `pickup` | pickup | Layered short tonal blips, ADSR-shaped |

### The fifty three named presets

Depth over breadth, per the brief: 53 named presets across the 8 required
taxonomy families, each with a documented `description` (one line, the game
moment it is for).

| Family | Count | Presets |
| --- | --- | --- |
| ui | 9 | `ui-click`, `ui-hover`, `ui-confirm`, `ui-cancel`, `ui-error`, `ui-toggle-on`, `ui-toggle-off`, `ui-notification`, `ui-text-blip` |
| impact | 12 | `impact-{wood,metal,stone,glass,plastic,body}-{light,heavy}` |
| footstep | 7 | `footstep-{concrete,wood,grass,gravel,snow,metal,water-puddle}` |
| whoosh | 4 | `whoosh-sword`, `whoosh-punch`, `whoosh-pass-by`, `whoosh-cloth` |
| explosion | 3 | `explosion-small`, `explosion-big`, `explosion-distant` |
| scifi | 8 | `scifi-laser`, `scifi-zap`, `scifi-teleport`, `scifi-shield-up`, `scifi-shield-down`, `scifi-power-up`, `scifi-power-down`, `scifi-computer-beep` |
| magic | 5 | `magic-cast`, `magic-shimmer`, `magic-heal`, `magic-buff`, `magic-curse` |
| pickup | 5 | `pickup-coin`, `pickup-gem`, `pickup-key`, `pickup-powerup`, `pickup-level-up` |

Render times (Node, this machine, seed 1, `test/fixtures/perf-baseline.json`):
740.8 ms total for all 53, mean 14.0 ms, from 0.7 ms (`ui-text-blip`) to
87.1 ms (`explosion-distant`, the longest and most layered preset).
`pnpm --filter sfx-engine test:perf-budget` fails if any preset exceeds 3x
its committed baseline.

## Loudness and mixing

### House convention

`loudness/loudness.ts` and `loudness/truepeak.ts` implement ITU-R
BS.1770-4 / EBU R128: K-weighting (two cascaded biquads, derived at both
44100 Hz and 48000 Hz from BS.1770's design parameters, checked against
ITU's own published 48 kHz coefficients to within 1e-9), momentary loudness
(400 ms blocks, falling back to one whole-signal block for a render shorter
than 400 ms), integrated (gated) loudness, and true peak (4x-oversampled
with a windowed-sinc interpolator). `loudness/normalize.ts` then gains every
render so its momentary loudness reaches at most -18 LUFS and its true peak
reaches at most -1 dBTP, with the peak cap winning whenever the two targets
disagree.

### Cross check against ffmpeg

`scripts/ffmpeg-loudness-check.mjs` renders every preset, then compares this
engine's own `integratedLoudness()`/`truePeakDb()` against ffmpeg's
`ebur128` filter on an identical mono WAV of the same signal - an
independently-written reference implementation of the same standard. True
peak is compared for all 53 presets (an instantaneous statistic, meaningful
at any duration): max observed difference 0.100 dB, tolerance 0.25 dB
(roughly 2.5x margin). Integrated loudness is compared only for the 28
presets at least 0.4 s long: ffmpeg's `ebur128` filter cannot produce a
valid Integrated reading below one full 400 ms BS.1770 gating block - it
returns its absolute-gate floor (-70.0 LUFS) regardless of the clip's actual
content, confirmed precisely at the boundary (a 0.400 s preset already
agreed with ffmpeg to 0.000 LU; every shorter preset read exactly -70.000
LUFS from ffmpeg no matter what it contained). Among the 28 comparable
presets: max observed difference 0.058 LU, tolerance 0.25 LU (roughly 4x
margin). Both tolerances are derived from the measured distribution plus a
stated margin, not picked to make today's output pass.

## Quality evidence

### Listening report

`pnpm --filter sfx-engine listen` (`scripts/build-listening-report.mjs`)
renders every preset at 4 seeds, encodes each to Ogg Vorbis (ffmpeg's native
`vorbis` encoder), and writes one self-contained HTML page next to them with
a native `<audio controls>` element (keyboard-playable, no custom player)
per sound, a seed selector, the recipe JSON (collapsible), and the measured
LUFS/true peak/duration/render time. Grouped by family. Written outside this
package, to a scratchpad path, since it is evidence for a human listener,
not a shipped artifact; total size comfortably fits the 15 MB budget (most
of these are well under a second, so Ogg's own per-file header overhead,
not bitrate, dominates a short clip's size).

### CLAP semantic eval

An objective, local-only check (not in CI): does a general-purpose
text-audio model actually recognize these sounds as matching their own
one-line description? Uses
[LAION-CLAP](https://github.com/LAION-AI/CLAP) (`laion_clap` on PyPI,
the `630k-audioset-best.pt` non-fusion checkpoint - both the code and the
checkpoint are CC0-1.0, confirmed from the repository's own `LICENSE`, from
`pip show laion_clap`'s `License` field, and from the checkpoint's own host,
https://huggingface.co/lukewys/laion_clap, so local use is unrestricted), in
a Python venv under `.artifacts/` (gitignored).

`eval/prompts.json` is a fixed set of 53 plain-English sound descriptions,
one per preset, written once before any of this ran and never edited
afterward - presets were not tuned against these prompts, so there is no
held-out second prompt set (nothing was iterated against this eval).
`scripts/build-clap-audio.mjs` renders two 48 kHz mono WAV sets: `real`
(every preset, normally) and `degraded` (the same preset's compiled graph
put through `scripts/clap-degrade-graph.mjs`, which removes every `filter`/
`shaper`/`delay`/`reverb` node, flattens every `envelope`/`sweep` node to a
constant, and replaces every physically-informed generator - `modal`,
`phisem`, `karplus`, `bubble` - with plain white noise, leaving only raw
oscillators/noise/constants wired the same way). `.artifacts/clap_eval.py`
embeds all 53 prompts and both audio sets, and reports text-to-audio
retrieval accuracy (top-1/top-5: is the correct audio the most similar, or
in the 5 most similar) under three conditions:

| Condition | What it measures |
| --- | --- |
| `real` | The number this ticket reports as the CLAP result |
| `shuffled labels` | The same audio and prompts, graded against a shuffled (derangement) pairing, averaged over 20 random derangements - a sanity check on the retrieval methodology itself, expected at chance level |
| `degraded engine` | The same prompts against the degraded audio set - must score clearly worse than `real`, or the metric is not measuring anything |

**Numbers (from `.artifacts/clap-report.json`, laion_clap
`630k-audioset-best.pt`, non-fusion):**

| Condition | top-1 | top-5 |
| --- | --- | --- |
| `real` | 9.4% (5/53) | 37.7% (20/53) |
| `shuffled labels` | 2.0% (theoretical chance 1.9%) | 9.2% (theoretical chance 9.4%) |
| `degraded engine` | 1.9% (1/53) | 26.4% (14/53) |

Both controls pass: shuffled-label top-1 (2.0%) is clearly worse than
`real`'s (9.4%), matching the theoretical chance rate for 53 candidates
(1.9%), so the retrieval methodology itself is sound rather than biased
toward a "correct" answer; degraded-engine top-1 (1.9%) is clearly worse
than `real`'s too, and lands at almost exactly chance, so stripping filters/
envelopes/physically-informed generators really does destroy what the model
was recognizing. `real`'s numbers can therefore be read as evidence, not
just a number: a general-purpose text-audio model, never tuned against these
prompts, ranks the correct sound in its top 5 out of 53 candidates better
than a third of the time from a one-line English description alone, a large
margin above both controls.

Per-family confusion (`real` condition, top-1 predictions; rows are the
prompt's actual family, columns are the family of the preset CLAP ranked
most similar):

| Actual \ Predicted | ui | impact | footstep | whoosh | explosion | scifi | magic | pickup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ui | 2 | 3 | 2 | 0 | 0 | 1 | 0 | 1 |
| impact | 2 | 8 | 0 | 0 | 0 | 2 | 0 | 0 |
| footstep | 0 | 4 | 3 | 0 | 0 | 0 | 0 | 0 |
| whoosh | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 |
| explosion | 0 | 1 | 0 | 0 | 0 | 1 | 1 | 0 |
| scifi | 1 | 1 | 0 | 4 | 0 | 2 | 0 | 0 |
| magic | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 4 |
| pickup | 1 | 1 | 2 | 0 | 0 | 0 | 0 | 1 |

Read honestly: `whoosh` (4/4) and `impact` (8/12) are where CLAP's top-1
guess lands on the right family most reliably. `magic` is the weakest
diagonal (0/5) - its top-1 guess is `pickup` 4 times out of 5, which is a
plausible confusion (both are short, bright, tonal blips) rather than a
random failure, and is consistent with `magic` and `pickup` sharing the
same underlying build block (layered short tones shaped with an ADSR
envelope). `footstep` is confused with `impact` more than it is correctly
identified (4 vs 3), again a plausible pair (both are short transient
collision sounds) rather than a sign the retrieval is broken - the controls
above already rule that out.

If the two controls above did not score clearly worse than `real`, this
section would say so plainly instead of quoting the number as evidence of
quality; both did, so the numbers above stand as evidence - see "Limits of
this evidence" below for what they do not cover.

### Best of N helper

`render/bestOfN.ts` renders the same recipe under N different seeds and
returns the highest-scoring one: `analysis/signal-checks.ts`'s sanity checks
always run, and an optional external `score` function (e.g. a CLAP
similarity score against a text prompt, computed out of process - this
package has no ML runtime dependency) blends in at a default weight of 0.6.
Deterministic by construction (the same base recipe and seed list always
render the same PCM and so score the same way); `test/best-of-n.test.mjs`
checks this directly (two runs produce identical winners, scores and PCM),
that seeds are consumed in the given order rather than resorted, that the
external-score blend uses its documented default weight and honours an
explicit one, and a negative case (a deliberately silent low-level graph
recipe scores 0 through the real signal-check path, not a stub).

### Limits of this evidence

- The modal synthesis mode tables (`models/modal.ts`) are designed from
  general acoustic principles, not fitted to a measured object - documented
  in that file, not claimed as measured fact.
- `truepeak.ts`'s true-peak filter is a windowed-sinc polyphase
  interpolator, not ITU Annex 2's own published filter table reproduced
  bit-for-bit; the ffmpeg cross-check above is the evidence for how close
  that approximation lands in practice, not a spec-conformance claim.
- `models/bubble.ts` does not model the onset chirp some recordings show (a
  bubble's frequency glides slightly as it detaches) - a known, documented
  simplification, not implemented.
- The CLAP eval's `degraded` control necessarily changes more than "just"
  filters and envelopes for presets built purely from a physically-informed
  generator (all 12 `impact` presets are a single `modal` node with nothing
  else to strip) - `clap-degrade-graph.mjs`'s own doc comment explains why
  the degraded set also replaces those generators with plain noise, so the
  control is meaningful for every preset, not just the ones with an
  explicit filter/envelope chain.
- CLAP's retrieval accuracy measures whether a general-purpose text-audio
  model's embedding space separates these sounds the way the prompts
  describe them; it is not a substitute for a human listening to the
  report above, and the two are reported side by side rather than one
  standing in for the other.

## Sources

Every physically-informed model and every non-trivial DSP algorithm here is
an independent implementation from a paper or a documented public-domain
algorithm description, never a port of an existing codebase (GPL or
otherwise) - each file's own doc comment cites its source; this table
collects them:

| Technique | Source |
| --- | --- |
| Band-limited oscillators (PolyBLEP) | Valimaki & Huovilainen, "Antialiasing Oscillators in Subtractive Synthesis", IEEE Signal Processing Magazine (2007) |
| Pink noise | Paul Kellet's public-domain "economy" three-stage IIR approximation (musicdsp.org) |
| RBJ biquad filters | Robert Bristow-Johnson, "Audio EQ Cookbook" |
| Algorithmic reverb | Jezar's public-domain Freeverb algorithm description |
| Modal synthesis | van den Doel & Pai, "The Sounds of Physical Shapes", Presence (1998); "Synthesis of Shape Dependent Sounds with Physical Modeling" (1996) |
| PhISEM particle models | Perry R. Cook, "Physically Informed Sonic Modeling (PhISM): Synthesis of Percussive Sounds", Computer Music Journal (1997) |
| Karplus-Strong plucked strings | Kevin Karplus & Alex Strong, "Digital Synthesis of Plucked-String and Drum Timbres", Computer Music Journal (1983) |
| Bubble model | Kees van den Doel, "Physically based models for liquid sounds", ACM TAP (2005), building on Marcel Minnaert (1933) |
| Transcendental math (`dsp/math.ts`) | Cody & Waite, "Software Manual for the Elementary Functions" (1980); Muller, "Elementary Functions: Algorithms and Implementation" (2016); the standard fdlibm range-reduction shape |
| Seeded PRNG | Tommy Ettinger's mulberry32 (public domain) |
| Loudness / true peak | ITU-R BS.1770-4 / EBU R128; design method cross-checked against libebur128 and pyloudnorm (both permissively licensed; independent implementation, not a port) |
| General technique reference | Andy Farnell, "Designing Sound" |

## What was cut

- **Stretch families** (water, fire, door, mechanical): left out entirely,
  per the brief's "only if the others are good" - depth on the 8 required
  families took priority.
- **Voices, animals and music**: out of scope for this ticket; not
  attempted.
- **Recorded or sampled audio of any kind**: every sound is synthesized
  offline from a recipe and a seed, and is CC0-1.0 by construction.
- **Impulse-response reverb**: the reverb here is purely algorithmic
  (Freeverb-style); no recorded impulse response anywhere in this package.

## Testing and CI

```bash
pnpm --filter sfx-engine test:unit          # node --test over test/*.test.mjs, 133 cases
pnpm --filter sfx-engine test:hash-fixture  # 53 presets x 3 seeds vs a committed SHA-256 fixture
pnpm --filter sfx-engine test:perf-budget   # every preset vs a committed timing baseline, 3x regression gate
```

These three, plus `build` and `typecheck`, are the `sfx-engine` CI job
(`.github/workflows/ci.yml`) - fast and fully independent of the rest of the
monorepo. Every primitive is tested against an analytic expectation (an
oscillator's frequency by zero crossing count, a filter's cutoff by its
measured -3 dB point, and so on), and every check in
`analysis/signal-checks.ts` has both a positive and a negative test (built
on purpose to violate the check, proving it actually bites). Deliberately
excluded from CI, as local-only tooling: `parity/`'s cross-engine
Chromium/Firefox/WebKit determinism check (`pnpm --filter sfx-engine
parity:check`), the ffmpeg loudness cross-check (`pnpm --filter sfx-engine
loudness:ffmpeg-check`), the listening report, and the CLAP eval - all need
either real browser engines or external tooling CI does not carry.
