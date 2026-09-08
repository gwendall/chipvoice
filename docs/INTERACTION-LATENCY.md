# Interactive audio latency audit

[日本語](INTERACTION-LATENCY_ja.md)

2026-09-08. Audited production revision `2cdf7b3` (PR #55). The measurements below describe the baseline; the implementation section records the subsequent changes.

## Measurements

Chromium/Playwright on the development Mac, against `https://chipvoice.dev`, with separate fresh browser sessions for the landing, loop studio, composer and lab. No account, generation, publication or production mutation. Machine load at the start: 5.35 / 6.71 / 11.83. This is a small diagnostic sample, not a device benchmark or a p95 claim.

| Interaction | Observed delay | Measurement endpoint |
| --- | --- | --- |
| Landing: first Mario playback | 2.04–2.60 s | Input to `AudioBufferSource.start()` call |
| Landing: first Game Boy selection | 1.02–1.89 s | Same |
| Landing: cached console/song selection | 181–182 ms | Same; no audio fetch/decode |
| Landing: Mario/Game Boy tempo 100 → 125% | 7.15–12.38 s | Same; 70.83 s of audio rendered first |
| Landing: first Zelda / Sonic selection | 1.87 / 2.72 s | Same |
| Composer: starter playback / tempo edit | 1.14 / 0.89 s | Same; short starter, not a long MIDI |
| Composer: first Game Boy selection | 2.51 s | Same |
| Loop studio: tempo / console change | 272 / 277 ms | New live engine becomes current; includes handoff completion and browser polling |
| Lab: first playback / Game Boy | 0.78 / 1.14 s | Input to buffer start call |
| Lab: cached Super Famicom | 1 ms | Same |

The buffer start is scheduled another 25 ms ahead. The browser reported roughly 168 ms of output latency once running; fades add their own transition envelope. The measurements above are **not speaker latency**. First-use initialization and network transfer vary; the stable 180 ms delay does not. Repeatability was checked with two full landing runs and a third focused warm-selection run. Rename-only edits did not replace the loop engine or restart the composer's audio; the composer's sticky title nevertheless remained stale in the screenshot.

Artifacts: `.artifacts/interaction-latency/`, including request/decode/worker traces and desktop screenshots. The initial run is `measurements.json`, later runs use per-mode directories. The second composer run additionally exercises transpose and part level.

## Findings

1. **Interactive playback waits for an export.** `Arrangements.tsx` and `ProjectPlayer.load()` prepare the complete PCM, encode it as WAV, create a Blob, then decode it into an AudioBuffer before switching. The landing's tempo trace spent most of its time rendering, with no main-thread long tasks during that edit. Progress reporting does not remove this dependency. Transpose, solo, note edits and per-part controls take this path too.
2. **A blanket 180 ms debounce also delays cache hits.** The landing applies it to song, console and part selection as well as continuous controls. The composer applies another 180 ms before loading changes. The loop studio coalesces for 45 ms; its live handoff then schedules 100 ms ahead and completes at 185 ms. Short fades are useful; delaying the start of every action is a separate decision.
3. **The landing downloads audio it is not playing.** Its first Mario selection fetched both the rendering (3.37 MB) and independent reference (3.47 MB). `BufferPlayback.select()` waits for both downloads and decodes. Switching to Game Boy also requested the same score view twice, and the playback path waited for the view before fetching audio. An unavailable reference can therefore block the primary recording.
4. **Prepared variants are not reused by musical settings.** The transport caches eight decoded URLs, but every edited arrangement gets a fresh worker and Blob URL. Returning to the same edited tempo/transpose/part rerenders it. A count of eight full stereo buffers is not a memory budget: eight 90-second, 44.1 kHz Float32 stereo buffers alone approach 254 MB, before active references, workers and encoded copies.
5. **Live edits recreate a chip.** The loop studio already uses the live sequencer; changed musical fingerprints create another `Chip` and crossfade it. Worklet modules are already cached per context, so reimporting the module is not the explanation for every edit. Tempo and mute need a lighter update path with future-event cancellation, proper releases and an audio-clock commit boundary.
6. **Published playback has serial work.** `playPublication()` fetches project details even when the publication page already has them, then starts media loading. `/api/v1/jobs/[id]/audio` reads all database chunks and concatenates the entire file before responding. It ignores Range requests and sends `private, no-store`. The HTML media element can consume the eventual response progressively, but the server has already materialized the whole asset. The public catalogue was empty during this audit; these findings are code inspection, not measured production track timings.
7. **Ownership and metadata are still polled/coupled.** The persistent host checks readiness every 50 ms; that can add delay on ownership changes, although it does not explain the landing's 182 ms cache hit. In the composer, the audible project's title is part of the rendered snapshot, leaving a rename stale until a musical render commits. Immediate draft metadata needs a separate update for the same source identity; selecting another song must still label the audio actually playing.

The current continuous handoff, cancellation rules, shared output clock and reference fidelity are assets to preserve. Removing fades or advancing the visual cursor ahead of audible output would conceal the problem or introduce regressions.

## Preparation prototype

The browser worker compiles the full Mario adaptation at 125% tempo, initializes the existing `ChipCore`, and renders only the first 4,096 frames (92.9 ms of sound). It then checks those samples against the existing offline renderer. The refined run uses 128-frame blocks versus the offline renderer's 4,096-frame block.

| Chip | Plan + initialize + first block | Maximum PCM difference |
| --- | --- | --- |
| Famicom | 37.5 ms | 0 |
| Game Boy | 30.7 ms | 0 |
| Mega Drive | 58.5 ms | 0 |
| Super Famicom | 30.2 ms | 0 |

An earlier single-block run took 40–86 ms. These measurements exclude worker startup, source download, delivery to the output device and first-use audio unlock. They establish that waiting for 71 seconds of PCM is unnecessary for producing the first sound. They **do not establish sustained realtime performance, arbitrary seeking, seamless parameter changes or fidelity over an entire song**.

The existing `ChipCore.schedule/load/render` seam can drive a bounded progressive worker or a direct worklet. Evaluate both before choosing: a worker needs a small bounded PCM queue and underrun handling; a direct worklet must meet every audio deadline. Share the compiler and DSP with offline export. Do not write a second interpretation of the score or reduce full performances to four loop roles.

## Implementation order and acceptance criteria

| Ticket | Work | Acceptance |
| --- | --- | --- |
| LAT-1 | Remove debounce from ready selections; ignore equivalent selections; deduplicate view requests and start view/audio loading concurrently; separate same-source metadata updates | Warm selection reaches audio scheduling within 100 ms on the controlled test host; rename causes no DSP work and updates the player title; no duplicate view request |
| LAT-2 | Load the independent reference on explicit comparison, then reuse it; cache compiled plans/variants by source revision, engine version, sample rate and musical settings; prefetch only bounded likely next assets | Slow/broken reference cannot block primary playback; revisiting an edited variant avoids another render; explicit byte/time budgets, cancellation and disposal |
| LAT-3 | Separate project compilation from offline WAV export; add progressive preview using the same plans and cores | First audio does not wait for full-song PCM, WAV encoding or decoding; blockwise/offline PCM comparison on all chips; bounded memory and measured sustained headroom on long/MIDI fixtures |
| LAT-4 | Add incremental updates for tempo, instrument, notes, gain and mute; reuse compatible live engines; make readiness event-driven | Small edits reach an audio-clock commit without full-song rendering; no clicks, silence gaps, stale events or stuck notes; Pause wins over rapid input; no per-block allocation growth |
| LAT-5 | Preserve state for mid-song console changes and seeks; define a dynamic per-chip checkpoint capability and bounded checkpoint cache | Preserve envelopes, noise state, sample position, filters and echo where applicable; compare forward playback to checkpoint/seek output, including native register captures; maintain beat phase |
| LAT-6 | Reuse publication descriptors, support byte ranges and bounded server reads; evaluate object storage for immutable renditions and warm only the next queue item | Playback/seek does not require reading all database audio; Range correctness and early delivery tested; private/revoked tracks retain authorization rules; no mass catalogue preload |
| LAT-7 | Qualify end to end with latency budgets and sonic regressions | Cold/warm and rapid changes across all visible consoles; desktop/mobile; output-clock visuals; cancellation, navigation, loop edges, memory, CPU, underruns and long tracks |

LAT-1/2 are immediate improvements; LAT-3/4 address the main architectural cause. LAT-5 is necessary before promising instant arbitrary mid-song replacement. Register values alone are not complete emulator snapshots, and the generic core currently exposes no save/restore contract. Starting a target chip cold at the current note would lose its history. LAT-6 can be delivered independently. LAT-7 starts with the diagnostic harness and grows with each capability.

Aim for immediate UI acknowledgement and under 50–100 ms of application-added latency for warmed interactive paths. These are proposed budgets, not current guarantees. Network-cold assets, first audio unlock and hardware/Bluetooth latency cannot truthfully have a universal zero-time promise. Keep the previous audio playing while preparation is necessary. Do not change `AudioBufferSource.playbackRate` to implement BPM: it also changes pitch. Do not split hardware mixes into independent stems without checking nonlinear mixing and shared effects.

## Reproduce

From `apps/web` with the installed Playwright browser path:

```sh
PLAYWRIGHT_BROWSERS_PATH=../../.artifacts/playwright MODE=landing node scripts/diagnose-interaction-latency.mjs
PLAYWRIGHT_BROWSERS_PATH=../../.artifacts/playwright MODE=live node scripts/diagnose-interaction-latency.mjs
PLAYWRIGHT_BROWSERS_PATH=../../.artifacts/playwright MODE=create node scripts/diagnose-interaction-latency.mjs
PLAYWRIGHT_BROWSERS_PATH=../../.artifacts/playwright MODE=lab node scripts/diagnose-interaction-latency.mjs
PLAYWRIGHT_BROWSERS_PATH=../../.artifacts/playwright node scripts/diagnose-progressive-preview.mjs
```

`SITE` overrides production. `WARM_ONLY=1` skips the expensive edited-song trials. `ENFORCE_WARM=1` makes the landing diagnostic fail when a warmed selection exceeds 100 ms; it is expected to fail on the audited revision. The preview probe asserts exact equality on the tested prefix. The scripts listen and edit disposable browser-local drafts; they do not publish or send email. Run performance probes sequentially. The baseline audit made no deployment. The implementation described below is qualified separately.

## Implementation and qualification

The landing now starts view/audio requests concurrently, deduplicates score views, removes the 180 ms delay for prepared selections and fetches the independent reference only on explicit comparison. Decoded recordings have both an eight-entry and 96 MiB cache limit. Compiled landing plans have eight-entry/24 MiB limits. Repeated equivalent selections avoid preparation; title-only edits update metadata separately.

Project preview and edited arrangements use `ProgressivePlayback`: compile the existing project/plan, generate an initial prefix, and schedule PCM ahead in bounded chunks. WAV generation is an explicit export operation. Three worker-backed variants are retained; each caches at most roughly three seconds of stereo Float32 PCM. The worker compiler is shared with offline export. Obsolete compilation is coalesced to the newest input; a running obsolete task gets 100 ms before replacement. Pending worker replies carry revisions so a reused worker cannot inject an older project's sound.

Optional `ChipCore.fork()` supports complete in-process DSP checkpoints. All five built-in cores opt in. New cores without a checkpoint implementation still work by replaying from their initial state; cores with closures/private/native resources must provide their own fork. Checkpoints preserve class prototypes, typed-array aliases and nested DSP state. Each variant retains at most 25 coarse checkpoints and four recent ones; no persistent snapshot format is introduced.

The loop editor coalesces edits for one frame, schedules 25 ms ahead with short overlapping fades. Unchanged and stopped compatible engines are reused; a completed replacement disposes the old worklet to avoid paying for idle DSP. This is **not** an in-place retiming API: changed music is still rescheduled. Direct retiming of arbitrary native register captures would change emulator history and needs a separate fidelity contract. Current progressive updates preserve the established offline semantics, including nonlinear shared mixes.

Publication playback reuses available descriptors. Audio GET/HEAD supports byte ranges, pulls database chunks on demand and stops reads on cancellation. Visibility checks and private/no-store headers remain in force. No catalogue-wide prefetch or object-storage migration is needed for these gains.

Qualification includes exact block/seek PCM equality on all five chips and on native Mario, Zelda and Sonic captures; delayed-worker races; paused and playing handoffs; lazy reference cancellation; byte ranges with real private-job authorization; browser playback/edits/end/replay/disposal and measured output. Test artifacts are in `.artifacts/progressive`, `.artifacts/interaction-latency`, `.artifacts/unified-playground` and `.artifacts/continuity`.

Remaining boundary: a never-prepared mid-song variant must render its history to reach the requested phase. Preparation preserves the previous audio. Network/device latency and a browser suspended by the operating system cannot be reduced to a universal zero-delay guarantee. In-place musical retiming and storage migration are follow-up design options, not prerequisites for progressive playback.
