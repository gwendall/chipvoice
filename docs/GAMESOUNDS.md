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
`Sound`'s own `origin` (`"curated"` or `"chipvoice"`; `"generated"` is
reserved for Phase 2) and, for a chipvoice render, its `recipe`, record how
it was made without depending on chipvoice's own types.

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
style in the category rather than resolving to nothing. The shipped
taxonomy has 85 categories, 9 of them top-level hubs with no sounds filed
directly on them (every sound sits on a leaf); 66 categories hold at least
one sound.

## Sourcing and licensing

Every sound comes from exactly one of two origins, both `CC0-1.0` by
construction: curated takes from Kenney's CC0 packs, or renders from
chipvoice's own offline `renderSfx` (`packages/chipvoice`, `b649b54`). No
other source is mixed in for Phase 1, so "all CC0" holds without a runtime
licence filter - `apps/sounds/test/mapping.test.mjs` checks every shipped
file traces back to one of the two.

## Loudness, trim and determinism

The catalogue build (`apps/sounds/scripts/build-catalog.mjs` and
`scripts/lib/audio.mjs`) trims each take at a zero crossing with a
documented fade, measures loudness and rejects anything outside the stated
band: -18 LUFS momentary maximum, true peak <= -1 dBTP, no more than 10 ms
of leading silence, no clipping. A negative test in `apps/sounds/test/checks.test.mjs`
proves each check actually fails a file built to violate it, not just that
a passing file happens to pass. The build is deterministic given the same
sources: `apps/sounds/test/mapping.test.mjs` covers every shipped file's
mapping back to a source and its SHA-256.

## Content addressing

Every variant is encoded to `.ogg`, `.mp3` and `.wav` and served at
`/f/<sha256>.<ext>`, immutable. The three formats of one take share one
filename hash: the canonical WAV's own SHA-256 (`encodeVariant()` in
`scripts/lib/audio.mjs`), used as a group key. Only the `.wav` at that
address literally hashes to it - an `.ogg`/`.mp3` sharing the name is a
content-addressing convenience, not a claim about its own bytes. Anything
that verifies a hash against a downloaded file (the CLI, the browser smoke
test) fetches the companion `.wav` to check it.

## The REST API

A public, keyless `/api/v1` (`apps/sounds/src/app/api/v1`): `GET /categories`,
`GET /sounds` (search: `q`, `category`, `style`, `tag`), `GET /sounds/{id}`,
`GET /sounds/{id}.zip`, `GET /packs`, `GET /packs/{id}`, `GET /packs/{id}.zip`,
and `POST /api/v1/resolve` - the one call that answers a whole game's worth
of events at once (`{events, style}` in; `{manifest, resolved, unresolved}`
out). `GET /schema/manifest-1.json` serves the manifest's own JSON Schema
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

`npx gamesounds add <event...> [--style <style>] [--api <url>] [--out <dir>]`
(`packages/gamesounds/bin/gamesounds.mjs`, no dependencies) calls
`POST /api/v1/resolve`, downloads the audio, and writes `sounds.json` and
`SOUNDS-CREDITS.md` into `<dir>` (default: the current directory).
Downloads are content-addressed, so a file already on disk is never
re-fetched, and re-running the command merges new events into an existing
`sounds.json` rather than overwriting it. Every downloaded hash is verified
against the server's own content-addressed `.wav` before the command exits
(see "Content addressing" above) - `packages/gamesounds/test-cli.mjs` runs
the command twice against a real local server and checks both the
acceptance example and the idempotent re-run.

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

## For agents

`/llms.txt`, `/skill.md`, `/openapi.json` and `/.well-known/mcp.json` are
all derived from one `openApiSpec()` (`apps/sounds/src/lib/openapi.ts`), so
the API is described in exactly one place. `/skill.md` leads with the CLI
(the fastest path to a locally usable `sounds.json`) before the runtime
snippet and the raw endpoint table.

## Testing

`apps/sounds`: `pnpm test` (schema, search/resolve logic, mapping and
build-check negatives) plus `node test-smoke.mjs` (Playwright, closed in a
`finally`, against a real built site - home loads, search finds results,
play starts a real `AudioBufferSourceNode`, a download's bytes match its
SHA-256, keyboard shortcuts work). `packages/gamesounds`: `npm run test:unit`
(the fake-`AudioContext` runtime suite) plus `node test-cli.mjs` (the CLI
against a real local server, twice).
