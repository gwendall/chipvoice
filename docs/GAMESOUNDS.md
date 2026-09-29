# gamesounds.ai

<p align="center"><a href="GAMESOUNDS.md">English</a> &bull; <a href="GAMESOUNDS_ja.md">日本語</a></p>

A game sound-effects bank filed by event, not by pack: an agent resolves
`"jump"` or `"combat/hit/heavy"` to a licensed, loudness-matched sound and
gets playing, with no account, no key and no person auditioning candidates
first. Phase 1 ships the catalogue, the site, the REST API, a CLI and a
runtime library; see [Decision 49](DECISIONS.md) for why it is a second app
(`apps/sounds`, gamesounds.ai) and a second package (`gamesounds`), not a
page added to chipvoice.dev, and [the backlog](BACKLOG.md) for what Phase 1
deliberately leaves out.

## The data model

`packages/gamesounds/src/types.ts` is the one place the shape is defined -
plain TypeScript, no imports of its own, so both the site's server code and
an installed `gamesounds` package read the same types. A `Sound` answers one
`Category` (a taxonomy id, at most two levels deep, e.g. `"movement/jump"`),
carries a `style` (one of ten facets: `8bit`, `16bit`, `arcade`, `cartoon`,
`realistic`, `scifi`, `fantasy`, `horror`, `cozy`, `minimal-ui`), a licence
and its source as data, and 1 to 8 `Variant`s of the same idea - each with a
duration, precomputed waveform `peaks` and content-addressed `files`. A
`Sound`'s own `origin` is `"chipvoice"` (chipvoice's own `renderSfx`, real
chip emulation) or `"generated"` (`packages/sfx-engine`'s deterministic
procedural synthesis - GS-02, wired into the catalogue by
[GS-03](BACKLOG.md), [Decision 54](DECISIONS.md)); both are entirely our
own DSP, no third-party sounds and no external generation API, ever. Its
`recipe` records how the sound was made without this package depending on
either chipvoice's or sfx-engine's own types: a chipvoice
`{chip, channel, note, instrument, duration, ...}` shape, or sfx-engine's
own `{engine: "sfx-engine@1", model, params, seed, sampleRate}`. Every
generated `Variant` additionally carries its OWN `recipe` (same shape,
this variant's own seed) - unlike chipvoice, where one recipe shape
describes the whole sound and the seed ladder that produced its siblings is
not itself part of the recipe.

## Taxonomy and event resolution

`catalog/taxonomy.json` defines every category once; `apps/sounds/src/lib/catalog.ts`'s
`resolveEvent()` accepts the three short forms an agent is expected to use:
a fully qualified id (`"ui/confirm"`), a bare leaf name (`"jump"`, resolved
by segment or alias), or `"leaf/tag"` (`"hit/heavy"` - a tag filter on the
two-level category `"combat/hit"`, not a third taxonomy level; the split is
on the *first* `/` only, so a three-segment string does not behave as a
deeper path). `pickSoundForEvent()` then picks exactly one sound
deterministically: every Phase 1 sound has `rank.score` 0 (no votes or usage
data exist yet - that is Phase 2), so ties break on the sound's own id,
sorted ascending, and a requested style with no candidate falls back to any
style in the category rather than resolving to nothing. The taxonomy keeps
every category it defines even when nothing is filed there yet - a future
style or preset may fill one in - but `GET /api/v1/categories`
(`listCategoriesWithCounts()`) attaches every category's own honest `count`
(its leaf's own sounds plus every descendant leaf's, for a branch), and the
site's category cards and hub pages show that same count and an explicit
"No sounds filed here yet" rather than presenting an empty category as if
it had content. Of 85 categories, 50 currently hold at least one sound (44
chipvoice-only before [GS-03](BACKLOG.md) wired in the generated half; the
6 new ones are categories only a generated preset reaches, e.g.
`world/machine-hum`). 7 of the taxonomy's 10 style facets exist today:
chipvoice's `8bit` and `16bit`, plus `minimal-ui`, `realistic`, `scifi`,
`fantasy` and `cartoon` from [GS-03](BACKLOG.md)'s generated half -
`arcade`, `horror` and `cozy` remain unfilled, honestly (see "Generated
sounds" below for the rule that keeps a facet unfilled rather than
mislabelling something into it).

## Sourcing and licensing

gamesounds is our own sound bank: every sound is made procedurally, by
chipvoice's own offline `renderSfx` (`origin: "chipvoice"`,
`packages/chipvoice`, real chip emulation) or by `packages/sfx-engine`
(`origin: "generated"`, GS-02's own deterministic DSP, recipe + seed) - no
third-party sounds, no external generation API, ever, `CC0-1.0` by
construction for both. No other source is mixed in, so "all CC0" holds
without a runtime licence filter; `checkLicense` in `scripts/lib/checks.mjs`
still refuses any sound the build produces without one (belt and braces,
not a filter over mixed sources). See "Style and category mapping" below
for how each of sfx-engine's 53 presets was filed.

## Generated sounds (GS-03)

`apps/sounds/catalog/generated-recipes.mjs` maps every one of
`packages/sfx-engine`'s 53 named presets (GS-02) onto the taxonomy: a
category, a style, tags and a title, hand-written per preset - the
generated-origin analogue of `chipvoice-recipes.mjs`. `build-catalog.mjs`'s
`buildGenerated` renders each through `recipeForPreset(id, seed, 44100)`
directly at the catalogue's own 44.1 kHz (never through sfx-engine's
default 48 kHz), through the same trim/level/encode/measure pipeline as the
chipvoice half.

