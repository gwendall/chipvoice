# Contributing

<p align="center">
  <a href="CONTRIBUTING.md">English</a> &bull;
  <a href="CONTRIBUTING_ja.md">日本語</a>
</p>

`chipvoice` is a pnpm + turbo monorepo: `packages/chipvoice` is the published
npm package (five sound-chip emulators, driver, project schema, playback),
`packages/conform` holds the conformance harness, and `apps/web` is the
Next.js site at [chipvoice.dev](https://chipvoice.dev).

## Setup

Node 22 and pnpm 10.27.0 (the version pinned in `package.json`'s
`packageManager` field; `corepack enable` selects it automatically).

```bash
pnpm install --frozen-lockfile
pnpm --filter chipvoice build
```

The second command generates the inline audio worklets and the SNES sample
bank; the web app and every typecheck need them to exist before they can run.

## Build and typecheck

```bash
pnpm build       # turbo build, every package
pnpm typecheck   # turbo typecheck, every package
```

`apps/web`'s own typecheck also needs its generated render-worker catalogues,
which its own `build` script writes but `turbo typecheck`'s dependency graph
does not (it only builds *upstream* packages, i.e. `chipvoice`). If you are
typechecking `apps/web` without first running its full `pnpm build`, generate
those catalogues on their own first:

```bash
node apps/web/scripts/build-renderer.mjs   # from apps/web
pnpm typecheck
```

## Tests

Package unit tests and a fresh-install smoke test:

```bash
pnpm --filter chipvoice test:unit
pnpm --filter chipvoice test:fresh   # installs the built tarball into an empty project
```

Score, arrangement and mixing regressions (no browser, run from the repo root):

```bash
pnpm scores:check
pnpm arrangements:check
```

The web browser suite builds a production Next server, drives it in a real
browser and never touches production data or the real database:

```bash
pnpm --filter chipvoice-web build
cd apps/web && node test-local.mjs
```

`test-local.mjs` starts `next start` on a free port against a temporary
SQLite file; it does not build anything itself, hence the prior
`chipvoice-web build`. Two environment variables narrow a run while you are
iterating on one script (the full run, with neither set, is the actual gate):

- `CHIPVOICE_TEST_ONLY=<script-file>` runs only that one script.
- `CHIPVOICE_TEST_FROM=<script-file>` runs from that script through the rest
  of the list.

If you add a new `apps/web/test-*.mjs` script, register it in the `scripts`
list near the top of `test-local.mjs` or `test-local.mjs` will never run it.

The conformance suite (reference cores, hardware test ROMs, mixer
cancellation) lives in `packages/conform` and runs from there, for example
`pnpm --filter chipvoice-conform check`; see `.github/workflows/ci.yml`'s
`conformance` job for the full list of its checks.

## The publication report

`apps/web/public/arrangement-data/report.json` records an `engineSha256` of
the exact engine build its rendered audio and measurements came from. Any
change to `packages/chipvoice`'s engine (the chip cores, the driver, the
mixer) that could change rendered audio needs a fresh report before the
change is merged:

```bash
pnpm arrangements:eval
```

`scores/arrangements/verify-publication.mjs`, run as part of the web test
suite, fails the build if the committed report's hash does not match the
engine it ships next to. The native reference captures `arrangements:eval`
and `arrangements:check` compare against (`.artifacts/arrangements`,
`.artifacts/native-songs/*`) are not committed; regenerate them from your own
NSF/VGM dumps with the commands in
[`scores/arrangements/README.md`](scores/arrangements/README.md#native-source-reproduction)
before running either.

The recordings themselves are not committed. They live in a Vercel Blob store
(decision 40) under site paths that name their content, and the two reports,
`arrangement-data/report.json` and `lab-data/report.json`, are their manifest.
After `pnpm arrangements:eval` or `pnpm --filter chipvoice-web publish:lab`,
upload what is new:

```bash
vercel env pull .env.local --environment=development   # once, at the repository root
pnpm audio:push
```

CI fails a report that names a recording the store does not hold
(`pnpm audio:check`). The site reads recordings from the store;
`pnpm audio:pull` puts a verified copy under `apps/web/public` for offline
work, and a local copy is served first.

## Pull requests

- One plain sentence as the PR title, no type prefix (`Put the Authorize
  button where the reviewer is looking`, not `fix: ...` or `feat: ...`).
  Squash-merge keeps that sentence as the commit title.
- The description explains what changed and, more importantly, why; call out
  which tests cover the change and any decision it depends on or creates.
- `git log` on `main` is the house style to match.

## Decisions

A project-level decision (an architectural choice, a policy, a convention,
not a routine bug fix or feature) gets appended to the end of
[`docs/DECISIONS.md`](docs/DECISIONS.md) and
[`docs/DECISIONS_ja.md`](docs/DECISIONS_ja.md) as `## NN. Title (YYYY-MM-DD)`,
a short statement, then **Why.** and **What changes.** paragraphs. The
Japanese file uses an `<a id="...">` anchor matching the English heading's
slug; follow an existing entry's shape.

## Writing

- Everything in the repository is English: code, comments, docs, commit
  messages. Every Markdown file mirrors as `<name>_ja.md`, kept in sync in
  the same change; `python3 docs/check-translations.py` must report nothing.
- Never write an em dash or en dash (`—`, `–`) anywhere in the repository.
  Use a plain hyphen, spaced ` - ` where a dash would set off a clause.
- UI strings go through the i18n dictionary (`apps/web/src/i18n`), with a
  Japanese translation for every new string.
- Match the surrounding code: comment density, naming, idioms, formatting.
