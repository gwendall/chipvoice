<a id="generation-benchmark"></a>
# 生成ベンチマーク

<p align="center"><a href="GENERATION-BENCHMARK.md">English</a> &bull; <a href="GENERATION-BENCHMARK_ja.md">日本語</a></p>

[配信順序](GENERATIVE-COMPOSITION_ja.md#delivery-order)のGEN-01とGEN-05：「コンソールごとに約50のプロンプトによるベンチマーク。レイテンシ、コスト、試聴の評価表を含め、モデルを変えるたびに再実行する」。本書はハーネスの仕組み、実行方法、記録する各列の意味、そして最初の実サンプル実行で測定した結果を説明します。

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
pnpm gen-bench --confirm-paid-run --concurrency 4 --max-cost-usd 70
                                            # 250件全件の実行（オーナーの承認が必要。下記参照）
pnpm gen-bench --confirm-paid-run --resume .artifacts/gen-bench/<run-id>
                                            # 停止した実行を、レンダー済みの分を再度支払わずに続行
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
| `--concurrency n` | 最大`n`件のプロンプトを同時に実行します（1〜8、既定は1）。記録は引き続きファイル順に書き出します。同時実行中に測ったレンダー時間はマシンのコアを共有した値で、モデル呼び出しのレイテンシはプロバイダー側の値です。 |
| `--max-cost-usd n` | あと1回の呼び出しでこの実行の支出が`n` USDを超えうる時点で、新しいプロンプトの払い出しを止めます。実行中の呼び出しは、その実行のそれまでの平均費用で数えます（usageのない失敗した呼び出しも同じ単価で数えます）。その後、レンダーできた分で集計を書き出し、再開方法を表示します。 |
| `--resume dir` | `dir`の実行を`results.jsonl`から続行します。レンダー済みの記録は保持してそのプロンプトは再送せず、失敗したものは再試行し、防止策と見積もりはこれから送るプロンプトだけを数えます。模擬の実行で実実行を再開することも、その逆もできません。 |

模擬でない実行は、サーバーと全く同じように`OPENAI_API_KEY`（および`model.ts`が読む他の`OPENAI_*`変数）を環境から読み、他の鍵は一切試しません。スクリプトは`apps/web/.env.local`が存在すればそれ自身で読み込み（すでに設定済みの変数は上書きしません）、既定ではWebアプリ自身のローカル設定（その鍵、`OPENAI_MODEL`、`OPENAI_REASONING_EFFORT`、`OPENAI_MAX_OUTPUT_TOKENS`）で実行します。別のファイルを使う場合は、鍵をどこかへコピーするのではなく、`node --env-file=path/to/.env.local apps/web/scripts/gen-bench.mjs ...`のように指定してください。

プロンプトはコンソールを順番に1件ずつ送ります（2a03、dmg、md、snes、c64、次に各コンソールの2件目、以下同様。`bench.ts`の`interleaveByConsole`）。そのため、支出上限や中断で途中停止した実行でも、すべてのコンソールをほぼ均等にカバーします。

<a id="the-spending-guard"></a>
## 支出の防止策

いかなる資格情報を読む前にも、いかなる呼び出しをする前にも、要求された実行の見積もり費用を表示します（`estimateRunCost`：`.artifacts/gen-bench/`配下の直近の実実行の`summary.json`から算出した1呼び出しあたりの実測平均費用、または直近の実実行が存在しない場合は[決定42](DECISIONS_ja.md#42-the-server-enforces-the-closed-beta-invitations-and-a-monthly-budget-2026-09-27)の本番実測平均であるフォールバック値0.28 USD）。要求が全プロンプト集より少ない場合は、同じ1呼び出しあたりの単価で250件全件を実行した場合の見積もり費用も表示します。`--confirm-paid-run`なしに実モデル呼び出しを5回より多く要求すると、資格情報を読むことも何かを送信することもなく、開始前に拒否します。`--confirm-paid-run`はその呼び出し回数の防止策だけを解除します。鍵が欠けている、または鍵が拒否された場合は実行を即座に停止し、別の鍵を探すことはありません。

<a id="what-each-run-records"></a>
## 各実行が記録するもの

各プロンプトは1件の記録を残します。完了した時点で`results.jsonl`に追記され（クラッシュしても支払い済みの生成はすべて残り、`--resume`がそれを読み戻します）、最後にファイル順で`results.json`に書き出され、`summary.json`に集計されます。

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
| `melody` | モデルの出力に対する既知旋律ゲートの最良一致（`similarity`、`referenceId`、`part`）。`jobs.ts`が本番で記録するのと全く同じく`knownMelodySimilarity`で算出します（[決定56](DECISIONS_ja.md#56-prompt-moderation-and-a-melodic-similarity-gate-refuse-a-known-work-on-the-input-and-the-output-2026-09-29)）。比較できる旋律パートがなかった場合は`null`です。しきい値未満も含めすべての生成で記録します。このベンチマークが、`KNOWN_MELODY_THRESHOLD`を再較正するための実際の陰性集合だからです。 |
| `project` | 生成されたMusicProjectの実行ディレクトリー下でのパス（`projects/<id>.json`）とSHA-256。同じ作曲に対して後から別の測定を、再度支払わずにやり直せます。 |

`summary.json`/`summary.md`はコンソールごとに集計します。成功数、各検査が適用される対象の中での通過率、モデル・レンダー・合計それぞれのレイテンシp50/p90、生成1件あたりの平均費用、既知旋律の類似度のp90と最大値です。実行全体の既知旋律の節は、レンダーされたすべての生成に対する類似度のp50/p90/p99/最大値、しきい値以上の件数（本番なら有料呼び出しの後に拒否する生成）、そして最も近い5件とそれぞれが一致した参照を示します。`listening-grid.csv`は成功した曲を音声パスとともに列挙し、聞きながら人が埋める5つの空欄を用意します。musicality（音楽性）、fit to prompt（依頼への適合）、console idiom（コンソールらしさ）、defects（欠陥）、notes（メモ）です。

レンダーした音声は`.artifacts/gen-bench/<run-id>/audio/`にWAVとして、生成された各プロジェクトはその隣の`projects/`に書き出されます。`.artifacts/`はすでにGit管理対象外なので、実行の成果物は一切コミットされません。

<a id="mock-mode-and-ci-coverage"></a>
## 模擬モードとCIでの検証

`apps/web/test-gen-bench.mjs`は`--mock`でハーネスを一気通貫で実行し、書き出された`results.json`/`results.jsonl`/`summary.json`/`summary.md`/`listening-grid.csv`、レンダーしたWAVのヘッダー・長さ、各記録の既知旋律一致と保存されたプロジェクト、`--resume`がレンダー済みの記録を再送しないこと、`--concurrency`がファイル順を保つこと、`--max-cost-usd`が上限の手前で止まることを検証します。続けて支出の防止策を実際のサブプロセスとして実行し（周囲の環境に関わらず`OPENAI_API_KEY`を明示的に空にして）、資格情報を読む前に5回を超える実呼び出しを拒否すること、`--confirm-paid-run`がその防止策だけを解除し、迷い込んだ鍵を見つけたり使ったりしないことを確認し、さらに`apps/web/src/lib/composition/bench.ts`の純粋関数（`selectPrompts`、`guardPaidRun`、`estimateRunCost`、GPT-6 Astraの定価に対する`costFromUsage`、`summarize`、`summarizeMelody`、`interleaveByConsole`、`budgetAllows`、`percentile`、`formatSummaryMarkdown`、`listeningGridCsv`）を直接単体テストし、コミット済みプロンプト集を検証します。`apps/web/test-local.mjs`のスクリプト一覧に`test-whole-song-checks.mjs`の隣として組み込まれているため、Webスイートの一部としてCIで実行されます。1件の変更だけをローカルで検証する場合は、フルブラウザースイートを実行しないという本リポジトリの方針どおり、`apps/web`から`CHIPVOICE_TEST_ONLY=test-gen-bench.mjs node test-local.mjs`を使ってください。

<a id="the-sample-run"></a>
## サンプル実行

チケットは、全件実行の前にコンソールごと1件の実生成（合計5回の実呼び出し）を行い、実測の費用とレイテンシを測定し、プロジェクトオーナーが承認するために250件全件の費用を見積もることを求めています。2026-09-29の最初の試みでは、指定した環境ファイルに`OPENAI_API_KEY`がなく、呼び出しの前に停止し、何も支出しませんでした。サンプルは2026-09-30に`node --env-file=apps/web/.env.local apps/web/scripts/gen-bench.mjs --sample`（Webアプリ自身のローカル設定、モデル`gpt-6-astra`）で実行し、5件すべてがレンダーされました。

| プロンプト | 長さ | 費用 | モデル呼び出し | レンダー | 入力／出力トークン | 所見 |
| --- | --- | --- | --- | --- | --- | --- |
| `2a03-01` | 15s | $0.2302 | 75.9s | 0.9s | 3,277 / 3,949 | `abrupt_ending` |
| `dmg-01` | 12s | $0.2110 | 58.5s | 1.2s | 3,583 / 3,504 | `abrupt_ending` |
| `md-01` | 15s | $0.2833 | 75.3s | 4.5s | 8,600 / 3,946 | `abrupt_ending` |
| `snes-01` | 17s | $0.2275 | 65.7s | 0.6s | 6,583 / 3,234 | `abrupt_ending` |
| `c64-01` | 12s | $0.1516 | 49.9s | 0.8s | 3,897 / 2,253 | `abrupt_ending` |

実測平均は生成1件あたり$0.2207で、250件全件では$55.19と見積もられ、フォールバック単価による70 USDを下回ります。この見積もりは予測ではなく下限です。サンプルの5件は12〜17秒を求めていますが、全件の平均は45秒で、呼び出しの価格の大半は出力トークンです。そのため全件実行は見積もりに任せず、承認額である`--max-cost-usd 70`を付けて開始します。

サンプルのレンダーはすべて`duration_mismatch`、`clipping`、`level_jump`、`silence_gap`を通過し、すべて`abrupt_ending`で不合格でした。最後の0.5秒が直前3秒のピークより2.1〜5.8 dBしか下がっておらず、検査の上限-36 dBFSに対して-29.4〜-33.2 dBFSです。モデルはどのコンソールでも、終わるのではなく止まる音楽を書いています。それがどこまで一般的かは全件実行で測ります。

<a id="the-full-run"></a>
## 全件実行

承認された実行は2026-09-30に`node --env-file=<メインのチェックアウトのapps/web/.env.local> apps/web/scripts/gen-bench.mjs --confirm-paid-run --concurrency 4 --max-cost-usd 70 --out .artifacts/gen-bench/full-2026-09-30`で開始しました。全件は完了していません。188件の生成がレンダーされた時点でOpenAIアカウントのプリペイド残高が尽き、以降の呼び出しはすべてストリーム中の`insufficient_quota`エラーとして返りました。`model.ts`はこれを`model_error`（「The composition provider interrupted the response」）として報告します。この形で43件が失敗し（最初は`dmg-39`）、実行は手動で停止しました。インターリーブ順の最後の18件のプロンプトは送信されていません。残る1件の失敗はモデル自身によるものです。`2a03-03`は2A03のボイス数を超える同時発音を書き、レンダーがそれを拒否しました（「Arrangement exceeds hardware voices」）。支払い済みの呼び出しで、聴けるものは何も残りません。アカウントに残高が戻れば、同じディレクトリで`--resume`を実行すると残りの62件（失敗44件、未送信18件）を送信します。

| コンソール | レンダー / 送信 | 平均費用 | モデル呼び出し p50 / p90 | レンダー p50 / p90 | `abrupt_ending`合格 | `loop_click`合格 | `loop_level_jump`合格 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `2a03` | 37 / 46 | $0.2547 | 89.7s / 106.4s | 2.5s / 5.0s | 10 / 23 | 13 / 14 | 14 / 14 |
| `dmg` | 38 / 47 | $0.2419 | 78.0s / 112.2s | 3.8s / 8.6s | 10 / 23 | 15 / 15 | 14 / 15 |
| `md` | 38 / 47 | $0.2992 | 84.8s / 104.9s | 12.6s / 24.3s | 10 / 23 | 13 / 15 | 15 / 15 |
| `snes` | 38 / 47 | $0.2794 | 85.3s / 110.3s | 1.0s / 2.4s | 11 / 23 | 15 / 15 | 14 / 15 |
| `c64` | 37 / 45 | $0.2547 | 90.2s / 109.7s | 2.9s / 5.9s | 13 / 23 | 14 / 14 | 13 / 14 |

`abrupt_ending`はループでない115件に、ループの検査はループである73件に適用されます。`duration_mismatch`、`clipping`、`level_jump`は188件すべてで合格し、`silence_gap`は1件（`dmg`）を除いてすべて合格しました。

- **費用。** 価格の付いた189回の呼び出し（レンダーされた188件と`2a03-03`）で$50.29でした。レンダーされた生成1件あたりの平均は$0.2661（$0.0936〜$0.4530）で、サンプルの$0.2207より21%高く、想定どおりサンプルは下限でした。全件の平均の長さは43.6秒で、サンプルは12〜17秒です。この平均なら全件で約$66.5となり、承認された70 USDに収まります。
- **レイテンシ。** 大半はモデル呼び出しです。p50で86.9秒、p90で109.6秒（最大153.4秒）に対し、レンダーはp50で1〜13秒です（レンダーが最も遅いのは`md`）。全体ではp50で92.7秒、p90で118.4秒です。
- **終わり方。** ループでない115件のうち61件（53%）が`abrupt_ending`で不合格で、最後の0.5秒は-35.8〜-26.1 dBFSです。サンプルの5件中5件は実態より強く出ていましたが、それでもモデルはどのコンソールでも、半分以上の場合に終わるのではなく止まります。GEN-04の修復呼び出しが待っていた、実測された失敗がこれです。
- **既知の旋律。** この実行は、決定56が待っていた陰性集合です。出荷時のゲート（しきい値0.40）で採点すると、188件中59件が有料呼び出しの後で拒否されていました。その理由と変更点は決定56の再較正の追補にあります。修正した参照と0.65のしきい値では、拒否される生成はありません。p50 0.313、p90 0.385、最大0.571です。188件の音高付きノートは`apps/web/test/melody-negatives-gen-bench.json.gz`としてコミットされており、`test-known-melody-similarity.mjs`がCIで採点します。

<a id="when-to-rerun"></a>
## 再実行のタイミング

モデルを変更するたびに再実行してください。`OPENAI_MODEL`の変更、`OPENAI_REASONING_EFFORT`の変更、`model.ts`のアダプター変更、`score.ts`のプロンプト・スキーマ変更のいずれもです。バックログの「必要に応じてのみ拡大する」のとおり、現行のプロンプト集が役に立たなくなったときだけベンチマークの件数を拡大してください。