**The style rule** (`generated-recipes.mjs`'s own header carries the same
reasoning, line by line, next to the map it explains):

- `impact`, `footstep`, `whoosh`, `explosion` -> `realistic` - every one of
  these models real-world physics (a struck or rigid material, a walked
  surface, air movement, a blast), never a stylized interpretation of one.
- `scifi` -> `scifi` - synthetic sound design, not modeling anything real.
- `magic` -> `fantasy` - spell/cast content, sparkle-layered synthesis.
- `ui` -> `minimal-ui` - short, oscillator-only interface blips.
- `pickup` -> judged per preset, never forced. `pickup.ts`'s own header
  says these are deliberately "not an 8-bit square-wave cliche": the warm,
  bright tuned-oscillator arpeggios (`coin`, `gem`, `powerup`, `level-up`)
  read as `cartoon`; `key`, the one physically-informed preset in the
  family (a struck-metal modal jingle), is honestly `realistic` instead,
  like the material-impact families it shares its synthesis technique
  with. Nothing is forced into `cartoon`, `horror` or `cozy` just to fill
  an empty facet - an empty facet is honest, a mislabelled one is not.

**Category choices that are not a mechanical rename of the preset id**
(every category below already exists in `catalog/taxonomy.json`; this
ticket adds none):

- All 12 `impact-*` presets file under `combat/hit`, except
  `impact-body-{light,heavy}`, whose own description ("a light/heavy
  body/punch impact") names `combat/punch` directly.
- `whoosh-sword` -> `combat/sword` (a swing IS the sword sound);
  `whoosh-punch` -> `combat/punch` (alongside `impact-body`, distinguished
  by tag); `whoosh-pass-by` and `whoosh-cloth` have no dedicated taxonomy
  leaf for a generic air-movement cue, so both file under `movement/dash`
  (the closest honest "burst of movement" leaf), distinguished by tag.
- `scifi-shield-up`/`down` -> `combat/shield` (an exact alias match:
  "shield up"). `scifi-power-up`/`down` are a device/system cue, not a
  pickup, so they file under `world/machine-hum` ("engine hum, drone,
  electric hum"), not `collect/powerup` - naming them a powerup would have
  been the mislabel this whole rule exists to avoid.
  `scifi-computer-beep` -> `ui/confirm` ("acknowledgement" IS a confirm
  cue). `scifi-zap` has no dedicated "electric" leaf, so it files under
  `combat/hit`, tagged `zap`/`electric`. `scifi-teleport` uses the
  `magic/teleport` category - a category about the *event* (warp/blink),
  independent of the `scifi` style facet sitting on top of it.
- `magic-shimmer` has no leaf of its own; it is a `magic/cast` variant
  (tagged `shimmer` instead of `spell`) per `magic.ts`'s own description
  ("cast, shimmer... layer a sparkle... over a gesture sweep").

**Quality gate**: every generated variant runs through the same
`checkSound` every chipvoice variant does (license, variant count, sha256,
no clipping, leading silence, both loudness checks, and a per-variant
format-energy check - see below). The format-energy check gates on each
variant's TOTAL energy per channel (the sum of each sample squared, not a
mean or a peak - see `energyPerChannel` in
`apps/sounds/scripts/lib/audio.mjs` and [Decision 54](DECISIONS.md) for
why it must be a sum), decoding the shipped ogg/mp3 back to PCM and
comparing against the source wav within `FORMAT_ENERGY_TOLERANCE_DB`
(1.0 dB). A preset whose variants fail, whose style judgment cannot be
made honestly, or that simply sounds wrong is excluded by name and reason
in `build-catalog.mjs`'s `EXCLUDED_PRESETS` map rather than shipped or
force-fit. This ticket's own build excludes three of the 53 presets this
way: `pickup-key`, `impact-glass-light` and `footstep-metal` each put
most of their own synthesized energy above 16 kHz (97.4%, 77.6% and 31.0%
respectively, measured with a steep highpass) - inside the range both
libvorbis (via sox, GS-06/GS-07) and libmp3lame filter away at this
catalogue's quality settings, so their shipped ogg/mp3 lose real energy
against their own wav across the seed ladder (13.2 to 18.2 dB, 6.1 to 6.9
dB and 2.2 to 15.6 dB respectively) rather than the harmless peak-only
"transient smearing" some other presets legitimately show. A follow-up
ticket tracks finding why sfx-engine's own modal synthesis puts their
energy there and fixing it at the source (see `docs/BACKLOG.md`); tuning
a preset's own sound stays out of scope here (sfx-engine's fixture-pinned
output, GS-02's own hash fixture, is not touched by this ticket) - a
preset that needs that gets excluded, not silently shipped worse than it
should be, and can come back once fixed. (Re-measured after GS-06/GS-07
switched every machine's ogg encoder to libvorbis via sox: see that
section below for the full story - `build-catalog.mjs`'s own
`EXCLUDED_PRESETS` map carries the current, re-verified numbers.)

**Loudness's own trap** (see [Decision 54](DECISIONS.md) and
[GAMESOUNDS-ENGINE.md](GAMESOUNDS-ENGINE.md#loudness-convention-across-engines)
for the full mechanism): sfx-engine meters and gains a render as mono,
*before* panning to stereo - every preset pans to 0, where equal-power pan
law gives `left = right = mono * cos(pi/4)`, about -3.0103 dB quieter than
the mono figure the engine reports on `RenderedSound.loudness`. Trusting
that self-reported figure instead of re-measuring the actual shipped bytes
would silently under-level every generated variant by about 3 dB.
`renderGeneratedVariants` in `build-catalog.mjs` never does this: it takes
`RenderedSound.left` as the shipped signal (valid exactly because
`left === right` at `pan: 0`, the only pan value any preset uses) and runs
it through the catalogue's own `levelToConvention`, which re-measures
whatever bytes it is actually given. Generated sounds ship **mono wav and
mp3**, the same layout the chipvoice half already actually ships (verified
directly from `apps/sounds/scripts/lib/audio.mjs`'s `toWavBytes`,
`channels = right ? 2 : 1`: chipvoice's `renderSfx` is never called with
`stereo: true` anywhere in this catalogue), not the "stereo dual-mono"
layout an earlier note assumed - consistency with the *actual*, not
aspirationally-documented, existing convention was the measured reason to
deviate from that default. The ogg format used to be the one exception,
and used to NOT be uniform: before GS-06/GS-07 (see that section below),
`vorbisEncoderArgs` picked libvorbis, which keeps a mono source mono, only
when the build machine's ffmpeg happened to have it (true in CI); otherwise
it fell back to ffmpeg's own native vorbis encoder, which refused mono
input and had to upmix to dual-mono stereo instead (true of this repo's
own dev Homebrew ffmpeg). That machine-dependent branch, and the
dual-mono upmix it produced, no longer exist: every ogg, on every machine,
is now encoded with sox's own libvorbis handler, which keeps the source's
own mono layout - ogg is mono everywhere now too, the same as wav and
mp3, with no machine-dependent exception left to remember.
`apps/sounds/test/generated-loudness.test.mjs`
proves both loudness directions: a variant leveled through the catalogue's
own pipeline on its true shipped layout passes `checkOneCeilingBinds`, and
a variant that instead ships the engine's own pre-pan self-report as its
recorded measure fails it, on real, independently-measured bytes.

**Ogg encoding switched to libvorbis via sox everywhere, plus a fixed tail
guard, after real decoders turned out to cut real content (GS-06 and
GS-07, both delivered).** An earlier version of this section (and of
[Decision 54](DECISIONS.md)'s GS-07 amendment) blamed this repo's own ogg
ENCODER: first as harmless end-of-block padding, then - wrongly - as
ffmpeg's native "experimental" vorbis encoder outright dropping a final
1024-sample block for certain input lengths. Neither was the real story.
Direct measurement (an ogg stream's own granule position, read straight
off the bytes with no decoder involved, and a decode through the reference
libvorbis decoder) proved the encoder, native or libvorbis, was never at
fault: a native-encoder ogg's own final granule position is always at
least the source frame count (`n=1023` carries granule `1024`; `n=10035`
carries granule `10048`), a libvorbis-encoded one carries the EXACT source
frame count as its granule (`n=10035` carries granule `10035`), and the
reference decoder plays every one of these files whole. What actually cuts
audio is DECODERS, and they disagree with each other and with the ogg's
own declared length: ffmpeg's own CLI decoder (what this build's
`checkFormatLengths` gate itself reads) drops up to 128 frames off the end
of ANY ogg, libvorbis-encoded ones included - reproduced directly on a
granule-complete `n=1023` native-encoder ogg, which the ffmpeg CLI decodes
to **zero frames**, the whole sound gone, from a stream whose own header
proves it is complete. Real browsers are worse, and disagree with the
ffmpeg CLI too: on the catalogue as shipped before this fix, Chromium
failed to decode 5 of 1080 live oggs at all, decoded 1013 shorter than
their own wav, and lost audible content (compared with what Firefox plays)
on 747 of them, mean 465 samples (about 10.5ms at 44.1kHz), max 1024
samples (about 23ms) - while Firefox decoded all 1080 whole. See
[Decision 54](DECISIONS.md)'s GS-07 v2 amendment for the full measured
mechanism, every number, and how each one was reproduced.

The fix has two parts, both in `apps/sounds/scripts/lib/audio.mjs`.
First, every ogg on every machine - dev and CI alike - is now encoded with
`sox -R <wav> -C 5 <ogg>` instead of either of ffmpeg's own vorbis
encoders; `sox` and its vorbis format handler are a hard build requirement,
checked once per process with a specific, actionable error naming what to
install if either is missing. This removes the dev-machine-only code path
entirely (there is no "native" branch left to diverge into) and delivers
GS-06 (libvorbis everywhere) as a side effect: a developer's local ogg
rebuild now matches CI's byte-for-byte for the same input, and sox keeps
the source's own mono channel count too (see the ogg-uniformity paragraph
above). Second, since even a complete, correctly-encoded libvorbis ogg
still loses real content to the worse of ffmpeg's CLI decoder or
Chromium's own end-trim (up to 128 frames of raw buffer length, up to 179
frames of real audible content - the two measurements differ because a
decoder's own rendering of an already-near-zero fade tail can vary even
inside a portion of the buffer that is not literally missing), every ogg
encode now pads its own encoder input - never the wav or mp3 that ship -
with a fixed 256-frame (`OGG_TAIL_GUARD_FRAMES`) zero-sample tail guard
first, so that trim always eats manufactured silence, never the real
signal. `checkFormatLength`/`checkFormatLengths`
(`apps/sounds/scripts/lib/checks.mjs`) are unchanged in logic and stay
wired into `checkSound` alongside the format-energy check, catching
exactly the class of loss energy cannot see: real content removed from a
part of the signal that was already quiet.

