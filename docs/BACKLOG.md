# Backlog

<p align="center">
  <a href="BACKLOG.md">English</a> &bull;
  <a href="BACKLOG_ja.md">日本語</a>
</p>

## Project review - plan (2026-09-26)

A review of the whole repository on 2026-09-26 (package, server, client, CI and
documentation) produced the tickets below, in the order they land. Each pull
request moves its own tickets; decisions go to [the decision log](DECISIONS.md).
The GitHub releases missing for 0.15.0, 0.15.1 and 0.18.0, already on npm, were
created the same day.

- done - REV-01 `fix/progressive-cold-switch`: main CI was red because
  `test-progressive-long.mjs` measured one SNES underrun after a cold mid-song
  console change. The likely cause was the handoff itself: the playhead moves on
  while a cold target catches up, so its first block could arrive nearly spent.
  The handoff now extends that block with warm reads until the new source starts
  0.75 s ahead, the audible source keeps a 3 s reserve while another prepares,
  underruns are counted per source and per phase, and the long fixture forces
  the nearly spent case (it underran on every run before the change).

- done - REV-02 `fix/security-hardening`: forbid framing of every page, show
  the agent name on `/connect` as self-declared with the request time and a
  warning, throttle sign-in mail per recipient, stop trusting the first
  `X-Forwarded-For` entry, compare the admin key in constant time, and refuse
  to reuse the production database token in previews. Also split magic-link
  redemption so GET only checks a link and a confirm-button POST is the one
  thing that spends it, since the old GET consumed the token on a mail
  scanner's prefetch before anyone clicked; see Decision 34.

- done - REV-03 `fix/render-lanes`: one global lease still serves anonymous
  evaluations and publication renders, but publications now take it first,
  even while only queued, not just while already rendering (bounded so an
  abandoned queue row cannot block forever) rather than getting a separate
  lane. Render time is also budgeted per caller per minute (60s signed in, 20s
  anonymous), on top of the existing per-minute call limits, and anonymous
  evaluate's deadline dropped to 15 seconds; decision 33.

- done - REV-04 `fix/creator-player-bugs`: title typing floods undo, the piano
  roll playhead loop runs while paused, a published song can reuse the previous
  editor, user part names go through the UI dictionary, the shared player polls
  while idle, and the score seek bar has no keyboard control. Fixed all six,
  plus the listed cleanups (dead `active` prop, a missing unmount guard in
  `applyCode`, a mount effect that reset the draft on unrelated `publication`
  refetches, non-locale-aware grant expiry dates, and an untranslatable "The
  listening lab" link); left the Arrangements.tsx/Lab.tsx loudness-matching
  duplication alone, since the shared helper imposes a floor the arrangement
  mixer does not and reusing it would change audio output.

- done - REV-05 `perf/page-weight`: confirmed the hypothesis. `PersistentPlayer`
  and the shared `SiteHeader`/`MachinePicker` only needed a plain array of chip
  names and logos, but got it from a module that also imported `arrange` and
  `validateSong`, which pulled in all five chip engines and their inlined
  AudioWorklet sources. Moved the pure display data into its own module with
  no `chipvoice` import (see [Decision 35](DECISIONS.md)). About, Connect,
  Docs, Signin and the three Lab pages now ship about 627KB less JavaScript
  each (roughly half). Create, Explore and Library still load the real
  engine for their own editing features, but each drops about 281KB too,
  since they were loading it a second time through the shared UI shell as
  well; only the home page, which needs none of the chip machinery, is
  unchanged. Added `test-page-weight.mjs` as a standing regression guard.

- done - REV-06 `refactor/package-playback`: `BufferPlayback` converted to
  TypeScript alongside its sibling `ProgressivePlayback`, with the published
  `.d.ts` a strictly more precise superset of the old inferred one. Node
  tests for progressive playback and the `ProjectPlayer` preview path pin the
  handoff extension, the underrun and reserve rules, seeking, pausing and
  rapid reloads mid-load, and the worker cap, against a fake `AudioContext`
  and the real preview worker. `test:unit`'s 44-command chain is now
  `node --test` over every `test/*.mjs` file read from disk (decision 37).
  The SN76489 noise channel's rate-3 ("clocked by tone 2") behavior was
  checked against SMS Power's notes and MAME's public source; it already
  matches both, down to the exact frequencies the notes give, so the tests
  that pin it landed without a code change. It shipped in 0.19.1.

- done - REV-07 `ci/pipeline-hygiene`: current action majors, the evaluation
  artifact only on failure, unit and browser suites in parallel jobs,
  `test:parity` in release qualification, the GitHub release created by the
  publish workflow, and the unused root `lamejs` dependency removed. Also
  bumped `next`, `react`, `react-dom` and `domani` within their current
  majors (left `typescript` alone). The three historical releases already on
  npm without a release page, 0.15.0, 0.15.1 and 0.18.0, were left for the
  maintainer to backfill by hand rather than created by this change.

- done - REV-08 `docs/review-cleanup`: fixed every finding
  `check-translations.py` reported on main (missing anchors, a stale
  language-switch line, an untranslated measurement column) and added
  `.github/workflows/docs.yml` so it runs on every push and pull request that
  touches Markdown, since `ci.yml` ignores those paths. The Game Boy sentence
  in both READMEs' accuracy summaries was the one real inconsistency found: it
  lacked the digital-parity clause every other chip has, now fixed in all four
  README variants. README.md and README_ja.md open with a verified Quickstart
  (`npm install`, a snippet run against the built package, a link to the
  site); the progressive-playback announcement moved to a new
  `CHANGELOG.md`/`CHANGELOG_ja.md`. `apps/web/.env.example` now lists every
  `process.env` variable read outside tests, each with a one-line purpose and
  local-need note. `CONTRIBUTING.md`/`CONTRIBUTING_ja.md` document setup,
  build, typecheck, the test suites, the publication-report rule and the PR
  and decision conventions, every command checked against `package.json`.

- done - REV-09: 147 MB of lab and arrangement FLAC was tracked without LFS.
  It now lives in a Vercel Blob store under paths that name their content,
  with the reports as its manifest (decision 40).

## Next steps (2026-09-27)

Decisions 38 and 39 set the direction after the review: prove the five chips
down to real hardware, expose every instrument each chip really has, read and
write the machines' own music formats, keep renders identical over time and
across devices, then add systems one at a time. Generation opens in parallel
as a closed beta. Work top to bottom; items in one step can run in parallel.
Work without a ticket takes a NEXT id.

**Step 0. Unblock.**

- done - REV-09: lab and arrangement audio lives in object storage (decision 40).
- done - decision 38: V1 accepted, new chips reopened under its guards.
- done - NEXT-01: the skill's install line pinned
  `chipvoice@${engineVersion}`, which was `PROJECT_ENGINE_VERSION` (0.17.0),
  not the published package version. The constant is now the package version,
  a unit test holds the two equal, and the production e2e checks that the
  skill installs the version npm serves.
- done - P2-4: the package README links all five sheets, and the skill links
  each target's sheet, checked by `test-agent-guide.mjs`.
- done - NEXT-02: `.github/workflows/e2e.yml` runs the production e2e after
  every successful production deployment, and its writes belong to a dedicated
  test account, `e2e@chipvoice.dev`, through the `CHIPVOICE_E2E_KEY` secret.
  The first run with the key passed without the anonymous-write warning.
- done - NEXT-03: `test-creation-browser.mjs` failed only at a load average of
  70, on Playwright's 30-second default wait. Every wait now gets the test's
  two-minute preparation budget. The editor itself kept Pause visible through
  a tempo change, even with the page's CPU slowed sixfold.
- done - P7-7: a minimal 6510, VIC-II raster line and CIA 1 (`src/roms/c64.mjs`)
  run fourteen of VICE's `testprogs/SID` programs, chosen for reporting a
  verdict without the KERNAL; thirteen pass, in CI (`roms:c64`). `busvalue`
  fails: reading OSC3 or ENV3 does not refresh the internal bus latch the way
  real hardware's read-only registers do, a P2-1 finding, not fixed here.
  `envrate` matches Dag Lem's real-hardware-verified rate table exactly.

**Step 1. Prove the five chips.** A sheet is complete when it gives a number
at four levels: an independent oracle, test ROMs written for the hardware,
real game music, and a real unit.

- Oracle and ROM level: P1-13, P1-14, P2-1, P3-4, P7-11.
- done - P5-8: PR #85. MAME's `sn76496.cpp`, configured as `segapsg_device`,
  is a second oracle for the Mega Drive's PSG (`packages/conform/oracles/sn76496`).
  Confirmed the white noise LFSR's 57337-shift period against MAME directly;
  diagnosed three real divergences from `sn76489.ts` (a tone period of 0 or 1,
  the polarity a channel starts at before its first reload, tone 3's noise
  rate), recorded on the sheet.
- done - P2-1: every divergence the step's oracles found is fixed from the
  documents or traced and written down. First pass (#86): every 2A03
  divergence against Mesen is traced. One was the shim's (its cycle count's
  parity picked the other `$4017` delay), fixed, lifting `song-e2e`'s pulse 2
  to 100 %; the rest are Mesen's sweep power-on state, its output refreshed
  only on a write or a timer tick, and a write on a reload's own cycle, each
  confirmed with a scratch build of the core and documented on the sheet. The
  SID now leaves an OSC3 or ENV3 read on its data bus (`busvalue` passes, 14
  of 14). A Game Boy pulse started from silence outputs a digital zero until
  its first duty step (Pan Docs, SameBoy agrees). Second pass: the Game Boy
  against SameBoy (P3-4). Its noise missed whole notes because the corpus
  wrote between M-cycles, which no CPU does; the corpus is now written on
  whole M-cycles, and SameBoy parity goes from 88.15 % to 94.82 %. Two
  readings stay open on the sheet's deviations: where the noise clock stands
  at a trigger (the gbdev wiki and Pan Docs disagree; a unit decides, P3-5) and a
  pulse's trigger delay of 4 or 8 cycles, of which Pan Docs' low two timer
  bits close up to 3 (P3-7, below). The zombie compound case is
  nondeterministic on the hardware. The PSG's three divergences from MAME
  (P5-8) were already traced on the sheet with deviation rows; none is
  contradicted by a document, so nothing changes.
- done - P3-7: this PR. A trigger on ch1 or ch2 keeps the low two bits of the
  frequency timer instead of zeroing them, Pan Docs' "Obscure Behavior".
  Looked further, in the documents alone, for what explains the rest of the
  gap SameBoy showed (GBEDG has no APU page to check); none of them give a
  cycle count for it, so only the low two bits are implemented and the rest
  stays a known deviation, now up to 5 cycles instead of 4 or 8. Against
  SameBoy, `script-lengths` and `script-sweep`'s ch1 rise (1973 cycles of the
  corpus); against Gb_Snd_Emu, which does not model the rule, the same two
  logs fall back slightly (159 cycles), the expected direction for a weaker
  oracle. The golden moved and went through the calibration and the
  arrangement eval.
