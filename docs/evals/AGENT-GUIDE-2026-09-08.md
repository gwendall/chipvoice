# Agent composition guide evaluation

<p align="center"><a href="AGENT-GUIDE-2026-09-08.md">English</a> &bull; <a href="AGENT-GUIDE-2026-09-08_ja.md">日本語</a></p>

The agent entry points now lead with complete `MusicProject` performances. Machine capabilities are generated from the engine rather than a second hand-maintained console table. The executable example is an original eight-bar, six-part ensemble with 110 source notes, rendered for 16 seconds at 44100 Hz.

## Executed workflow

`apps/web/test-agent-guide.mjs` reads the served skill, extracts and executes its JavaScript for every discovered target, then extracts and executes its Bash publication recipe against a disposable local database. The test checks raw-project validation, rejected wrappers and unknown fields, authentication, persisted idempotency, conflicts, polling, byte-identical pinned WAV and remix ancestry. It tests schema references and authentication declarations in the HTTP discovery manifest.

A synthetic additional target checks that documentation generation has no fixed target count. The live capability response is compared to the engine-derived document. The test also imports the source into the browser editor, checks the actual General MIDI program remains visible, measures audible output and captures desktop/mobile screenshots. The new check runs in the normal web CI suite and its artifacts are uploaded.

Separately, the original example ran in a new consumer directory with `chipvoice@0.17.0` installed from npm. Its project imported and played on the production site without creating a production account or publication. Browser signal RMS was approximately 0.048; no JavaScript error occurred. This complements local HTTP publication tests without adding artificial community content.

## Audio observations

| Target | Source notes | Played notes | Omitted | RMS | Peak |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2a03 | 110 | 87 | 23 | 0.03761 | 0.19050 |
| dmg | 110 | 87 | 23 | 0.03935 | 0.25092 |
| md | 110 | 110 | 0 | 0.04087 | 0.19087 |
| snes | 110 | 110 | 0 | 0.04965 | 0.20939 |
| c64 | 110 | 77 | 33 | 0.03954 | 0.62063 |

Every render repeats byte-for-byte at the same engine/sample rate; samples are finite and output is non-silent and unclipped. Full note preservation does not imply timbre preservation: the Mega Drive report includes instrument substitution and uncalibrated mixing. Other reports include palette, hardware mixing and bus-timing limitations. These remain visible rather than being filtered away.

An explicit Famicom reduction removes optional brass/counterpoint and turns simultaneous string chords into authored timed arpeggios. It fits with no omitted notes and preserves all 32 melody notes. A separate 32-note simultaneous overload is structurally valid but fails strict rendering; accepting losses produces explicit omission records. This distinguishes document validity, hardware playability and musical judgement.

## Review and corrections

Standards review identified missing authentication metadata on older endpoints and dangling component references in the tool manifest. Both were corrected and regression checks added. Spec review found a hard-coded response chip enum and generic percussion discovery that ignored actual kit instruments; both now derive from engine data.

Production bundling initially shortened floating-point pitch bounds from imported JSON. The capability endpoint now serves the original generated JSON text so its values and content hash remain consistent. The browser evaluation also found an imported program outside the short preset menu displayed as Pulse; it now displays its actual program without changing the source or audio.

## Reproduction and limits

Build with `pnpm --filter chipvoice-web build`, then use the web test runner (`pnpm --filter chipvoice-web test`) with its disposable server/database. The focused test is `apps/web/test-agent-guide.mjs`; it deliberately rejects non-local HTTP targets. Audio, reports and screenshots are generated in `.artifacts/agent-guide` and are not committed. The composition source is [compose-project.mjs](../examples/compose-project.mjs).

This is an executable-document rehearsal, not an independent language-model benchmark. Musical form was reviewed from the source; signal measurements and screenshots do not certify subjective listening quality, realistic orchestration or fidelity to a game. No DSP or calibration algorithm changed. Future-console support still requires actual engine implementation and qualification before a target is admitted to the project API.
