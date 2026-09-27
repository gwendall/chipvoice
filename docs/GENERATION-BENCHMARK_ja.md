<a id="generation-benchmark"></a>
# 生成ベンチマーク

<p align="center"><a href="GENERATION-BENCHMARK.md">English</a> &bull; <a href="GENERATION-BENCHMARK_ja.md">日本語</a></p>

[配信順序](GENERATIVE-COMPOSITION_ja.md#delivery-order)のGEN-01とGEN-05：「コンソールごとに約50のプロンプトによるベンチマーク。レイテンシ、コスト、試聴の評価表を含め、モデルを変えるたびに再実行する」。本書はハーネスの仕組み、実行方法、記録する各列の意味、そしてこれまでに試みた1回のサンプル実行の状況を説明します。

<a id="what-it-drives"></a>
## 駆動する経路

`pnpm gen-bench`（`apps/web/scripts/gen-bench.mjs`）はサーバーが使うのと同じ生成経路を駆動します。[`apps/web/src/lib/composition/`](../apps/web/src/lib/composition/)の`compositionInstructions`/`compositionSchema`/`compositionProject`と`openAIModel`（`model.ts`、`score.ts`）を無改変で使い、続けて`chipvoice`パッケージの`renderProject`/`toWav`（`project-render-worker.ts`が本番で使うのと同じレンダー経路）を実行します。[GEN-03](GENERATIVE-COMPOSITION_ja.md#whole-song-checks-gen-03)の曲全体検査（`checks.ts`）をデコード済みレンダーに対して実行し、費用は`apps/web/src/lib/composition/admission.ts`の`priceUsage`で算出します。月間予算が1か月分の行を合計するのと同じ関数なので、ベンチマークの1行の費用が予算の計算からずれることはありません。

<a id="the-prompt-set"></a>
## プロンプト集

`apps/web/scripts/gen-bench-prompts.json`はコミット済みの250件のオリジナルプロンプト集で、コンソール（`2a03`、`dmg`、`md`、`snes`、`c64`）ごとに50件、ジャンル、雰囲気、テンポ、長さ（10〜90秒、依頼スキーマの上限）、構成を多様化し、コンソール固有の楽器編成のヒントを添えています。[決定39](DECISIONS_ja.md#39-generation-opens-as-a-closed-beta-familiar-game-melodies-stay-only-while-it-is-free-2026-09-27)により生成は既知の旋律の再現を断りますが、この規則はベンチマーク自身のプロンプトにも適用されるため、既知のゲームや映画のテーマを名指し、引用、描写するものは1件もありません。`validatePromptSet`（`apps/web/src/lib/composition/bench.ts`）が毎回の実行でプロンプト集を検査します。重複ID、未知のコンソール、依頼スキーマの上限を外れた長さ・プロンプト文字数、コンソールごとのプロンプト不足、そしてよく知られた作品名・作曲家名の禁止リストを単語境界で照合し、「contrasting」のような一般的な単語が「contra」を含むという理由で誤検出されないようにします。

<a id="running-it"></a>
## 実行方法

```bash
pnpm gen-bench --mock                       # 250件全件、ネットワークなし・費用なし
pnpm gen-bench --mock --sample              # コンソールごと1件、模擬
pnpm gen-bench --sample                     # コンソールごと1件の実プロンプト（5回、OPENAI_API_KEYが必要）
pnpm gen-bench --console md,snes --limit 10 # 絞り込んだ一部
pnpm gen-bench --confirm-paid-run           # 250件全件の実行（オーナーの承認が必要。下記参照）
```

| フラグ | 効果 |
| --- | --- |
| `--mock` | `model.ts`が想定するOpenAI Responses SSEプロトコルを話すループバックHTTPサーバー（`127.0.0.1`限定）に対して実行します。外部へのネットワーク呼び出しは一切発生せず、費用もかかりません。 |
| `--console a,b` | 指定したコンソールIDだけに絞ります。 |
| `--sample` | 全件ではなく、選択したコンソールごとに1件（ファイル順）だけを使います。 |
| `--limit n` | コンソール絞り込みと`--sample`の後、先頭`n`件だけを残します。 |
| `--prompts path` | 別のプロンプト集ファイルを使います（コミット済みの集合を編集せずに別案を試す用途）。 |
| `--out path` | 既定の`.artifacts/gen-bench/<run-id>/`ではなく、指定したディレクトリーに出力します。 |
| `--confirm-paid-run` | 1回の実行で実（模擬でない）モデル呼び出しを5回より多く行うために必要です。 |

模擬でない実行は、サーバーと全く同じように`OPENAI_API_KEY`（および`model.ts`が読む他の`OPENAI_*`変数）を環境から読み、他の鍵は一切試しません。鍵をどこかへコピーするのではなく、鍵を持つチェックアウトを`node --env-file=path/to/.env.local apps/web/scripts/gen-bench.mjs ...`のように指定してください。

<a id="the-spending-guard"></a>
## 支出の防止策

いかなる資格情報を読む前にも、いかなる呼び出しをする前にも、要求された実行の見積もり費用を表示します（`estimateRunCost`：`.artifacts/gen-bench/`配下の直近の実実行の`summary.json`から算出した1呼び出しあたりの実測平均費用、または直近の実実行が存在しない場合は[決定42](DECISIONS_ja.md#42-the-server-enforces-the-closed-beta-invitations-and-a-monthly-budget-2026-09-27)の本番実測平均であるフォールバック値0.28 USD）。要求が全プロンプト集より少ない場合は、同じ1呼び出しあたりの単価で250件全件を実行した場合の見積もり費用も表示します。`--confirm-paid-run`なしに実モデル呼び出しを5回より多く要求すると、資格情報を読むことも何かを送信することもなく、開始前に拒否します。`--confirm-paid-run`はその呼び出し回数の防止策だけを解除します。鍵が欠けている、または鍵が拒否された場合は実行を即座に停止し、別の鍵を探すことはありません。

<a id="what-each-run-records"></a>
## 各実行が記録するもの

各プロンプトは`results.json`に1件の記録を残します（`summary.json`に集計されます）。

| フィールド | 意味 |
| --- | --- |
| `model` | 応答が報告したモデルID。 |
| `usage` | Responses APIが返した`input_tokens`、`output_tokens`、キャッシュ済み入力トークン数をそのまま。 |
| `costUsd` | `usage`を`admission.ts`の`priceUsage`で価格化したもの。月間予算と同じ計算式です。 |
| `timings.modelMs` | モデル呼び出しだけの経過時間。 |
| `timings.renderMs` | 全曲レンダーだけの経過時間（`renderProject` + `toWav`）。 |
| `timings.totalMs` | プロンプト全体の経過時間。モデル呼び出しから書き出したWAVまで。 |
| `findings` | このレンダーに対するGEN-03の曲全体検査の所見（`clipping`、`level_jump`、`silence_gap`、ループしない場合の`abrupt_ending`、ループする場合の`loop_level_jump`/`loop_click`、`duration_mismatch`）。検査は決して却下せず、所見は記録されるだけです。 |
| `audio` | レンダーしたWAVの実行ディレクトリー下でのパス、秒数、SHA-256。試聴評価表に使います。 |

`summary.json`/`summary.md`はコンソールごとに集計します。成功数、各検査が適用される対象の中での通過率、モデル・レンダー・合計それぞれのレイテンシp50/p90、生成1件あたりの平均費用です。`listening-grid.csv`は成功した曲を音声パスとともに列挙し、聞きながら人が埋める5つの空欄を用意します。musicality（音楽性）、fit to prompt（依頼への適合）、console idiom（コンソールらしさ）、defects（欠陥）、notes（メモ）です。

レンダーした音声は`.artifacts/gen-bench/<run-id>/audio/`にWAVとして書き出されます。`.artifacts/`はすでにGit管理対象外なので、実行の成果物は一切コミットされません。

<a id="mock-mode-and-ci-coverage"></a>
## 模擬モードとCIでの検証

`apps/web/test-gen-bench.mjs`は`--mock`でハーネスを一気通貫で実行し、書き出された`results.json`/`summary.json`/`summary.md`/`listening-grid.csv`とレンダーしたWAVのヘッダー・長さを検証します。続けて支出の防止策を実際のサブプロセスとして実行し（周囲の環境に関わらず`OPENAI_API_KEY`を明示的に空にして）、資格情報を読む前に5回を超える実呼び出しを拒否すること、`--confirm-paid-run`がその防止策だけを解除し、迷い込んだ鍵を見つけたり使ったりしないことを確認し、さらに`apps/web/src/lib/composition/bench.ts`の純粋関数（`selectPrompts`、`guardPaidRun`、`estimateRunCost`、GPT-6 Astraの定価に対する`costFromUsage`、`summarize`、`percentile`、`formatSummaryMarkdown`、`listeningGridCsv`）を直接単体テストし、コミット済みプロンプト集を検証します。`apps/web/test-local.mjs`のスクリプト一覧に`test-whole-song-checks.mjs`の隣として組み込まれているため、Webスイートの一部としてCIで実行されます。1件の変更だけをローカルで検証する場合は、フルブラウザースイートを実行しないという本リポジトリの方針どおり、`apps/web`から`CHIPVOICE_TEST_ONLY=test-gen-bench.mjs node test-local.mjs`を使ってください。

<a id="the-sample-run"></a>
## サンプル実行

チケットは、全件実行の前にコンソールごと1件の実生成（合計5回の実呼び出し）を行い、実測の費用とレイテンシを測定し、プロジェクトオーナーが承認するために250件全件の費用を見積もることを求めています。このサンプルは、指示どおりメインチェックアウトの環境ファイルから`node --env-file=/Users/gwendall/Code/chipvoice/.env.local apps/web/scripts/gen-bench.mjs --sample`で試みました。そのファイルに`OPENAI_API_KEY`は存在せず（`BLOB_READ_WRITE_TOKEN`と`VERCEL_OIDC_TOKEN`のみ）、実行は`Cannot start a real run: Set OPENAI_API_KEY on the server to enable composition`で直ちに停止し、何も支出しませんでした。チケットの指示どおり、別の鍵は試さず、別の場所も探しませんでした。

ハーネス自体は上記の`--mock`と`apps/web/test-gen-bench.mjs`によって一気通貫で検証済みで、プロンプトからモデル呼び出し、レンダー、検査、費用算出までの経路は確認できていますが、実測のコンソールごとのレイテンシや費用の数値はまだ存在しません。250件全件の実行費用は、決定42の0.28 USD/生成というフォールバック平均（これに代わる実測runが存在しないため）で**70.00 USD**と見積もられ、ハーネスは実実行の前に同じ見積もりを表示します。このチェックアウトで`OPENAI_API_KEY`が使えるようになったら、`pnpm gen-bench --sample`で実際の5件サンプルを取得し、全件実行を承認する前に、実測のコンソールごとのレイテンシ、費用、検査通過率でこの節を更新してください。

<a id="when-to-rerun"></a>
## 再実行のタイミング

モデルを変更するたびに再実行してください。`OPENAI_MODEL`の変更、`OPENAI_REASONING_EFFORT`の変更、`model.ts`のアダプター変更、`score.ts`のプロンプト・スキーマ変更のいずれもです。バックログの「必要に応じてのみ拡大する」のとおり、現行のプロンプト集が役に立たなくなったときだけベンチマークの件数を拡大してください。