- done - NEXT-04: [docs/HARDWARE-EVIDENCE.md](HARDWARE-EVIDENCE.md) catalogues
  what published recordings and measurements of real hardware already exist
  for all five chips, each source opened and verified before being listed
  (decision 38's free-evidence-first order). One candidate qualified for a
  "measure one" script: the C64's combined waveforms against a real 6581 R4AR
  (`libsidplayfp/combined-waveforms`), scored by
  `pnpm --filter chipvoice-conform evidence:c64:sheet` at 82.0-94.1% byte
  match across the four combinations, written onto
  [docs/chips/c64.md](chips/c64.md#combined-waveforms-against-a-real-6581).
  It settles nothing about the analog stage (it is the pre-DAC waveform
  generator), but is one independent hardware check the digital model did not
  have before. No other chip had a candidate with a precisely known,
  reproducible input; NES already has blargg's `apu_mixer`. The fetch script,
  `packages/conform/src/evidence/fetch.mjs` (`evidence:fetch`), downloads
  what a licence allows into a gitignored `.artifacts/hardware-evidence/`,
  verified against `packages/conform/src/evidence/manifest.json`'s committed
  SHA-256s.
- Hardware level: P2-3 first, with one purchased NES validating the capture
  bench; then P3-5, P5-9, P6-8 and P7-8 as recordings or units allow. NEXT-04
  found `filter.cc`'s op-amp transfer-curve tables (a named 6581 and a named
  8580) as a register-log-free path to an analog measurement; P7-10 read the
  8580's endpoint to endpoint, leaving the curve's shape between them, and the
  6581's own kink, for P7-8; and MDFourier as P5-9's strongest lead, blocked on
  finding its test ROM's exact register sequence rather than on hardware
  access. P2-3's bench is ready in software (test ROM, render, compare, a
  synthetic self-test in CI); [HARDWARE-BENCH.md](HARDWARE-BENCH.md) has the
  unit and interface to buy and the capture-day procedure, still to be
  bought and run.

**Step 2. Every instrument each chip has.**

