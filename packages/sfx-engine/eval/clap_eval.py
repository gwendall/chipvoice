#!/usr/bin/env python3
"""
GS-02's objective semantic check: text-to-audio retrieval with LAION-CLAP
(https://github.com/LAION-AI/CLAP, code and pretrained checkpoints both
CC0-1.0 - confirmed from the repo's own LICENSE and from `pip show
laion_clap`'s License field, and from the checkpoint host
https://huggingface.co/lukewys/laion_clap's license, so local use for this
eval is unrestricted). Local-only tooling, not run in CI, per the brief.

Setup (once), pinned versions (see also `eval/requirements.txt`):

    python3 -m venv packages/sfx-engine/.artifacts/venv
    packages/sfx-engine/.artifacts/venv/bin/pip install \
      numpy==1.26.4 scipy==1.17.1 torch==2.14.0 laion_clap==1.1.7

Run (from packages/sfx-engine/):

    node scripts/build-clap-audio.mjs   # renders the 424 WAVs this reads
    .artifacts/venv/bin/python3 eval/clap_eval.py

For each of the 53 named presets, at each of `SEEDS` (not just each
preset's own reference seed - several renders per prompt, though NOT
independent ones, since a seed only jitters a recipe a few percent; see
"The unit of analysis" below for how this file actually accounts for that):
  - `eval/prompts.json` has one plain-English description of the sound,
    written before any of this ran and never edited afterward.
  - `.artifacts/audio/real/<id>-seed<seed>.wav` is the preset rendered
    normally.
  - `.artifacts/audio/degraded/<id>-seed<seed>.wav` is the same
    preset/seed with its graph put through `scripts/clap-degrade-graph.mjs`
    (filters and envelopes bypassed, physically-informed generators
    replaced with raw noise) - see that file's own doc comment for exactly
    what "degraded" means here.

Three conditions, all using the model's default checkpoint
(630k-audioset-best.pt, non-fusion - the paper's best general-purpose
non-music model), each run once per seed (53-prompt vs 53-audio retrieval)
and then pooled across all 4 seeds into per-(item, seed) hit/miss trials:
  1. real: cosine similarity between the 53 prompt embeddings and that
     seed's 53 real-audio embeddings; for each prompt, is its own preset's
     audio in the top-1 / top-5 most similar? This is the number this
     ticket reports as "the CLAP numbers."
  2. shuffled: the same real-audio embeddings and the same prompt
     embeddings, but graded against a shuffled (derangement) ground-truth
     pairing instead of the true one, averaged over several random
     derangements per seed - a sanity check on the retrieval methodology
     itself, expected at chance level (top1 ~= 1/53, top5 ~= 5/53).
  3. degraded: the same prompts, but against that seed's degraded-audio
     embeddings - must score clearly worse than `real` for the metric to
     mean anything (the brief's explicit requirement).

The unit of analysis for every significance test below is the PRESET
(n=53), not the (item, seed) trial (n=212): a preset's `SEEDS` renders
differ only by a few-percent seed jitter (see `ModelMetadata.seedJitter`),
so they are highly correlated, not independent draws - treating the 212
pooled outcomes as 212 independent Bernoulli trials understates every
p-value below whatever that correlation happens to be. The pooled-212
figures are still computed and reported (`*_pooled_212_DESCRIPTIVE_ONLY`),
but only as descriptive rates, explicitly not as significance tests.

Pre-declared statistical tests (not tuned post hoc to make anything pass):
  - real-vs-chance and degraded-vs-chance: an exact permutation
    (randomization) test at the preset level. For `NUM_PERMUTATION_REPS`
    (10000) reps, independently permute the prompt<->audio correspondence
    WITHIN each seed (the real embeddings are untouched - only which prompt
    is graded against which audio changes) and sum top-k hits across all 4
    seeds, building an empirical null distribution for that pooled total;
    p = (1 + count(null >= observed)) / (reps + 1), one-sided. Chosen over
    the alternative considered (a per-preset "hit in >= j of 4 seeds"
    binomial against the exact chance rate for that threshold event) because
    it uses the real embedding geometry directly rather than an assumed
    per-trial chance rate, needs no independence assumption between a
    preset's seeds at all (each replicate carries the exact same cross-seed
    correlation structure the observed statistic has), and does not throw
    away the 0-4 hit count's magnitude the way binarizing "hit in >= j of 4"
    would. RNG: `numpy.random.default_rng(PERMUTATION_RNG_SEED)`,
    `PERMUTATION_RNG_SEED` fixed below so a run is exactly reproducible.
  - real-vs-degraded: a paired exact sign test over the 53 presets, on each
    preset's (hits_real - hits_degraded) out of 4 seeds; ties (diff = 0)
    dropped; one-sided ("real" beats "degraded"); alpha 0.05. This is
    McNemar's exact test applied at the preset level (the discordant-pairs
    binomial), the same construction the previous pooled-212 version used,
    just with presets instead of raw trials as the paired unit.

Also reports a family x family confusion matrix for the `real` condition's
top-1 predictions (8x8, families from eval/families.json, one row per
(item, seed) trial), and pooled per-family hit rates so every "weak
diagonal" family is visible, not just the ones that happen to be
highlighted in prose.

Output: `.artifacts/clap-report.json` (numbers quoted in the PR and in
docs/GAMESOUNDS-ENGINE.md) plus a human-readable summary on stdout.
"""
import json
import random
import sys
from pathlib import Path

