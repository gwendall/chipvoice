# Creation, sharing and API review

<p align="center"><a href="CREATION-API-REVIEW-2026-09-07.md">English</a> &bull; <a href="CREATION-API-REVIEW-2026-09-07_ja.md">日本語</a></p>

Historical pre-implementation audit. The accepted work is now described in [Projects, creation and publication](CREATION.md); the proposed status below records the state at review time.


Review of `a0e86918e605d6818a806fbd308b8dad4338fa24`, SDK **0.16.3**. This is a proposed implementation plan, not a description of newly shipped features. It follows the portable-timbre fixes in PR #44; outstanding human listening and real-device acceptance remain open.

## Verdict

A small, remixable music playground is a good direction for the library. Its distinctive interaction is to compose once, hear what different real chip constraints do to it, inspect the code and take the result into a game. Creation should be a first-class route through that demonstration.

Keep the existing engines, exact-tick model and deterministic planner. Unify the document and playback contracts before building community discovery. The problem is not too few exported functions: important capabilities are separated between the compact composer, complete-arrangement player, SDK and publication service.

## What exists and what is missing

| Capability | Current implementation | Gap |
| --- | --- | --- |
| Create a loop | Pads, recording, note/drum editing, Undo, variations and instrument intents | Four fixed tracker roles; full imported performances cannot enter this editor |
| Complete music | `Performance`, MIDI import, exact ticks, multiple parts, expression, allocation and mixing | Separate from the saved/published `Score` document |
| Code | Composer exports runnable JavaScript and Score JSON | A read-only `pre`, not an editor or a code execution environment; absent from the default complete player |
| Sharing | Draft URLs, permanent `/s/{id}` pages, MP3/WAV links, forks and ancestry | Only compact documents; imports and arrangement settings cannot round-trip through publication |
| Identity | Stable accounts, email login, independent API keys, own-publication list | No public username/profile; free-text `author` is not an account handle |
| Discovery | Individual publications and fork families | No public list/search endpoint, feed, tags, favourites or ranking; `ui/Gallery.tsx` is a component showcase, not a song gallery |
| Playback | Worklet `Chip`, app `LivePlayback` and app `BufferPlayback` | `Chip.play` accepts `Song`, not `Performance`; smooth replacement, audible position and buffer transport are not one SDK contract |
| Validation | Compact issue objects; performance exceptions; adaptation loss/mix reports | Several result/error shapes and no versioned shared publication schema for performances |

Evidence: [playground](../apps/web/src/arrangements/Playground.tsx), [composer](../apps/web/src/studio/App.tsx), [document](../apps/web/src/studio/document.ts), [code panel](../apps/web/src/studio/CodePanel.tsx), [publication schema](../apps/web/src/lib/schema.ts), [stored songs](../apps/web/src/lib/songs.ts), [accounts](../apps/web/src/studio/Account.tsx), [migrations](../apps/web/src/lib/migrations.ts), [performance](../packages/chipvoice/src/performance.ts), [SDK](../packages/chipvoice/src/index.ts).

## Findings to address first

