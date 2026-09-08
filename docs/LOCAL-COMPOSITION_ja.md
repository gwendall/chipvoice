<a id="local-prompt-composition"></a>
# ローカルでのプロンプト作曲

<p align="center"><a href="LOCAL-COMPOSITION.md">English</a> &bull; <a href="LOCAL-COMPOSITION_ja.md">日本語</a></p>

プロンプトを1つのモデルに送り、音符と楽器を受け取ります。Chipvoiceは検証後、通常の`MusicProject`（既定は非公開）を自分のアーティストに保存し、既存の全曲WAV/MP3レンダージョブを利用します。曲のページ、保存先、エディター、共有方法は手動作曲と共通です。プロンプト本文は所有者だけが参照できます。閲覧可能な曲には作成方法とモデル名が表示されます。プロンプト生成、直接作曲、プロンプト曲からのリミックスを区別します。これはChipvoice上の操作履歴であり、外部AIを使わずに作曲した証明ではありません。

<a id="configuration"></a>
## 設定

[apps/web/.env.example](../apps/web/.env.example)の設定を`apps/web/.env.local`へコピーし、既存の設定を残してください。`OPENAI_API_KEY`はローカルで設定します。このファイルはGitの対象外です。認証情報に`NEXT_PUBLIC_`変数を使わないでください。

```dotenv
COMPOSITION_PROVIDER=openai
OPENAI_API_KEY=your-private-key
OPENAI_MODEL=gpt-6-astra
OPENAI_REASONING_EFFORT=medium
OPENAI_MAX_OUTPUT_TOKENS=24000
COMPOSITION_DAILY_LIMIT=10
```

