# Scheduling design and qualification — 2026-09-06

<p align="center">
  <a href="SCHEDULING-2026-09-06.md">English</a> &bull;
  <a href="SCHEDULING-2026-09-06_ja.md">日本語</a>
</p>


Follow-up on `feat/playable-demo`, in the same PR #20. The first CI run's
conformance job failed in `TransportCore.schedule`: a captured ROM log expanded
into too many `push` arguments. The user requested an architectural correction,
not just removal of that argument expansion. [Decision 23](../DECISIONS.md)
records the chosen design and its limits.

## What the failure revealed

The volume is legitimate captured hardware traffic. Address/data ordering,
repeated writes and retriggers cannot be dropped to make the test cheaper.
The wrapper introduced redundant buffering and cloning; underlying chip queues
also repeatedly sorted or shifted pending history.

| Operation | Previous implementation | Shared scheduler |
| --- | --- | --- |
| Add an ordered capture | Argument expansion, global sort, then another core queue | Linear reference copy into one run |
| Add another batch | Sort pending history again | Sort only the new batch if necessary; insert its run into a heap |
| Consume | Wrapper splice/map; several cores shift arrays | Return existing record, clear its reference, advance the run head |
| Idle chip cycle | Inspect the pending array | Compare a cached next timestamp |
| Cancel | Filter the wrapper queue | Compact affected runs; preserve raw unowned writes |
| Offline command history | Clock fixed at zero | Host render clock, expired commands pruned in place |
| Offline reset | Sample initialization before and after reset | One initialization after reset |

Consumption is O(log r) for r pending runs and O(1) for a single capture.
Cancellation still scans affected runs. Reference-array capacity lives until a
run is consumed, while consumed objects are released immediately. Active and
future musical frames remain available for held-note restoration. The Mega
Drive's accepted hardware writes use a ring FIFO rather than `Array.shift()`.
There is no new runtime dependency or new browser transport protocol. The
standalone worklets contain extra scheduler code; this is not a bundle-size
reduction claim.

The library build also clears stale generated output and excludes all five
worklet entry points uniformly. The removed wrapper cannot survive in `dist`
after an incremental rebuild.

## Local qualification

All commands below passed, run sequentially to respect the loaded host:

- `pnpm build` and `pnpm typecheck`.
- `pnpm test:unit`: existing functional/audio checks plus 500,000 queued writes,
  4,000 deterministic randomized scheduling/cancellation rounds against an
  independent stable-sort model, hardware FIFO growth/wraparound, advancing
  offline time, expired command release and one-time sample initialization.
- Five machine outputs remain identical to the pre-refactor song goldens;
  each core also produces identical output in 128- and 4096-sample blocks.
  Stop, delayed/overlapping effects and held-note restoration still pass.
- `pnpm --filter chipvoice-conform mixer`: the previously crashing captured-log
  path completes. Square, triangle, noise and DMC comparisons all pass their
  existing hardware-recording criteria, unchanged.
- `pnpm --filter chipvoice-web test`: production API tests with a disposable
  SQLite database, then Chromium desktop/touch-emulated journeys. All five
  worklets make measured sound; switching, Stop, effects, editor, complete-score
  sharing, draft recovery, copied code and stereo export pass without exceptions.
- `pnpm --filter chipvoice test:fresh`: the packed package installs in an empty
  project, starts audio, sequences music and lends a voice to an effect.

The five song hashes, unchanged by this scheduling refactor:

| Machine | Hash |
| --- | --- |
| NES | `8220846152b9937b` |
| Game Boy | `8cada5531fa0aa04` |
| Mega Drive | `109733dc8469f745` |
| SNES | `5b2fe9e2f23e1872` |
| C64 | `cc2a1343fa4f0849` |

The mixer reports cancellation relative to the tone at -32.7 dB (square),
-33.0 dB (triangle), -31.0 dB (DMC); noise is within the existing 4 dB tolerance
of the recording. These are conformance measurements, not CPU benchmarks.

New screenshots and desktop/mobile videos are in `.artifacts/demo/`. The
desktop and mobile captures, plus an extracted desktop video frame, were
inspected: machine controls, musical visualization and arcade pads remain
intact. The export is byte-identical to the same score rendered by the library;
ffprobe reports PCM16, 44.1 kHz, stereo, 6.666667 seconds. Measured Stop output
peaks below 0.001 after future notes would have played.

The complete five-corpus, NES/GB ROM and mixer matrix remains enabled in CI;
consult the checks on the current PR revision for that full-run result. Local
corpus success from the preceding V1 evaluation is not presented as a rerun of
this refactor. Chromium was rerun here; the preceding Firefox/WebKit checks are
documented separately in [the V1 evaluation](DEMO-2026-09-05.md).

## Limits and follow-ups

This host is heavily loaded, as reported by the user. No latency, throughput or
CPU speedup number is inferred from local runs. The improvement established here
is removal of redundant work and poor scaling, with preserved audio behavior.
Representative-device profiling, actual Safari/phone checks and low-rate CPU
qualification remain in the backlog. Packed buffers/shared memory and limits on
live scheduling lookahead require workload measurements; arbitrary event loss
is not an acceptable optimization. This PR remains open, without a merge or
production release.
