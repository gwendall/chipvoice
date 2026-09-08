# Creator journey qualification — 2026-09-08

<p align="center"><a href="CREATOR-JOURNEY-2026-09-08.md">English</a> &bull; <a href="CREATOR-JOURNEY-2026-09-08_ja.md">日本語</a></p>

The local end-to-end journey passes with a simulated provider. A separate real Astra trial produced a complete 60-second, four-part song and decodable MP3. Production deployment evidence belongs to [PR #50](https://github.com/gwendall/chipvoice/pull/50); a local success does not certify production.

## Coverage

| Scenario | Verification |
| --- | --- |
| Discovery | Fetch deployed `/skill.md`, OpenAPI and the dependency-free `/skill/compose.mjs` |
| Artist authorization | Owner reviews the request in `/connect`, selects and names an artist, then approves scoped access |
| Agent independence | Child process receives only the served helper, its scoped credential and musical input; no repository imports or owner/database/provider credentials |
| Prompt composition | Generate, poll, download the complete MP3, repeat with the same directory and verify the same song ID |
| Direct composition | Upload a complete score with the same helper, publish and download the MP3 |
| Attribution | API, library, public song and profile identify the selected artist |
| Creation method | Distinct prompt/direct labels survive gallery grouping; edited prompt descendants inherit their origin; clients cannot forge origin metadata |
| Sharing | Private/public/unlisted transitions keep the same song and rendered audio; private audio is unavailable anonymously; other artists cannot be published by the grant |
| Browser | Mobile/desktop screenshots, playback, MP3 decoding, no page errors, EN/JA labels, no profile overflow |
| Prompt UI | Progress, reload/resume, selected artist, library link and intact editor draft |
| Failure paths | Companion generation suite exercises refusal, invalid output, errors, cancellation, revocation, concurrency, quota and idempotency conflicts |

## Reproduce

```bash
pnpm --filter chipvoice-web build
cd apps/web
node test-generation.mjs
node test-creator-journey.mjs
```

Local runs use disposable SQLite databases and a simulated HTTP provider. Reports and screenshots go to `.artifacts/creator-journey/local-*/`. They require no OpenAI credits.

The explicit production mode requires `CHIPVOICE_EVAL_PRODUCTION=1`, `CHIPVOICE_EVAL_SITE=https://chipvoice.dev` and server database credentials loaded privately from an ignored environment file. It makes two paid model calls and temporarily publishes clearly identified test songs. Its controller creates a dedicated owner fixture; authorization then goes through the real browser. Cleanup withdraws that owner's test publications and revokes its credentials. No existing artist or song is modified. Artifacts go to `.artifacts/creator-journey/production-*/`.

## Limits

Email delivery and attachment to an external chat service are not exercised by this harness. The agent actually receives a local MP3 file, which its chat tool can attach. The fixture controller does not claim that an agent can bypass owner authorization. “Direct composition” describes submission through Chipvoice, not proof of human-only authorship. API/browser checks and audio decoding do not establish musical taste, prompt fidelity or hardware fidelity; those require separate musical and emulator evaluations.

Local database contention is exercised with a real cross-process writer while generation resumes, asserting completion without repeating the paid call. SQLite uses persistent WAL mode; a rejected standalone statement renews its connection to release retained read snapshots. Retries are bounded and limited to explicit BUSY errors. Hosted libsql connections are unchanged.
