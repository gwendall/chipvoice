# web-kit

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

Private server code shared by `apps/web` (chipvoice.dev) and a second app in
this monorepo: crypto, the HTTP route envelope, an in-memory rate limiter, SSE
parsing, a database factory, device-flow agent authorization, MP3/ID3 audio
encoding, and the locale/translator core. Nothing app-specific lives here;
each app supplies its own table names, token prefixes, scopes and copy
through a factory or a configuration object. See
[Decision 47](../../docs/DECISIONS.md) for why this package exists and what
moved into it.

## Subpaths

| Subpath | Holds |
| --- | --- |
| `web-kit/crypto` | `secret`, `hashKey`, `newId` |
| `web-kit/http` | `HttpError`, `readBody`, `objectBody`, `createRoute` |
| `web-kit/limit` | `allow` (per-tier in-memory rate limiting), `clientKey` |
| `web-kit/sse` | `readSSE`, an async iterator over a Server-Sent Events stream |
| `web-kit/db` | `createDb`, `migrate`, `addColumns`, `admitWindow` |
| `web-kit/agent-auth` | `createAgentAuth`: RFC 8628 device-flow agent pairing, RFC 8414/9728 discovery, sessions, API keys, magic links |
| `web-kit/audio` | `encodeMp3`, `id3`/`contentDisposition`, `audioRange`/`audioStream`, `createRenderCache`/`RenderBusy` |
| `web-kit/agent-docs` | `agentManifest`, built from an app's OpenAPI spec |
| `web-kit/i18n` | `createLocaleHelpers`, `createTranslator` |
| `web-kit/i18n/react` | `createI18nReact`: provider, hooks and a language selector for the core above |

There is no bare `web-kit` root export; import a subpath.

## The factory pattern

A module that needs app-specific values (a table name, a cookie name, a
token prefix, a default rate-limit tier) exports a factory that takes those
values as configuration, instead of assuming them:

```ts
import { createDb } from "web-kit/db";

export const dbInstance = createDb({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});
```

`apps/web` keeps a small file per module under `apps/web/src/lib` that calls
the matching factory with chipvoice's own values and re-exports the result
under the names its call sites already use, so nothing outside that one file
needs to change. `apps/web/src/lib/agents.ts` is the fullest example: it
configures `createAgentAuth` with chipvoice's table names, its
`cv_agent_`/`cv_live_`/`cv_session_` token prefixes, and its own
route-to-scope authorization policy, then remaps the two fields where
web-kit's generic shape (`ownerId`) differs from chipvoice's external wire
format (`profileId`, plus `profileUrl` on the device-flow poll response) so
already-deployed agent clients see no difference.

## Build, typecheck, tests

```bash
pnpm --filter web-kit build       # tsc -p tsconfig.build.json
pnpm --filter web-kit typecheck
pnpm --filter web-kit test:unit   # node --test over test/*.test.mjs
```

`turbo.json`'s existing `dependsOn: ["^build"]` builds `web-kit` before
`apps/web` with no further wiring; `pnpm build`/`pnpm typecheck` at the repo
root cover it as part of the normal turbo graph.

Unit tests live in `test/*.test.mjs`, one file per module that has logic
worth testing in isolation (`crypto`, `http`, `db`, `agent-auth`,
`agent-docs`, `audio`, `limit`, `sse`); `scripts/run-unit-tests.mjs`
discovers them from disk, per decision 37. Behavior that depends on a real
Next.js server, a real filesystem cache or a real browser is proved instead
by `apps/web`'s own integration scripts (`apps/web/test-*.mjs`), since that
is where those dependencies actually live.

## What is not here

Anything chipvoice-specific stays in `apps/web`: its migration history and
table shapes (`apps/web/src/lib/migrations.ts`), its route-to-scope
authorization policy (`authorizeAgent` in `apps/web/src/lib/agents.ts`), its
locale list and message catalogues (`apps/web/src/i18n`), and its OpenAPI
spec and agent tool descriptions (`apps/web/src/lib/agent-tools.ts`). A
second app configures the same factories with its own values; it does not
inherit chipvoice's.
