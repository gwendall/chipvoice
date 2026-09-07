# General automatic console adaptation and mixing

<p align="center">
  <a href="AUTOMATIC-MIXING.md">English</a> &bull;
  <a href="AUTOMATIC-MIXING_ja.md">日本語</a>
</p>

## Status and objective

Planned on 2026-09-07 following the user's Zelda/Mega Drive balance report.
No implementation or musical acceptance is claimed by this specification.
Sound and adaptation quality take priority over the deferred npm release and new features.

Build a general, deterministic, local arrangement/mixing system for authored,
imported and generated music. Familiar songs are fixtures, never song-specific
mix configurations. There must be no title, file hash or song-ID branch in the
production mix policy. Source identifiers remain appropriate for provenance and
catalogue identity tests, outside the policy.

## Contract

- Keep chip behavior, console output profiles, instrument mapping/calibration and
  musical mixing separate. Fix evidenced output defects before fitting gains.
- Native playback preserves original register commands and original musical mix;
  corrected emulator/output behavior still applies. Automatic remixing is explicit.
- Adaptation preserves supported authored expression and explicit overrides.
  Velocity can affect timbre as well as level: mix trim is a separate concept.
  Do not equalize every stem or assume the melody is always the foreground.
- Use one policy module behind a small interface for SDK, worker, offline renderer
  and game integration. Return decisions/diagnostics; callers do not duplicate rules.
- Calibrate known instruments offline across useful conditions. Unknown instruments
  use bounded measurement or a disclosed conservative fallback, not unbounded rendering.
- Mixing depends on actual voice allocation, register resolution, shared resources
  and internal headroom. Measure full mixes as well as solos; nonlinear chip mixing
  means isolated renders cannot always be summed into the original full output.
- Complete-score preparation and live phrase generation have explicit information
  limits. Live decisions use bounded lookahead and smooth envelopes, not the unknown
  whole future song. No network judge, per-sample policy allocation or repeated full
  song analysis is required for live decisions.
- Determinism means the same supported input, engine, policy/profile versions and
  render settings yield the same decisions and repeatable output under the qualified
  runtime. Cross-platform bit identity is a separate claim to test, not assume.
- Evaluation combines hard correctness gates, useful acoustic diagnostics and
  controlled listening. It cannot certify that all possible music sounds good.

Implementation update: MIX-01 contract and MIX-03 reproductions are recorded. MIX-04 has a verified pre-decimation filter repair; physical-output differences remain scoped. MIX-06/07/09/10 are in progress. No held-out musical acceptance, real-phone check, deployment or npm release is complete yet.

## Ordered tickets

All tickets below are `todo`. Dependencies refer to MIX IDs. The execution order
follows prerequisites; evaluator and device baselines begin early rather than
being invented after the algorithm is tuned.