Passing that ffmpeg-CLI-based gate was never proof a real browser plays a
file whole - ffmpeg's own CLI decoder matched Chromium's decoded length on
only 1004 of 1080 measured live oggs. `apps/sounds/scripts/check-browser-decode.mjs`
(new) is the gate that actually verifies this: it decodes every catalogue
ogg and mp3 in real Chromium AND Firefox (Playwright, one browser launch
per engine, a hard overall timeout, both closed in a `finally`) and fails
the build on any decode error, any decoded length shorter than the source
wav, or (ogg only) the browser's own last-audible sample sitting
meaningfully earlier than the wav's. Firefox's mp3 behavior below is
reported, never failed on. Run in CI as part of the `sounds` job
(which now installs Firefox alongside Chromium) and exposed locally as
`pnpm sounds:check-decode`. "Meaningfully earlier" needed one more
refinement once this gate ran against the rebuilt catalogue: 96 of 1080
oggs showed a gap past the margin in both engines, but every one turned
out to be near-threshold chatter on a slowly-decaying tail (the wav's own
loudest sample in the gap never exceeded -55 dBFS) rather than real lost
content, so the gate now also requires the wav's own gap content to reach
a second, higher threshold before failing - see
[Decision 54](DECISIONS.md)'s GS-07 v2 amendment for the full
measurement and the negative fixture that proves this did not just widen
the gate into uselessness. With that in place, the gate passes cleanly
against the rebuilt catalogue: 0 failures in Chromium, 0 in Firefox.

