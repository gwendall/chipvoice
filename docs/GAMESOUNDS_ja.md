<a id="gamesoundsai"></a>
# gamesounds.ai

<p align="center"><a href="GAMESOUNDS.md">English</a> &bull; <a href="GAMESOUNDS_ja.md">日本語</a></p>

パックではなくイベント単位でファイルされたゲーム効果音バンクである：エージェントは`"jump"`や`"combat/hit/heavy"`をライセンス済みでラウドネスの揃った音に解決し、アカウントも鍵も無く、人が先に候補を試聴することもなく、そのまま再生できる。フェーズ1はカタログ、サイト、REST API、CLI、ランタイムライブラリを出荷する。これが（gamesounds.aiを提供する）`apps/sounds`という2つ目のアプリと`gamesounds`という2つ目のパッケージであり、chipvoice.devに追加したページではない理由は[決定48](DECISIONS.md)を、フェーズ1が意図的に含めていないものは[バックログ](BACKLOG.md)を参照。

<a id="the-data-model"></a>
## データモデル

`packages/gamesounds/src/types.ts`が形を定義する唯一の場所である - 自身は何もインポートしないプレーンなTypeScriptであり、サイトのサーバーコードとインストールされた`gamesounds`パッケージの両方が同じ型を読む。`Sound`は1つの`Category`（タクソノミーのid、最大2階層、例：`"movement/jump"`）に答え、`style`（10ある側面の1つ：`8bit`、`16bit`、`arcade`、`cartoon`、`realistic`、`scifi`、`fantasy`、`horror`、`cozy`、`minimal-ui`）を持ち、ライセンスとその出所をデータとして運び、同じアイデアの1から8個の`Variant`を持つ - それぞれが長さ、事前計算された波形`peaks`、コンテンツアドレス化された`files`を持つ。`Sound`自身の`origin`（`"curated"`または`"chipvoice"`。`"generated"`はフェーズ2用に予約済み）と、chipvoiceレンダーの場合はその`recipe`が、chipvoice自身の型に依存することなく、どう作られたかを記録する。

<a id="taxonomy-and-event-resolution"></a>
## タクソノミーとイベント解決

`catalog/taxonomy.json`がすべてのカテゴリを一度だけ定義し、`apps/sounds/src/lib/catalog.ts`の`resolveEvent()`はエージェントが使うと想定される3つの短縮形を受け付ける：完全修飾id（`"ui/confirm"`）、裸のリーフ名（`"jump"`、セグメントまたはエイリアスで解決）、`"leaf/tag"`（`"hit/heavy"` - 2階層カテゴリ`"combat/hit"`に対するタグフィルターであり、タクソノミーの3階層目ではない。分割は*最初*の`/`だけで行われるため、3セグメントの文字列はより深いパスとしては振る舞わない）。続いて`pickSoundForEvent()`が決定的に音を1つだけ選ぶ：フェーズ1のすべての音は`rank.score`が0なので（投票や利用データはまだ存在しない - それはフェーズ2）、タイブレークは音自身のidを昇順で行い、候補の無い指定スタイルは何にも解決しないのではなく、そのカテゴリ内の任意のスタイルにフォールバックする。出荷済みのタクソノミーは85カテゴリで、うち9つは最上位のハブで直接ファイルされた音を持たない（すべての音はリーフに置かれる）。66カテゴリが少なくとも1つの音を持つ。

<a id="sourcing-and-licensing"></a>
## ソースとライセンス

すべての音は2つの出自のうちちょうど1つから来ており、どちらも構造的に`CC0-1.0`である：Kenneyの CC0 パックから厳選したテイク、またはchipvoice自身のオフライン`renderSfx`（`packages/chipvoice`、`b649b54`）によるレンダー。フェーズ1では他の出所は混在しないため、「すべてCC0」は実行時のライセンスフィルターなしに成立する - `apps/sounds/test/mapping.test.mjs`が、出荷されたすべてのファイルがこの2つのどちらかまで遡れることを検証する。

<a id="loudness-trim-and-determinism"></a>
## ラウドネス、トリム、決定性