| ID | Ticket | Dependencies | Acceptance / deliverable |
| --- | --- | --- | --- |
| MIX-01 | Contract and acceptance | none | Specify native replay versus adaptation, authored dynamics versus calibration, offline versus bounded-lookahead generation, deterministic versioning and explicit overrides. Freeze evaluation protocol and acceptance gates before tuning. |
| MIX-02 | Independent corpus and held-out split | 01 | Pin source identities and references; include Zelda/MD, native Sonic, sparse/dense, bass-led, percussion-led, melody-only, generated scores and diverse MIDI. Split by source family, keeping transpositions/variants together; reserve unseen songs for validation. |
| MIX-03 | Reproduce the audible imbalance | 01,02 | Capture aligned full mixes and isolated voices; distinguish bass from percussion in Zelda. Measure levels, attacks, spectral overlap and clipping; record repeatable failure cases without selecting thresholds to approve the current output. |
| MIX-04 | Qualify Mega Drive output | 03 | Isolate native Sonic FM, DAC and PSG against independent references. Identify the residual high-frequency difference and FM/PSG balance; fix demonstrated core/output defects before freezing calibration. Recheck native corpus; preserve uncertainty where hardware captures are absent. |
| MIX-05 | Preserve source expression | 03 | Audit native observation and MIDI dynamics, articulations, envelopes, pan and drum identities. Separate note velocity from mix trim; retain expressive events and report unsupported mappings. Never infer a new accompaniment or declare recovered data independent evidence. |
| MIX-06 | Improve target instrument mapping | 05 | Use chip-appropriate patches, envelope behavior and drum categories; preserve source intent and explicit instrument choices. Evaluate instruments independently of gain so a quieter wrong timbre cannot pass as a correct port. |
| MIX-07 | Generate instrument calibration profiles | 04,06 | Measure pitch, velocity, duration, attack/sustain/release and supported sample rates for the actual target presets and output profiles. Generate compact versioned response tables. Validate interpolation and instrument changes; no per-song coefficients. |
| MIX-08 | Bound unknown-instrument behavior | 07 | For custom patches/samples, choose a bounded preparation measurement or conservative fallback with confidence diagnostics. Cache by instrument content, engine/output version and relevant render settings; bound cache size and preparation cost. Unknown does not silently mean calibrated. |
| MIX-09 | Implement the general mix policy | 01,05,07,08 | One module combines authored dynamics, calibrated instrument response, actual allocated voices, role importance and concurrent density. Return gain decisions and diagnostics; support explicit author overrides and conservative uncertain-role behavior. Preserve silence, intended foreground and dynamics; avoid pumping and global equalization of every stem. |
| MIX-10 | Realize the mix through hardware controls | 09 | Encode trims using supported chip controls, with volume quantization, FM carrier versus modulator behavior, shared resources and internal mixer headroom respected. Recheck the joint full mix: isolated stems need not sum linearly. Report unachievable targets instead of modifying chip physics. |
| MIX-11 | Runtime preparation and continuous changes | 10 | Share the policy across complete-score preparation and bounded phrase/lookahead generation. A live prefix must not require an unknown future song. Apply smooth changes, retain transport/Stop authority, cancel stale work and preserve native-mode semantics. No remote judge or full-song rerender required for each live decision. |
| MIX-12 | Build a multi-criterion evaluator | 02,03; validate 09–11 | Separate identity/notes, dynamics, role balance, masking indicators, transients, internal/final clipping, and runtime stability. Label heuristics and confidence; add level-controlled blind listening for preference. Define hard correctness gates and separate musical acceptance; avoid a universal fidelity score. |
| MIX-13 | Validate generalization and robustness | 11,12 | Freeze a candidate before unseen evaluation. Test held-out songs, source-family separation, varied note density/register/velocity, silent parts, reordered unrelated parts, custom instruments and generated seeds. Compare calibrated-only and complete-policy baselines. A failed holdout used for tuning becomes development data and needs a fresh holdout. |
| MIX-14 | Qualify performance and real devices | 03 baseline; 11,13 acceptance | Set numeric budgets from representative baseline measurements before tuning performance. Measure first sound, parameter-to-audible delay, planning cost, CPU, memory, allocations and cache bounds; exercise real mobile/Safari and interruptions. Separate emulation correctness from slow-host timing and emulated viewport checks from real-device evidence. |
| MIX-15 | Integrate SDK, playground, lab and game fixture | 11,13 | Use the same policy module everywhere, including offline rendering and a minimal game integration. Keep a small interface with automatic defaults and optional part overrides. Expose native/adapted mode and useful diagnostics; qualify continuous changes, solo and original A/B without misleading labels. |
| MIX-16 | Document and reconcile the roadmap | 01 initial; 15 final | Publish English/Japanese method, interface examples, source/evaluation limits and profile versioning. Reconcile stale native Zelda/Sonic and SNES chord tickets. Document what requires human listening or physical equipment; do not mark those checks complete through simulation. |
| MIX-17 | Regenerate and qualify publication | 04,13,14,15,16 | Regenerate all affected recordings and references only when evidence changes, bind source/engine/policy/profile hashes, qualify browser audio and screenshots and review before deployment. After deployment check actual served assets and native/adaptation behavior. |
| MIX-18 | Ship and verify the npm release | 17 | Publish a version matching documented capabilities, including native VGM functions already in main. Install the actual published tarball in an empty consumer and exercise native replay, automatic adaptation and custom instruments. Confirm site/examples/package agree; source-tree success alone is insufficient. |

## Execution and review batches

1. Establish MIX-01–03, the initial MIX-12 evaluator and MIX-14 baseline/budgets.
   Investigate/fix MIX-04 and audit MIX-05. Do not tune around an unresolved output defect.
2. Implement MIX-06–10, then MIX-11; extend MIX-12 during implementation.
   Validate MIX-13 and MIX-14 against frozen acceptance criteria, not the tuning set alone.
3. Complete MIX-15–18, final bilingual documentation, publication and consumer verification.

Aim for three coherent implementation PRs: diagnosis/output/source foundations;
general calibration and mix policy; integration/qualification/release preparation.
Group further only if independent review and evidence remain manageable. This
planning document does not authorize marking unrun checks as done. Real-device or
human-listening evidence must be obtained or explicitly remain open; independent
implementation work can continue while it is pending.

## Deferred directions

New consoles, C64 exposure, a full DAW and Storybook remain outside this work.
Progressive rendering, extra caching and console-specific package entry points are
measurement-driven follow-ups, not automatic prerequisites. Richer game-state
music and more original compositions follow a qualified general adaptation system.
No recurring remote model service is required for sound generation or mixing.