mp3 has no equivalent content-loss problem, but has a different, newly
measured one: Chromium is gapless-exact on every live mp3 (1042 of 1080
decode to exactly the wav's own frame count, the other 38 longer by 4 to
46 samples, none shorter). Firefox decodes every mp3 whole too, but its
own decoded length exceeds the wav's frame count by 623 to 1774 samples
(mean about 1172, roughly 14 to 40ms) - it does not trim the LAME
encoder's own priming delay the way Chromium's gapless playback does. That
is a real, separate defect (added leading latency, not lost content) -
tracked as new backlog item **GS-08**, not fixed in this ticket. The
catalogue has no loop sounds, so none of this trailing-silence handling is
ever audible as a seam either way.

## Variants

Every Phase 1 sound is generated, not sourced, so none has an excuse to
ship few takes: every sound carries 3 to 5 variants (Phase 1 ships 4 per
event x chip group, and 4 per generated preset). `checkChipvoiceVariantCount`
in `scripts/lib/checks.mjs` fails the build if any chipvoice-origin sound
falls under 3, with a negative test in `apps/sounds/test/checks.test.mjs`;
the check is gated on `origin === "chipvoice"` rather than applied
unconditionally so a non-chipvoice origin can define its own rule instead
of inheriting this one by accident - `checkGeneratedVariantCount` is that
rule for `origin === "generated"` (GS-03), same floor of 3, "the same
survival rule as the chipvoice half" (the same keep-first-4-audible-and-
byte-distinct candidate-ladder pattern, just walking a plain incrementing
seed ladder instead of an escalating detune/duration/volume nudge ladder -
every one of sfx-engine's 8 models registers real per-seed jitter for every
preset kind, so a plain seed ladder reliably produces byte-distinct takes
without needing chipvoice's coarser-quantization workaround).
`apps/sounds/catalog/chipvoice-recipes.mjs`'s
`chipvoiceGroups`/`groupCandidates` is the mechanism: each event x chip group
carries an ordered candidate ladder, not a fixed 4-shot list - every rung
applies its own duration stretch, whole-semitone `detune` nudge (chipvoice's
own top-level semitone offset) and volume-table shift on top of one of the
event's two hand-tuned shapes, each alternating sign and growing in
magnitude as the ladder climbs. `build-catalog.mjs`'s `renderGroupVariants`
renders candidates in order and keeps the first 4 that are both audible and
byte-distinct from every take already kept, skipping a silent or
byte-identical render rather than shipping it; most groups accept their
first four candidates outright, and the rest of the ladder exists for the
handful of chip/role combinations whose own quantization (a noise voice's
clamped 0-15 period, a duration rounded to a 60 Hz engine frame, or - the SNES
specifically - every `perc`-role recipe sharing its one period-addressed
voice regardless of instrument) is coarse enough that duration and detune
alone cannot guarantee real variety, which is why the volume-table shift
exists as a third, independent lever.

