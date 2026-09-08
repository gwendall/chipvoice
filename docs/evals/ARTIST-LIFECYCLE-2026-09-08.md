# Artist lifecycle evaluation — 2026-09-08

<p align="center"><a href="ARTIST-LIFECYCLE-2026-09-08.md">English</a> &bull; <a href="ARTIST-LIFECYCLE-2026-09-08_ja.md">日本語</a></p>

Scope: [artists and agents](../ARTISTS-AND-AGENTS.md). SDK/DSP remains 0.17.0. Evaluation uses a production Next build, disposable SQLite accounts and original music; it sends no real email and creates no production publications.

## Results

The 30-script web qualification passed, including reference publication hashes, legacy account migration, polyphonic creation, native song playback, uninterrupted transport, MIDI import, and English/Japanese mobile views. After final lease/recipe changes, the focused publication and agent lifecycle checks were repeated.

The new browser scenario approves an agent through `/connect`, edits its username and pixel portrait, evaluates a project twice, publishes console variants, downloads/decodes MP3, converts an old WAV, and revokes access. Explicit checks cover expired/read-only tokens, denial, consumed pairing tokens, cross-origin approval, owner-session requirements, private artist isolation, legacy endpoint escapes, owner favourites, busy rendering, MP3 cancellation and active-grant history.

| Measurement | Result |
| --- | --- |
| HTTP evaluation source | Original 2-second Super Famicom fixture, 17 source / 17 planned notes |
| Repeated evaluation | Identical report, including mix and loss ledger |
| Evaluation audio | 44100 Hz; RMS 0.04307; peak 0.13374; 0 clipped samples |
| Published audio | Famicom adaptation; stereo WAV, 352844 bytes |
| Browser-decoded MP3 | Stereo; 2.03755 seconds including codec padding; RMS 0.03659; peak 0.20888 |
| Original WAV after MP3 upgrade | Every byte unchanged |
| Mobile | 390-pixel viewport; authorization, publication and Japanese library fit without horizontal overflow |
| Translation checks | 979 UI keys; bilingual repository documentation and anchors validated |

These are different target renders: the Super Famicom evaluation measurements are **not** an A/B fidelity score against the Famicom MP3. The short fixture verifies the service contract and audio pipeline; it cannot certify full-song aesthetics, original-game timbres or orchestral realism. Full-plan losses remain explicit even when the opening audio is clean.

## Independent review

Standards review found an administrator-key ordering regression, default-profile admission edge case and MP3 cancellation gap. Spec review found stale console-version selection, MP3 cancellation and active credentials hidden by recent revoked history. All were corrected. Follow-up inspection confirmed the fixes; an additional worker deadline issue now has a clock-shift regression. Contention explicitly inserts the singleton lease key and returns retryable admission instead of a SQLite CHECK error.

## Reproduce and inspect

Run `pnpm --filter chipvoice-web build` followed by `pnpm --filter chipvoice-web test`. The served skill's JavaScript is exercised on every declared target, and its Bash recipe downloads both WAV and tagged MP3. No permanent credential is included in source, screenshots or reports; the commit scan is clean.

`test-artists.mjs` writes `report.json`, `full.wav`, `full.mp3`, `connect-mobile.png`, `song-mobile.png`, `library-ja-mobile.png` and `library-desktop.png` under `.artifacts/artist-lifecycle/`. CI uploads this directory with its other evaluation evidence. Screenshots were inspected after the library had loaded its song cards, not just its loading state.