import numpy as np
from scipy.stats import binomtest

SCRIPT_DIR = Path(__file__).resolve().parent
PACKAGE_DIR = SCRIPT_DIR.parent
AUDIO_DIR = PACKAGE_DIR / ".artifacts" / "audio"
REPORT_PATH = PACKAGE_DIR / ".artifacts" / "clap-report.json"
ALPHA = 0.05
SEEDS = [1, 2, 3, 4]

with open(SCRIPT_DIR / "prompts.json") as f:
    prompts_doc = json.load(f)
PROMPTS = prompts_doc["prompts"]

with open(SCRIPT_DIR / "families.json") as f:
    FAMILIES = json.load(f)

IDS = sorted(PROMPTS.keys())
assert IDS == sorted(FAMILIES.keys()), "prompts.json and families.json must cover the same preset ids"
N = len(IDS)
print(f"{N} presets loaded from eval/prompts.json, {len(SEEDS)} seeds each ({N * len(SEEDS)} trials per condition)")

for id_ in IDS:
    for cond in ("real", "degraded"):
        for seed in SEEDS:
            p = AUDIO_DIR / cond / f"{id_}-seed{seed}.wav"
            if not p.exists():
                sys.exit(f"missing {p} - run `node scripts/build-clap-audio.mjs` first")

import laion_clap  # noqa: E402  (import after the fast checks above)

print("Loading LAION-CLAP (630k-audioset-best.pt, non-fusion, CC0-1.0)...")
model = laion_clap.CLAP_Module(enable_fusion=False)
model.load_ckpt()  # downloads/caches under laion_clap's own package dir on first run
print("Model loaded.")


def embed_audio(condition, seed):
    files = [str(AUDIO_DIR / condition / f"{id_}-seed{seed}.wav") for id_ in IDS]
    embed = model.get_audio_embedding_from_filelist(x=files, use_tensor=False)
    return embed / np.linalg.norm(embed, axis=1, keepdims=True)


def embed_text():
    texts = [PROMPTS[id_] for id_ in IDS]
    embed = model.get_text_embedding(texts, use_tensor=False)
    return embed / np.linalg.norm(embed, axis=1, keepdims=True)


print("Embedding text prompts...")
text_embed = embed_text()

real_embed_by_seed = {}
degraded_embed_by_seed = {}
for seed in SEEDS:
    print(f"Embedding real audio (seed {seed})...")
    real_embed_by_seed[seed] = embed_audio("real", seed)
    print(f"Embedding degraded audio (seed {seed})...")
    degraded_embed_by_seed[seed] = embed_audio("degraded", seed)


def topk_hits(text_embed, audio_embed, correct_index_for, ks=(1, 5)):
    """For each text row i, rank all audio columns by cosine similarity
    (embeddings are already L2-normalized, so a dot product is cosine
    similarity) and check whether `correct_index_for[i]` lands in the top k.
    Returns {k: [bool per row]} plus the raw top-1 prediction index per row."""
    sims = text_embed @ audio_embed.T  # (N, N)
    order = np.argsort(-sims, axis=1)  # descending similarity, per row
    hits = {}
    for k in ks:
        topk = order[:, :k]
        hits[k] = [correct_index_for[i] in topk[i] for i in range(len(correct_index_for))]
    top1_pred = order[:, 0].tolist()
    return hits, top1_pred


identity = list(range(N))