1. **Publication cannot preserve the new music model.** `SongInput` requires tracker patterns/order. A valid SDK `Performance` fails that schema. It also has no way to store per-part expression, patches, measured timbres or mix overrides. Do not flatten MIDI into four lines to make sharing work.
2. **Unknown input fields can disappear silently.** A local schema probe submitted a valid compact score with `gain`, `parts` and `mix`; parsing succeeded but all three extra fields were removed. This is current schema behaviour, not evidence that those options are supported. A new versioned contract must reject unknown fields or explicitly preserve defined extensions. Keep legacy compatibility deliberate.
3. **The best playback behaviour belongs to the demo.** [LivePlayback](../apps/web/src/audio/LivePlayback.ts) handles replacement and context ownership; [BufferPlayback](../apps/web/src/audio/BufferPlayback.mjs) handles seeking and asynchronous selection; the worker performs full preparation. SDK consumers should not have to copy these files. `Chip.play` intentionally ignores an already-playing ID, so changing an object with the same ID is not a general live-edit API.
4. **The musical policy differs by entry point.** Compact playback keeps authored levels; `planPerformance` uses automatic mixing by default. This is documented and must remain explicit. Converting every old score through the new planner would change existing songs. Migration needs a legacy playback policy and audible regression fixtures, not a type cast.
5. **Publication identity does not freeze sound.** Current public audio renders with the current engine. Cache identity includes engine changes, but stored songs do not identify a reproducible engine/palette/adapter generation. A stable URL and a frozen audio revision are different contracts.
6. **Documentation trails the architecture.** HTTP docs still describe four text lines. The manually maintained OpenAPI body and Zod schema can diverge; OpenAPI omits several actual response fields and authentication schemes. Its `0.1.0` version may be an independent API version, but this needs an explicit compatibility policy. The main SDK API table emphasises `Chip` while complete-performance functions are documented separately.
7. **Creation is difficult to discover.** The home navigation is Playground / Listening lab / About. The default view has no direct developer API action; code lives behind “Make a loop” then “View code”. Familiar complete music and the editable melody studies are different documents despite similar titles.

## The product to build

Use one instrument with **Listen, Create and Code** views of the same project. Add **Explore** for published creations and **Docs / API** as a clear developer entry. The listening lab stays a secondary evidence tool. Do not add another disconnected studio.

On the first screen, keep a playable example, the console selector and a short explanation: compose retro music in JavaScript, hear it on emulated console chips, use it in your own project. Offer “Remix this” and “Use the API”. Provide original, editable starters with melody, harmony, bass and drums. Original-game command playback keeps its reference identity; editing opens an explicitly labelled adaptation.

The creation surface needs named parts, add/remove/duplicate, piano-roll notes, a drum grid, section repeat/loop regions, tempo, transpose, timbre, trim, mute/solo, Undo and recovery. Multiple parts can share a musical role; the four roles are not four tracks or four hardware voices. Keep advanced patch editing behind a disclosure. Desktop can show code and notes together; mobile should switch views around a persistent compact transport.

Start the code experience with editable, validated musical data and generated SDK examples. Add procedural JavaScript as a separate authoring mode: a bounded generator produces the same musical document, with an explicit random seed. Visual edits should not pretend to reverse arbitrary JavaScript. Offer “detach to editable notes”, or retain code as the sole authoring source. Compilation failures retain the last playable result and point to the error.

Saving a local draft requires no account. Publishing creates an explicit revision with title, attribution, visibility and a remix link. Imports remain local until publication is requested. A profile has a unique handle and a separate display name; reuse the existing account identity. Keep old anonymous URLs readable and never infer ownership from an author string. Future anonymous sharing needs a recovery/deletion capability or stays a local draft link.

Index **explicitly public publications**, not every imported file, autosave or edit. Start with search by title/creator/tags/console, latest publications, curated examples and favourites. Add a “popular this week” view only once there is meaningful usage and defined resistance to duplicate/self activity. Technical diagnostics describe playability; they must not rank musical taste. Likes, comments, follows and real-time collaboration are not prerequisites for creation and sharing.

## API direction

### One project, distinct musical layers

Introduce a versioned project envelope containing metadata, an authoring source, referenced assets and preferred render settings. Retain `Score` as a compact authoring format and `Performance` as the exact musical timeline; do not invent a third note model. There must be one authoritative source per revision, not independently editable code, tracker and note copies.

A prepared arrangement contains target voice allocation, resolved timbres, register events and diagnostics. It is derived from the source and target policy. Native register captures remain a separate source variant: editing or adapting them must never masquerade as original command playback. Their binary memory/sample assets need explicit serialization and hashes; `JSON.stringify(Uint8Array)` is not a sufficient file contract.

