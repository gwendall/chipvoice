# Artists and agents

<p align="center"><a href="ARTISTS-AND-AGENTS.md">English</a> &bull; <a href="ARTISTS-AND-AGENTS_ja.md">日本語</a></p>

This implements the approved lifecycle: authorize an artist-scoped agent, evaluate before publishing, share complete audio, and compare console variants with customizable original pixel portraits. Human accounts retain ownership; autonomous ownerless accounts are outside this release.

## Identity and permissions

One owner account can manage up to 20 artistic profiles. Existing profiles keep their IDs, handles and publications. New profiles do not require another email address. `/library` manages profiles, portraits and agent access; `/connect` lets an owner review an agent's requested permissions.

Email delivers a single-use, 30-minute sign-in link. The legacy `POST /api/keys` registration path also sends a sign-in link; it no longer creates or emails a permanent key. Previously issued owner keys remain valid until revoked. An agent uses a dedicated `cv_agent_` credential, never an owner's email or browser session.

The pairing protocol is inspired by [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628.html), but is a custom JSON API, **not an OAuth implementation**:

1. `POST /api/v1/agent-requests` with `{label, scopes}` returns a private `requestToken`, public `userCode`, `verificationUrl`, `expiresIn:600` and `interval:5`.
2. The owner opens the verification link, signs in, then reopens the link if needed. Opening it grants nothing. The owner explicitly chooses an artist, reviews permissions and approves access for 1, 7 or 30 days, or declines it.
3. The agent polls `POST /api/v1/agent-requests/token` with `{requestToken}` no more than once every five seconds. Honour `Retry-After`. Pending is a normal response; denied, expired and consumed requests are terminal. An authorized response returns the bearer token once. Lost responses require a new authorization.
4. `GET /api/v1/agent` returns the agent's profile, scopes and expiry. `GET /api/v1/profile` returns that artist, including public page and SVG portrait URLs. Only the owner browser session can list or revoke `/api/v1/agents`.

| Scope | Permission |
| --- | --- |
| `projects:read` | Read accessible songs; see private songs only for the authorized artist |
| `projects:write` | Publish and withdraw songs for that artist |
| `render` | Request/cancel audio work for that artist |
| `evaluate` | Evaluate a submitted project without publishing |
| `profile:write` | Update that artist's handle, display name, biography and portrait |

Agent tokens are denied access to legacy account/publishing endpoints, other owned artists, favourites, reports and further authorization grants. Explicit invalid credentials never fall back to a browser session or anonymous publication. Account quotas are shared across its agents. Revocation and expiry block subsequent requests; already authorized work may finish. No public profile exposes the owner's email or internal account ID. Tokens and pairing secrets are stored only as hashes.

## Evaluate before publishing

`POST /api/v1/evaluate` takes the raw MusicProject JSON, like `/api/v1/validate`. It needs no SDK installation, writes no project and runs in a bounded worker. Anonymous users can evaluate; an agent needs the `evaluate` scope.

The response includes the engine version and renderer fingerprint, full duration, note counts, the complete allocation loss ledger and mix report. Peak, RMS and clipped-sample counts measure only the first two seconds of rendered audio at 44100 Hz. They cannot certify the rest of the mix, musical quality or fidelity to an original game. Native register sources may have no note-level ledger; compact Score sources keep their authored mix. Strict projects can reject voice exhaustion: `allowLoss:true` is an explicit musical tradeoff, not an automatic repair.

Limits are 4 MB per request, six evaluations per minute per owner (anonymous: IP), 256 MB worker heap and a 30-second processing deadline. A database lease serializes evaluation and publication rendering. A busy renderer returns 429; honour `Retry-After`. Worker termination precedes lease release.

## Publication, audio and variants

Publish `{project, visibility, profileId?, parentId?}` to `/api/v1/projects` with an `Idempotency-Key`. An omitted profile selects the owner's default artist or the agent's authorized artist. Reusing the key with different artist, source, settings, visibility or parent returns 409. Revisions remain immutable.

Render jobs produce pinned WAV and MP3 together. Ready jobs expose `wavUrl`, `mp3Url`, `pageUrl` and `coverUrl`; MP3 carries title, artist and publication URL. A chat client can download `mp3Url` and attach the bytes using its upload tool. Supplying a URL does not itself upload an attachment.

For a ready older WAV-only job, posting its existing render kind queues MP3 encoding from its stored PCM. Poll `mp3Status`; the WAV and its original engine fingerprint never change. Conversion failure is explicit in `mp3Error` and does not corrupt the WAV. Preview audio is at most 30 seconds; full audio retains the complete source within the existing 40 MB WAV and 240-second processing limits.

Publications expose accessible `variants`: the latest version per console with identical canonical source data under the same artist. Target settings and presentation metadata do not change source identity. Sources that differ musically do not group. The page links console versions; Explore uses `group=1` to show one result per composition. Search/console filters apply before grouping; pagination retains its snapshot. Private and unlisted siblings are excluded from anonymous discovery. A directly opened unlisted version can show itself, plus its public siblings. Favourites remain attached to individual publication revisions.

## Original portraits

`PUT /api/v1/profile` and owner `PUT /api/v1/profiles/{id}` accept `avatar:{palette,variant}`. Palette is 0–3; variant is 0–15; `null` restores the original deterministic portrait. Defaults preserve existing portraits. Rendering is local SVG geometry derived from the public profile ID: no third-party avatar service, image uploads, personal data or secret seed. Public pages and cover PNGs share this renderer. The creator's publication panel selects the artistic profile independently of the music's source credits.

## Verification

`apps/web/test-artists.mjs` runs against a disposable database and production Next server. It exercises actual browser authorization, profile customization, scoped/expired/revoked tokens, legacy endpoint denial, another artist's private resources, repeated deterministic HTTP evaluation, grouped variants without hidden siblings, complete MP3 decoding, WAV-preserving conversion and English/Japanese mobile layouts. Existing account, publication, audio and agent-guide suites remain required.

Run `pnpm --filter chipvoice-web build` then `pnpm --filter chipvoice-web test`. Screenshots are written under `.artifacts/artist-lifecycle/`. Never seed production or send a real email to qualify this flow.