カタログビルド（`apps/sounds/scripts/build-catalog.mjs`と`scripts/lib/audio.mjs`）は各テイクをゼロ交差でトリムして文書化されたフェードを付け、ラウドネスを測定し、規定の帯域から外れたものを拒否する：モーメンタリー最大-18 LUFS、トゥルーピーク <= -1 dBTP、先頭無音は10ms以内、クリッピングなし。`apps/sounds/test/checks.test.mjs`の否定的テストが、合格するファイルがたまたま合格しているだけでなく、各チェックが違反するように作られたファイルを実際に落とすことを証明する。ビルドは同じソースに対して決定的である：`apps/sounds/test/mapping.test.mjs`が、出荷済みのすべてのファイルのソースとSHA-256への対応を検証する。

<a id="content-addressing"></a>
## コンテンツアドレッシング

すべてのバリアントは`.ogg`、`.mp3`、`.wav`にエンコードされ、`/f/<sha256>.<ext>`として不変に配信される。1テイクの3形式は1つのファイル名ハッシュを共有する：それは正準WAV自身のSHA-256（`scripts/lib/audio.mjs`の`encodeVariant()`）であり、グループキーとして使われる。そのアドレスに文字通りハッシュが一致するのは`.wav`だけである - 名前を共有する`.ogg`/`.mp3`はコンテンツアドレッシング上の便宜であり、自身のバイト列についての主張ではない。ダウンロードしたファイルに対してハッシュを検証するもの（CLI、ブラウザスモークテスト）は、それを検証するために付随する`.wav`を取得する。

<a id="the-rest-api"></a>
## REST API

公開・鍵不要の`/api/v1`（`apps/sounds/src/app/api/v1`）：`GET /categories`、`GET /sounds`（検索：`q`、`category`、`style`、`tag`）、`GET /sounds/{id}`、`GET /sounds/{id}.zip`、`GET /packs`、`GET /packs/{id}`、`GET /packs/{id}.zip`、そして`POST /api/v1/resolve`（1回の呼び出しでゲーム1本分のイベントすべてに答える呼び出しである：`{events, style}`を受け取り`{manifest, resolved, unresolved}`を返す）。`GET /schema/manifest-1.json`はマニフェスト自身のJSON Schema（draft 2020-12）を配信する。`apps/sounds/test/manifest.test.mjs`は実際の`buildManifest()`の出力をこれに対して検証し、さらにスキーマが実際に不正なものを拒否することも証明する。すべてのルートは`web-kit/http`のルートエンベロープの上に構築され、`web-kit/limit`でIPごとにレート制限される（決定47） - `POST /resolve`は、他の点では読み取り専用のAPIの中で唯一の書き込み的な呼び出しである。

<a id="the-manifest-soundsjson"></a>
## マニフェスト（sounds.json）

`sounds.json`は、すべての生産者と消費者が共有する唯一の契約である：`POST /api/v1/resolve`、`GET /packs/{id}`、そしてCLI自身が書き出すファイルは、すべて`buildManifest()`（`apps/sounds/src/lib/catalog.ts`）の出力である。その`base`は`files`/`fallback`のパスが何に対する相対パスかを示す（サーバーは`"/"`を返すが、CLIがディスクに書き出すファイルは代わりに`"./"`を持ち、パスもそれに合わせて書き換えられるため、書き出されたファイルは単体で持ち運べる）。`credits`は、音のidで重複排除した上で、それぞれ異なる音のライセンス、作者、出所、必要なクレジット表記を列挙する。

<a id="the-cli"></a>
## CLI