Keep old Score/Song entry points operational. A tracker-to-performance compiler can arrive behind equivalence tests, preserving gate lengths, arpeggios, percussion, envelopes and the existing mix policy. Until equivalence is demonstrated, the common facade can retain different internal execution paths. Unifying the public contract does not require rewriting all synthesis.

### Small high-level surface, advanced access retained

Proposed operation families, **not existing method names**:

| Operation | Contract |
| --- | --- |
| Parse / validate | Accept unknown data at the boundary; return structured issues with paths, codes and severity; bound notes, bytes, duration and assets |
| Prepare | Source + target + explicit adaptation policy → immutable prepared arrangement and report; async worker option, progress and cancellation |
| Play / update | Load, play, pause, stop, restart, seek, loop; update tempo/target/part settings at a defined boundary while preserving play intent |
| Observe | Audible musical position, duration, preparing/playing/error state and adaptation diagnostics; caller-owned scratch where needed |
| Render / export | Same prepared identity → PCM plus metadata; encoding to WAV or supported chip formats is separate |
| Inspect capabilities | Typed chip IDs, usable voices, instrument parameters, supported source/export features and calibration coverage |

Expose musical controls first: role, instrument intent, velocity, expression, transpose, tempo map, part trim and importance. Keep voice-allocation priority separate from mix importance. Native FM operators, wave tables, sample/BRR configuration and raw registers remain advanced access with explicit target compatibility. Do not expose every register as a universal slider, and do not silently substitute Famicom for an unknown target.

`allowLoss` currently defaults to false: preserve that strict SDK default. An interactive preview can deliberately opt into reported losses. Reports should distinguish voice omissions, unsupported expression, approximate timbres, calibration fallbacks and bus timing, with stable part/note identifiers. Deterministic output and a low loss count are not a promise of good musical taste or original-game fidelity.

Keep preparation outside the audio callback. Cancel obsolete jobs and bound caches. Tempo changes should not become unbounded full-song renders on every slider event. Define whether an update takes effect immediately or at a beat/bar boundary and expose pending state; never promise instant timbre conversion. Seeking must restore sustained notes, chip memory, envelopes and effects through replay/checkpoints, not merely skip old note-on events. Native tempo/pitch edits become adaptations unless a native transformation is separately implemented and qualified.

Make context ownership, disposal, async resume failure and transitions part of the public contract. Preserve one audible clock and retain the last working arrangement on preparation failure. Buffered playback and worklet streaming may remain internal strategies; add streaming only with measured startup/memory evidence.

### HTTP and reproducibility

The npm SDK composes, adapts and plays locally. The HTTP service stores, retrieves, searches and manages publication revisions. Avoid a mandatory server render round trip for every musical edit.

Add a versioned publication endpoint and a read-compatible bridge for old `/s/{id}` links. Store an immutable document revision, source/assets hashes, engine version, palette/calibration/adapter versions, target and render options. Preserve a pinned published preview; “render with the latest engine” creates an explicit new rendition. Archive the generator seed/code when present, but playback should consume its validated musical result, not rerun arbitrary published code.

Generate request/response schemas, OpenAPI, agent docs and examples from the same versioned contract. Document authentication, pagination, all supported export parameters, error codes and retry behaviour. Separate source duration from preview duration: the current HTTP renderer permits only 1–30 seconds, even though the SDK planner accepts up to ten minutes. Longer publication renders need explicit queued jobs and storage with progress/cancellation policy, not raised synchronous limits.

For executable user code, use a disposable isolated runner with CPU/time/output limits and no account credentials; do not evaluate it in the application context. Public indexing needs explicit visibility, deletion/reporting and bounded admission. The current per-instance rate limiter is documented as local only; distributed publication/render workloads need shared admission limits. Store attribution and an explicit reuse declaration independently of the library licence. These are requirements of the proposed publication/code features, not a claim that the existing data-only editor executes untrusted code.

## Ordered tickets and acceptance

All tickets below are **proposed / not implemented**. Group coherent changes into a few reviewable PRs; do not force one PR per row or merge an entire social platform at once.