# 1 & 3. real and degraded, per seed, pooled into per-(item, seed) trials
# (kept for the descriptive-only pooled rates) AND kept per-seed (real_hits_by_seed
# / degraded_hits_by_seed) so the preset-level tests below can treat each of
# the 53 presets, not each of the 212 trials, as the unit of analysis.
real_hits1, real_hits5 = [], []  # each a flat list over (seed, item), aligned with trial_ids
degraded_hits1, degraded_hits5 = [], []
trial_ids, trial_seeds = [], []
real_top1_by_seed, degraded_top1_by_seed = {}, {}
real_hits_by_seed, degraded_hits_by_seed = {}, {}  # seed -> {1: [bool*N], 5: [bool*N]}
for seed in SEEDS:
    r_hits, r_top1 = topk_hits(text_embed, real_embed_by_seed[seed], identity)
    d_hits, d_top1 = topk_hits(text_embed, degraded_embed_by_seed[seed], identity)
    real_top1_by_seed[seed] = r_top1
    degraded_top1_by_seed[seed] = d_top1
    real_hits_by_seed[seed] = r_hits
    degraded_hits_by_seed[seed] = d_hits
    real_hits1.extend(r_hits[1]); real_hits5.extend(r_hits[5])
    degraded_hits1.extend(d_hits[1]); degraded_hits5.extend(d_hits[5])
    trial_ids.extend(IDS); trial_seeds.extend([seed] * N)

TOTAL_TRIALS = len(trial_ids)
assert TOTAL_TRIALS == N * len(SEEDS)

# Per-preset hit counts out of len(SEEDS) - the unit of analysis for every
# preset-level test below.
real_top1_by_preset = [sum(real_hits_by_seed[seed][1][i] for seed in SEEDS) for i in range(N)]
real_top5_by_preset = [sum(real_hits_by_seed[seed][5][i] for seed in SEEDS) for i in range(N)]
degraded_top1_by_preset = [sum(degraded_hits_by_seed[seed][1][i] for seed in SEEDS) for i in range(N)]
degraded_top5_by_preset = [sum(degraded_hits_by_seed[seed][5][i] for seed in SEEDS) for i in range(N)]

# 2. shuffled labels: average over several random derangements of the
# identity pairing PER SEED, each graded with the exact same topk_hits
# function - an empirical chance-level baseline, not just the theoretical
# 1/N, with the same total trial count (20 derangement-runs) as before.
rng = random.Random(20260928)


def derangement(n, rng):
    while True:
        perm = list(range(n))
        rng.shuffle(perm)
        if all(perm[i] != i for i in range(n)):
            return perm


DERANGEMENTS_PER_SEED = 5  # x4 seeds = 20 runs total, matching the previous single-seed NUM_SHUFFLES
shuffled_hits1, shuffled_hits5 = [], []
shuffled_run_accs = []
for seed in SEEDS:
    for _ in range(DERANGEMENTS_PER_SEED):
        perm = derangement(N, rng)
        hits, _ = topk_hits(text_embed, real_embed_by_seed[seed], perm)
        shuffled_hits1.extend(hits[1]); shuffled_hits5.extend(hits[5])
        shuffled_run_accs.append({1: sum(hits[1]) / N, 5: sum(hits[5]) / N})
NUM_SHUFFLE_RUNS = len(SEEDS) * DERANGEMENTS_PER_SEED
shuffled_acc = {k: sum(r[k] for r in shuffled_run_accs) / NUM_SHUFFLE_RUNS for k in (1, 5)}


# --- Pre-declared statistics ---

def exact_binomial_vs_chance(hits, chance_p, alternative):
    n = len(hits)
    k = sum(hits)
    result = binomtest(k, n, chance_p, alternative=alternative)
    return {
        "hits": k, "trials": n, "observed_rate": k / n, "chance_rate": chance_p,
        "p_value": result.pvalue, "alternative": alternative,
        "significant_at_0.05": result.pvalue < ALPHA,
    }


def exact_paired_sign_test_on_counts(counts_a, counts_b, a_name, b_name):
    """Preset-level paired exact sign test: the unit is one preset's hit
    count out of len(SEEDS) seeds, NOT one (item, seed) trial - a preset's
    SEEDS renders differ only by a few-percent seed jitter and are not
    independent draws (see this file's module docstring). For each preset,
    diff = count_a - count_b; ties (diff == 0) are dropped; b = #presets
    where a > b, c = #presets where b > a; under the null the split of the
    b+c discordant presets is Binomial(b+c, 0.5) - an exact one-sided
    binomial test on that is the exact sign test (McNemar's exact test,
    applied at the preset level instead of the raw-trial level)."""
    assert len(counts_a) == len(counts_b)
    diffs = [a - b for a, b in zip(counts_a, counts_b)]
    b = sum(1 for d in diffs if d > 0)
    c = sum(1 for d in diffs if d < 0)
    ties = sum(1 for d in diffs if d == 0)
    if b + c == 0:
        return {
            "presets_a_better": b, "presets_b_better": c, "ties_dropped": ties, "n_presets": N,
            "p_value": 1.0, "note": "no discordant presets - test is degenerate",
            "significant_at_0.05": False,
        }
    result = binomtest(b, b + c, 0.5, alternative="greater")
    return {
        "presets_a_better": b, "presets_b_better": c, "ties_dropped": ties, "n_presets": N,
        "p_value": result.pvalue, "alternative": f"{a_name} > {b_name} (preset-level, one-sided)",
        "significant_at_0.05": result.pvalue < ALPHA,
    }


