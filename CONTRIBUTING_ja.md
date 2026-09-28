<a id="contributing"></a>
# 貢献の手引き

<p align="center">
  <a href="CONTRIBUTING.md">English</a> &bull;
  <a href="CONTRIBUTING_ja.md">日本語</a>
</p>

`chipvoice`はpnpmとturboによるモノレポです。`packages/chipvoice`は公開npmパッケージ（5つの音源チップエミュレータ、ドライバ、プロジェクトスキーマ、再生機能）、`packages/conform`は検証ハーネス、`apps/web`は[chipvoice.dev](https://chipvoice.dev)のNext.jsサイトです。

<a id="setup"></a>
## セットアップ

Node 22とpnpm 10.27.0（`package.json`の`packageManager`フィールドで固定されているバージョン。`corepack enable`で自動的に選択されます）。

```bash
pnpm install --frozen-lockfile
pnpm --filter chipvoice build
```

2つ目のコマンドはインライン化されたオーディオワークレットとSNESサンプルバンクを生成します。Webアプリとすべてのtypecheckは、実行前にこれらが存在している必要があります。

<a id="build-and-typecheck"></a>
## ビルドとtypecheck

```bash
pnpm build       # turbo build、全パッケージ
pnpm typecheck   # turbo typecheck、全パッケージ
```

`apps/web`自身のtypecheckは、生成されたレンダーワーカーのカタログも必要とします。これは`apps/web`自身の`build`スクリプトが書き出すもので、`turbo typecheck`の依存グラフには含まれません（上流パッケージ、つまり`chipvoice`だけをビルドします）。`apps/web`の完全な`pnpm build`を先に実行せずにtypecheckする場合は、そのカタログだけを単独で生成してください。

```bash
node apps/web/scripts/build-renderer.mjs   # apps/webから実行
pnpm typecheck
```

<a id="tests"></a>
## テスト

パッケージの単体テストと、新規インストールの動作確認：

```bash
pnpm --filter chipvoice test:unit
pnpm --filter chipvoice test:fresh   # ビルド済みtarballを空のプロジェクトへインストールして確認
```

`test:unit`はほとんどのファイルを4つずつ並列に実行し、その後で
`test/progressive-handoff-stall.mjs`だけを単独で実行します。このファイルは実際の壁時計とプロセス内のレンダリングを競わせるため、マシンが混んでいると、コードに問題がなくてもアンダーランや、いつまでも落ち着かないpumpを報告することがあります。他の重い処理を動かしながらローカルで失敗した場合は、回帰とみなす前に、空いているマシンで再実行してください（`packages/chipvoice`から`node --test test/progressive-handoff-stall.mjs`）。

スコア・編曲・ミキシングの回帰チェック（ブラウザー不要、リポジトリルートから実行）：

```bash
pnpm scores:check
pnpm arrangements:check
```

Webのブラウザースイートは本番ビルドのNextサーバーを起動し、実ブラウザーで操作します。本番データや実データベースには一切触れません。

```bash
pnpm --filter chipvoice-web build
cd apps/web && node test-local.mjs
```

`test-local.mjs`は空きポートで一時的なSQLiteファイルを使い`next start`を起動します。それ自体は何もビルドしないため、事前の`chipvoice-web build`が必要です。特定のスクリプトを反復して試す間は、次の2つの環境変数で範囲を絞れます（どちらも指定しないフルランが本来のゲートです）。

- `CHIPVOICE_TEST_ONLY=<スクリプトファイル名>`：そのスクリプトだけを実行します。
- `CHIPVOICE_TEST_FROM=<スクリプトファイル名>`：そのスクリプトから一覧の残りまでを実行します。

新しい`apps/web/test-*.mjs`スクリプトを追加したら、`test-local.mjs`冒頭付近の`scripts`一覧に登録してください。登録しないと`test-local.mjs`はそのスクリプトを実行しません。

検証ハーネス（参照コア、実機用テストROM、ミキサー打ち消し）は`packages/conform`にあり、そこから実行します。例：`pnpm --filter chipvoice-conform check`。全チェックの一覧は`.github/workflows/ci.yml`の`conformance`ジョブを参照してください。

本番e2eの`test-e2e.mjs`は、代わりに公開中のサイトを確かめます。npmのパッケージ、API、エディターがバイト単位で一致することです。`.github/workflows/e2e.yml`は本番デプロイが成功するたびにこれを実行し、手動では`SITE=https://chipvoice.dev pnpm test:e2e`で実行します。e2eは曲を1つ保存してフォークします。`CHIPVOICE_E2E_KEY`に専用テストアカウントのAPIキーがあれば、それらの曲はそのアカウントのものになり、なければ匿名になります。

<a id="the-publication-report"></a>
## 公開レポート

`apps/web/public/arrangement-data/report.json`は、その音声と測定値を生んだビルド済みエンジンのモジュール、つまり`evaluate.mjs`から到達できるモジュールの`engineSha256`を記録します。`scores/arrangements/engine.mjs`が`evaluate.mjs`をバンドルしてそれらを求めます。そのいずれか（チップコア、ドライバ、ミキサー）を変更したときは、マージ前に新しいレポートが必要です。再生、エディター、プロジェクトAPIの変更には必要ありません。

```bash
pnpm arrangements:eval
```

Webテストスイートの一部として実行される`scores/arrangements/verify-publication.mjs`は、コミット済みレポートのハッシュが同梱するエンジンと一致しなければビルドを失敗させます。`arrangements:eval`と`arrangements:check`が比較に使うネイティブ参照キャプチャ（`.artifacts/arrangements`、`.artifacts/native-songs/*`）はコミットされません。どちらかを実行する前に、自分で用意したNSF/VGMダンプから
[`scores/arrangements/README.md`](scores/arrangements/README.md#native-source-reproduction)
（[日本語版](scores/arrangements/README_ja.md)）のコマンドで再生成してください。

録音そのものはコミットしません。録音はVercel Blobのストア（決定40）に、内容を名前に含むサイトパスで保存され、`arrangement-data/report.json`と`lab-data/report.json`の2つのレポートがそのマニフェストです。`pnpm arrangements:eval`または`pnpm --filter chipvoice-web publish:lab`の後、新しい録音をアップロードします。

```bash
vercel env pull .env.local --environment=development   # リポジトリのルートで一度だけ
pnpm audio:push
```

ストアにない録音をレポートが指していると、CIが失敗します（`pnpm audio:check`）。サイトは録音をストアから読みます。`pnpm audio:pull`は検証済みのコピーを`apps/web/public`に置くので、オフラインでも作業できます。ローカルのコピーがあれば、そちらが先に配信されます。

<a id="pull-requests"></a>
## プルリクエスト

- タイトルは種別接頭辞なしの平文の一文（`fix: ...`や`feat: ...`ではなく、例えば「Put the Authorize button where the reviewer is looking」）。Squashマージはその一文をコミットタイトルとして残します。
- 説明には何を変えたか、そしてそれ以上に理由を書きます。どのテストがその変更をカバーするか、依拠または新設する決定があれば触れてください。
- `main`の`git log`が参考にすべき慣例です。

<a id="decisions"></a>
## 決定記録

プロジェクトレベルの決定（アーキテクチャの選択、方針、慣例。日常的なバグ修正や機能追加は含みません）は、[`docs/DECISIONS.md`](docs/DECISIONS.md)と[`docs/DECISIONS_ja.md`](docs/DECISIONS_ja.md)の末尾に`## NN. Title (YYYY-MM-DD)`として追記し、短い宣言文の後に**Why.**と**What changes.**の段落を続けます。日本語版では英語見出しのスラッグに一致する`<a id="...">`アンカーを付けます。既存のエントリの形式に従ってください。

<a id="writing"></a>
## 執筆について

- リポジトリ内はすべて英語です：コード、コメント、ドキュメント、コミットメッセージ。すべてのMarkdownファイルは`<name>_ja.md`として同じ変更の中で同期させます。`python3 docs/check-translations.py`は何も報告しない状態を保ってください。
- リポジトリのどこにもemダッシュ・enダッシュ（`—`、`–`）を書かないでください。ダッシュで区切りたい箇所は、前後にスペースを入れた通常のハイフン` - `を使います。
- UI文字列はi18n辞書（`apps/web/src/i18n`）を経由し、新しい文字列には必ず日本語訳を付けます。
- 周囲のコードに合わせます：コメントの密度、命名、慣用句、フォーマット。