- done - P7-10: a second SID model, `model: "8580"` on `Chip.create`,
  `renderPerformance`, `renderProject` and a project's `settings.model`,
  documented on [c64.md#the-8580](chips/c64.md#the-8580). Its combined
  waveforms are fitted independently against reSID-fp's own 8580 tables
  (decision 41: read from measurement, not from porting its `config[1]`),
  landing short of the 6581's exact match (92.60-99.05% per combination,
  against reSID-fp's own more detailed transistor model); its longer floating-
  output and shift-register decays, its one-cycle OSC3 pipeline lag, its
  near-linear DACs (`ladderRatio: 2.0`) and its filter (`filter.cc`'s exact
  8580 R5 cutoff line and Q table) come from the documents. A second oracle
  block, reSID-fp configured as an 8580 (`corpus/c64/parity-residfp-8580.json`,
  `check:residfp-8580`, in CI under two minutes), is 99.28 % identical; both
  divergences are the combined-waveform fit's own shortfall, confirmed against
  the oracle's source, not a new bug. The 6581 default path is unchanged,
  100 % identical as before.
- done - P5-10 and P5-12: FM drums on channel 6
  (`perc: "punchy"`): a kick, a snare, a closed and an open hat, written as FM
  patches from the manual's own techniques, not sampled or a generic
  substitute; the PSG noise kit stays the default (it already does what a
  kit needs here at no cost to the other roles, and reads the same as every
  other chip's kit). The LFO (`$22`, per-channel `ams`/`pms` in `$B4`, an
  operator's own `am` in `$60`) now sounds in both drivers, wherever a patch
  asks for it: `LEAD_BRIGHT`'s vibrato and the FM kit's hats in the portable
  arranger, `MD_PATCHES.shimmer` and any `FmPatch` setting `lfoFrequency` in
  the native one. Channel 3's special mode (`$27`, `$A8`-`$AE`) reaches the
  native driver through a note's `ch3` field, `fm3` only; the sheet says why
  it stays out of the portable arranger (no shape the four-role score asks
  for pays off against losing that FM voice's single pitch). Corpus scripts
  `song-punchy` and `script-native-lfo-ch3` added; Nuked-OPN2 parity stays
  100 % including them, `check:sn76496` unregressed. A driver bug found while
  writing the new tests, `MdDriver.noteOff()` treating any FM drum hit as a
  PSG one, is fixed alongside.
- done - P7-9: the SID's filter is reachable from the arranger's own words. A
  lead's `sweep` opens the cutoff across the note; a bass's `resonant` sets a
  fixed high resonance; both are low-pass. A voice sets and clears only its
  own routing bit in `$D417`; the shared resonance, cutoff and mode compare
  against each voice's own last write, never another voice's, so a long sweep
  dispatched first can never hide a shorter overlapping note's own write
  behind a value that was only ever true for a different voice at a different
  time. Two voices asking the filter for different settings at once - the
  arranger's own `sweep` lead against a `resonant` bass, say - are diagnosed
  by `validateSong` (`filter_conflict`) rather than left to silently overwrite
  each other. A public `Instrument.pulseWidth` field gives a per-frame
  pulse-width sweep at the driver level; no built-in preset asks for it yet.
  `script-filter` and `song-filter` join the C64 corpus; reSID-fp parity holds
  at 100%, since the filter is analog-stage-only and never moves the digital
  trace.
- done - P6-10: the kit's closed and open hats default to the
  S-DSP's own hardware noise generator (`NON` at `$3D`, `FLG`'s noise clock
  at `$6C` set from the power-on sequence's very first write, never
  rewritten to a different value since only the percussion voice ever
  carries `noiseMode`), the kick and snare staying BRR samples;
  `Instrument.noiseMode` opts a hat back to its BRR burst, the same word the
  NES, Game Boy, Mega Drive and C64 kits already use for their own noise.
  Real triads across voices, the ticket's other half, were already done. A
  new corpus script (`script-noise-clock`) exercises two voices on the noise
  at once, the clock changed under a held note rather than only at key-on,
  and `FLG`'s reset and mute bits over an active noise voice; still identical
  to snes_spc. A review pass before merge found the clock was live only from
  the later, quarter-second write, leaving any hat in a song's first 250 ms
  clocked at rate 0 - an audible click rather than hiss; fixed by moving it
  into the first write.
- P4-9 (the SNES palette).
- todo - NEXT-05: a measured instrument catalogue: per preset, a golden render
  with its measured envelope and spectrum, shown on the site, built only from
  what the chip really does.
- P4-7 and MIX-12: human listening, kept separate from correctness.

**Step 3. The machines' own music.**

- done - P1-12: the NSF corpus grew from Mario's one complete song to 8 real,
  independently authored NSFs (7 FamiTracker, 1 Pently), each redistributable
  under CC0, CC-BY or zlib and recorded with its source URL, licence, author
  and SHA-256 in `scores/nsf-corpus/sources.json`. All 8 match a pinned
  Game_Music_Emu oracle command by command, 31,083 commands with zero
  divergence, on `docs/chips/2a03.md`'s generated sheet. Getting there needed
  two real capture fixes: NSF2 (version 2) support for Pently's metadata-only
  export, and Pently's own non-standard NTSC rate ($411a=16639, not the usual
  16666), whose PLAY schedule starts one cycle later than a plain
  `ceil(initEnd/period)*period` gives - the standard rate's own half-cycle
  rounding lands on the right cycle already, so this only showed up on a
  custom rate. `packages/chipvoice` was not touched.
- todo - NEXT-06 GBS, NEXT-07 VGM import, NEXT-09 SID/PSID: each against its
  reference player (GME, sidplayfp), with a score per file.
- done - NEXT-08: `importSpc` plays an `.spc` snapshot (SPC700 + S-DSP, the
  SNES's own music format) through a new SPC700 (S-SMP), timers and I/O
  ports written from fullsnes, Anomie's SPC700/S-DSP documents and the SNES
  developer wiki - never ported from snes_spc's own CPU, which stays an
  oracle in `packages/conform`. The CPU is unit-tested opcode by opcode
  against Anomie's doc (`packages/chipvoice/test/spc700.mjs`); `check:spc`
  plays the same `.spc` file through `play-spc`, a real reference SPC700
  built from the same vendored snes_spc but driving its CPU this time, and
  compares the DSP register write sequence and the output samples. Both
  matched on the first (self-authored) corpus file. This CPU is also the
  prerequisite for P6-9 below: an embedded driver cannot be checked against
  a real SPC700 without one.
- P6-9 (SPC export, now unblocked by NEXT-08's CPU) and todo - NEXT-10 (NSF
  and GBS export): a song that plays on a real console from a flash cart,
  recorded on the step 1 bench.
- No commercial rip is distributed; the measurement corpus stays private or
  freely redistributable.

**Step 4. The same bytes, later and elsewhere.**

- done - NEXT-11: this PR. Decision 43. `songs`, `projects` and
  `project_jobs` each record the `PROJECT_ENGINE_VERSION` active when the row
  was written; a render always uses the server's current engine and records
  its own version on the job, so a rendition's `engineVersion` can differ
  from its publication's (both are shown, on the API and the published page:
  "published with chipvoice x.y.z, rendered with chipvoice a.b.c" when they
  differ). Rows written before this PR stay `null` rather than guessed.
  `/s/{id}` is unchanged: it still revalidates with whatever engine is
  currently deployed (a stated limit of decision 21, an AUD-2 follow-up).
- MIX-14: compare render hashes across browsers, Node and physical phones.
- done - NEXT-12: `/accuracy` and `/ja/accuracy` show all five chips' digital
  parity (per oracle, plus c64's real-6581 combined-waveform check), test ROMs,
  analog stage and driver coverage, generated into
  `apps/web/src/data/accuracy-data.json` by `packages/conform/src/accuracy-data.mjs`
  from the same summaries `status.mjs` writes to the sheets, never typed by
  hand; CI fails if that file drifts from the sheets.
- done - NEXT-13: the arrangement `report.json` hashes only the engine modules
  `evaluate.mjs` can reach (43 of 109), so a playback-only change no longer
  forces a full `pnpm arrangements:eval`.
- done - NEXT-23: this PR. The mixing calibration hash narrowed the same way:
  `scores/mixing/provenance.mjs`'s `calibrationEngineHash()` used to hash
  every `.js` under `chips/**` plus three named modules (37 files, none of
  them the probe instruments or the measurement code itself), so a chip's
  file-format player the calibration never runs, such as an SPC700 core for
  `.spc` playback (#101), moved the hash and forced a full recalibration on
  every open engine PR each time another one merged. It now hashes only the
  modules `scores/mixing/calibrate.mjs` reaches (39 of 77), found the same way
  NEXT-13 finds `evaluate.mjs`'s, sharing the walk as
  `engineModules(entry)` in `scores/arrangements/engine.mjs`, plus
  `MIX_PROFILE_VERSION` for the measurement method. `mix-profiles.js` is
  excluded by name (it is `calibrate.mjs`'s own generated output; nothing
  reachable imports it today, so the exclusion is a guard, not a correction).
  The now-redundant `calibrateMixInstrument.toString()`/
  `mixInstrumentSignature.toString()` terms are dropped: `mix-calibration.js`
  itself is in the hashed set, so its full bytes already cover both
  functions. `check-calibration.mjs` proves the module list reaches every
  chip's core and driver plus `performance-palette.js` and
  `mix-calibration.js`, and that a file under `chips/**` nothing imports does
  not move the hash. The measured profiles are unchanged (`profileSha256` and
  `src/mix-profiles.ts` identical to before; only `engineSha256` moves).

**Step 5. New systems, one at a time, under decision 38's guards.**

- todo - NEXT-14 NES expansion audio (VRC6, VRC7, FDS, N163, Sunsoft 5B,
  MMC5), NEXT-15 AY-3-8910 and YM2149, NEXT-16 YM2151 and YM2610, NEXT-17
  OPL2 and OPL3; then PC Engine, Game Boy Advance, Amiga Paula, POKEY, TIA,
  SCC and YM2608.
- A chip enters the public picker when its sheet is filled, or when the sheet
  states which levels are still missing.

**Step 6. Generation for everyone, in parallel (decision 39).**

- GEN-01 and GEN-05: a benchmark of about 50 prompts per console, with
  latency, cost and a listening grid, rerun on every model change.
- done - GEN-03: whole-song checks (late clipping, level jumps, silence
  gaps, an unresolved ending, a loop seam, a duration mismatch), pure and
  tested in `apps/web/src/lib/composition/checks.ts`, run once a generation's
  render is ready and recorded on it, never rejecting (GEN-04 stays separate).
- GEN-04: a repair call, only if measured failures justify it.
- todo - NEXT-18: style, tempo and structure control. GEN-11 and GEN-12:
  targeted revisions and console variants.
- todo - NEXT-19: a durable job queue at deployment scale, with AUD-2's cache
  and deduplication.
- doing - NEXT-20: quotas and billing. Quotas are in place for the beta
  (decision 42): invitations, the daily limit and a monthly budget the server
  prices from recorded usage, 110 USD in production. Billing remains.
  NEXT-21: prompt moderation and refusal of known melodies, measured by
  melodic similarity.
- P8-9 and P8-14. todo - NEXT-22: terms, ownership of generated songs and
  prompt privacy.
- GEN-13: the closed beta, then pricing from its measurements. The server
  now enforces the beta's invitation and budget (decision 42); inviting
  people and measuring remain.

## Generative composition — specification (2026-09-08)

The [generation plan](GENERATIVE-COMPOSITION.md) reuses ordinary song hosting. The OpenAI adapter, private/public song creation, owner attribution, origin-preserving remixes, visibility changes without rerendering, prompt UI and downloadable agent client are implemented (GEN-02, GEN-06–10). A real local Astra trial produced complete audio. The [creator journey evaluation](evals/CREATOR-JOURNEY-2026-09-08.md) covers agent discovery through MP3 retrieval and the corresponding UI. Wider musical benchmarks, full-song diagnostics and repair remain separate follow-ups.

## Creation and API review — implementation

[The original review](CREATION-API-REVIEW-2026-09-07.md) is the historical CREATE-01–11 specification. [The implementation guide](CREATION.md) documents the versioned SDK, complete workspace, isolated code generator, immutable publications/audio, profiles, local draft library, discovery and favourites. CREATE-01–11 are implemented and locally qualified, including the production-build browser suite. Release CI runs on the associated pull request and version tag. Retro pixel avatars are generated locally from public profile IDs. Source docs/comments are English, with Japanese documentation and UI maintained alongside them.

The existing sonic/hardware acceptance remains separate. Deployment-scale durable scheduling, moderation operations, real-device listening and multiple-account abuse resistance are stated limits, not claims of completed production-scale validation.

## General automatic mixing — priority plan (2026-09-07)

Sound correctness and general adaptation remain the priority for subsequent releases and features.
**MIX-01–MIX-18** have delivered their automated implementation and qualification within the documented API/corpus limits in **0.16.1** ([PR #40](https://github.com/gwendall/chipvoice/pull/40), [release workflow fix #41](https://github.com/gwendall/chipvoice/pull/41)). Human listening in MIX-12 and physical-phone/Safari acceptance in MIX-14 remain open. Production assets and the actual npm consumer are verified; [release evidence](https://github.com/gwendall/chipvoice/releases/tag/v0.16.1) records the final checks. Dependencies and acceptance criteria are
in [Automatic mixing](AUTOMATIC-MIXING.md). Song fixtures calibrate and evaluate
the shared policy; production behavior must never special-case their identity.
The [API](MIXING-API.md) and [evaluation](evals/AUTOMATIC-MIXING-POLICY-2026-09-07.md) record evidence and limits. Human listening and real-device acceptance remain explicitly open.


The [roadmap](ROADMAP.md) says where this is going. This is the list of what is
being done about it, ticket by ticket, kept current at the start and the end of
every pull request. A ticket moves to *doing* with its branch, and to *done* with
its PR and what was learned. Discoveries that change the plan go in the log at
the bottom, dated, and the ticket they change is updated in the same commit.

Statuses: `todo`, `doing`, `done`, `dropped` (with why).

Cold-review corrections for 0.16.2 are recorded in [the follow-up evaluation](evals/AUTOMATIC-MIXING-COLD-REVIEW-2026-09-07.md): joint SNES headroom, silent allocation, shared resources, MIDI role review and stronger acoustic acceptance. The original 0.16.1 evaluation is historical evidence, not qualification of the new engine.

## MIDI import feedback — 2026-09-06

- done — `fix/midi-import-feedback` (0.15.1): visible preparation stages,
  sample-based progress and elapsed time, legacy MIDI text decoding with explicit
  fallback, channel labels, and long-MIDI E2E through actual audio output.
  Reproduced with the user's local Musha Aleste MIDI; source bytes stay local.

## Unified playground and transport — 2026-09-06

- Implemented and qualified: [spec](UNIFIED-PLAYGROUND.md). Complete arrangements are the
  default on `/`; the old arrangement URL redirects. Full-song pause/seek/restart,
  loop/end, an output-clock score cursor and progressive composer tools preserve
  source truth, imports, drafts and sharing. Browser/audio evaluation and two-axis
  review passed; [evidence and screenshots](evals/UNIFIED-PLAYGROUND-2026-09-06.md).

## Complete arrangements — 2026-09-06

- done — `feat/complete-arrangements` (0.15.0): exact-tick polyphonic MIDI import,
  deterministic interval allocation with per-note loss reports, native Mario
  source extraction and independent GME command comparison; full Zelda/Sonic
  MIDI arrangements; public arrangement deck and local worker rendering.
  [Evaluation and review](evals/COMPLETE-ARRANGEMENTS-2026-09-06.md) records
  atomic bus transactions, eight SNES pitched voices, bounded MIDI expression,
  exact reference binding and publication checks.
- done for native replay — Zelda and Sonic now retain original chip commands
  and have independent emulator references. Portable timbres/expression remain
  approximations; native command parity does not certify those adaptations.
- todo — additional MIDI expression adapters (pan, modulation/aftertouch, SysEx
  patch banks), with independently reviewed references. Events are retained and
  unsupported behavior is disclosed.

## Phase 1. The bench

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P1-1 | Events in chip cycles | done | 0.4.0 |
| P1-2 | Register writes are bytes: `RegisterEvent` is `{at, addr, value}`, the core decodes `$4000-$4017`, the driver encodes | done | 0.5.0. Learned: see the log |
| P1-3 | Digital and analog apart: a per-cycle digital output before mixing, resampling and filters; the output stage as its own class with a named profile | done | PR #2. `Nes2A03`, `NesOutputStage`, `NESDEV_PROFILE`; golden unchanged |
| P1-4 | The trace: a change stream per voice, `(cycle, value)`, which is what parity is measured on | done | PR #2. `DigitalChip.trace`, `ChipDefinition.digital()` |
| P1-5 | `conform`: the harness. Corpus in, two cores run, first divergence out, numbers as JSON | done | PR #3, `packages/conform` |
| P1-6 | Oracle 1: Nes_Snd_Emu, built natively from vendored LGPL sources with a recording sink in place of Blip_Buffer | done | PR #3. Its limits are on the sheet |
| P1-7 | Corpus 1: this project's own songs and feature scripts, as byte write logs | done | PR #3, 12 logs |
| P1-8 | The sheet's numbers written by the harness | done | PR #3, `--sheet` between markers |
| P1-9 | `conform` in CI on the subset | done | PR #3, against a committed baseline |
| P1-10 | The 5-step frame sequence and `$4017` write timing | done | 0.5.0, with P1-2: the decoder needed `$4017` anyway |
| P1-11 | A 6502 test fixture to run blargg's APU ROMs | done | PR #7. 29 of 29 pass, in CI |
| P1-12 | Corpus 2: real games, from NSFs played through a reference with a write logger | done | Mario Ground Theme's 41,999 commands, then a corpus of 8 real, permissively licensed NSFs (7 FamiTracker, 1 Pently) added, 31,083 commands, all matched against pinned GME at exact cycles. `docs/chips/2a03.md`'s nsf-corpus sheet, `pnpm nsf-corpus:sheet` |
| P1-13 | Oracle 2: a modern reference - Mesen 2's APU or puNES - for the envelope, the sweep and the triangle's start, which neither the 2005 oracle nor the test ROMs settle | done | #84. Mesen 2's APU, vendored under `packages/conform/oracles/mesen`; the sweep's divider timing disagrees, filed as P2-1 |
| P1-14 | The triangle metric: compare step times with a per-run shift and a sequencer-position offset, so the triangle reads as identical when it is, rather than a few percent because of the oracle's start convention | done | PR #4. Hidden steps put back; every triangle run aligns on step times |

## Phase 2. NES to 100 %

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P2-1 | Fix every divergence the harness finds, or document why the oracle is wrong | done | #86: 2A03 against Mesen traced and documented (a shim fix), SID bus latch, Game Boy pulse start. Second pass: the DMG corpus on whole M-cycles; SameBoy's noise clock and pulse trigger delay recorded as deviations; the PSG's MAME divergences reviewed |
| P2-2 | The DMC | done | PR #5, 0.6.0. Identical steps to the oracle one bit period apart; see the log |
| P2-3 | A reference unit for the analog stage, captured and measured | doing | PR #8: the mixer is measured against blargg's own recordings of his NES and cancels as well as it; the filters still want a unit's line output. NEXT-04 traced the filter corners' provenance to blargg's own capture and lidnariq's analysis of it, but the files are gone and no revision was named: see [HARDWARE-EVIDENCE.md#nes-2a03](HARDWARE-EVIDENCE.md#nes-2a03). The capture bench is now ready in software and proven without hardware: a committed test ROM, `bench:nes:render`/`bench:nes:compare` (sync marker, drift correction, per-band error, corner fit), and a synthetic CI self-test (`bench:nes:selftest`) that recovers deliberately wrong corners, gain, latency, drift, DC and noise within stated tolerance. [HARDWARE-BENCH.md](HARDWARE-BENCH.md) has what unit and interface to buy and the capture-day procedure; no unit is bought yet |
| P2-4 | Release with the sheet linked from the package README and the skill | done | The README links every sheet; the skill links each target's |

## Phase 3. Game Boy

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P3-1 | DMG APU from Pan Docs and blargg's notes, verified by his dmg_sound ROMs on an SM83 fixture | done | `packages/chipvoice/src/chips/gb`, `packages/conform/src/roms/{sm83,gb}.mjs` |
| P3-2 | `ChipSpec`, `RegisterEvent` and the instrument model rewritten against two chips | done | `ChipDriver`, `FrameState`, `ChipSpec.roles`; `chips/{nes,gb}/driver.ts`. The 2A03's golden hash did not move |
| P3-3 | The Game Boy sheet, generated | done | `docs/chips/dmg.md` |
| P3-4 | A stronger Game Boy oracle: SameBoy driven by a register log, or a GBS player on the SM83 for real-game logs | done | PR #83. SameBoy's DMG-B `apu.c` vendored as a second oracle (`packages/conform/oracles/sameboy`); found and fixed a driver bug where `main.c`'s redundant `qsort` broke ties between same-cycle writes differently on gcc and clang, making the identical source cross-compiler non-deterministic. Once fixed, two narrower real gaps remained, since settled by P2-1 (a pulse trigger's first duty edge lands late; noise's cold start is a full note late), plus an open zombie-mode compound-case divergence |
| P3-5 | The Game Boy's output stage measured: a DMG's line-out under a known script | todo | needs a unit, like P2-3. NEXT-04 found a citable public-domain formula (gbdev Pan Docs) matching the sheet's placeholder and a die-level teardown, but no measured recording of any unit: see [HARDWARE-EVIDENCE.md#game-boy-dmg](HARDWARE-EVIDENCE.md#game-boy-dmg) |
| P3-6 | The Game Boy in the API, the studio and the skill: `chip: "dmg"` accepted, rendered and played; a chip selector in the editor; the skill says what changes | done | `apps/web`, skill 0.4.0 |
| P3-7 | A pulse trigger keeps the low two bits of its frequency timer, as Pan Docs says | done | this PR. P2-1's second pass. Closed up to 3 of a note's first-step gap against SameBoy; the rest, up to 5 cycles, is undocumented in the sources checked and stays a deviation |

## Phase 4. The portable score

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P4-1 | VGM export from the event stream, and VGM import into the corpus | done | PR #4. `toVgm`, `recordSong`; `import-vgm` in the harness |
| P4-2 | The score: roles and intents | done | `score.ts`: `Score`, `arrange`, `INTENTS`; decision 16 |
| P4-3 | An arranger per chip | done | `chips/nes/arranger.ts`, `chips/gb/arranger.ts`; the roles and idioms in `ChipSpec.roles` and `ChipDriver` since P3-2 |
| P4-4 | Instruments in the API and the wire format | done | as `intent`, words from the catalogue, stored, forked, rendered; skill 0.5.0 |
| P4-5 | Idioms per chip in the skill | done | skill 0.5.1: the catalogue per word, and a section per chip on how to write for it. There is no MCP server; the skill is the file an agent reads |
| P4-8 | Intent pickers in the studio, one per row | done | Role timbre choices shipped with P8-6 in PR #20 |
| P4-6 | Smooth vibrato through the sweep unit, the FamiStudio trick, so a vibrato across a period high-byte boundary does not reset the phase | done | `NesDriver.smoothHighByte`; golden hash moved; see the log |
| P4-7 | "Agent-written music sounds good" as a named goal with its own measures | doing | `feat/console-listening-evals`: [listening protocol and initial findings](AUDIO-EVALUATION.md), actual preset matrix, stems, native SNES parity, level-matched version comparisons. Human reference listening remains open |
| P4-9 | SNES musical palette: original/licensed BRR instruments, authored envelopes and polyphonic chords evaluated against explicit musical references | doing | Original build-time BRR palette, hardware envelopes and simultaneous chords implemented; [measurements and acceptance](SNES-PALETTE.md). Listening against a chosen musical reference remains open; DSP parity does not establish musical likeness |

## Operations

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| OPS-1 | Vercel: the `chipvoice-api` project was still connected to the repository and failed a deployment on every push, next to the `chipvoice` project that serves chipvoice.dev | done | Its root directory was `apps/api`, which stopped existing when the API moved into `apps/web`; nothing referenced it. Deleted with the Vercel CLI on 2026-09-04. Every PR from #1 to #11 wore its red cross; it should have been fixed at #1 |

## Phase 5. Mega Drive

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P5-1 | Nuked-OPN2 vendored as the YM2612 oracle: built natively, driven by a register log, its per-channel outputs traced | done | `packages/conform/oracles/nuked-opn2` |
| P5-2 | The YM2612 in TypeScript, ported from Nuked-OPN2 line for line, behind `DigitalChip`: six FM channels and the DAC | done | `chips/md/ym2612.ts`; identical to Nuked on every script |
| P5-3 | The SN76489 from the documents, with formula tests | done | `chips/md/sn76489.ts`; a second oracle now compares it, see P5-8 (PR #85) |
| P5-4 | The Mega Drive chip: the two behind one `ChipCore`, the ladder DAC and the console's output stage, a worklet | done | `chips/md/dsp.ts`; the output stage is a placeholder |
| P5-5 | The Mega Drive's driver and arranger: FM patches for the intents, the PSG for the chord, the kit on the noise | done | `chips/md/driver.ts`, `arranger.ts`; FM drums are still to come |
| P5-6 | VGM for the YM2612 and the PSG, the chip in the API, the studio and the skill | done | `toVgm({ chip: "md" })`; skill 0.6.0 |
| P5-7 | The Mega Drive sheet: parity with Nuked on every voice, a corpus of scripts and songs | done | `docs/chips/md.md` |
| P5-8 | A PSG oracle: MAME's `sn76496` behind a shim, or a Master System test ROM | done | PR #85. `packages/conform/oracles/sn76496`, configured as `segapsg_device`; three diagnosed divergences on the sheet |
| P5-9 | The Mega Drive's output stage measured: a Model 1's line-out under a known script | todo | needs a unit, like P2-3. NEXT-04 found MDFourier: named real units across both models, captured through a documented open-source test ROM, but its exact register sequence was not located; see [HARDWARE-EVIDENCE.md#mega-drive-ym2612-ym3438-sn76489](HARDWARE-EVIDENCE.md#mega-drive-ym2612-ym3438-sn76489) |
| P5-10 | FM drums on channel 6 and the LFO in the arranger | done | `perc: "punchy"` plays a kick, a snare and hats as FM patches on channel 6 instead of the PSG noise kit, which stays the default; the LFO sounds when a patch's `pms`, `ams` or an operator's `am` asks for it. `chips/md/arranger.ts`, `driver.ts`; the sheet says why the noise kit stays the default |
| P5-11 | A game's own driver beside the portable one: all six FM channels, the three tones, the noise and the DAC by name, a text tracker, a bank with a PCM kit, and the render steps a game ships through, extracted from Punk Force | done | `chips/md/native-driver.ts`, `bank.ts`, `tracker.ts`, `src/game-audio.ts`; [MD-NATIVE-DRIVER.md](MD-NATIVE-DRIVER.md), decision 32; the game's score compiles and renders to the same bytes |
| P5-12 | The native driver's LFO and channel 3's special mode | done | the LFO turns on for whichever loaded patch's `ams`, `pms` or an operator's `am` asks for it first; a note's `ch3` field (fm3 only) sets channel 3's special mode. `native-driver.ts`; `script-native-lfo-ch3` added to the corpus |

## Phase 6. SNES

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P6-1 | snes_spc's S-DSP vendored as the oracle: built natively, driven by a register log with the sample RAM from the log's memory lines, its stereo output traced per sample | done | `packages/conform/oracles/snes-spc` |
| P6-2 | The S-DSP in TypeScript, ported from snes_spc line for line, behind `DigitalChip`: the digital stereo output is the voice pair | done | `chips/snes/sdsp.ts`; identical to snes_spc on every log, first run |
| P6-3 | The SNES chip: 64 KB of sample RAM, the DSP reached through the SPC700's `$F2`/`$F3`, a placeholder output stage, a worklet | done | `chips/snes/dsp.ts` |
| P6-4 | A BRR encoder, and the sample instrument shape: `Instrument.sample` | done | `chips/snes/brr.ts`; `ChipDriver.memory()` |
| P6-5 | The SNES's driver and arranger: samples synthesised per intent, ADSR, the echo as the signature, the kit as samples | done | `chips/snes/driver.ts`, `arranger.ts` |
| P6-6 | The chip in the API, the studio and the skill. VGM has no S-DSP; SPC export is a driver in the file and comes later | done | skill 0.7.0; SPC export is P6-9 |
| P6-7 | The SNES sheet: parity with snes_spc on the output stream, a corpus of scripts and songs | done | `docs/chips/snes.md` |
| P6-8 | The SNES's output measured: a capture of the DSP's stream or a unit's line-out under a known script | todo | needs a unit. NEXT-04 found the one real logic-analyser capture of a console's S-DSP lines anyone made is dead-linked, and the one filter-frequency estimate is a schematic simulation, not a capture: see [HARDWARE-EVIDENCE.md#snes-s-dsp](HARDWARE-EVIDENCE.md#snes-s-dsp) |
| P6-9 | SPC export: a driver embedded in the file, so a song plays in any SPC player | todo | unblocked by NEXT-08: an export needs to be checked against a real SPC700, which `check:spc`'s `play-spc` oracle now gives it |
| P6-10 | Real triads across voices and hardware-noise hats | done | this PR. Triads are implemented and tested, including internal mixer checks. The kit's hats default to the DSP's own hardware noise (`NON`, `FLG`'s clock set from the very first write at power-on, never rewritten to a different value), the kick and snare staying BRR samples; `Instrument.noiseMode` opts a hat back to its BRR burst. A corpus script exercises two noise voices at once, a held note's clock changed, and `FLG`'s reset and mute bits over an active noise voice. A review pass before merge found the clock was live only from the later, quarter-second write, leaving any hat in a song's first 250 ms clocked at rate 0; fixed by moving it into the first write |

## Phase 7. C64

| # | Ticket | Status | Where |
| --- | --- | --- | --- |
| P7-1 | reSID-fp vendored as the SID oracle, in the harness only: it is GPL and never ships in the package (decision B) | done | `packages/conform/oracles/residfp`, `src/oracles/residfp.mjs` |
| P7-2 | The SID's digital part from the documents: oscillators, the noise register, waveform selection and combination, sync and ring modulation, the envelopes with their rate counters and the ADSR delay bug, behind `DigitalChip` | done | `packages/chipvoice/src/chips/c64/sid.ts`; identical to reSID-fp on every log |
| P7-3 | The SID's analog stage as a profile: the 6581's DAC ladders, the filter, the output stage | done | `chips/c64/dsp.ts`, `SID_6581_PROFILE`; unmeasured, the 8580 left for P7-10 |
| P7-4 | The C64's driver and arranger: waveforms and the envelope for the intents, three voices for four roles with the classic sharing | done | `chips/c64/driver.ts`, `arranger.ts`; the sharing rule in `Sequencer.scheduleStep` |
| P7-5 | The chip in the API, the studio and the skill | done | schema, openapi, skill 0.8.0, llms.txt, studio |
| P7-6 | The C64 sheet: parity with reSID-fp on the digital voices, a corpus of scripts and songs | done | `docs/chips/c64.md`, `corpus/c64`, `check:c64` in CI |
| P7-7 | VICE's SID test programs (`testprogs/SID`) on a 6510 in the harness, reading OSC3 and ENV3: a second verification of the digital part against programs written for the hardware | done | `packages/conform/roms/vice-sid`, `src/roms/c64.mjs`, `roms:c64` in CI; 13 of 14 pass, `busvalue` a P2-1 finding |
| P7-8 | A 6581's line-out captured under a known script, and the analog profile fitted to it: the DAC's zero, the filter's curve, the output stage | todo | needs a unit. NEXT-04 found reSID's `filter.cc` already has a named 6581 R4AR's own op-amp transfer-curve tables, diffable against our filter model with no register log needed, not yet implemented: see [HARDWARE-EVIDENCE.md#c64-sid-6581-8580](HARDWARE-EVIDENCE.md#c64-sid-6581-8580). It also implemented a combined-waveform check against a second named 6581 (`libsidplayfp/combined-waveforms`); see [c64.md#combined-waveforms-against-a-real-6581](chips/c64.md#combined-waveforms-against-a-real-6581) |
| P7-9 | The filter in the arranger: a word that opens it, a sweep for a lead | done | `chips/c64/arranger.ts`, `chips/c64/driver.ts`; a lead's `sweep` opens the cutoff across the note, a bass's `resonant` holds a high resonance, both low-pass; a voice sets only its own routing bit in `$D417`, the shared registers compare each voice's own last write rather than another voice's, so a note dispatched out of true time order can never bury a later note's own write; two voices wanting different filter settings at once are a `filter_conflict` in `validateSong`; `Instrument.pulseWidth` gives a per-frame pulse-width sweep, unused by any preset yet |
| P7-10 | The 8580: its combined waveforms, the triangle and sawtooth delay, its linear DACs and its own filter, as a second profile and a second table | done | `model: "8580"` on `Chip.create`/`renderPerformance`/`renderProject`; `SID_8580_PROFILE` and `COMBINED_8580` in `chips/c64/{dsp,sid}.ts`, fitted independently against reSID-fp's own 8580 tables (`fit:c64 -- --model 8580`), not ported from its `config[1]` (decision 41); reSID's `filter.cc` 8580 R5 curve and reSID-fp's `Dac` docs' 2.0 ladder ratio read as measurement data. A second oracle block, reSID-fp as an 8580 (`corpus/c64/parity-residfp-8580.json`, `check:residfp-8580`, in CI), 99.28 % identical; the two divergences are the combined-waveform fit's own shortfall, not a bug. See [c64.md#the-8580](chips/c64.md#the-8580) |
| P7-11 | The harness holds every change of every stream in memory, and a SID sawtooth changes every cycle: the corpus keeps dense waveforms short. A streaming compare, or a change stream as typed arrays, would lift that | done | PR #79. A `ChangeStream` (typed-array columns, not one object per change) and a streaming oracle read (`spawn`, not `spawnSync` with a giant buffer) replace both; `bestShift`'s string-keyed map is gone too. Four dense c64 scripts added, all three voices held on a sawtooth, a triangle, a noise rate or a combined waveform at once; the eight-second three-sawtooth case that used to run the harness out of memory now runs on demand (`check:c64:dense`) and passes |

## Phase 8. The site as an instrument

[DEMO.md](DEMO.md) is the agreed product spec. Decision 20 updates decision 19.
Delivery slices: **A** repairs the two foundations; **B** delivers the first
playable screen; **C** completes V1 editing and sharing; **D** contains later
extensions. Work in that order, using the dependencies below. Keep existing
IDs so historical references remain useful. V1 implementation is grouped in one
PR; deployment and real-device checks are distinct from local completion.
Decision 38 accepted V1 on 2026-09-27; P8-9, P8-13 and P8-14 continue after
it.

| # | Ticket | Status | Slice / dependencies |
| --- | --- | --- | --- |
| P8-15 | Preserve the complete score across load, editor, playback and fork: patterns, order, chord shapes, intents and machine. A title-only fork changes no music | implemented | A. Audit finding 1; shared document model before editing UI |
| P8-16 | Cancel scheduled music on Stop and voice stealing; define restoration after SFX and ownership of shared registers. Test resulting writes/audio, including overlapping effects | implemented | A. Audit finding 2; prerequisite for reliable switching and arcade pads |
| P8-17 | Fail conformance on a missing/invalid baseline and unexpected corpus membership; retain explicit subset runs. Add the foundation regressions | implemented | A. Audit finding 7; supports P8-15/16 |
| P8-1 | The first musical gesture works once on the production build. Handle audio unlock, pending creation and obsolete switches; a nonmusical click does not start playback | implemented | B. After P8-16; browser lifecycle and hydration |
| P8-2 | Three excellent composed cartridges, each playable on all five machines. A tune is loaded at opening; explicit Play starts it | implemented | B. Replaces arbitrary-click autoplay and six-to-eight-preset scope |
| P8-3 | Five visible machine selectors; switching preserves musical position and edits, with no overlapping player or unexpected start | implemented | B. After P8-15/16; selectChip does not currently preserve position |
| P8-5 | Four reactive role lanes showing notes, duration, playback and real voice ownership. Mute/solo; measured levels only when actually measured. Small scene actions accompany SFX | implemented | B. After P8-16; respect C64 shared voices and reduced motion |
| P8-18 | Four arcade pads: Jump, Coin, Laser, Explosion. Chip-appropriate sounds, touch and keyboard, visual action and truthful voice interruption/recovery | implemented | B. After P8-16; no full game required |
| P8-8 | Instrument-first layout: presets, machines, display and pads. Title, account and publication controls appear when relevant; playing needs no account | implemented | B. DEMO.md visual direction; no marketing hero prerequisite |
| P8-14 | Measure first sound, machine comparisons, effects, edits and shares without identity or score content. Observe usability sessions and establish a baseline | partial | Session-only counters implemented; observed human sessions and performance baseline deferred until a representative device is available |
| P8-4 | Sound on touch and an eight-note audition palette; document keyboard shortcuts, preserve a scale-assisted and a chromatic path | implemented | C. After P8-16; live recording remains P8-10 |
| P8-6 | Simple pitch-by-height editing of the selected pattern; preserve the full score and provide existing intent choices per role | implemented | C. Shipped in PR #20; incorporates P4-8 |
| P8-7 | Drum creation as a readable step grid with immediate audition. Distinguish musical drum controls from arcade SFX pads | implemented | C. After P8-15/16 |
| P8-9 | Phone editing with large enough targets and an overview; scroll/pinch never paint. Keyboard activation/navigation; do not shrink targets merely to fit sixteen steps | partial | Controls and touch-emulated editor implemented; real-phone scroll/pinch check deferred |
| P8-19 | Undo/redo and automatic local draft recovery. Raw text remains editable while incomplete, with validation before application | implemented | C. After P8-15; repairs text input and provides reversible exploration |
| P8-20 | View/copy the current score and runnable library code; share reopens the complete song and chosen machine. Clearly separate draft from publication | implemented | C. After P8-15; verify round trip and copied example |
| P8-21 | Coherent audio downloads: render identity/cache contract, stereo where appropriate, correct machine tags. Stable song links survive asset versioning | implemented | C. Before claiming exported audio reproduces the demo |
| P8-22 | Put critical production-build web journeys in CI with a temporary database; verify actual transport output, score preservation, input and sharing | implemented | A regressions, B/C journeys; no production writes from CI |
| P8-10 | Quantized live recording and overdubbing from the note palette and drums, with undo | implemented | D. Audio-clock tap capture, stable backing loop, one Undo per take and draft recovery; [qualification](evals/RECORDING-2026-09-06.md). Physical-phone checks remain P8-9 |
| P8-23 | Controlled variations: vary a role, lock others, undo. Start with authored/rule-based music, without a remote AI dependency | implemented | Seeded local melody/drum/timbre transforms, locked roles and Undo; silent patterns preserved; decision 26 |
| P8-11 | Web MIDI input using the same tested transport and ownership model | implemented | Opt-in MIDI taps share audition/recording; channel-10 drums and cleanup tested with simulated ports. Physical MIDI latency remains unmeasured |
| P8-12 | Producer exports: stems, render on all five machines, VGM where supported | implemented | Cancellable WAV/stems/five-machine ZIP and NES/GB/MD VGM; independent ZIP reader and byte parity; decision 26 |
| P8-13 | Expose the SID's actual filter and sweep; consider alongside SNES triads and FM drums as richer musical arrangements | done | D. P7-9 done: the SID's filter is reachable from the arranger. P5-10 done: FM drums and the LFO in the MD arranger. P6-10 done: SNES triads and hardware-noise hats; no simulated generic substitute |

## Audit follow-ups

The [audit](AUDIT-2026-09-05.md) contains evidence and the distinction between
reproduced defects and risks found by inspection. Score, transport, frontend,
cache and CI work is tracked in phase 8 above. These remaining repairs are
explicitly tracked without turning anonymous demo delivery into a platform
rewrite.

| # | Ticket | Status | Priority / dependency |
| --- | --- | --- | --- |
| AUD-1 | Separate stable user identity, API keys and browser sessions; recover publications across logins, consume magic tokens atomically, and do not rotate an agent key on browser login | implemented | Stable account ownership, independent keys/sessions, atomic login consumption, revocation and account UI; decision 28 |
| AUD-2 | Profile render CPU, bound/cache request variants and deduplicate concurrent renders; add worker/storage only as measurements justify | partial | Worker, duration/concurrency/rate/cache bounds, versioned keys, deduplication and conditional GET implemented; representative CPU profiling and distributed capacity remain open; decision 27 |
| AUD-3 | Make low-sample-rate offline scheduling correct, bound the timeline without a position reader and fix beatDelay's contract | partial | Scheduling fixes, host-driven offline expiry and direct shared bus queues included (decision 23); low-rate performance qualification remains separate |
| AUD-4 | Validate playable ranges per machine/voice and return arrangement diagnostics; preserve explicit target identity in the arranged API | implemented | Target identity preserved; base-pitch/arpeggio range and chord-capacity warnings, plus modulation (vibrato range/resolution/rate, slide range/resolution, volume step) and voice-budget (voice share, percussion voice) diagnostics, all with measured/limit fields, backward-compatible in `validateSong` and both API routes |
| AUD-5 | Use versioned database migrations with precise error handling | implemented | Versioned atomic migrations; legacy/fresh/idempotence/failure rollback covered; decision 28 |
| AUD-6 | Align root/npm README, package metadata, capabilities and licence statements; distinguish corpus parity from physical verification, remove misleading global completeness claims | implemented | Root/npm README, score spec, OpenAPI, agent skill and status generator aligned on five machines, actual arrangements, licensing, versioned audio and corpus versus hardware evidence |
| AUD-7 | Audit hot-path allocation/copy sites in five cores, drivers, encoding and demo animation; reuse scratch with explicit ownership | implemented | [Audit and qualification](evals/HOT-PATHS-2026-09-06.md); representative-device CPU/GC measurements remain alongside AUD-3 |

## Later phases

Decision 20 closed new systems until phase 8 V1 acceptance. Decision 38
accepted V1 on 2026-09-27 and reopened additions under its guards; the order
is in [the next steps](#next-steps-2026-09-27) and the roadmap.

## Discoveries

**2026-09-27, P1-13.** A second, current oracle - Mesen 2's APU, vendored
under `packages/conform/oracles/mesen` - checks the envelope, the sweep and
the noise's bit pattern against a modern reference, on all 13 corpus logs
(65.4744 % identical overall). The envelope and the triangle's phase agree
once a line is running, and the noise's bit pattern agrees throughout, once
the pulses' own class-1 one-cycle shift is allowed for - the one thing the
2005 oracle cannot settle. The sweep's target-period arithmetic agrees
exactly; its divider's timing does not: nesdev's page checks the divider
against zero before reloading or decrementing it, which this core's
`clockSweep()` follows, while Mesen's vendored code decrements first and
checks the result, landing a freshly-armed sweep's first period step one
half-frame clock late. Filed as a finding for P2-1, not fixed here. (P2-1
later found the algorithm to be the same unit counted one apart; the
difference is Mesen's power-on divider and period, both 0, outside its own
range.) See
`docs/chips/2a03.md`'s second-oracle section and the oracle's own README for
the numbers and the full diagnosis. No core change; no golden hash moved.

**2026-09-07, Japanese documentation.** `docs/japanese` translates the root/SDK
READMEs and all first-party documents using RTK-style `_ja.md` siblings. Validate
language links, source anchors and generated measurement parity. Third-party
material, licence texts and agent instructions retain their originals.
Done in PR #37: 43 bilingual documents, 32 unchanged executable examples,
GitHub Markdown rendering and two-axis review qualified. Generated-table
translation rejects unknown headers; a reviewed SNES description keeps the
current simultaneous-chord capability.

**2026-09-05, phase 8 and audit follow-ups.** The user clarified that the site
is a playful library demo. DEMO.md captures the agreed V1 and later ideas.
The audit reproduced complete-score loss on a title-only fork and musical
register writes returning after Stop or overwriting SFX. Repair those two
foundations first, then ship the visible instrument. Explicit Play replaces
arbitrary-click autoplay; three strong cartridges replace the larger initial
preset target. Live recording, MIDI, variations and stems follow V1. Existing
phase 8 IDs are retained, new prerequisites and missing outcomes are added,
and no implementation is marked complete by writing this specification.

**2026-09-04, P7-1 to P7-6.** The fifth chip, and the first written from the
documents since the Game Boy: the SID's digital part is chipvoice's own code,
from the datasheet, kevtris's rate values, plogue's ADSR findings and what
VICE and reSID published from the die, and reSID-fp, GPL, stays in the
harness as the oracle (decision 18). It was identical to reSID-fp on every
stream of every log once two things were right, both facts about the
hardware: power-on is a reset, which clocks the noise register once as the
reset line goes; and rate 8 of the envelope is 392 cycles a step, one more
than the datasheet's 391, which is what the register value kevtris read off
the chip says. The combined waveforms are a model with six numbers per
combination, bits pulling on their neighbours and the pulse pulling from
above; it matches the oracle's tables on every entry, and the harness scores
it (`fit:c64`). Three voices for four lines is the first time the score has
more lines than the chip has voices, and the rule went into the sequencer
rather than the driver, because the driver expands a note into writes when
the note is scheduled and cannot take a write back: a drum cuts the chord,
and the chord comes back after it until the next drum, as on every C64 tune
with drums. The drums are the SID's own, pitched, and every one is shorter
than a step because a drum's note off lands where its duration says on every
chip. The harness holds every change of every stream in memory, and a SID
sawtooth at an audible pitch changes every cycle: an 8 s script of three
sawtooths ran it out of memory, and the corpus now uses pulses wherever the
waveform is not what is under test (P7-11).

**2026-09-04, P6-1 to P6-7.** The fourth chip, and the port was identical to
its oracle on the first run: snes_spc's S-DSP, line for line, compared on the
DSP's output stream, which on this chip is the chip's output. Everything the
first run found was in the programs. The DSP powers on in a state captured
from a console: an echo buffer 28 KB long from wherever ESA points, which
wraps round the top of RAM and over the samples until the old buffer runs
out; and voices keyed on with the noise routed to some of them and the noise
clock stopped, a constant on the output that grows with an envelope and
looked, for an hour, like a drift in the chip. The IPL ROM keyed every voice
off and every program disabled echo writes and waited the old delay out
before enabling them; the driver, the scripts and the formula tests now do
both, and the chip was never wrong. The BRR encoder's first version was wrong
by a factor of two: the decoder works on half-scale values and doubles the
result, so a nibble is worth `2^shift` on the scale of the samples and the
prediction counts double; a sine encoded with the wrong unit saturated. Note
off on this chip is the voice's own GAIN rather than KOFF, because KOFF is one
register for eight voices and a driver that writes notes out of time order
cannot hold its state. `ChipDriver.memory()` and `Instrument.sample` are the
sample instrument shape: a chip whose instruments are samples names them from
a bank the driver puts in memory at power-on.

**2026-09-04, P5-1 to P5-7.** The third chip, in a day, and the first whose
verification is against the die. Nuked-OPN2 is a reading of the YM3438's
transistors, and the chip's YM2612 is that reading ported line for line with
Nuked's names kept; Nuked itself, built natively, is the oracle. The first run
was 93 % identical with every run aligned under a shift of at most 41 cycles,
which was two conventions and no bug: the trace stamped a change at the end of
the internal cycle where the oracle stamps its start, and a write was delivered
on the cycle after its stamp rather than the one starting at it. With both made
the oracle's, every script - the eight algorithms at three feedback levels, the
envelope's stages and key scaling, detune and every multiple, the LFO at every
speed with both sensitivities, SSG-EG's eight shapes, channel 3's special mode,
the DAC - is identical on every voice, every edge exact. Two things learned on
the way: the register's slot pipeline means a data byte lands only when the
chip's twelve-slot cycle reaches its operator, so a driver that writes faster
than the busy flag loses writes, and the driver here spaces registers as a
program that waits on the flag does; and the master clock is the right unit for
the log, because the 68000, the YM2612 and the PSG all divide from it and
nothing else is integral in all three. The SN76489's noise register, sixteen
bits with taps at 0 and 3 as SMS Power and MAME have it, is not a maximal
register: it repeats after 7 times 8191 shifts, not 32767, which the formula
test now says. It has no oracle yet.

**2026-09-04, P4-6.** Blargg's smooth vibrato, as FamiStudio's engine writes
it: to move a pulse's period high bits by one without the `$4003` write that
restarts the phase, put the low byte at `$FF` or `$00`, arm the sweep with a
shift of 7 in the right direction, clock it at once with a `$4017` write in
5-step mode, disarm it, restore the low byte. The period moves by `period >>
7`, enough to cross the boundary and too little to cross two. Traced on the
chip: a vibrato on A4 that used to reset the phase six times a second now
keeps every edge within the vibrato's own swing. The writes are spaced as a
CPU spaces them, because `$4017` takes effect three or four cycles after the
write and the disarm has to land after that; the two pulses are staggered so
both crossing in one frame do not interleave. The golden hash moved, as it
should. And the oracle found a new place to disagree: Nes_Snd_Emu clocks the
forced half frame zero or one cycle after the write where the hardware takes
three or four, which blargg's own later `apu_test` checks and the chip passes.
When a pulse's timer happens to reload inside those cycles, the oracle's
edges sit a few cycles from ours for the rest of the note; it happened once,
on pulse 2 of the e2e song, and the baseline moved to say so.

**2026-09-04, P4-2, P4-3, P4-4.** The second chip turned the score sketch into
a design in an afternoon, and the design is smaller than the sketch. The roles
kept their names, because renaming `chord` to harmony would have broken every
stored song for a nicer word. The intents are words from a catalogue, not
parameters, and the Game Boy's bass is what decided it: `"hollow"` is a square
wave in wave RAM there and nothing on a NES, which a word says and a
brightness of 0.6 could not. Instruments never entered the wire format; the
API stores a word per role and each chip's arranger maps it, so a song keeps
its timbre across chips. Both golden hashes did not move: a score with no
intent arranges to the instruments every song had, to the number, and the
studio now arranges the same way the API renders, which removed a copy of
those instruments that had been kept by hand in two places. What the two
chips could not test: the voice budget - both have four voices for four roles
- and arrangement-level validation, which the SN76489's tone floor will force.

**2026-09-04, P3-2.** The driver split where the second chip said it should:
at the frame. Reading an instrument's tables, the arpeggio, the slide, the
vibrato and the frame clock produce a `FrameState` - a volume, a pitch in hertz,
a duty, a noise index - that no chip owns, and each chip's own `ChipDriver`
turns a note's frames into its registers. `RegisterEvent` did not need to
change: a byte to an address on a clock was already what both chips are.
`ChipSpec` gained one thing, the map of a song's four roles onto the chip's
voices, which is the arranger in its smallest form. What the Game Boy's idiom
turned out to be, against the same instrument tables: a pulse's volume takes
effect on a trigger, so a volume change retriggers the voice, which the
hardware makes cheap by keeping the duty position; the bass goes on the wave
channel, whose RAM is only writable while it is off; and a noise drum's volume
table cannot be followed frame by frame, because a retrigger restarts the
register and mutes it for its first fifteen shifts, which at the rates drums
use is most of a frame - so the table is fitted to the hardware envelope at the
note's start. The 2A03's golden hash did not move through the rewrite. Two
things the instrument model still carries from the 2A03, named as such rather
than hidden: the noise index is the 2A03's and other chips map it onto their
rates, and a pitch table is in 2A03 period units, applied elsewhere as the
ratio it would have made there.

**2026-09-04, P3-1.** The Game Boy's APU was written from Pan Docs and blargg's
"Game Boy Sound Operation" rather than ported from SameBoy as the ticket first
said: SameBoy's `apu.c` is shaped around its emulator's state and would have had
to be rewritten into `DigitalChip` anyway, and the verification does not come
from the port but from the ROMs. Blargg's twelve `dmg_sound` ROMs, on an SM83
the harness now carries, passed eleven of twelve on the first run. The twelfth
was the DMG's wave RAM corruption on a retrigger, which happens in the two
cycles *before* the channel fetches a byte, with the byte it is about to fetch,
not after the fetch with the byte it just read; SameBoy models it the same way.
Two things the documents leave open and the ROMs do not settle, both taken from
SameBoy: a voice's timer runs only while the voice is on, so a note starts at
the duty position the last one stopped at; and the wave channel's first fetch
after a trigger comes six cycles after its period, which ROMs 09, 10 and 12 are
sensitive to within two cycles and pass with. Gb_Snd_Emu 0.1.4 as an oracle is
as old as Nes_Snd_Emu and weaker: it takes a voice's first step at the trigger
without reloading the timer, ticks its frame clock at time zero, and has no
DACs, no power switch and no zombie envelope. Its runs line up with ours on
every voice; its identical-cycle count never will. It confirms the short noise
sequence's pattern and the envelope's steps, which no ROM checks.

**2026-09-04, P1-2.** The decoded-command interface let the driver do two things
the hardware cannot. It changed a pulse's period high bits without restarting the
sequencer, which on a NES only a `$4003` write can do, and that write resets the
phase; and it never wrote `$4001`, leaving the sweep negate flag clear, so the
sweep unit's mute condition silenced any pulse note with a period of `$400` or
more - roughly G#2 and below. Drivers on the hardware wrote `$4001 = $08` for
that reason. Both are now what the hardware does: a note that crosses a period
high-byte boundary restarts its phase, and low pulse notes play.

**2026-09-04, P2-3.** Blargg's `apu_mixer` ROMs come with recordings of a real
NES, and they measure the mixer without owning one: each has a channel play a
waveform while the DMC plays its inverse, and how silent the middle is says how
right the DAC curves are. Ours cancels to -32.7 dB on the pulses, -33 dB on the
triangle and -31 dB on the DMC, where his console does -32.2, -30.9 and -27.2.
It did not at first: the triangle's power-on position, which decision 5 had
moved to spare a click, put it on the wrong value for the whole test and read
22 dB worse. The hardware's position is back and the click is handled where it
belongs, in the output stage. A measurement beat a reasonable-sounding choice.

**2026-09-04, P1-11.** Every one of blargg's APU test ROMs passes on a 6502
the harness carries: the 2011 `apu_test` and `apu_reset`, the `dmc_tests`, and
the 2005 frame counter set, twenty-nine ROMs. That settles the one question the
2005 oracle raised: the frame timing is nesdev's, to the cycle, and the oracle
is the one that is two cycles off. Two things the ROMs knew that the wiki says
less plainly are now in the chip: a halt flag written on a length clock's cycle
takes effect after the clock, and a length reload on that cycle is ignored
unless the counter was zero. What no ROM checks: the envelope, the sweep and the
linear counter near a clock, and any voice's output.

**2026-09-04, P2-2.** The DMC's steps are identical to the oracle's, one bit
period apart: its output unit powers on with one bit remaining in Nes_Snd_Emu
and with eight in nesdev's description and in Mesen, and no document pins the
hardware's power-on state. And a `$4011` write in the oracle adjusts the
amplitude through a DAC table for the sound of the pop, so its levels after one
are not the register's value. Kept nesdev's eight; a hardware capture of the
first DMC byte after power-on would settle it (P2-3 territory).

**2026-09-04, P1-6, first run.** The pulses are identical to the oracle cycle
for cycle on every song and on the sweep-down, mute, and restart scripts: not
one edge unmatched. Every divergence found is an oracle convention: its frame
steps land two cycles late, its triangle steps at once when its counters reload
where the hardware waits for the timer, and its `reset()` writes `$4003` to
every voice so that its first frame clock loads every envelope with 15. The
sheet has the reading. CI checks a baseline rather than demanding zero
divergence, because with this oracle zero is not on offer; a second oracle is
ticket P1-13.

**2026-09-04, P1-6.** Nes_Snd_Emu 0.1.7 is from 2005 and predates some of what
nesdev now knows. Its frame sequence is a uniform 7458 cycles, not
7457/14913/22371/29829; its noise register starts at `1 << 14` and outputs the
volume when bit 0 is *set*, the inverse of the documented polarity; and while a
noise channel is muted it does not clock the register exactly, so the LFSR's
phase after any silence is approximate. The oracle is used for the pulses and
the triangle, cycle for cycle. The noise is verified by the formula tests and by
its envelope, which shares code with the pulses. The sheet says so.

**2026-09-06, P4-7.** All three demo SNES loops match the native DSP, but their driver saturates the dry sum on 13–20% of 32-clock windows before master attenuation. Lowering per-voice levels removes measured dry/echo-input clipping while retaining exact native parity. `recordSong` also inserted early stop events in its final block; complete PCM replay now guards all five consoles. See [the evaluation protocol](AUDIO-EVALUATION.md).


**2026-09-06, continuous playback and public lab.** The demo retains Play through
tempo, score, instrument and console changes with fractional-phase handoffs.
The local and public `/lab` share the buffered A/B transport. Shared visual
primitives and `/lab/components` document the existing identity; a separate
Storybook build is deferred until the collection needs it. The public corpus is
an explicitly versioned, on-demand snapshot. See
[implementation and regression evidence](CONTINUOUS-PLAYBACK-LAB.md).


**2026-09-06, composition controls.** Tempo now uses a shared 40–300 BPM slider
with a synchronized manual input and grouped Undo. Further controls and sourced
Mario/Zelda/Sonic repertoire proposals are recorded in
[composition controls](COMPOSITION-CONTROLS.md); these proposals are not yet
implemented or included in the public evaluation corpus.


**2026-09-06, familiar cartridges.** Mario Ground Theme, Zelda Overworld and
Sonic Green Hill Zone now have credited four-bar study arrangements on all five
consoles, with source/adaptation notes in the playground and lab. Transposition
and deterministic drum activity are reversible live controls. The
[score workflow](../scores/README.md) covers optional MIDI extraction, reviewed
recipes, reproducible compilation, explicit rhythm reduction and publication.
Swing and per-role gain remain future work.

### Source-faithful melody workflow (follow-up to #28)

Replaced four-bar arrangements and automatic root/fifth bass/drums with longer
melody transcriptions: Mario 50 bars, Zelda 24 bars, Sonic 24-bar main cycle. Frozen
MIDI references and mutation-tested note comparisons cover 415 notes on five
sequencer role maps. Added 12-step quarter-note grids, fork/grid preservation,
source-versus-edited labels and silent-drum controls. Fixed offline startup
padding truncating the final note and aligned register captures with the WAV's
sample-rounded end. See [method, coverage and limits](../scores/README.md).
The recorder now also uses the cores' event queue so short-note rests cancel
obsolete future releases, with a regression that failed on Game Boy beforehand.
Full-theme publication/fork tests also cover the cartridge title separator and
the advertised 30-second audio previews for long scores, including social metadata.

Further musical fidelity requires checking the chosen transcription against
original game audio and measuring acoustic pitch/articulation after the DSP.
Full multivoice arrangements should use explicitly transcribed source voices;
adding a generic accompaniment is no longer part of this pipeline.

### Native song fidelity (2026-09-07)

Mario, Zelda NES and Sonic Mega Drive now use native commands on the original
console, with independent A/B references. NSF bank switching, bounded VGM import
with original DAC samples, FM byte serialization and native hardware solo are
implemented. See [the reproduction method](../scores/arrangements/README.md).

Further work is deliberately separate: identify DAC drum sample boundaries/types
for portable arrangements; recover FM envelope/release/stereo expression for
editing; measure physical output filtering and PSG balance against real hardware.
Native command/digital verification does not complete those fidelity claims.
The identified 8–10 kHz alias mechanism is repaired by filtering before
decimation; FM, DAC and PSG have separate comparisons. Physical output/DAC
uncertainty remains. See [the measured repair](evals/AUTOMATIC-MIXING-FOUNDATIONS-2026-09-07.md).


Zelda selection regression fixed: the catalogue now uses NSF track 3, with an independent Overworld phrase checked before emulator parity. All four ports and A/B reference are rebuilt; [evidence and limits](evals/ZELDA-SELECTION-2026-09-07.md).

### Native timbre follow-up (0.16.3)

Completed: dry SNES factory playback and 120-unit internal headroom; measured
native FM fundamental/envelope projection; opaque patch IDs; repeated DAC attack
boundaries and kick/snare family inference; updated player pitch display and six
fresh SNES listening-lab cases. All source-chip recordings remain unchanged.

Remaining musical limits: FM descriptors use two pitch probes and a finite
amplitude window, not exact envelopes at every pitch; target factory timbres,
release tails and stereo are approximations. DAC classification is heuristic,
and quiet candidates are disclosed. Controlled human preference comparisons and
physical-device acceptance remain open. See [the timbre evaluation](evals/PORTABLE-TIMBRES-2026-09-07.md).

### Artist and agent lifecycle (2026-09-08)

Implemented: separate owned artists; scoped, expiring agent pairing without an agent mailbox; owner revocation; HTTP evaluation before publication; pinned MP3 with original-WAV conversion; console-version grouping; configurable original pixel portraits; English/Japanese UI and documentation. See [contracts and verification](ARTISTS-AND-AGENTS.md).

Ownerless agent accounts, delegated per-song permissions, refresh tokens, full-song perceptual quality grading and a universal orchestral instrument library remain separate future decisions. This release does not claim those capabilities.

### Persistent site player (2026-09-08)

- Shared transport controls across arrangements, live loops, composition, lab and publications.
- Application-owned playback survives client navigation; explicit ready sources take ownership.
- Fixed mobile/desktop player with audible metadata, seek/restart/repeat/volume and source links.
- Direct play from Explore/library/artist cards; bounded on-demand streaming and a result-list queue.
- Published audio keeps its revision and creator; blind A/B metadata stays masked across navigation.
- Live loop score opens in the full composer; pads and recording retain their live engine.
- Transport progress and piano-roll highlights update locally, without rerendering the full editor.
- English/Japanese copy, shared component catalogue and browser/audio/session regressions.

Contract and verification: [continuous playback](CONTINUOUS-PLAYBACK-LAB.md).
Reload restoration, cross-tab playback coordination and collaborative editing remain separate work.


## Interactive audio latency — audit, 2026-09-08

Status: implemented and locally qualified; release qualification runs in CI. See [measurements, prototype and acceptance criteria](INTERACTION-LATENCY.md).

- [x] LAT-1 — Immediate prepared selections, deduplicated score loading, independent metadata updates.
- [x] LAT-2 — Lazy reference audio and bounded caches keyed by musical settings.
- [x] LAT-3 — Progressive project preview using the existing compiler and DSP, separate from WAV export.
- [x] LAT-4 — Bounded progressive musical updates, reuse of unchanged/stopped compatible engines and readiness notifications.
- [x] LAT-5 — Stateful mid-song switching and seeking with per-chip checkpoint capabilities.
- [x] LAT-6 — Reusable publication descriptors and audio range delivery with bounded server reads.
- [x] LAT-7 — Cold/warm latency measurements, sustained rendering, desktop/mobile and sonic continuity regression tests.

Preview and offline rendering share the compiler and DSP. Complete DSP checkpoints and latest-input cancellation preserve the native-reference and continuous-playback contracts. An in-place retiming API for arbitrary register histories is deliberately outside this change; inactive spare worklets are disposed rather than consuming CPU behind a mute. Cold history reconstruction and device/network latency remain explicit limits.
