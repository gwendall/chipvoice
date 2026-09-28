# sfx-engine

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

gamesounds.ai's own procedural sound-effect synthesis engine: deterministic,
offline, float64 DSP that renders a recipe plus a seed to PCM. No third-party
audio, no recorded samples, no external generation API - see
[Decision 51](../../docs/DECISIONS.md) for why this package exists. Full
architecture, the recipe format, the model/param reference, the determinism
guarantee and the quality evidence (and its limits) are in
[`docs/GAMESOUNDS-ENGINE.md`](../../docs/GAMESOUNDS-ENGINE.md); this file is
just how to build, test and use the package.

A sound here is a recipe (JSON: which model, its params, a seed, a sample
rate) plus that seed - the same recipe renders to bit-identical PCM in Node,
Chromium, Firefox and WebKit. Two layers:

- **A low-level graph** (`model: "graph"`): nodes, params and connections -
  oscillators, noise, envelopes, filters, delay, reverb, waveshaping and four
  physically-informed models (modal synthesis, PhISEM, Karplus-Strong, a
  bubble model), wired together explicitly. `schema/recipe-1.json` is the
  full, language-agnostic shape.
- **53 high-level named presets** (`PRESETS`, e.g. `impact-metal-heavy`,
  `scifi-laser`) across 8 taxonomy families (UI, impact, footstep, whoosh,
  explosion, sci-fi, magic, pickup), each a thin, documented parametric model
  that compiles to a graph internally. Every model's `metadata` is written
  for an LLM reader: a plain-English description, each param's type/unit/
  range/default/meaning, which params jitter per seed and by how much, and
  2-4 ready-to-render examples.

Every sound this engine renders is dedicated to the public domain
(CC0-1.0) by construction: it is synthesized offline from a recipe and a
seed, never a recorded or third-party sample.

## Use

```ts
import { recipeForPreset, renderRecipe, PRESETS } from "sfx-engine";

const recipe = recipeForPreset("impact-metal-heavy", /* seed */ 7, 48000);
const rendered = renderRecipe(recipe); // { left, right, sampleRate, durationSeconds, loudness, ... }
```

`PRESETS`, `MODELS` and `getPreset` are the registry; `renderRecipe` also
accepts a raw `model: "graph"` recipe (or any plain JSON object shaped like
one - `assertValidRecipe` checks it against `schema/recipe-1.json`'s rules
before rendering).

## Build, typecheck, tests

```bash
pnpm --filter sfx-engine build              # tsc -p tsconfig.build.json
pnpm --filter sfx-engine typecheck
pnpm --filter sfx-engine test:unit          # node --test over test/*.test.mjs (133 cases)
pnpm --filter sfx-engine test:hash-fixture  # every preset x 3 seeds against a committed PCM-hash fixture
pnpm --filter sfx-engine test:perf-budget   # every preset's render time against a committed baseline, 3x regression gate
```

These four are the `sfx-engine` CI job (`.github/workflows/ci.yml`) - fast,
deterministic, and independent of the rest of the monorepo (no relation to
`apps/sounds`, `packages/gamesounds` or `packages/chipvoice`). Two more are
local-only, not in CI, since they need real browser engines or external
tooling:

```bash
pnpm --filter sfx-engine parity:check         # Node vs Chromium/Firefox/WebKit PCM-hash parity
pnpm --filter sfx-engine loudness:ffmpeg-check # cross-checks BS.1770 loudness/true-peak against ffmpeg's ebur128
pnpm --filter sfx-engine listen                # builds the self-contained listening report (see the doc above)
```

The CLAP semantic eval (`eval/`, `.artifacts/clap_eval.py`) is also
local-only, documented in `docs/GAMESOUNDS-ENGINE.md`'s quality evidence
section rather than as a pnpm script, since it needs a Python venv.

## What is not here

No `apps/sounds`, `packages/gamesounds` or `packages/chipvoice` code, and no
change to any of them - this package is additive, standalone, and has zero
runtime dependencies. No recorded audio or third-party sample library
anywhere. No voice, animal or music synthesis (out of scope for this
ticket - see `docs/GAMESOUNDS-ENGINE.md`'s "what was cut" section). No
impulse-response reverb (the reverb here is purely algorithmic, Freeverb-
style). The CLAP model checkpoint and the Python venv it runs in live under
`.artifacts/` (gitignored), not in this package's shipped `dist`.
