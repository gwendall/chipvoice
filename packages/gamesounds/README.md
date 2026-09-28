# gamesounds

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

A game sound-effects bank, filed by event: the CLI and runtime for
[gamesounds.ai](https://gamesounds.ai). No account to browse or download;
every sound carries its licence (Phase 1 ships `CC0-1.0` only). See
[`docs/GAMESOUNDS.md`](https://github.com/gwendall/chipvoice/blob/main/docs/GAMESOUNDS.md)
in the main repository for the full data model, taxonomy and API reference,
and [Decision 49](https://github.com/gwendall/chipvoice/blob/main/docs/DECISIONS.md)
for why this package exists.

## The CLI

```bash
npx gamesounds add jump coin hit/heavy ui/confirm --style 8bit
```

Resolves each event (a category id, a bare leaf name, or `leaf/tag` - see
`docs/GAMESOUNDS.md`) against gamesounds.ai, downloads the audio, and writes
`sounds.json` and `SOUNDS-CREDITS.md` into the current directory (`--out` to
choose another). Every downloaded file's hash is verified against the
server's own content-addressed store before the command exits. Safe to run
again: a file already on disk is not re-downloaded, and a later run adds to
`sounds.json` rather than replacing it. `gamesounds add --help` prints the
full flag list (`--style`, `--api`, `--out`).

## The runtime

```ts
import { loadSounds } from "gamesounds";
import manifest from "./sounds.json";

const sounds = await loadSounds({ manifest });

document.addEventListener("pointerdown", () => sounds.unlock(), { once: true });

sounds.play("jump");                    // round-robin variant, jitter, cooldown
sounds.play("hit/heavy", { detune: 200 });
const music = sounds.bus("music");
music.duck(0.4);                        // ready for a one-shot on the sfx bus

const amb = sounds.loop("ambience/wind");
amb.stop();
```

`loadSounds()` also accepts `{remote: true, events, style, api}` to resolve
and stream directly from a running gamesounds.ai-compatible API with no
local `sounds.json` at all. The returned `GameSounds` handles round-robin
variant selection, pitch jitter, per-event cooldowns, per-event and global
voice caps with priority stealing, named buses with `duck()`, and the iOS
unlock gesture - see `src/runtime.ts`'s own doc comments for every option,
and `src/types.ts` for the full `Manifest`/`ManifestEvent` shape.

## The schema

`schema/manifest-1.json` (JSON Schema, draft 2020-12) is `sounds.json`'s own
published contract - import it directly (`gamesounds/schema/manifest-1.json`)
to validate a manifest your own tooling writes.

## Licence

MIT for this package's own code. Every sound gamesounds.ai serves carries
its own licence as data (`sound.license`, `sound.attribution`); Phase 1's
catalogue is `CC0-1.0` throughout, so no attribution is legally required,
but `SOUNDS-CREDITS.md` names the source and author anyway.

## Build, typecheck, tests

```bash
npm run build        # tsc -p tsconfig.build.json -> dist/
npm run typecheck
npm run test:unit    # node --test over test/*.mjs, a fake AudioContext
node test-cli.mjs    # the CLI against a real local gamesounds.ai server
```

`bin/gamesounds.mjs` ships as plain ESM, unbuilt (no dependency on `dist/`),
so it runs with no build step; `dist/` is only what `import "gamesounds"`
resolves to once this package is built or installed from npm.