PERMUTATION_RNG_SEED = 20260929  # today's date at the time this test was written - fixed so a run is exactly reproducible
NUM_PERMUTATION_REPS = 10000


def permutation_test_vs_chance(embed_by_seed, observed_hits_total, k, num_reps, rng):
    """Exact-by-construction permutation/randomization test for "is this
    condition's pooled retrieval accuracy above chance", valid regardless of
    how correlated a preset's SEEDS renders are with each other: per rep,
    independently permute the prompt<->audio correspondence WITHIN each seed
    (the real embeddings are untouched - only which prompt is graded against
    which audio changes) and sum top-k hits across all SEEDS, building a
    null distribution of that pooled total over `num_reps` reps. See this
    file's module docstring for why this was chosen over the "hit in >= j of
    4 seeds" binomial alternative."""
    null_totals = np.empty(num_reps, dtype=np.int64)
    for r in range(num_reps):
        total = 0
        for seed in SEEDS:
            perm = rng.permutation(N)
            hits, _ = topk_hits(text_embed, embed_by_seed[seed], perm)
            total += sum(hits[k])
        null_totals[r] = total
    p = (1 + int(np.sum(null_totals >= observed_hits_total))) / (num_reps + 1)
    return {
        "observed_hits": observed_hits_total, "trials": N * len(SEEDS),
        "num_permutation_reps": num_reps, "rng_seed": PERMUTATION_RNG_SEED,
        "null_mean": float(null_totals.mean()), "null_std": float(null_totals.std()),
        "p_value": float(p), "alternative": "greater (one-sided)",
        "significant_at_0.05": bool(p < ALPHA),
    }


perm_rng = np.random.default_rng(PERMUTATION_RNG_SEED)
preset_level_tests = {
    "real_vs_chance_permutation": {
        "top1": permutation_test_vs_chance(real_embed_by_seed, sum(real_top1_by_preset), 1, NUM_PERMUTATION_REPS, perm_rng),
        "top5": permutation_test_vs_chance(real_embed_by_seed, sum(real_top5_by_preset), 5, NUM_PERMUTATION_REPS, perm_rng),
    },
    "degraded_vs_chance_permutation": {
        "top1": permutation_test_vs_chance(degraded_embed_by_seed, sum(degraded_top1_by_preset), 1, NUM_PERMUTATION_REPS, perm_rng),
        "top5": permutation_test_vs_chance(degraded_embed_by_seed, sum(degraded_top5_by_preset), 5, NUM_PERMUTATION_REPS, perm_rng),
    },
    "real_vs_degraded_paired_sign_test": {
        "top1": exact_paired_sign_test_on_counts(real_top1_by_preset, degraded_top1_by_preset, "real", "degraded"),
        "top5": exact_paired_sign_test_on_counts(real_top5_by_preset, degraded_top5_by_preset, "real", "degraded"),
    },
}

stats = {
    "preset_level_tests": preset_level_tests,
    "pooled_212_trials_NOTE": (
        "The conditions below pool 53 presets x 4 seeds = 212 (item, seed) "
        "trials. A preset's 4 seed-renders differ only by a few-percent "
        "seed jitter, so they are highly correlated, not independent "
        "Bernoulli draws - these binomial/sign-test p-values assume iid "
        "trials and are NOT valid significance tests under that clustering. "
        "Kept only as descriptive rates; see 'preset_level_tests' above for "
        "the actual pre-declared significance tests (53 presets, not 212 "
        "trials, as the unit of analysis)."
    ),
    "real_vs_chance_pooled_212_DESCRIPTIVE_ONLY": {
        "top1": exact_binomial_vs_chance(real_hits1, 1 / N, "greater"),
        "top5": exact_binomial_vs_chance(real_hits5, 5 / N, "greater"),
    },
    "degraded_vs_chance_pooled_212_DESCRIPTIVE_ONLY": {
        "top1": exact_binomial_vs_chance(degraded_hits1, 1 / N, "greater"),
        "top5": exact_binomial_vs_chance(degraded_hits5, 5 / N, "greater"),
    },
    "shuffled_vs_chance_two_sided": {
        "top1": exact_binomial_vs_chance(shuffled_hits1, 1 / N, "two-sided"),
        "top5": exact_binomial_vs_chance(shuffled_hits5, 5 / N, "two-sided"),
    },
}

