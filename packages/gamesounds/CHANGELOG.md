# Changelog

<p align="center">
  <a href="CHANGELOG.md">English</a> &bull;
  <a href="CHANGELOG_ja.md">日本語</a>
</p>

Notable changes to the `gamesounds` npm package (the CLI and runtime for
[gamesounds.ai](https://gamesounds.ai)), newest first. See
[README.md](README.md) for the current quickstart and feature overview, and
[docs/GAMESOUNDS.md](https://github.com/gwendall/chipvoice/blob/main/docs/GAMESOUNDS.md)
in the main repository for the full data model, taxonomy and API reference.

## 0.1.0: gamesounds first npm release

First publish. `npx gamesounds add <event...>` resolves game events (a
category id, a bare leaf name, or `leaf/tag`) against gamesounds.ai,
downloads the audio and writes `sounds.json` and `SOUNDS-CREDITS.md`, every
download's SHA-256 verified against the server's own content-addressed name
before it is trusted; `search`, `list`, `swap` and `sync` round out the CLI.
`import { loadSounds } from "gamesounds"` gives a game the same round-robin
variants, pitch jitter, cooldowns, per-event and global voice caps with
priority stealing, named `Bus`es with `duck()`, and the `unlock()` an iOS
gesture requirement needs, whether the manifest is a local `sounds.json`
(`loadSounds({ manifest })`) or resolved live (`loadSounds({ remote: true,
events, style })`). `schema/manifest-1.json` is `sounds.json`'s own published
JSON Schema (draft 2020-12), importable for validating a manifest your own
tooling writes. Every sound gamesounds.ai serves is rendered by chipvoice's
own chip emulation or by gamesounds' own deterministic `sfx-engine` - never a
third-party sound or an external generation API (see Decision 52 in
[docs/DECISIONS.md](https://github.com/gwendall/chipvoice/blob/main/docs/DECISIONS.md)).
MIT.
