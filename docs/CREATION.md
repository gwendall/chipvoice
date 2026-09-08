# Projects, creation and publication

For scoped agent authorization, separate artist profiles, HTTP evaluation before publication, MP3 sharing and grouped console versions, see [Artists and agents](ARTISTS-AND-AGENTS.md).

<p align="center"><a href="CREATION.md">English</a> &bull; <a href="CREATION_ja.md">日本語</a></p>

The **0.17.0** project API joins complete performances, compact scores, the browser workspace and publication without reducing imported music to four tracker lines. [Create](https://chipvoice.dev/create) works locally; [Explore](https://chipvoice.dev/explore) contains only explicitly public revisions. The existing compact composer, `/s/{id}` links and SDK APIs remain supported.

## One authoritative document

`MusicProject` version **1** stores a title, optional description, source credit (`author`), reuse `licence`, tags, one source and render settings. `reserved` (the default), `CC0-1.0` and `CC-BY-4.0` describe the music; they are independent of chipvoice's software licence and the account's public handle.

| Source | Preserved data | Playback policy |
| --- | --- | --- |
| `score` | Existing `Score` patterns, order and instrument intents | Authored levels, with sample-equivalence regression tests; `mix: 'auto'` is rejected |
| `performance` | Exact ticks, tempo map, notes, expression, part instruments, portable timbres and mix overrides | Deterministic allocation and automatic mixing, unless `mix: 'authored'` |
| `native` | Serializable register plan plus its editable source performance | Original commands on the original target at original tempo/pitch; changing these or isolating parts creates an adaptation |

Native sample memory uses arrays of bytes, via `storePlan(plan)`. The document hash covers embedded data and settings. Editing notes detaches the generator; a publication never executes somebody else's JavaScript. The optional generator code and seed describe how the stored source was authored.

`parseProject(unknown)` returns a detached JSON snapshot or throws `ProjectValidationError`. `validateProject(unknown)` returns `{ok, issues}` with path, code, message and severity. Unknown versions, fields and targets fail explicitly. Import JSON, SDK preparation and HTTP publication use the same `PROJECT_SCHEMA` and semantic validator. Validation is not a promise of original-game fidelity or musical quality.

## Create and recover

The complete player offers **Remix this song**, including locally imported MIDI. The original command reference stays intact; an editable familiar song is labelled an adaptation. The compact composer's code panel can open its score in the same project workspace while preserving authored playback.

Create offers named parts, add/remove/duplicate, pitch and drum grids, note length/velocity, pitch range, section navigation/repeat, loop start, tempo, transpose, timbre, part trim, allocation priority, mix importance, mute/solo and Undo/Redo. Notes and JSON operate on the same source. Mobile shows one measure; desktop shows two. The seek bar and Play control belong to the instrument.

Named drafts appear in the local section of Your library, with pagination and separate recovery keys for remixes. Drafts stay in this browser's local storage; they are not cross-device backups. Download JSON to keep an independent copy. An account is needed only to publish or manage a profile. Imports are bounded to 4 MB and remain local until publication. A pending render retains the last audible arrangement; the UI reports preparation. Buffered changes take effect when their worker result and decoded audio are ready, preserving normalized musical position through a short crossfade. This is not a zero-latency synthesis editor.

The JavaScript tab runs in a disposable Worker inside a sandboxed opaque-origin iframe. Its CSP denies network access. Code receives `starter` and seeded `random()`, has a two-second deadline and a 4 MB serialized result limit. Syntax errors, timeouts and invalid output retain the last accepted source. Reproducibility requires using `random()` and deterministic inputs; arbitrary JavaScript using time or its own randomness is not promised deterministic. Worker isolation is not an operating-system memory quota: do not promise that deliberately exhausting browser memory is harmless.

## SDK contracts

```js
import {
  projectFromPerformance, importProjectMidi, validateProject,
  prepareProject, ProjectPlayer, renderProject, toWav,
} from 'chipvoice';

const abort = new AbortController();
const project = await importProjectMidi(midiBytes, {
  chip: 'snes', title: 'My song', signal: abort.signal,
});
project.settings.allowLoss = true; // Explicitly accept reported voice omissions.
console.log(validateProject(project));

// In a browser: cancellable preparation without opening an AudioContext.
const prepared = await prepareProject(project, {
  signal: abort.signal, onProgress: fraction => console.log(fraction),
});
// prepared.wav, seconds, peak, engineVersion, native, loopStartSeconds, losses

const player = new ProjectPlayer();
await player.load(project);
playButton.onclick = () => player.play(); // Browser user gesture.
await player.update({ chip: 'md', tempoScale: 1.2 });
player.seek(12); // Seconds on the audible output clock.
player.loop = true;
player.pause(); player.restart(); player.stop();
player.dispose();

// Node or your own worker: same rendering implementation.
const { audio, plan } = renderProject(project, { sampleRate: 44100 });
const wav = toWav(audio);
console.log(plan?.losses, plan?.mix);
```

| Parameter or operation | Contract |
| --- | --- |
| `settings.chip` | `2a03`, `dmg`, `md`, `snes`, `c64`; C64 stays hidden in the public demo |
| `tempoScale` | Positive multiplier 0.1–10; compact scores must also remain within their valid BPM range |
| `transpose` | Semitones, −48 to +48 for performances; legacy scores require integer values within their note range |
| `gain` | Linear master gain, 0–1; defaults retain the source family's existing render policy |
| `allowLoss` | SDK default false; the interactive preview explicitly allows reported adaptation losses |
| `parts` | Optional array of source part IDs when preparing/loading; compact source IDs are `lead`, `chord`, `bass`, `perc` |
| `sampleRate` | Integer Hz, 8000–96000; defaults to 44100 |
| `renderProject.seconds` | Optional excerpt length, positive and at most 600 seconds; never expands the source |
| `load` / `update` | Resolve true only for the accepted selection, false for failure or supersession; inspect `error` |
| `playing`, `position`, `duration`, `audibleProject` | Current transport intent and audible presentation; preparing does not replace these with pending values |
| `preparing`, `progress`, `prepared`, `onChange` | Preparation state, progress 0–1, last accepted result and change notification; position is read on your animation frame |
| `cancel` / `dispose` | Abort preparation; disposal also releases transport, workers and object URLs; closes only an internally owned AudioContext |

`ProjectPlayer({context})` accepts an existing AudioContext. `output` allows an output tap; `setVolume` changes the listening gain without altering the project. An export contains the project master gain, not the listening volume. `PerformancePart.program` supplies a default instrument for new notes; explicit note programs take precedence. `muted` and `mix.gainDb` remain effective without automatic balancing. The browser worker and server share `renderProject`; legacy `Chip`, SFX, raw registers, `recordSong` and `toVgm` remain available. `projectCapabilities()` distinguishes facade WAV export from lower-level register VGM support and lists chip voices/roles; it does not claim every chip implements every foreign instrument.

## Publication and identity

The [OpenAPI document](https://chipvoice.dev/.well-known/openapi.json) and [agent guide](https://chipvoice.dev/skill.md) expose `/api/v1` alongside the original compact `/api/songs` service. Source schema version, npm version and HTTP API version are separate compatibility boundaries.

| Endpoint | Behaviour |
| --- | --- |
| `POST /api/v1/validate` | Validate without storing; 200 or 422 with structured issues |
| `POST /api/v1/projects` | Authenticated `{project, visibility?, parentId?}`; required `Idempotency-Key`; immutable revision |
| `GET /api/v1/projects/{id}` | Complete source plus metadata; private records require owner identity |
| `DELETE /api/v1/projects/{id}` | Owner withdrawal; hides source/audio and cancels unfinished jobs; existing remixes retain their own documents |
| `GET /api/v1/projects` | Public search by `q` (title/creator), `tag`, `chip`, `handle`; `sort=recent|popular`; opaque `cursor` |
| `GET/PUT /api/v1/profile` | Account profile with unique case-insensitive handle, separate display name and bio |
| `PUT/DELETE /api/v1/projects/{id}/favourite` | One favourite per account; self-favourites excluded |
| `POST /api/v1/projects/{id}/report` | Authenticated reason, 3–500 characters; one report per account/publication |
| `POST /api/v1/projects/{id}/render` | Owner starts `{kind: 'preview'|'full'}`; idempotent per publication/kind |
| `GET/DELETE /api/v1/jobs/{id}` | Progress/status or owner cancellation |
| `GET /api/v1/jobs/{id}/audio` | Ready pinned WAV or MP3 (`?format=mp3`), with publication access control |

Authentication reuses existing Bearer keys and HttpOnly browser sessions. Public profile IDs are distinct from internal account IDs; public records never expose email. Handles are reserved atomically. Same-key/same-body retries return the original publication; reusing a key with different content, parent or visibility returns 409. A new revision or remix gets a new request key and publication ID.

Public revisions appear in Explore; unlisted revisions are accessible by link; private revisions require their owner. `mine=1` and `favourites=1` require authentication. Lists return up to 24 entries. Cursor snapshots exclude subsequently created publications; withdrawals and changes in the favourite ranking can still alter a later page. “Popular this week” counts unique favourites created in the last seven days; it is not a listening-quality score or a complete defence against multiple-account abuse. Local drafts never enter the index. The original starter remains available when the community is empty; no artificial users or votes are seeded.

## Pinned audio and operating limits

A job records the SHA-256 of its actual bundled renderer, including the chip code, sample palette and calibration used by that bundle. Successful jobs store immutable WAV chunks and a byte hash in SQLite/Turso. Reading ready audio does not rerender it with a newer engine. Replay with a new engine means creating a new revision. An interrupted or obsolete-engine job fails visibly; publishing a new revision allows a retry.

Previews cover up to **30 seconds**; the source and local full rendering can cover **ten minutes**. Server jobs have a **240-second worker deadline**, a **256 MB JavaScript heap limit**, a **40 MB output ceiling** and one shared active lease. The heap limit does not separately cap native/ArrayBuffer allocations. Admission is stored in the database, not an instance-local counter. The Next `after` callback attempts execution after admission; an owner's status polling retries queued work. This is a small cooperative queue, not an external durable scheduling service. A queued job can wait until its owner polls again; terminated workers fail after the lease expires. Deployments must support Node workers, writable database storage and the configured 300-second route duration.

The operator can inspect `project_reports` joined to `projects`, withdraw violating revisions by setting `deleted_at`, and cancel their unfinished `project_jobs`. Reports do not automatically delete music. Withdrawal revokes application access but retains rows for referential history; storage retention/purging is an operator policy. No secrets belong in the repository: copy `.env.example` locally, keep credentials server-side, and use disposable databases for qualification.

## Qualification

`packages/chipvoice/test/project.mjs` covers strict admission, legacy sample parity, all three complete repertoire round trips and exact section/expression repetition. `apps/web/test-projects.mjs` uses a disposable database for concurrent retries, privacy, remixes, filters, profiles, favourites, real worker WAV persistence and cancellation. `apps/web/test-creation-browser.mjs` covers audible creation, seek/live tempo, seeded generator isolation/timeouts, Undo, publication/reload and EN/JA mobile. Existing audio clock/transition and legacy editor tests remain in qualification. Screenshots and video are generated under `.artifacts/creation/e2e`.

Automated structural and signal checks do not replace musical listening, physical mobile-device acceptance or production capacity monitoring. Original-game fidelity remains governed by the separate native/reference conformance suite.

For agent composition, machine discovery and executable evaluation, see [Composing with an agent](AGENT-COMPOSITION.md).

## Progressive interactive playback

Since SDK 0.18.0, the web composer uses `new ProjectPlayer({preview: true})`. This opt-in SDK mode compiles the same project and renders the same chip cores as offline export, but schedules bounded PCM blocks as they become available. It does not encode/decode a complete WAV before playing. `previewMetadata` exposes duration, native status and mix results; `losses` works in both playback modes. `prepared` remains `null` in preview mode. Use `prepareProject()` or `renderProject()` explicitly when you need a downloadable file.

```js
import {ProjectPlayer} from 'chipvoice';

const player = new ProjectPlayer({preview: true});
// Call play from a user gesture to unlock browser audio.
void player.play();
await player.load(project);
await player.update({tempoScale: 1.25});
player.setTitle('New title'); // Metadata only; no audio preparation.
```

The player keeps the current sound during preparation, preserves Play/Pause intent and follows the audio output clock. A warm worker and bounded variant/PCM/checkpoint caches accelerate repeated edits and seeks. Cold mid-song changes still need to reconstruct DSP history: an emulator's envelopes, samples, filters and echo cannot be restored from note positions alone. Browser audio unlock, uncached network assets and device latency remain real costs. Default `ProjectPlayer()` keeps the existing whole-buffer behavior for compatibility.

