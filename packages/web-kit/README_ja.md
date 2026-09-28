<a id="web-kit"></a>
# web-kit

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

`apps/web`（chipvoice.dev）とこのモノレポの2つ目のアプリが共有する、プライベートなサーバーコードです：暗号、HTTPルートのエンベロープ、インメモリのレートリミッター、SSEのパース、データベースファクトリー、デバイスフローのエージェント認可、MP3/ID3の音声エンコード、そしてロケール/翻訳のコア。アプリ固有のものはここには何もなく、各アプリはテーブル名、トークンのプレフィックス、スコープ、コピーを、ファクトリーまたは設定オブジェクトを通じて自分で渡します。このパッケージが存在する理由と、何がここへ移ったかは[決定47](../../docs/DECISIONS_ja.md)を参照してください。

<a id="subpaths"></a>
## サブパス

| Subpath | 内容 |
| --- | --- |
| `web-kit/crypto` | `secret`、`hashKey`、`newId` |
| `web-kit/http` | `HttpError`、`readBody`、`objectBody`、`createRoute` |
| `web-kit/limit` | `allow`（階層別のインメモリレート制限）、`clientKey` |
| `web-kit/sse` | `readSSE`。Server-Sent Eventsストリームを走査する非同期イテレータ |
| `web-kit/db` | `createDb`、`migrate`、`addColumns`、`admitWindow` |
| `web-kit/agent-auth` | `createAgentAuth`：RFC 8628のデバイスフロー・エージェントペアリング、RFC 8414/9728のディスカバリー、セッション、APIキー、マジックリンク |
| `web-kit/audio` | `encodeMp3`、`id3`/`contentDisposition`、`audioRange`/`audioStream`、`createRenderCache`/`RenderBusy` |
| `web-kit/agent-docs` | アプリのOpenAPI仕様から組み立てる`agentManifest` |
| `web-kit/i18n` | `createLocaleHelpers`、`createTranslator` |
| `web-kit/i18n/react` | `createI18nReact`：上記コアのプロバイダー、フック、言語セレクター |

裸の`web-kit`ルートエクスポートはありません。サブパスをimportしてください。

<a id="the-factory-pattern"></a>
## ファクトリーパターン

アプリ固有の値（テーブル名、クッキー名、トークンのプレフィックス、既定のレート制限の階層）を必要とするモジュールは、それらの値を決め打ちにする代わりに、設定として受け取るファクトリーをエクスポートします：

```ts
import { createDb } from "web-kit/db";

export const dbInstance = createDb({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});
```

`apps/web`は、`apps/web/src/lib`の下にモジュールごとの小さなファイルを持ち、対応するファクトリーをchipvoice自身の値で呼び出し、結果をその呼び出し元がすでに使っている名前で再エクスポートします。そのため、その1ファイルの外は何も変える必要がありません。もっとも規模の大きい例は`apps/web/src/lib/agents.ts`です：`createAgentAuth`をchipvoiceのテーブル名、`cv_agent_`/`cv_live_`/`cv_session_`のトークンプレフィックス、そして自身のルートからスコープへの認可ポリシーで設定し、web-kitの汎用的な形（`ownerId`）とchipvoiceの外部向けワイヤーフォーマット（`profileId`、デバイスフローのポーリング応答ではさらに`profileUrl`）が異なる2つのフィールドを付け替えることで、すでにデプロイされているエージェントクライアントから見て違いがないようにしています。

<a id="build-typecheck-tests"></a>
## ビルド・型検査・テスト

```bash
pnpm --filter web-kit build       # tsc -p tsconfig.build.json
pnpm --filter web-kit typecheck
pnpm --filter web-kit test:unit   # node --test over test/*.test.mjs
```

`turbo.json`の既存の`dependsOn: ["^build"]`が、追加の配線なしに`apps/web`より先に`web-kit`をビルドします。リポジトリのルートでの`pnpm build`/`pnpm typecheck`は、通常のturboグラフの一部としてこれをカバーします。

ユニットテストは`test/*.test.mjs`にあり、単独でテストする価値のあるロジックを持つモジュールごとに1ファイルです（`crypto`、`http`、`db`、`agent-auth`、`agent-docs`、`audio`、`limit`、`sse`）。決定37に従い、`scripts/run-unit-tests.mjs`がこれらをディスクから自動的に見つけます。実際のNext.jsサーバー、実際のファイルシステムキャッシュ、実際のブラウザに依存する振る舞いは、代わりに`apps/web`自身の統合スクリプト（`apps/web/test-*.mjs`）で証明します。それらの依存先が実際に存在するのはそちらだからです。

<a id="what-is-not-here"></a>
## ここにないもの

chipvoice固有のものはすべて`apps/web`に残ります：そのマイグレーション履歴とテーブル形状（`apps/web/src/lib/migrations.ts`）、そのルートからスコープへの認可ポリシー（`apps/web/src/lib/agents.ts`の`authorizeAgent`）、そのロケール一覧とメッセージカタログ（`apps/web/src/i18n`）、そしてそのOpenAPI仕様とエージェントツールの説明（`apps/web/src/lib/agent-tools.ts`）。2つ目のアプリは同じファクトリーを自分自身の値で設定します。chipvoiceのものを引き継ぐわけではありません。