アダプターは[構造化出力付きOpenAI Responses API](https://developers.openai.com/api/docs/guides/structured-outputs)を直接利用し、初期モデルは[GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)です。追加SDKは不要です。キーがなければ新規リクエストは`503 generation_disabled`になります。キーを削除すると新規受付は停止しますが、既存リクエストの参照は可能です。

`OPENAI_MODEL`で互換モデルを変更できます。任意の`OPENAI_REASONING_EFFORT`はそのモデルに対応する値にします。`OPENAI_BASE_URL`ではサーバー設定のResponses互換エンドポイントを指定でき、既定はOpenAIへの直接接続です。実装済みはOpenAIアダプターだけです。別プロバイダーは[model.ts](../apps/web/src/lib/composition/model.ts)の小さな`CompositionModel.generate`を実装します。保存とレンダリングは共通です。リクエスト本文からキー、モデル、接続先は変更できません。

<a id="use-the-existing-account"></a>
## 既存アカウントを利用する

所有者の認証情報かログイン済みセッションで作曲を依頼できます。エージェントは既存のアーティスト権限に**`generate`、`projects:write`、`render`**が必要です。生成後のプロジェクト・音声エンドポイントの参照には`projects:read`も必要です。既存の権限は自動追加されません。`/skill.md`の通常の認証手順を使います。

```bash
curl http://localhost:3010/api/v1/generations \
  -H "Authorization: Bearer $CHIPVOICE_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: space-theme-v1' \
  -d '{"prompt":"An original space theme, a clear melody with a contrasting bridge and restrained percussion","target":"md","durationSeconds":60,"loop":false}'
```

対応する`target`は`/api/v1/capabilities`で確認します。モデルも同じ生成済み機能カタログを参照します。長さは10〜90秒の整数で、既定は60秒です。プロンプトは前後の空白除去後、JavaScriptの文字列単位で1〜2000です。`loop`は作曲上の意図であり、継ぎ目のないループの検証保証ではありません。所有者は所有する`profileId`を選べます。エージェントは認可されたアーティストを使います。任意の`visibility`は`private`（既定）、`unlisted`、`public`です。

ライブ更新には同じ認証情報で`GET /api/v1/generations/{id}/events`をストリーム受信します（`curl -N`）。約20秒で閉じたら同じURLに再接続し、作曲リクエストは再送しません。[SSEの契約](GENERATIVE-COMPOSITION_ja.md#implemented-contract)を参照してください。従来どおり、応答の`id`を使い、同じ認証情報で`GET /api/v1/generations/{id}`を`Retry-After: 2`に従ってポーリングします。状態は`queued`、`composing`、`validating`、`saving`、`rendering`、`ready`へ進み、失敗または中止は`failed`/`cancelled`です。同じURLへ`DELETE`を送ると未完了処理を中止できます。

完了応答には`projectId`、`renderJobId`、通常の公開情報`project`、既存音声ジョブ`render`、`evaluation`、モデルの`usage`が入ります。ログインして`/p/{projectId}`を開けます。音声は既存の認証付き`/api/v1/jobs/{renderJobId}/audio?format=mp3`または`format=wav`から取得します。エージェントは取得したファイルをチャット機能で添付できます。URLに認証情報を含めないでください。編集は通常の流れを使います。既存曲の公開は`PATCH /api/v1/projects/{id}`へ`{"visibility":"public"}`を送ります。作者、曲ID、レンダリング済み音声を保持します。

同じ入力と冪等キーで再送すると、失敗済みを含む既存ジョブが返り、モデルは再実行されません。同じキーで入力を変えると409です。意図的な再試行は新しいキーを使います。処理は既存のサーバーコールバックと認証付きポーリングで進みます。クライアントを閉じると後続処理が再ポーリングまで遅れる場合があります。独立した永続スケジューラーではありません。

<a id="browser-and-one-command-agent-flow"></a>
## ブラウザーと1コマンドのエージェント操作

`/create`で「プロンプトから作曲」を開き、アーティストと長さを選んで生成します。再読み込み後も進行状況を復元でき、中止と保存曲・ライブラリーへのリンクは同じAPIを利用します。編集中の下書きは維持されます。共有するときは曲ページで公開範囲を変更します。

`/skill.md`の所有者認可後、依存パッケージ不要のクライアントを取得します。

```bash
curl -fsS https://chipvoice.dev/skill/compose.mjs -o compose.mjs
node compose.mjs --prompt "An original space theme with restrained percussion" --target md --seconds 60 --visibility public --out space-theme
# または: node compose.mjs --project project.json --visibility public --out my-score
```

先に環境変数`CHIPVOICE_API_KEY`を設定します。クライアントは全曲レンダリングを待ち、`song.mp3`、`project.json`、`result.json`を保存します。そのMP3をチャットツールで添付できます。同じ出力ディレクトリーなら安全に再試行できます。意図的に別の曲を作る場合は別ディレクトリーを指定します。公開共有には名前付きアーティストが必要です。

<a id="bounds-and-honest-evaluation"></a>
## 制限と評価の範囲

初版は**モデル呼び出し1回、自動修正なし**です。構造化JSONだけを受け取り、生成コードを実行しません。全楽譜を`allowLoss:false`でコンパイルし、対応ボイスを超える曲は音符を黙って落とさず失敗します。ミックスには既存の自動調整を使います。

既定の受付上限は所有者ごとにUTCで1日10件、未完了1件、全体の同時作曲ワーカー2件です。失敗・中止も日次上限に数えます。出力は24,000トークン（最大64,000まで設定可）、イベントストリーム8 MB、音符20,000個、90秒が上限です。モデルの期限は210秒、作曲ワーカーは240秒、放棄されたワーカーの失敗判定は270秒です。生成全体は600秒で期限切れになります。コンパクトなモデルのパターンを決定的に通常の音符へ展開し、公開プロジェクト形式は変更しません。既存レンダラーのCPU・保存制限も適用します。これらは件数やサイズの制限であり、**金額上限ではありません**。共有環境で有効にする前にプロバイダー側の予算を設定してください。

既存評価は**割り当て全体を検証しますが、音響評価は冒頭2秒のみ**です。その後、既存レンダラーが全曲を生成します。`ready`は有効なプロジェクトと全曲の出力があることを示し、趣味、依頼への適合、ループの継ぎ目、全曲の音響品質を認証するものではありません。モデルの作曲が良くない場合や制約を超える場合があり、成功保証はありません。広い音楽評価はこの小さな統合とは別に行います。

中止と権限失効は後続処理の前に確認します。保存後の中止では通常の非公開下書きが残ることがあります。送信済みのモデルリクエストは中止しても課金される場合があります。結果が不明な中断呼び出しは自動再送せず失敗扱いにします。

<a id="reproduce-the-tests"></a>
## テストの再現

```bash
pnpm --filter chipvoice-web build
cd apps/web
node test-generation-stream.mjs
node test-generation.mjs
```

E2Eは本物のローカルNextサーバーと使い捨てDB、模擬HTTPモデルを使います。構造化リクエスト、同時再送の冪等性、認証、権限失効、上限、中止、エラー、使用中ワーカー、非公開保存、全WAV/MP3取得、ブラウザー再生を検証します。デスクトップ・モバイル画像とレポートはリポジトリ直下の`.artifacts/prompt-composition/`です。モデル料金は発生せず、Astraの音楽品質ではなく統合を検証します。

キーや課金なしで同じ全曲測定スクリプトを試すには、`pnpm --filter chipvoice-web eval:composition --fixture`を実行します。出力先は`fixture-*`で、模擬プロバイダーであることを明記します。

キー設定後、実モデルを明示的に試す場合：

```bash
pnpm --filter chipvoice-web eval:composition
# 任意指定：プロンプト、秒数、ターゲット
pnpm --filter chipvoice-web eval:composition 'An original calm theme with a developed ending' 30 snes
```

各実行は設定済みモデルへ有料リクエストを1回送り、プロジェクトと全WAV/MP3を`.artifacts/prompt-composition/live-*/`へ保存します。全PCMの長さ・ピーク・RMS・クリッピング・毎秒の音声活動、SSEの進捗と遅延、MP3の復号、モバイルとデスクトップの非公開曲ページを検証します。使い捨てローカルDBを使い、本番へテスト曲を公開しません。信号検証と試聴はレポート上も区別されます。音楽の判断には保存した音声を試聴してください。CIは模擬プロバイダーだけを使います。
