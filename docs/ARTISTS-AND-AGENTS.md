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

Agent tokens are denied access to legacy account/publishing endpoints, other owned artists, favourites, reports and further authorization grants. Explicit invalid credentials never fall back to a browser session or anonymous publication. Account quotas are shared across its agents. An owner can have up to 100 active credentials; management lists active credentials before recent inactive history. Revocation and expiry block subsequent requests; already authorized work may finish. No public profile exposes the owner's email or internal account ID. Tokens and pairing secrets are stored only as hashes.

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

## Human sign-in and mail operations

The header links to `/signin` for guests and shows the default artist's pixel avatar linking to `/library` when signed in. `AccountLink` reuses `PixelAvatar`, the same portrait component used on profiles and song cards. Anonymous prompt composers see the email form before generation; editing and playback remain available without signing in. The prompt and duration stay in local storage on that device. The email link returns to the composer without starting a paid generation automatically. Opening the link in another tab restores the draft; returning to the original tab refreshes its session. Links work once for 30 minutes. Expired links lead to a visible retry form. English and Japanese share this flow.

`useSession` shares one identity request across mounted components. The lightweight `GET /api/auth/session` returns identity and the default portrait; it does not load songs or API keys. A five-minute presentation cache in `sessionStorage` survives navigation and reload. A matching snapshot up to 24 hours old can remain visible during background revalidation. The real credential stays in its HttpOnly cookie, and protected APIs still authenticate every action. A separate, non-secret revision cookie changes on login and is cleared on logout; it cannot authenticate a request. Focus/visibility checks detect account changes, while cross-tab signals and the `chipvoice-session` event invalidate logout/profile edits immediately. Signals contain no identity or token. Late responses cannot restore a previous account. The sharing panel loads its library and keys only when expanded.

`test-session-cache.mjs`, `test-session-browser.mjs` and `test-auth-http.mjs` cover request deduplication, reload/focus reuse, stale snapshots, outages, late responses, account changes, cross-tab logout, real cookie authorization and revocation. Browser screenshots under `.artifacts/session/` cover the English and Japanese header and its 44-pixel mobile account target.

Mail uses the official `domani` SDK, `DOMANI_API_KEY` and `CHIPVOICE_MAIL_FROM` (default `hello@chipvoice.dev`). Configure these as server-only secrets in local `.env.local` and Vercel production, then deploy to apply a changed production environment. Use a dedicated token restricted to that mailbox; do not copy an owner's unrestricted CLI credential into the app. Check token expiry when rotating. The September 2026 production mail token expires on September 1, 2027. The optional `DOMANI_BASE_URL` is for a controlled test provider; leave the production default at `https://domani.run`.

An HTTP 202 from sign-in confirms provider acceptance, not inbox delivery. A rejected key previously caused production 503 responses: probe the configured mailbox with the same token, inspect the status/code, and rotate an invalid token. Logs deliberately omit provider bodies, addresses and sign-in links. The UI reports failure and allows retry; it never claims that a failed send succeeded.

`test-onboarding.mjs` exercises real Next routes, the SDK over HTTP, email content capture, single-use redemption, new-tab draft restoration, private generation, failure/retry, safe return paths and Japanese mobile layouts against a disposable database and local mail fixture. It is included in the normal web suite; screenshots are under `.artifacts/onboarding/`. A separately authorized production smoke test must verify receipt in an app-controlled mailbox and redeem that newly received link. Never infer delivery from the mocked suite, read unrelated inbox messages or send test mail to another person.

To run the separately authorized production check from `apps/web`, load the scoped key without printing it: `CHIPVOICE_EVAL_PRODUCTION=1 node --env-file=.env.local scripts/eval-human-signin.mjs`. It refuses a forwarded mailbox, reads only new matching inbound mail to `hello@chipvoice.dev`, checks a private 10-second generation and its decoded MP3, then withdraws that test song and revokes only its own session. It is deliberately excluded from CI.