| Ticket | Scope and dependency | Acceptance |
| --- | --- | --- |
| CREATE-01 | Versioned document/diagnostic contract; first | Compact and complete fixtures round-trip without lost notes, expression, timbres or overrides; unknown versions/fields fail explicitly; legacy fixtures still load |
| CREATE-02 | Shared preparation and runtime facade; after 01 | A fresh npm consumer plays Score and Performance; seek/restart/rapid updates preserve play intent; failed and cancelled preparation cannot replace current audio; context disposal verified |
| CREATE-03 | Capabilities, developer docs and examples; with 01–02 | Visible SDK vs HTTP entry points, compilable creation/import/game/export examples; documented parameter units, ownership, policy and supported features; EN/JA parity |
| CREATE-04 | Unified Create/Listen data flow; after 01–02 | Open a complete project, edit a part, switch console, Undo, recover the draft; no silent conversion into the melody-only study; mobile workflow checked |
| CREATE-05 | Editable code/data workspace; after 04 | Data edits and visual edits operate on the same source; code generator seed is reproducible; timeout/error keeps last sound; arbitrary code never runs in the account context |
| CREATE-06 | Complete-project publication and immutable revisions; after 01 | Publish → reload → fork preserves source and mix settings; legacy URLs survive; duplicate retries are idempotent; visibility and withdrawal enforced |
| CREATE-07 | Reproducible previews and export jobs; after 02, 06 | Pinned rendition survives engine upgrades; source duration differs explicitly from excerpt duration; bounded jobs expose ready/failure status; deleted/private output is not served publicly |
| CREATE-08 | Handles, profile and library; after 06 | Reuse account ownership, unique handle reservation, separate display name, paginated drafts/publications, no public email or inferred ownership |
| CREATE-09 | Explore and search; after 06–08 | Only public active revisions are discoverable; title/creator/tag/console filters, stable pagination, recent and curated views; private drafts and imports absent |
| CREATE-10 | Favourites and measured popularity; after 09 and real usage | Account-unique favourites, exclusion of self/duplicate activity, specified time window; no audio metric presented as an artistic score |
| CREATE-11 | Integrated qualification; begins with 01, gates each slice | Create/import → edit → change machine → publish → fresh browser → fork → export; measured audio continuity, visual clock, document fidelity, cancellation and EN/JA mobile screenshots |

Suggested delivery slices: **contract/runtime/docs** (01–03), **creation/code** (04–05), **publication/profile/renditions** (06–08), then **discovery** (09–10). Qualification (11) accompanies each. Schema/storage groundwork can run before the editor is complete; none of this replaces ongoing sound-quality acceptance.

## Review evidence and limits

Read-only production inspection and local schema/bundle probes were used; no public songs or accounts were created. Browser evidence confirms the home navigation and read-only code panel (zero editable fields). Production `GET /api/songs` returns 405; the OpenAPI document returns 200 and has no list operation. The local probe confirms that SDK-valid Performance data is rejected by the publication schema and unknown compact fields are stripped. See the reproducible review script and observations under `.artifacts/creation-api-review` in the review workspace; these are local audit artifacts, not shipped functionality.

An esbuild browser/minified probe on the current dist measured `importMidi` alone at **9,843 bytes / 4,247 gzip**, `Chip` at **316,709 / 98,469**, and SNES planning/rendering at **278,873 / 82,782**. These are illustrative entry bundles, not network or startup benchmarks. The small MIDI result shows that tree shaking already works; missing subpath exports alone is not evidence that every consumer downloads every core. Investigate runtime entry splitting only against representative consumer budgets.

This pass evaluates API/product design, not new sonic correctness. It does not claim human listening acceptance, production-scale capacity or a completed JavaScript sandbox. The prior roadmap explicitly excludes a full DAW competitor; a focused creation/remix workspace can respect that limit while making creation a first-class product feature.
