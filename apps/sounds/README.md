# apps/sounds (gamesounds.ai)

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

The site and REST API for [gamesounds.ai](https://gamesounds.ai): a game
sound-effects bank filed by event, browsable by a person and callable by an
agent with no account. See [`docs/GAMESOUNDS.md`](../../docs/GAMESOUNDS.md)
for the data model, taxonomy, API and manifest reference, and
[Decision 49](../../docs/DECISIONS.md) for why this is a second app in the
monorepo rather than a page on chipvoice.dev. `packages/gamesounds` holds
the CLI and the runtime an agent installs into its own project; this app
never depends on that package's own build (its types are imported by
relative path), so `catalog:build` and `next build` never need to build
`packages/gamesounds` first.

## Running it locally

```bash
pnpm --filter chipvoice build                 # required first: build-catalog.mjs imports its dist
pnpm --filter sfx-engine build                # required first too: same reason, for the generated half
pnpm --filter gamesounds-site catalog:build   # generated/catalog.json + public/f/*
pnpm --filter gamesounds-site dev             # next dev --turbopack -p 3020
```

`public/f/` (the content-addressed audio files) is gitignored - `catalog:build`
renders every chipvoice recipe plus every sfx-engine preset (GS-03) and
writes both the catalogue and every served file. gamesounds is our own
sound bank: every sound is made by chipvoice's own synthesis or by our own
`packages/sfx-engine`, no third-party sounds and no external generation
API, so this build never touches the network. It is deterministic given the
same recipes, so it is safe to run again; `--out <path>` writes elsewhere
instead of `generated/catalog.json` (used by `catalog:check-determinism` to
rebuild fresh without clobbering the committed file it checks against).
`generated/catalog.json` is committed, so the site itself can build and run
without a rebuild.

## Layout

| Path | Holds |
| --- | --- |
| `catalog/taxonomy.json`, `catalog/chipvoice-recipes.mjs`, `catalog/generated-recipes.mjs`, `catalog/packs.ts` | The taxonomy, the per-event/chip recipes, the sfx-engine preset map, and the starter packs (`/packs/<id>`) |
| `scripts/build-catalog.mjs`, `scripts/lib/*.mjs` | The catalogue build: render, trim, measure, encode, write |
| `generated/catalog.json` | The built catalogue, committed |
| `public/f/` | Content-addressed audio (`/f/<sha256>.<ext>`), gitignored |
| `src/lib/catalog.ts` | Loads `generated/catalog.json`; search, event resolution, `buildManifest()` |
| `src/lib/openapi.ts` | The one OpenAPI spec `/openapi.json`, `/.well-known/mcp.json`, `/llms.txt` and `/skill.md` are all derived from |
| `src/app/api/v1/*` | The REST API |
| `src/app/[locale]/*` | The site |
| `src/components/*` | `SoundList` (keyboard shortcuts), `Waveform`, `PlayButton`, `SearchBox`, `CopyForAgent` |
| `src/lib/player.tsx` | `PlayerProvider`/`usePlayer`: the one Web Audio player instance the whole site shares |

## Testing

```bash
pnpm --filter gamesounds-site test          # node --test over test/*.test.mjs
pnpm --filter gamesounds-site build         # next build
node apps/sounds/test-smoke.mjs         # Playwright, against a running build
```

`test/*.test.mjs` covers schema validation (`manifest.test.mjs`, against
`packages/gamesounds/schema/manifest-1.json`), the catalogue's own build
checks (`checks.test.mjs`, with negative cases that prove a bad file is
actually rejected), audio processing (`audio.test.mjs`), the
determinism gate (`determinism.test.mjs`, see "Continuous integration" in
`docs/GAMESOUNDS.md`), the generated half's own loudness-layout trap
(`generated-loudness.test.mjs` - GS-03, see `docs/GAMESOUNDS.md`'s
"Generated sounds" section) and that a new style reaches a generated sound
without changing 8bit/16bit/no-style resolution
(`resolve-generated.test.mjs`). `test-smoke.mjs` needs a built, running server
(`next build && next start -p 3020`,
or `SITE=<url>` for another one) - it drives a real browser, closed in a
`finally`, to prove the home page loads, search returns results, play
starts a real `AudioBufferSourceNode`, a download's bytes match its
SHA-256, and the keyboard shortcuts (`/`, `j`, `k`, `space`, `d`) work.

## Environment

`NEXT_PUBLIC_SITE_URL` (default `https://gamesounds.ai`) is the only
required variable - it seeds `src/lib/site.ts`'s `SITE` constant, used for
absolute URLs in the OpenAPI spec, `llms.txt` and the agent manifest.
