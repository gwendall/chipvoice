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
`Sound`'s own `origin` (`"chipvoice"` for every Phase 1 sound; `"generated"`
is reserved for the procedural synthesis engine tracked as
[GS-02](BACKLOG.md)) and its `recipe` record how it was made without
depending on chipvoice's own types.

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
style or the procedural engine ([GS-02](BACKLOG.md)) may fill one in - but
`GET /api/v1/categories` (`listCategoriesWithCounts()`) attaches every
category's own honest `count` (its leaf's own sounds plus every descendant
leaf's, for a branch), and the site's category cards and hub pages show
that same count and an explicit "No sounds filed here yet" rather than
presenting an empty category as if it had content. Of 85
categories, 52 currently hold at least one chipvoice sound
(2 of the taxonomy's 10 style facets exist today, `8bit` and `16bit` - the
rest are non-retro styles the procedural engine will reach).

## Sourcing and licensing

gamesounds is our own sound bank: every sound is made procedurally by
chipvoice's own offline `renderSfx` (`packages/chipvoice`, `b649b54`) -
no third-party sounds, no external generation API, `CC0-1.0` by
construction. No other source is mixed in for Phase 1, so "all CC0" holds
without a runtime licence filter; `checkLicense` in `scripts/lib/checks.mjs`
still refuses any sound the build produces without one (belt and braces,
not a filter over mixed sources). A second origin, `"generated"`, is
reserved in the schema for the procedural synthesis engine tracked as
[GS-02](BACKLOG.md) (our own DSP, deterministic, recipe + seed) - a later
ticket, not built in this phase.

## Variants

Every Phase 1 sound is generated, not sourced, so none has an excuse to
ship few takes: every sound carries 3 to 5 variants (Phase 1 ships 4 per
event x chip group). `checkChipvoiceVariantCount` in `scripts/lib/checks.mjs`
fails the build if any chipvoice-origin sound falls under 3, with a negative
test in `apps/sounds/test/checks.test.mjs`; the check is gated on
`origin === "chipvoice"` rather than applied unconditionally so a future
non-chipvoice origin (the procedural engine, [GS-02](BACKLOG.md)) can define
its own rule instead of inheriting this one by accident.
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
silence, no clipping - and a **floor**, so a broken leveling pass (e.g.
collapsing everything to -40 LUFS) fails loudly instead of shipping quiet.
The floor is derived, not picked to pass: `deriveLoudnessFloor` in
`scripts/lib/checks.mjs` measures every variant's own `peakDb - lufs` gap
(invariant to which ceiling bound the leveling pass's gain or to its target
LUFS), takes the widest observed gap across the whole catalogue, and
subtracts a stated margin from the peak ceiling:
`floor = peakCeilingDb - maxObservedGap - marginDb`. A negative test in
`apps/sounds/test/checks.test.mjs` proves each check - ceilings and floor
alike - actually fails a file built to violate it, not just that a passing
file happens to pass. The build is deterministic given the same recipes:
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
determinism and build-check negatives, including the loudness floor and the
chipvoice variant-count minimum) plus `node test-smoke.mjs` (Playwright,
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
