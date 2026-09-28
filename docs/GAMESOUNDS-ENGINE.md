# The gamesounds procedural sound effect engine

<p align="center">
  <a href="GAMESOUNDS-ENGINE.md">English</a> &bull;
  <a href="GAMESOUNDS-ENGINE_ja.md">日本語</a>
</p>

`packages/sfx-engine` is gamesounds.ai's own deterministic, offline sound
effect synthesizer. It has zero runtime dependencies, ships as plain
TypeScript built to ESM (`dist`), and does not touch `apps/sounds`,
`packages/gamesounds` or `packages/chipvoice` - see
[Decision 52](DECISIONS.md). A sound here is a recipe (JSON: which model,
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

### Continuous params

`impact`, `ui` and `whoosh` shipped with continuous params from the start
(`size`, `baseFreq`, `intensity`); `scifi`, `magic`, `pickup`, `footstep`
and `explosion` originally exposed only enums/booleans (`kind`, `weight`,
`debris`). Each of those five now also takes 2-4 continuous params, each
mapped onto a real compile-time knob (never a cosmetic label):

| Model | New params | What they scale |
| --- | --- | --- |
| `scifi` | `pitch` (semitones, -12..12), `duration` (x, 0.4..2.5), `brightness` (0..1) | Every base frequency/sweep endpoint; every branch's base duration; a post-cue lowpass (below 1) |
| `magic` | `pitch`, `duration`, `brightness` (same ranges as `scifi`) | Every gesture tone and sparkle centre frequency; every kind's base duration; a post-cue lowpass |
| `pickup` | `pitch`, `duration`, `brightness` (same ranges) | Every base frequency (for `key`, inversely via `models/modal.ts`'s `size`, since `key` has no direct frequency knob); every kind's base duration; a post-cue lowpass |
| `footstep` | `intensity` (0..1, continuous `weight`), `pitch` (semitones, -12..12) | Every quantity that used to switch on `weight` (size/strength/energy/duration); modal `size` for concrete/wood/metal only - documented as inert on gravel/snow/grass/water-puddle, since `models/phisem.ts` has no frequency-override input and grass/water-puddle are unpitched noise |
| `explosion` | `distance` (0..1, continuous "distant"), `debrisAmount` (0..1, continuous `debris`), `duration` (x, 0.4..2.5) | The reverb size/damping/mix, the post-reverb muffle cutoff and the duration bonus together; the debris layer's particle count and mix gain together; the boom/thump/debris base duration |

Every new param's default reproduces its model's pre-existing named-preset
renders bit-for-bit: `presets/helpers.ts`'s `lerpExact(lo, hi, t)` returns
`lo`/`hi` directly (no floating-point arithmetic at all) at `t<=0`/`t>=1`
rather than computing `lo + (hi-lo)*t`, which IEEE-754 does not guarantee
exact at the boundary, and `semitoneMultiplier(0) === 1` exactly (both
`0/12` and `2**0` are IEEE-754-exact). `pnpm --filter sfx-engine
test:hash-fixture` confirms this directly: all 159 hashes (53 presets x 3
seeds) are unchanged by this work.

Every `seededRange` jitter any of the eight models' `compile()` calls
(directly, or indirectly through `sparkleLayer`) is declared on
`ModelMetadata.seedJitter` as `{ label, affects, min, max }` - `label` is the
`seededRange` prefix, `affects` is the plain-English quantity it changes, and
`min`/`max` are the exact multiplicative offsets passed to `seededRange`
(e.g. `-0.1`/`0.1` for +-10%) - and mechanically checked by
`test/seed-jitter-coverage.test.mjs`, which compiles every preset and every
model's metadata `examples`, instruments `seededRange`, and fails if any
captured `(label, min, max)` is not covered by a declared entry whose prefix
matches AND whose bounds match exactly (or if a declared entry is never
actually used). One exception: `sparkleLayer`'s grain-onset-time entries
(any `label` ending in `-t`) are declared as a fraction of the cue's own
duration rather than raw seconds, since a fixed seconds figure would be
wrong at any duration other than the one it was measured at; the test scales
that entry's declared bounds by each render's actual compiled `duration`
before comparing. Every declared entry, by model:

| Model | Label | Affects | Range |
| --- | --- | --- | --- |
| `scifi` | `laser-pitch` | laser sweep start frequency | +-10% |
| `scifi` | `zap-mod` | zap ring-modulator frequency | +-15% |
| `scifi` | `teleport-from` | teleport sweep start frequency | +-8% |
| `scifi` | `teleport-to` | teleport sweep end frequency | +-8% |
| `scifi` | `teleport-vibrato` | teleport vibrato rate | +-10% |
| `scifi` | `power-range` | power up/down sweep range | +-6% |
| `scifi` | `beep-pitch` | computer beep base frequency | +-8% |
| `magic` | `cast-sparkle-t` | cast sparkle grain onset time | 0 to 80% of duration |
| `magic` | `cast-sparkle-f` | cast sparkle grain pitch spread | +-60% |
| `magic` | `cast-sparkle-g` | cast sparkle grain gain offset | 0 to +0.35 |
| `magic` | `shimmer-t` | shimmer grain onset time | 0 to 80% of duration |
| `magic` | `shimmer-f` | shimmer grain pitch spread | +-80% |
| `magic` | `shimmer-g` | shimmer grain gain offset | 0 to +0.35 |
| `magic` | `heal-sparkle-t` | heal sparkle grain onset time | 0 to 80% of duration |
| `magic` | `heal-sparkle-f` | heal sparkle grain pitch spread | +-50% |
| `magic` | `heal-sparkle-g` | heal sparkle grain gain offset | 0 to +0.35 |
| `magic` | `buff-sparkle-t` | buff sparkle grain onset time | 0 to 80% of duration |
| `magic` | `buff-sparkle-f` | buff sparkle grain pitch spread | +-60% |
| `magic` | `buff-sparkle-g` | buff sparkle grain gain offset | 0 to +0.35 |
| `pickup` | `coin-pitch` | coin tone pair frequency | +-2% |
| `pickup` | `key-size` | key modal strike size (inversely, pitch) | +-10% |
| `pickup` | `powerup-pitch` | powerup tone trio frequency | +-2% |
| `pickup` | `gem-sparkle-t` | gem sparkle grain onset time | 0 to 80% of duration |
| `pickup` | `gem-sparkle-f` | gem sparkle grain pitch spread | +-50% |
| `pickup` | `gem-sparkle-g` | gem sparkle grain gain offset | 0 to +0.35 |
| `pickup` | `levelup-sparkle-t` | level-up sparkle grain onset time | 0 to 80% of duration |
| `pickup` | `levelup-sparkle-f` | level-up sparkle grain pitch spread | +-50% |
| `pickup` | `levelup-sparkle-g` | level-up sparkle grain gain offset | 0 to +0.35 |
| `footstep` | `footstep-duration` | footstep duration | +-5% |
| `explosion` | `explosion-duration` | explosion duration | +-5% |
| `impact` | `impact-size` | impact modal size (inversely, pitch) | +-6% |
| `whoosh` | `whoosh-speed` | whoosh resolved duration (via its speed/length formula) | +-8% |
| `ui` | `ui-pitch` | UI event base pitch (when `baseFreq` is omitted) | +-2% |

The human-readable "which quantity, by how much" side of a jitter tied to
one specific param also still lives on that param's `seedJitter` prose
(e.g. `impact`'s `size` param); the table above is the mechanically-enforced
source of truth for the exact numbers.
`test/continuous-params.test.mjs` renders every new param at its declared
min/default/max, asserts the engine's own signal-sanity checks pass at each
point, and asserts one directional metric moves the documented way between
min and max (zero-crossing rate for `pitch`/`brightness`, render length for
`duration`/`intensity`/`distance`, and 100-400ms-window energy for
`debrisAmount`) - plus a negative test proving that directional assertion
would actually fail on a param wired to nothing.

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

### EBU Tech 3341 minimum requirements tests

`test/loudness.test.mjs` implements EBU Tech 3341 v4 (Geneva, November
2023), Table 1's minimum-requirements test cases 1-5 and 15-19, cited by
case number and expected value directly from that table:

- **Cases 1-2** (loudness): a steady 1kHz tone at -23.0 and -33.0 dBFS,
  momentary and integrated loudness pinned to the table's expected values.
- **Cases 3-5** (loudness): signals built to exercise the two-stage
  (absolute + relative) gate, integrated loudness pinned.
- **Cases 15-19** (true peak): a 0.5/1.41-full-scale tone at fs/4, fs/6 and
  fs/8 with various inter-sample phase offsets, each tapered with the
  10ms fade-in/fade-out the table's own case 15 text specifies (an
  unfaded, abruptly-truncated fixture was found during development to
  produce a spurious peak-interpolator edge artifact unrelated to the
  filter's real accuracy - this was caught by probing before it was
  ever committed as a test), true peak pinned to the table's
  +0.2/-0.4 dB tolerance.
- Cases 6 (multichannel), 7-8 (authentic programme material), 9-14
  (short-term-only, this module does not expose an S measurement) and
  20-23 (a stricter transient-reconstruction test beyond what this
  engine's approximate true-peak filter claims) are out of scope and
  documented as such in the test file.

Table 1's cases are stereo; this engine is mono, so each expected value is
the table's stereo figure shifted by exactly `-10*log10(2) = -3.0103` LU,
the exact loudness two bit-identical channels at BS.1770 weight 1.0
contribute over one channel alone (a consequence of the summation in the
standard's own formula, not an empirical fudge - true peak needs no shift,
since BS.1770 Annex 2 takes the max across channels, not a power sum). The
previous non-standard "~-3.0 LUFS +-0.3" full-scale smoke test was replaced
with the same case-1-derived shift, analytically pinned to
`-3.0103 +-0.1` LU rather than a rounded folklore value. Two negative
tests (reimplementing the meter with K-weighting bypassed, and separately
with the relative gate dropped, both test-local-only and never exported by
the real package) prove the K-weighting and relative-gate stages are
actually exercised: bypassing K-weighting misses case 1 by 0.691 LU,
dropping the relative gate misses case 3 by 1.155 LU, both far outside the
0.1 LU tolerance.

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

### Loudness convention across engines

This engine's own `loudness/normalize.ts` measures and gains a render as
mono, since every recipe here renders one channel, BEFORE `panToStereo`
runs (`render/renderRecipe.ts`) - so the figures it reports on
`RenderedSound.loudness` describe the pre-pan signal, not the post-pan
`left`/`right` channels a caller actually receives. Every preset in this
package renders at `pan: 0` (`graphParams.pan ?? 0`), where equal-power pan
law gives `left = right = mono * cos(pi/4)`, about -3.0103 dB - the exact
`-10*log10(2)` BS.1770 shift Table 1's stereo cases needed above, in
reverse: trusting this engine's own self-reported loudness for a rendered
`left` channel would silently ship a file that measures about 3 dB quieter
than its recorded figure claims (the trap runs opposite to the mono-vs-
dual-mono direction the paragraph below once worried about, because the
signal that reaches a listener here is one *panned* channel, not two summed
ones). GS-03 (which wires sfx-engine into the catalogue) settled this: it
found, by reading `apps/sounds/scripts/lib/audio.mjs`'s `toWavBytes`
directly (`channels = right ? 2 : 1`), that the gamesounds.ai catalogue in
fact ships every chipvoice-origin sound as mono today - chipvoice's own
`renderSfx` is never called with `stereo: true` anywhere in the catalogue
build - contrary to what this section previously assumed ("stereo 44.1 kHz
for most catalogue sources"). Generated sounds ship mono wav and mp3 too,
for that measured reason, not the suggested-by-default alternative (ogg is
the one exception, and is not uniform across build machines - see Decision
54): each variant's own `RenderedSound.left` (valid as the shipped mono
signal exactly because `left === right` at `pan: 0`) is fed through the
catalogue's own `levelToConvention`, which re-measures the actual shipped
mono bytes rather than trusting this engine's pre-pan self-report - never
the reverse. See [Decision 54](DECISIONS.md) and the "Loudness" section of
[GAMESOUNDS.md](GAMESOUNDS.md).

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
a Python venv under `.artifacts/` (gitignored). The eval script itself is
tracked at `eval/clap_eval.py`, with pinned dependency versions in
`eval/requirements.txt`:

```
python3 -m venv packages/sfx-engine/.artifacts/venv
packages/sfx-engine/.artifacts/venv/bin/pip install \
  numpy==1.26.4 scipy==1.17.1 torch==2.14.0 laion_clap==1.1.7

# from packages/sfx-engine/
node scripts/build-clap-audio.mjs
.artifacts/venv/bin/python3 eval/clap_eval.py
```

`eval/prompts.json` is a fixed set of 53 plain-English sound descriptions,
one per preset, written once before any of this ran and never edited
afterward - presets were not tuned against these prompts, so there is no
held-out second prompt set (nothing was iterated against this eval).
`scripts/build-clap-audio.mjs` renders two 48 kHz mono WAV sets at each of
4 seeds (`SEEDS = [1, 2, 3, 4]`, not just each preset's own reference seed):
`real` (every preset, normally) and `degraded` (the same preset/seed's
compiled graph put through `scripts/clap-degrade-graph.mjs`, which removes
every `filter`/`shaper`/`delay`/`reverb` node, flattens every `envelope`/
`sweep` node to a constant, and replaces every physically-informed
generator - `modal`, `phisem`, `karplus`, `bubble` - with plain white noise,
leaving only raw oscillators/noise/constants wired the same way).
`eval/clap_eval.py` embeds all 53 prompts and both audio sets, and for each
seed runs a separate 53-prompt vs 53-audio retrieval (an item's correct
match is always among that same seed's 53 candidates, never mixed across
seeds), then pools the resulting per-(item, seed) hit/miss outcomes into 212
trials per condition for the descriptive rates below. A preset's 4
seed-renders are NOT independent trials, though - a seed only jitters a
recipe a few percent (see "Continuous params" above, `ModelMetadata.seedJitter`) -
so every significance test below treats the preset (n=53), not the
(item, seed) trial (n=212), as the unit of analysis.

| Condition | What it measures |
| --- | --- |
| `real` | The number this ticket reports as the CLAP result |
| `shuffled labels` | The same audio and prompts, graded against a shuffled (derangement) pairing, averaged over 5 random derangements per seed (20 total) - a sanity check on the retrieval methodology itself, expected at chance level |
| `degraded engine` | The same prompts against the degraded audio set - must score clearly worse than `real`, or the metric is not measuring anything |

**Numbers (from `.artifacts/clap-report.json`, laion_clap
`630k-audioset-best.pt`, non-fusion, pooled across 4 seeds, 212 trials per
condition):**

| Condition | top-1 | top-5 |
| --- | --- | --- |
| `real` | 10.4% (22/212) | 37.7% (80/212) |
| `shuffled labels` | 1.4% (theoretical chance 1.9%) | 8.9% (theoretical chance 9.4%) |
| `degraded engine` | 4.7% (10/212) | 21.7% (46/212) |

**Pre-declared statistical tests (alpha 0.05, exact tests):** the unit of
analysis is the preset (n=53), not the (item, seed) trial (n=212) - a
preset's 4 seed-renders differ only by a few-percent seed jitter, so they
are correlated, not independent Bernoulli draws, and treating them as 212
independent trials (an earlier version of this eval did exactly that)
understates every p-value below. `real` and `degraded` vs chance use an
exact permutation (randomization) test: `NUM_PERMUTATION_REPS = 10000` reps,
RNG seed `PERMUTATION_RNG_SEED = 20260929` (both in `eval/clap_eval.py`),
each rep draws ONE permutation of the prompt<->audio correspondence and
applies that SAME permutation to all 4 seeds, summing top-k hits across
them into an empirical null distribution for that pooled total. The
permutation is shared across a preset's seeds, not redrawn per seed,
because the preset - not the (item, seed) trial - is the exchangeable unit
under the null: a preset's 4 seed-renders are correlated in the real data
(a seed only jitters a recipe a few percent), so the null must correlate
them the same way, or it is narrower than the true null and every p-value
is anti-conservative (an earlier version of this eval drew an independent
permutation per seed, which has exactly this bug). A self-check in the
script, `_self_check_permutation_clustering()`, proves the fix holds: with
synthetic embeddings where a preset's 4 seeds are identical, the
shared-permutation null's std comes out at exactly 4x a single seed's std,
not ~2x (what independent per-seed permutations would give, since that
sums 4 near-independent draws rather than 4 copies of one draw). Chosen
over the alternative considered (a per-preset "hit in >= k of 4 seeds"
binomial against the exact chance rate for that threshold event) because it
uses the real embedding geometry directly rather than an assumed per-trial
chance rate, needs no independence assumption between a preset's seeds at
all, and does not throw away the 0-4 hit count's magnitude the way
binarizing "hit in >= k of 4" would. `real` vs `degraded` uses a paired
exact sign test over the 53 presets' (hits_real - hits_degraded) out of 4
seeds, ties dropped, one-sided. `shuffled` is not one of these preset-level
tests: it stays a pooled, two-sided sanity check on whether the retrieval
methodology itself is unbiased toward the true pairing (not a claim this
eval leans on), so it is reported as a descriptive rate only (in the
"Numbers" table above), not in the significance table below.

| Test | top-1 p-value | top-5 p-value |
| --- | --- | --- |
| `real` vs chance (permutation, greater) | <0.0001 (significant) | <0.0001 (significant) |
| `degraded` vs chance (permutation, greater) | 0.0585 (not significant) | 0.0004 (significant) |
| `real` vs `degraded`, preset-level paired sign test (real greater) | 0.395 (not significant) | 0.055 (not significant) |

The pooled-trial binomial p-values below assume independent trials, which
the seed clustering above rules out, so they are dropped as significance
tests and kept only as descriptive rates in
`.artifacts/clap-report.json`, labeled `*_pooled_212_DESCRIPTIVE_ONLY` (real
vs chance top-1 p=1.61e-10, top-5 p=1.40e-28; degraded vs chance top-1
p=0.0075, top-5 p=7.38e-08 - all far more extreme than the correct
preset-level numbers above, exactly the anti-conservative pattern
non-independence produces) and `shuffled_vs_chance_pooled_DESCRIPTIVE_ONLY`
(53 presets x 4 seeds x 5 derangements = 1060 trials, two-sided: top-1
p=0.309, top-5 p=0.563). An earlier, pre-preset-level version of this
section had also reported a pooled-212 real-vs-degraded paired sign test
(top-1 p=0.0251, top-5 p=0.00062, both "significant"); that number is
dropped as invalid under the same clustering, not reconciled against the
numbers above.

Read plainly, and without re-framing: `real` beats chance decisively at
both top-1 and top-5 - this engine's audio is genuinely retrievable by a
general-purpose text-audio model, not just superficially different from
noise. `degraded` also beats chance at top-5 (p=0.0004) but, once the
permutation null correctly accounts for seed clustering, no longer beats
chance at top-1 (p=0.0585, just past alpha=0.05): a stripped-down,
noise-based render still carries enough duration/coarse-spectral-tilt/
onset-rhythm signal to be recognizable in the top 5, but not reliably as
the single best match. This is a change from what an earlier pass of this
eval reported here (top-1 p=0.0066, "significant") - that number came from
a bug in the permutation test itself (an independent permutation was drawn
per seed instead of one shared per replicate across a preset's 4 seeds),
which made the null narrower than the true clustered null and every
p-value in this row anti-conservative; the self-check above exists because
of that bug. At the preset level, with only 53 independent units, `real`
does **not** beat `degraded` at a statistically significant level either:
the preset-level paired sign test gives top-1 p=0.395 (8 of 53 presets
where `real` scored higher, 6 where `degraded` did, 39 ties) and top-5
p=0.055 (21 vs 11, 21 ties) - close, but on the wrong side of alpha=0.05.
This is a real weakening from the earlier, pre-preset-level (invalid,
pooled-212) analysis, which had reported this exact comparison as
significant at both top-1 and top-5; the honest reading is that this eval,
at 53 presets, does not have enough statistical power to confirm that
filters/envelopes/physically-informed generators measurably improve
CLAP-recognizability over the degraded control, even though `real`'s
descriptive numbers (37.7% top-5 vs 21.7% for `degraded`) point that way.
Seeding more renders of the same 53 presets would not fix this - seeds are
exactly the correlated, non-independent axis causing the problem; more
presets would.

Per-family confusion (`real` condition, top-1 predictions, pooled over 4
seeds; rows are the prompt's actual family, columns are the family of the
preset CLAP ranked most similar; each row sums to that family's preset
count times 4 seeds):

| Actual \ Predicted | ui | impact | footstep | whoosh | explosion | scifi | magic | pickup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ui | 8 | 13 | 6 | 0 | 0 | 7 | 0 | 2 |
| impact | 8 | 32 | 0 | 0 | 0 | 8 | 0 | 0 |
| footstep | 0 | 16 | 11 | 1 | 0 | 0 | 0 | 0 |
| whoosh | 0 | 0 | 0 | 16 | 0 | 0 | 0 | 0 |
| explosion | 0 | 5 | 0 | 0 | 1 | 2 | 4 | 0 |
| scifi | 4 | 4 | 0 | 16 | 0 | 8 | 0 | 0 |
| magic | 5 | 2 | 0 | 0 | 0 | 0 | 0 | 13 |
| pickup | 4 | 6 | 6 | 0 | 0 | 0 | 0 | 4 |

That matrix's diagonal is a looser metric than the headline numbers above:
"did CLAP's top-1 guess land in the right family at all", even when it
missed the exact preset. The metric that actually backs the headline `real`
top-1 rate is the stricter one, exact preset per family:

| Family | Exact top-1 hits / trials | Rate |
| --- | --- | --- |
| ui | 0/36 | 0% |
| impact | 8/48 | 16.7% |
| footstep | 2/28 | 7.1% |
| whoosh | 7/16 | 43.8% |
| explosion | 1/12 | 8.3% |
| scifi | 4/32 | 12.5% |
| magic | 0/20 | 0% |
| pickup | 0/20 | 0% |

Read honestly: on this stricter exact-preset metric, `whoosh` is the
strongest family by far (7/16, 43.8%), followed by `impact` (8/48, 16.7%)
and `scifi` (4/32, 12.5%); `ui`, `magic`, and `pickup` are all exactly zero
(0/36, 0/20, 0/20), and `footstep` (2/28, 7.1%) and `explosion` (1/12, 8.3%)
are barely above zero. The looser family-diagonal reading in the confusion
matrix above is more forgiving - CLAP's top-1 guess lands in the right
family 66.7% of the time for `impact`, 39.3% for `footstep`, and 100% for
`whoosh` even when it misses the exact preset - but three families (`magic`
at 0/20, `pickup` at 4/20, `explosion` at 1/12) are weak on both readings.
`magic`'s top-1 guess is `pickup` 13 times out of 20, a plausible confusion
rather than a random failure (both are short, bright, tonal blips built
from the same layered-tone-plus-ADSR-envelope block), and `footstep` is
guessed as `impact` more than half the time (16/28), another plausible pair
(both are short transient collision sounds) rather than a sign the
retrieval itself is broken - the `shuffled` control above already rules
that out.

An earlier, single-seed, pre-statistical pass over this same eval had
informally cited figures like "explosion 0/3" and "pickup 1/5" for the
family-diagonal reading above. Those were single-seed spot-checks (12x and
20x fewer trials than the pooled numbers here) taken before this eval had
pinned dependency versions, a tracked script path, or pre-declared
statistical tests; they are superseded by the pooled, statistically tested
results in this section, not reconciled against them.

If the pre-declared tests above had not shown `real` beating chance, or had
shown `shuffled` behaving as anything but chance, this section would say so
plainly instead of quoting the numbers as evidence of quality. They did not
show that; they did show `real`-vs-`degraded` losing significance once
seed-clustering is accounted for, and, once the permutation null was
corrected to actually share one permutation per replicate across a
preset's 4 seeds instead of drawing one independently per seed, `degraded`
itself losing significance vs chance at top-1 (p=0.0585, was p=0.0066
under the bugged, anti-conservative null) - both are reported plainly above
rather than smoothed over. `real`'s numbers stand as evidence of beating
chance at both top-1 and top-5; not (yet, at this sample size) as evidence
of beating the degraded control. See "Limits of this evidence" below for
what they do not cover.

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
pnpm --filter sfx-engine test:unit          # node --test over test/*.test.mjs, 166 cases
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