`npx gamesounds add <event...> [--style <style>] [--api <url>] [--out <dir>]`
（`packages/gamesounds/bin/gamesounds.mjs`、依存なし）は`POST /api/v1/resolve`を呼び、音声をダウンロードし、`sounds.json`と`SOUNDS-CREDITS.md`を`<dir>`（既定はカレントディレクトリ）に書き出す。ダウンロードはコンテンツアドレスであるため、ディスク上に既にあるファイルは決して再取得されず、コマンドを再実行すると既存の`sounds.json`を上書きするのではなく新しいイベントをマージする。ダウンロードされたすべてのハッシュは、コマンドが終了する前にサーバー自身のコンテンツアドレス化された`.wav`に対して検証される（上の「コンテンツアドレッシング」参照） - `packages/gamesounds/test-cli.mjs`は、実際のローカルサーバーに対してこのコマンドを2回実行し、合格基準の例と冪等な再実行の両方を検証する。

<a id="the-runtime"></a>
## ランタイム

`gamesounds`のランタイム（`packages/gamesounds/src/runtime.ts`）は、依存の無い小さなWeb Audioプレーヤーであり、サイトとは別に公開されているため、生成されたゲームは`sounds.json`と音声がローカルに揃えば`import { loadSounds } from "gamesounds"`してサーバーを介さずに音を鳴らせる。`loadSounds()`はマニフェスト（ローカル、または稼働中のAPIに対する`{remote: true, events, style}`）を読み、`GameSounds`ハンドルを返す：`play(event, options)`（ラウンドロビンのバリアント選択、ピッチジッター、イベントごとのクールダウン）、`loop(event)`、優先度スティーリング付きのイベントごと・グローバルのボイス上限、`duck()`（スケジュールされたアタック/リリースのゲインランプ）を持つ名前付きバス、そしてiOSの最初のジェスチャー要件のための`unlock()`。`packages/gamesounds/test/runtime.test.mjs`は、これらすべてをブラウザではなく偽の`AudioContext`（`packages/gamesounds/test/fake-audio-context.mjs`）に対して駆動し、`currentTime`を手動で進めるため、クールダウンやスティーリングのタイミングは本物の時計と競合せず正確である。

<a id="the-site"></a>
## サイト

`apps/sounds`（Next.js App Router）は、`<audio>`ではなくWeb Audioの上に構築された、キーボード優先の結果リストである：`/`で検索にフォーカス、`j`/`k`で選択を移動、`space`または`1`-`8`でバリアントを再生、`r`でランダムなバリアントを再生、`d`でダウンロード。ページ：`/`、`/c/<category>`（子カテゴリへ再帰するか、リーフの音を一覧する）、`/s/<id>`（音自身のページ：すべてのバリアント、ライセンス、測定値、エージェント用のスニペット）、`/packs/<id>`、`/docs`。ホームページのカテゴリカードは、そのブランチ自身の子孫リーフの中で最も評価の高い音をプレビューする（すべての最上位ブランチは、直接ファイルされたものを持たないハブである）。どのカードも再生できないプレビューを主張しない。投票ボタンや「サンドボックスで試す」リンクは無い：フェーズ1には投票するためのアカウントが無く、サンドボックスはフェーズ2である - 裏に何もないコントロールは、コントロールが無いより悪い（[バックログ](BACKLOG.md)参照）。

<a id="for-agents"></a>
## エージェント向け

`/llms.txt`、`/skill.md`、`/openapi.json`、`/.well-known/mcp.json`はすべて1つの`openApiSpec()`（`apps/sounds/src/lib/openapi.ts`）から導出されており、APIは1か所にしか記述されていない。`/skill.md`は、ランタイムのスニペットや生のエンドポイント表より先にCLI（ローカルで使える`sounds.json`への最短経路）を紹介する。

<a id="testing"></a>
## テスト

`apps/sounds`：`pnpm test`（スキーマ、検索/解決ロジック、マッピングとビルドチェックの否定的ケース）に加えて`node test-smoke.mjs`（Playwright、`finally`でクローズ、実際にビルドしたサイトに対して実行 - ホームが読み込まれ、検索が結果を見つけ、再生が本物の`AudioBufferSourceNode`を開始し、ダウンロードのバイト列がそのSHA-256と一致し、キーボードショートカットが動く）。`packages/gamesounds`：`npm run test:unit`（偽`AudioContext`によるランタイムスイート）に加えて`node test-cli.mjs`（実際のローカルサーバーに対してCLIを2回実行）。