## Loudness, trim and determinism

The catalogue build (`apps/sounds/scripts/build-catalog.mjs` and
`scripts/lib/audio.mjs`) trims each take at a zero crossing with a
documented fade, measures loudness on *every* variant (not just the first)
and rejects anything outside the stated band: -18 LUFS momentary maximum
ceiling, true peak <= -1 dBTP ceiling, no more than 10 ms of leading
silence, no clipping - and **one ceiling must bind**, so a broken leveling
pass (e.g. a skipped gain stage or a wrong target) fails loudly instead of
shipping quiet. `levelToConvention` in `scripts/lib/audio.mjs` applies a
single linear gain per render: whichever of the two is quieter, the gain
that brings momentary LUFS to -18 or the gain that brings true peak to -1
dBTP (peak cap wins when the two disagree). A correctly leveled variant
therefore always lands within rounding slack of at least one of the two
ceilings - `checkOneCeilingBinds` in `scripts/lib/checks.mjs` asserts
exactly that: `lufs >= -18 - eps OR peakDb >= -1 - eps`, eps 0.2 dB. This
needs no cross-variant statistic (no widest observed gap, no margin) - it
is an exact per-variant consequence of how the gain was computed, so it
cannot be fooled by a broken variant whose own gap happens to fall inside
another variant's legitimate range, the gap a derived-floor approach left
open. A negative test in `apps/sounds/test/checks.test.mjs` proves each
check - both ceilings and the one-ceiling-binds gate alike - actually
fails a file built to violate it, not just that a passing file happens to
pass. The build is deterministic given the same recipes:
`scripts/check-determinism.mjs` (see "Continuous integration" below)
rebuilds the whole catalogue fresh and proves it on every CI run against
the committed catalogue's own per-variant SHA-256.

## Content addressing

Every variant is encoded to `.ogg`, `.mp3` and `.wav`, each served at
`/f/<sha256>.<ext>` where `<sha256>` is that file's *own* bytes' hash, not a
shared group key - `encodeVariant()` in `scripts/lib/audio.mjs` hashes each
format after encoding and records `{sha256, bytes, url}` per format in
`catalog.json`'s `Variant.files`. A variant still carries its own top-level
`sha256` too (the canonical WAV/PCM's hash, produced before any
format-specific encoder runs), useful as the variant's identity independent
of format, but nothing downstream is allowed to assume an `.ogg` or `.mp3`
shares its sibling's name: the CLI's `verifyDownload` and the browser smoke
test both check exactly the file they just fetched against the hash
embedded in that file's own URL.

## The REST API

