# Documents

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Project purpose, methods and decisions live beside the code and change with it.

| Document | Purpose |
| --- | --- |
| [Roadmap](ROADMAP.md) | Roadmap and phase acceptance |
| [Playable demo](DEMO.md) | Playable demo specification |
| [Unified playground](UNIFIED-PLAYGROUND.md) | Complete arrangements and musical transport |
| [Composition controls](COMPOSITION-CONTROLS.md) | Composition controls and sourced repertoire |
| [Continuous playback](CONTINUOUS-PLAYBACK-LAB.md) | Continuous playback and public listening lab |
| [Website languages](INTERNATIONALIZATION.md) | Website dictionaries, routing and metadata |
| [Score model](SCORE.md) | Portable score and arrangement model |
| [Conformance](CONFORMANCE.md) | Verification method, corpus and oracles |
| [Audio evaluation](AUDIO-EVALUATION.md) | Listening protocol and audio measurements |
| [SNES palette](SNES-PALETTE.md) | SNES instruments, envelopes and chords |
| [Project audit](AUDIT-2026-09-05.md) | Project audit (French original) |
| [Decisions](DECISIONS.md) | Decisions and their reasoning |
| [Backlog](BACKLOG.md) | Tickets, status and discoveries |

## Developer guides

- [SDK and API reference](../packages/chipvoice/README.md)
- [Source-faithful melody workflow](../scores/README.md)
- [Full MIDI and native arrangements](../scores/arrangements/README.md)
- [Test ROM provenance](../packages/conform/roms/README.md)
- [Console logo provenance](../apps/web/public/machines/README.md)
- [Japanese share-card font](../apps/web/assets/fonts/README.md)

## Chip sheets and oracles

- [2a03](chips/2a03.md) · [nes-snd-emu](../packages/conform/oracles/nes-snd-emu/README.md)
- [dmg](chips/dmg.md) · [gb-snd-emu](../packages/conform/oracles/gb-snd-emu/README.md)
- [md](chips/md.md) · [nuked-opn2](../packages/conform/oracles/nuked-opn2/README.md)
- [snes](chips/snes.md) · [snes-spc](../packages/conform/oracles/snes-spc/README.md)
- [c64](chips/c64.md) · [residfp](../packages/conform/oracles/residfp/README.md)
- [Sheet template](chips/TEMPLATE.md)

## Evaluations

- [Complete arrangements — 2026-09-06](evals/COMPLETE-ARRANGEMENTS-2026-09-06.md)
- [Creative tools and API foundations — 2026-09-06](evals/CREATIVE-2026-09-06.md)
- [Playable demo V1 evaluation — 2026-09-05](evals/DEMO-2026-09-05.md)
- [Hot-path allocation audit — 2026-09-06](evals/HOT-PATHS-2026-09-06.md)
- [English / Japanese website — 2026-09-06](evals/INTERNATIONALIZATION-2026-09-06.md)
- [Japanese console playground evaluation](evals/JAPANESE-PLAYGROUND-2026-09-06.md)
- [MIDI import feedback — 2026-09-06](evals/MIDI-IMPORT-PROGRESS-2026-09-06.md)
- [Readable frontend type — 2026-09-06](evals/READABLE-TYPE-2026-09-06.md)
- [Loop recording evaluation — 2026-09-06](evals/RECORDING-2026-09-06.md)
- [Scheduling design and qualification — 2026-09-06](evals/SCHEDULING-2026-09-06.md)
- [Unified playground evaluation — 2026-09-06](evals/UNIFIED-PLAYGROUND-2026-09-06.md)

## Translations

Following [RTK](https://github.com/rtk-ai/rtk/blob/develop/README_ja.md), Japanese translations use `_ja.md` siblings and a language switch on every document. Japanese document links stay in Japanese; explicit source-heading anchors preserve existing fragments. Code identifiers, commands, hashes and literal ROM output retain their original spelling. Third-party READMEs, licence texts and AGENTS.md/CLAUDE.md are excluded.

Update the source and Japanese sibling together. Local decisions belong in code comments; project decisions belong in DECISIONS.md. Correct outdated explanations or explicitly mark them historical. Generated tables use the same values in both languages. After updating measurements with the harness, run the following commands. New generated wording also requires updating `translations/generated-ja.json`; unknown formats must fail rather than silently fall back to English.

```sh
python3 docs/check-translations.py --sync-generated
python3 docs/check-translations.py
```