# Per-family confusion matrix (real condition, top-1 predictions, one row
# per (item, seed) trial) and pooled per-family hit rate for top1.
family_list = sorted(set(FAMILIES.values()))
confusion = {a: {b: 0 for b in family_list} for a in family_list}
family_hits = {a: 0 for a in family_list}
family_trials = {a: 0 for a in family_list}
for seed in SEEDS:
    top1 = real_top1_by_seed[seed]
    for i, id_ in enumerate(IDS):
        true_family = FAMILIES[id_]
        pred_family = FAMILIES[IDS[top1[i]]]
        confusion[true_family][pred_family] += 1
        family_trials[true_family] += 1
        if top1[i] == i:
            family_hits[true_family] += 1
family_hit_rate = {fam: {"hits": family_hits[fam], "trials": family_trials[fam], "rate": family_hits[fam] / family_trials[fam]} for fam in family_list}

per_item = []
for i, id_ in enumerate(IDS):
    per_item.append({
        "id": id_,
        "prompt": PROMPTS[id_],
        "family": FAMILIES[id_],
        "real_top1_hits": real_top1_by_preset[i],
        "real_top5_hits": real_top5_by_preset[i],
        "real_trials": len(SEEDS),
        "real_top1_predicted_ids_by_seed": {str(seed): IDS[real_top1_by_seed[seed][i]] for seed in SEEDS},
        "degraded_top1_hits": degraded_top1_by_preset[i],
        "degraded_top5_hits": degraded_top5_by_preset[i],
        "degraded_trials": len(SEEDS),
    })

report = {
    "model": "laion_clap 630k-audioset-best.pt (non-fusion), CC0-1.0",
    "num_presets": N,
    "seeds": SEEDS,
    "conditions": {
        "real": {
            "top1": sum(real_hits1) / TOTAL_TRIALS, "top5": sum(real_hits5) / TOTAL_TRIALS,
            "trials": TOTAL_TRIALS,
        },
        "shuffled_labels_control": {
            "top1": shuffled_acc[1], "top5": shuffled_acc[5],
            "num_derangement_runs": NUM_SHUFFLE_RUNS,
            "theoretical_chance": {"top1": 1 / N, "top5": 5 / N},
        },
        "degraded_engine_control": {
            "top1": sum(degraded_hits1) / TOTAL_TRIALS, "top5": sum(degraded_hits5) / TOTAL_TRIALS,
            "trials": TOTAL_TRIALS,
        },
    },
    "statistical_tests": stats,
    "family_confusion_real_top1": confusion,
    "family_hit_rate_real_top1": family_hit_rate,
    "per_item": per_item,
}

def json_default(o):
    """scipy/numpy scalars (np.bool_, np.integer, np.floating) aren't
    natively JSON-serializable - convert them to the equivalent Python
    builtin rather than silently stringifying or dropping them."""
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")


REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
with open(REPORT_PATH, "w") as f:
    json.dump(report, f, indent=2, default=json_default)

print("\n=== CLAP retrieval accuracy (pooled over 4 seeds, 212 trials/condition) ===")
print(f"real:      top1={report['conditions']['real']['top1']:.3f}  top5={report['conditions']['real']['top5']:.3f}")
print(f"shuffled:  top1={shuffled_acc[1]:.3f}  top5={shuffled_acc[5]:.3f}  (theoretical chance top1={1/N:.3f}, top5={5/N:.3f}, over {NUM_SHUFFLE_RUNS} derangement-runs)")
print(f"degraded:  top1={report['conditions']['degraded_engine_control']['top1']:.3f}  top5={report['conditions']['degraded_engine_control']['top5']:.3f}")
print("\n=== Pre-declared statistical tests (alpha=0.05); unit of analysis is the 53 presets, not the 212 pooled trials ===")
for name, d in stats.items():
    if isinstance(d, str):
        print(f"{name}: {d}")
        continue
    print(f"{name}:")
    for k, v in d.items():
        print(f"  {k}: {v}")
print(f"\nPer-family real top1 hit rate: {json.dumps(family_hit_rate, indent=2)}")
print(f"\nFull report written to {REPORT_PATH}")