A public, keyless `/api/v1` (`apps/sounds/src/app/api/v1`): `GET /categories`,
`GET /sounds` (search: `q`, `category`, `style`, `tag`), `GET /sounds/{id}`,
`GET /sounds/{id}.zip`, `GET /packs`, `GET /packs/{id}`, `GET /packs/{id}.zip`,
and `POST /api/v1/resolve` - the one call that answers a whole game's worth
of events at once (`{events, style, formats, exclude}` in;
`{manifest, resolved, unresolved}` out; `formats` picks 1-2 of
`ogg`/`mp3`/`wav` for the manifest's files, `exclude` drops given sound ids
from the candidate pool, the mechanism behind the CLI's `swap`).
`GET /schema/manifest-1.json` serves the manifest's own JSON Schema
(draft 2020-12); `apps/sounds/test/manifest.test.mjs` validates a real
`buildManifest()` output against it, and proves the schema actually rejects
a broken one. Every route is built on `web-kit/http`'s route envelope and
rate-limited per IP with `web-kit/limit` (Decision 47) - `POST /resolve` is
the one write-shaped call in an otherwise read-only API.

`style` is a plain equal-match filter over whichever candidates a category
and tag already narrowed to (`pickSoundForEvent` in `src/lib/catalog.ts`),
origin-blind by construction: asking for a style GS-03 newly populates
(`realistic`, `scifi`, `fantasy`) reaches a generated sound the exact same
way asking for `8bit`/`16bit` reaches a chipvoice one - no special-casing
either origin. Leaving `style` unset keeps the pre-GS-03 default: every
candidate in the category/tag pool, tie-broken by `rank.score` (always 0 in
Phase 1) then the sound's own id ascending. Every generated sound's id is
composed as `${category-slug}-${style}-${preset}`
(`build-catalog.mjs`'s `buildGenerated`), and every style facet a generated
sound can carry starts with a letter (`realistic`, `scifi`, `fantasy`,
`cartoon`, `minimal-ui`), while both existing chipvoice styles start with a
digit (`8bit`, `16bit`) - under `localeCompare`, a digit always sorts
before a letter, so a generated sound can never become the alphabetically-
first (and so selected) candidate in a category a chipvoice sound already
occupies.

That id-ordering argument only shows a generated sound can never *outrank*
an existing chipvoice one within a single already-matched candidate pool -
it says nothing on its own about whether some other combination of
category, tag and style could resolve to a *different* pool than before
GS-03 shipped. `apps/sounds/test/resolve-generated.test.mjs` checks that
directly and exhaustively, not just a few spot cases: for every (category,
tag-or-none, style) combination the catalogue can actually be asked for -
405 of them, covering 85 categories, every tag actually in use, and all
three styles (none, `8bit`, `16bit`) - it picks the sound the real,
built catalogue returns and separately picks the sound a chipvoice-only
subset of that same catalogue would return, and proves the two agree
whenever the chipvoice-only pick is non-null. A generated sound can only
ever fill a gap a chipvoice sound leaves empty; it can never override one
that exists. This is a real, intended behavior change for a combination
that previously resolved to nothing, not a no-op: 138 of the 405
combinations previously resolved to nothing and now resolve to a generated
sound - 46 unique (category, tag) gaps, each filling identically under all
three styles, so 92 of the 138 are an `8bit`/`16bit` request newly reaching
a generated sound, not just the style-less default. Examples:
`movement/footstep/concrete`, `movement/footstep/wood`,
`combat/explosion/small`, `combat/shield`, `ui/toggle/on`,
`collect/coin/coin` and `magic/cast/shimmer` all previously resolved to
nothing under an explicit `8bit` or `16bit` request (no chipvoice sound
exists for any of them, in any style) and now resolve to a generated one.

The same invariant extends to the EXCLUDE (swap) path -
`pickSoundForEvent`'s `exclude` parameter, the mechanism behind
`POST /resolve`'s `exclude` field and the CLI's `swap`. For every
combination with a chipvoice-only pick, excluding that pick's own id must
give the same next pick on both the chipvoice-only pool and the full pool,
whenever the chipvoice-only pool still has another candidate once its own
pick is excluded. When the chipvoice-only pool has no other candidate -
`pickSoundForEvent`'s own documented fallback returns the same excluded
sound again rather than nothing, since "a swap request with no other
candidate should say so honestly" - the only permitted difference on the
full pool is a generated sound filling that gap in place of "the same
sound again", the same gap-filling-never-overriding rule applied to the
swap case. `apps/sounds/test/resolve-generated.test.mjs` proves this
exhaustively too, against the same real, built catalogue and the same
production `pickSoundForEvent` function.

## The manifest (sounds.json)

`sounds.json` is the one contract every producer and consumer shares:
`POST /api/v1/resolve`, `GET /packs/{id}` and the CLI's own written file are
all `buildManifest()`'s output (`apps/sounds/src/lib/catalog.ts`). Its
`base` says what `files`/`fallback` paths are relative to (the server
answers `"/"`; a file written to disk by the CLI gets `"./"` instead, and
its paths are rewritten to match, so the written file is portable on its
own). `credits` lists every distinct sound's licence, author, source and
required attribution, deduplicated by sound id.

## The CLI

`packages/gamesounds/bin/gamesounds.mjs` (no dependencies) is a small set of
commands over the same public API:

- `add <event...> [--style] [--formats] [--api] [--dir] [--json]` resolves
  events to sounds, downloads the audio and writes `sounds.json` and
  `SOUNDS-CREDITS.md` into `<dir>` (default: the current directory).
- `search <query> [--style] [--category] [--limit] [--api] [--json]` is a
  free-text lookup over the catalogue, to find an event id before `add`-ing
  it.
- `list [--dir] [--json]` reports the events already resolved in
  `<dir>/sounds.json`.
- `swap <event> [--style] [--api] [--dir] [--json]` re-resolves one event to
  the next-best sound that is not the one already chosen (`exclude` on
  `POST /resolve`) and replaces it in `sounds.json`, or reports no
  alternative exists without writing.
- `sync [--dir] [--api] [--json]` verifies every file `sounds.json`
  references still exists and still hashes to its own content-addressed
  name: a missing file is redownloaded and re-verified, a present-but-
  tampered one is refused outright, never silently overwritten.

`--formats <fmt[,fmt]>` picks 1-2 of `ogg`/`mp3`/`wav` (default `ogg,mp3`);
the first is the primary file, the second the fallback, and a single format
writes no `fallback` field at all. `--json` swaps prose output for a
machine-readable summary on every command. Downloads are content-addressed,
so a file already on disk is never re-fetched, and re-running `add` merges
new events into an existing `sounds.json` rather than overwriting it. Every
downloaded file's hash is verified against its own content-addressed URL
before the command trusts it (see "Content addressing" above) -
`packages/gamesounds/test-cli.mjs` drives all five commands against a real
local server: the acceptance example, an idempotent re-run, a merge,
`--formats ogg` writing only ogg, `swap` changing the chosen sound while
keeping `sounds.json` schema-valid, and `sync` redownloading a deleted file
while refusing a tampered one.

## The runtime

`gamesounds`'s runtime (`packages/gamesounds/src/runtime.ts`) is a small,
dependency-free Web Audio player, published separately from the site so a
generated game can `import { loadSounds } from "gamesounds"` and play sounds
with no server in the loop once `sounds.json` and the audio are local.
`loadSounds()` reads a manifest (local, or `{remote: true, events, style}`
against a live API) and returns a `GameSounds` handle: `play(event, options)`
(round-robin variant selection, pitch jitter, per-event cooldown), `loop(event)`,
per-event and global voice caps with priority stealing, named buses with
`duck()` (a scheduled attack/release gain ramp), and `unlock()` for the iOS
first-gesture requirement. `packages/gamesounds/test/runtime.test.mjs`
drives all of it against a fake `AudioContext`
(`packages/gamesounds/test/fake-audio-context.mjs`), not a browser, with
`currentTime` advanced by hand so cooldown and stealing timing is exact
rather than raced against a real clock.

## The site

`apps/sounds` (Next.js App Router) is a keyboard-first result list over Web
Audio, not `<audio>`: `/` focuses search, `j`/`k` move the selection,
`space` or `1`-`8` play a variant, `r` plays a random one, `d` downloads.
Pages: `/`, `/c/<category>` (recurses into child categories or lists a
leaf's sounds), `/s/<id>` (a sound's own page: every variant, licence,
measurements and an agent snippet), `/packs/<id>` and `/docs`. The home
page's category cards preview the best-ranked sound among a branch's own
descendant leaves (every top-level branch is a hub with none filed
directly), and no card claims a preview it cannot play. There is no vote
button and no "try it in a sandbox" link: Phase 1 has no accounts to vote
with, and the sandbox is Phase 2 - a control with nothing behind it is worse
than no control (see [the backlog](BACKLOG.md)).

`apps/sounds/src/lib/player.tsx` splits creating an `AudioContext` (safe at
any time, no gesture needed) from resuming it (only inside `play()`, right
before `.start()`, satisfying iOS's gesture requirement), which lets
`preload()` decode eagerly and early: a shared `IntersectionObserver`
preloads a result row as it scrolls into view, and hovering or keyboard-
selecting a row preloads it too, all through a bounded-concurrency
semaphore (`MAX_CONCURRENT_DECODES`) so scrolling a long list never opens
unbounded parallel decodes. `data-preload-state="ready"` on a row is the
observable proof the decode cache actually filled, not just a UI flag.
Playback keeps a `Map` of currently-live sources per sound id: retriggering
a sound that is already sounding stops the previous voice first (the spam
guard - holding a key no longer stacks unlimited voices), and the sticky
`MiniPlayer` exposes the live count as `data-active-voices` alongside the
playing sound's title, variant, licence and source link. `Waveform.tsx`
rides a playhead over the peaks, driven by `AudioContext.currentTime`
through `requestAnimationFrame` (so it naturally pauses when the tab is
backgrounded, matching the audio clock, not `Date.now()`).

## For agents

`/llms.txt`, `/skill.md`, `/openapi.json` and `/.well-known/mcp.json` are
all derived from one `openApiSpec()` (`apps/sounds/src/lib/openapi.ts`), so
the API is described in exactly one place. `/skill.md` leads with the CLI
(the fastest path to a locally usable `sounds.json`) before the runtime
snippet and the raw endpoint table.

## Deploy

`public/f/` (the content-addressed audio) is gitignored; `generated/catalog.json`
is committed. Vercel never renders audio: rendering needs ffmpeg (absent on
Vercel), and different ffmpeg versions re-encode `.ogg`/`.mp3` differently
behind what is otherwise an "immutable" URL. Instead this follows apps/web's own
audio-store pattern (Decision 40), ported for gamesounds' simpler,
already-self-naming files (Decision 50): `apps/sounds/scripts/audio-store.mjs`
reads every `AudioFile` straight off `catalog.json` (no separate report to
parse, since a file already names its own content) and `pull`/`check`/`push`
against a Vercel Blob store keyed by `GAMESOUNDS_BLOB_READ_WRITE_TOKEN`
(root `package.json`'s `sounds:pull`/`sounds:check`/`sounds:push`, beside
`sounds:build`). Keys are written once and never deleted. `apps/sounds/audio-store.json`'s
`base` is a fallback `next.config.ts` rewrite for `/f/<sha256>.<ext>`: a
local `public/f/<file>` wins in dev and in tests (checked first), and only a
miss falls through to the store - `src/lib/files.ts`'s `readPublicFile`
does the same for the zip routes, verifying a store download's bytes
against the sha256 embedded in its own path before trusting it.
`vercel.json`'s `buildCommand` is only `web-kit` plus the site build (no
`catalog:build`, no ffmpeg, no network), and its `ignoreCommand` skips the
deploy entirely unless `apps/sounds`, `packages/gamesounds`,
`packages/web-kit`, `pnpm-lock.yaml` or `vercel.json` itself changed.

## Continuous integration

The `sounds` CI job never touches the network: with no third-party sources,
`catalog:build` renders the whole catalogue itself
(packages/chipvoice's own offline synthesis is the only source) and
`catalog:check-determinism` proves that fresh build's WAV/PCM hashes - each
variant's own identity, produced before any format-specific encoder runs -
equal the committed `catalog.json`'s entries for every sound
(`apps/sounds/scripts/check-determinism.mjs`, tested negatively in
`apps/sounds/test/determinism.test.mjs`). This deliberately checks nothing
about `.ogg`/`.mp3` bytes, which are not expected to be identical across
ffmpeg builds or platforms - so the unit tests, the production build and the
e2e smoke/CLI tests that follow all run against the catalogue CI just
rendered for itself (copied over `generated/catalog.json` before those
steps), not the one committed from the author's own machine, but
self-consistently covering every sound rather than a subset. Trusting the
Blob store's own bytes (see "Deploy" above) is a one-time, push-time check
(`pnpm sounds:check` against the committed catalogue and the store), not
something CI re-verifies on every run.

## Testing

`apps/sounds`: `pnpm test` (schema, search/resolve logic, audio processing,
determinism and build-check negatives, including the one-ceiling-binds
loudness gate and the chipvoice variant-count minimum) plus `node
test-smoke.mjs` (Playwright,
closed in a `finally`, against a real built site - home loads, search finds
results, preload-on-visibility fills the decode cache, play starts a real
`AudioBufferSourceNode`, the mini-player and waveform playhead track
playback, the spam guard caps active voices, a download's bytes match its
own SHA-256, keyboard shortcuts work). `packages/gamesounds`:
`npm run test:unit` (the fake-`AudioContext` runtime suite) plus
`node test-cli.mjs` (all five CLI commands against a real local server:
`add` twice for idempotence and merge, `--formats ogg`, `search`, `list`,
`swap` schema-checked against `manifest-1.json`, and `sync` redownloading a
deleted file while refusing a tampered one).
