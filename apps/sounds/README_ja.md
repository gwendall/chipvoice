<a id="appssounds-gamesoundsai"></a>
# apps/sounds（gamesounds.ai）

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

[gamesounds.ai](https://gamesounds.ai)のサイトとREST API：イベント単位でファイルされたゲーム効果音バンクで、人が閲覧でき、エージェントはアカウント無しで呼び出せる。データモデル、タクソノミー、API、マニフェストのリファレンスは[`docs/GAMESOUNDS.md`](../../docs/GAMESOUNDS.md)を、これがchipvoice.devのページではなくモノレポの2つ目のアプリである理由は[決定49](../../docs/DECISIONS.md)を参照。`packages/gamesounds`は、エージェントが自身のプロジェクトへインストールするCLIとランタイムを保持する。このアプリはそのパッケージ自身のビルドに決して依存しない（型は相対パスでインポートする）ため、`catalog:build`と`next build`は`packages/gamesounds`を先にビルドする必要が一切ない。

<a id="running-it-locally"></a>
## ローカルでの実行

```bash
pnpm --filter chipvoice build                 # 先に必要：build-catalog.mjsがそのdistをインポートする
pnpm --filter sfx-engine build                # これも先に必要：生成半分について同じ理由
pnpm --filter gamesounds-site catalog:build   # generated/catalog.json + public/f/*
pnpm --filter gamesounds-site dev             # next dev --turbopack -p 3020
```

`public/f/`（コンテンツアドレス化された音声ファイル）はgitignoreされている - `catalog:build`はchipvoiceの全レシピと全sfx-engineプリセット（GS-03）をレンダーし、カタログと配信される全ファイルの両方を書き出す。gamesoundsは私たち自身のサウンドバンクである：すべての音はchipvoice自身の合成、または私たち自身の`packages/sfx-engine`によって作られ、第三者の音源も外部の生成APIも使わないため、このビルドは決してネットワークに触れない。同じレシピに対しては決定的なので、再実行しても安全である。`--out <path>`は`generated/catalog.json`の代わりに別の場所へ書き出す（`catalog:check-determinism`が、チェック対象のコミット済みファイルを上書きすることなく新規ビルドを行うために使う）。`generated/catalog.json`はコミットされているため、サイト自体は再ビルドなしにビルド・実行できる。

<a id="layout"></a>
## レイアウト

| パス | 内容 |
| --- | --- |
| `catalog/taxonomy.json`、`catalog/chipvoice-recipes.mjs`、`catalog/generated-recipes.mjs`、`catalog/packs.ts` | タクソノミー、イベント×チップごとのレシピ、sfx-engineプリセットの対応表、スターターパック（`/packs/<id>`） |
| `scripts/build-catalog.mjs`、`scripts/lib/*.mjs` | カタログビルド：レンダー、トリム、測定、エンコード、書き出し |
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

`test/*.test.mjs`は、スキーマ検証（`manifest.test.mjs`、`packages/gamesounds/schema/manifest-1.json`に対して）、カタログ自身のビルドチェック（`checks.test.mjs`、不正なファイルが実際に拒否されることを証明する否定的ケースを含む）、音声処理（`audio.test.mjs`）、決定性ゲート（`determinism.test.mjs`、`docs/GAMESOUNDS.md`の「継続的インテグレーション」を参照)、生成された半分自身のラウドネス・レイアウトの罠（`generated-loudness.test.mjs` - GS-03、`docs/GAMESOUNDS.md`の「生成された音」節を参照)、そして新しいスタイルが8bit/16bit/スタイル無しの解決を変えずに生成された音に到達すること（`resolve-generated.test.mjs`）をカバーする。`test-smoke.mjs`はビルド済みで稼働中のサーバーを必要とする（`next build && next start -p 3020`、または別のサーバーなら`SITE=<url>`） - `finally`でクローズされる実際のブラウザを操作し、ホームページが読み込まれること、検索が結果を返すこと、再生が本物の`AudioBufferSourceNode`を開始すること、ダウンロードのバイト列がそのSHA-256と一致すること、キーボードショートカット（`/`、`j`、`k`、`space`、`d`）が動くことを証明する。

<a id="environment"></a>
## 環境変数

`NEXT_PUBLIC_SITE_URL`（既定`https://gamesounds.ai`）が唯一の必須変数である - `src/lib/site.ts`の`SITE`定数を決め、OpenAPI仕様、`llms.txt`、エージェントマニフェストの絶対URLに使われる。
