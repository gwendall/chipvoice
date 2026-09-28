<a id="appssounds-gamesoundsai"></a>
# apps/sounds（gamesounds.ai）

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

[gamesounds.ai](https://gamesounds.ai)のサイトとREST API：イベント単位でファイルされたゲーム効果音バンクで、人が閲覧でき、エージェントはアカウント無しで呼び出せる。データモデル、タクソノミー、API、マニフェストのリファレンスは[`docs/GAMESOUNDS.md`](../../docs/GAMESOUNDS.md)を、これがchipvoice.devのページではなくモノレポの2つ目のアプリである理由は[決定48](../../docs/DECISIONS.md)を参照。`packages/gamesounds`は、エージェントが自身のプロジェクトへインストールするCLIとランタイムを保持する。このアプリはそのパッケージ自身のビルドに決して依存しない（型は相対パスでインポートする）ため、`catalog:build`と`next build`は`packages/gamesounds`を先にビルドする必要が一切ない。

<a id="running-it-locally"></a>
## ローカルでの実行

```bash
pnpm --filter gamesounds-site catalog:build   # generated/catalog.json + public/f/*
pnpm --filter gamesounds-site dev             # next dev --turbopack -p 3020
```

`public/f/`（コンテンツアドレス化された音声ファイル）はgitignoreされている - `catalog:build`はKenneyのソースパックをダウンロードし、chipvoice由来の音をレンダーし、カタログと配信される全ファイルの両方を書き出す。同じソースに対しては決定的なので、再実行しても安全である。`--fetch-only`/`--skip-fetch`は、生ソースが既にディスク上にある場合に編集サイクルを速めるため、ネットワークの段階とレンダーの段階を分離する。`generated/catalog.json`はコミットされているため、サイト自体は再ビルドなしにビルド・実行できる。

<a id="layout"></a>
## レイアウト

| パス | 内容 |
| --- | --- |
| `catalog/taxonomy.json`、`catalog/sources/*.json`、`catalog/packs.ts` | タクソノミー、ソースごとのレシピ／クレジット、スターターパック（`/packs/<id>`） |
| `scripts/build-catalog.mjs`、`scripts/lib/*.mjs` | カタログビルド：取得、レンダー、トリム、測定、エンコード、書き出し |
| `generated/catalog.json` | ビルド済みカタログ、コミット済み |
| `public/f/` | コンテンツアドレス化された音声（`/f/<sha256>.<ext>`）、gitignore済み |
| `src/lib/catalog.ts` | `generated/catalog.json`を読み込む。検索、イベント解決、`buildManifest()` |
| `src/lib/openapi.ts` | `/openapi.json`、`/.well-known/mcp.json`、`/llms.txt`、`/skill.md`がすべて導出される唯一のOpenAPI仕様 |
| `src/app/api/v1/*` | REST API |
| `src/app/[locale]/*` | サイト |
| `src/components/*` | `SoundList`（キーボードショートカット）、`Waveform`、`PlayButton`、`SearchBox`、`CopyForAgent` |
| `src/lib/player.tsx` | `PlayerProvider`/`usePlayer`：サイト全体が共有する唯一のWeb Audioプレーヤーインスタンス |

<a id="testing"></a>
## テスト

```bash
pnpm --filter gamesounds-site test          # node --test over test/*.test.mjs
pnpm --filter gamesounds-site build         # next build
node apps/sounds/test-smoke.mjs         # Playwright, against a running build
```

`test/*.test.mjs`は、スキーマ検証（`manifest.test.mjs`、`packages/gamesounds/schema/manifest-1.json`に対して）、カタログ自身のビルドチェック（`checks.test.mjs`、不正なファイルが実際に拒否されることを証明する否定的ケースを含む）、そのソースマッピング（`mapping.test.mjs`）をカバーする。`test-smoke.mjs`はビルド済みで稼働中のサーバーを必要とする（`next build && next start -p 3020`、または別のサーバーなら`SITE=<url>`） - `finally`でクローズされる実際のブラウザを操作し、ホームページが読み込まれること、検索が結果を返すこと、再生が本物の`AudioBufferSourceNode`を開始すること、ダウンロードのバイト列がそのSHA-256と一致すること、キーボードショートカット（`/`、`j`、`k`、`space`、`d`）が動くことを証明する。

<a id="environment"></a>
## 環境変数

`NEXT_PUBLIC_SITE_URL`（既定`https://gamesounds.ai`）が唯一の必須変数である - `src/lib/site.ts`の`SITE`定数を決め、OpenAPI仕様、`llms.txt`、エージェントマニフェストの絶対URLに使われる。
