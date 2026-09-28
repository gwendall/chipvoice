<a id="gamesoundsai"></a>
# gamesounds.ai

<p align="center"><a href="GAMESOUNDS.md">English</a> &bull; <a href="GAMESOUNDS_ja.md">日本語</a></p>

パックではなくイベント単位でファイルされたゲーム効果音バンクである：エージェントは`"jump"`や`"combat/hit/heavy"`をライセンス済みでラウドネスの揃った音に解決し、アカウントも鍵も無く、人が先に候補を試聴することもなく、そのまま再生できる。フェーズ1はカタログ、サイト、REST API、CLI、ランタイムライブラリを出荷する。これが（gamesounds.aiを提供する）`apps/sounds`という2つ目のアプリと`gamesounds`という2つ目のパッケージであり、chipvoice.devに追加したページではない理由は[決定49](DECISIONS.md)を、フェーズ1が意図的に含めていないものは[バックログ](BACKLOG.md)を参照。

<a id="the-data-model"></a>
## データモデル

`packages/gamesounds/src/types.ts`が形を定義する唯一の場所である - 自身は何もインポートしないプレーンなTypeScriptであり、サイトのサーバーコードとインストールされた`gamesounds`パッケージの両方が同じ型を読む。`Sound`は1つの`Category`（タクソノミーのid、最大2階層、例：`"movement/jump"`）に答え、`style`（10ある側面の1つ：`8bit`、`16bit`、`arcade`、`cartoon`、`realistic`、`scifi`、`fantasy`、`horror`、`cozy`、`minimal-ui`）を持ち、ライセンスとその出所をデータとして運び、同じアイデアの1から8個の`Variant`を持つ - それぞれが長さ、事前計算された波形`peaks`、コンテンツアドレス化された`files`を持つ。`Sound`自身の`origin`（フェーズ1のすべての音は`"chipvoice"`。`"generated"`は[GS-02](BACKLOG.md)として追跡される手続き的合成エンジン用に予約済み）とその`recipe`が、chipvoice自身の型に依存することなく、どう作られたかを記録する。

<a id="taxonomy-and-event-resolution"></a>
## タクソノミーとイベント解決

`catalog/taxonomy.json`がすべてのカテゴリを一度だけ定義し、`apps/sounds/src/lib/catalog.ts`の`resolveEvent()`はエージェントが使うと想定される3つの短縮形を受け付ける：完全修飾id（`"ui/confirm"`）、裸のリーフ名（`"jump"`、セグメントまたはエイリアスで解決）、`"leaf/tag"`（`"hit/heavy"` - 2階層カテゴリ`"combat/hit"`に対するタグフィルターであり、タクソノミーの3階層目ではない。分割は*最初*の`/`だけで行われるため、3セグメントの文字列はより深いパスとしては振る舞わない）。続いて`pickSoundForEvent()`が決定的に音を1つだけ選ぶ：フェーズ1のすべての音は`rank.score`が0なので（投票や利用データはまだ存在しない - それはフェーズ2）、タイブレークは音自身のidを昇順で行い、候補の無い指定スタイルは何にも解決しないのではなく、そのカテゴリ内の任意のスタイルにフォールバックする。タクソノミーは、まだ何もファイルされていないカテゴリも保持し続ける - 将来のスタイルや手続き的エンジン（[GS-02](BACKLOG.md)）がいずれ埋めるかもしれないためだ - が、`GET /api/v1/categories`（`listCategoriesWithCounts()`）はすべてのカテゴリに正直な`count`（そのリーフ自身の音に加え、ブランチについてはすべての子孫リーフの音の合計）を付与し、サイトのカテゴリカードとハブページも同じカウントと明示的な「No sounds filed here yet」を表示する。空のカテゴリを中身があるかのように見せることはない。85カテゴリのうち52が現在少なくとも1つのchipvoiceの音を持つ（タクソノミーの10あるスタイルの側面のうち2つ、`8bit`と`16bit`が今日存在する - 残りは非レトロ系のスタイルであり、手続き的エンジンが将来担う）。

<a id="sourcing-and-licensing"></a>
## ソースとライセンス

gamesoundsは私たち自身のサウンドバンクである：すべての音はchipvoice自身のオフライン`renderSfx`（`packages/chipvoice`、`b649b54`）によって手続き的に作られる - 第三者の音源も外部の生成APIも使わず、構造的に`CC0-1.0`である。フェーズ1では他の出所は混在しないため、「すべてCC0」は実行時のライセンスフィルターなしに成立する。`scripts/lib/checks.mjs`の`checkLicense`は、それでもビルドが生成したライセンス無しの音を拒否する（複数の出所を仕分けるフィルターではなく、念のための二重チェックである）。2つ目の出自`"generated"`はスキーマに予約されており、[GS-02](BACKLOG.md)として追跡される手続き的合成エンジン（私たち自身のDSP、決定的、レシピ＋シード）用である - これはこのフェーズでは作られない、後のチケットだ。

<a id="variants"></a>
## バリアント

フェーズ1のすべての音は収集されたものではなく生成されたものであるため、テイク数が少ない言い訳はできない：すべての音は3から5個のバリアントを持つ（フェーズ1ではイベント×チップのグループごとに4個を出荷する）。`scripts/lib/checks.mjs`の`checkChipvoiceVariantCount`は、chipvoice由来の音が3個を下回ればビルドを失敗させ、`apps/sounds/test/checks.test.mjs`に否定的テストがある。このチェックは無条件ではなく`origin === "chipvoice"`にゲートされている - 将来の非chipvoice出自（手続き的エンジン、[GS-02](BACKLOG.md)）が、これを誤って継承するのではなく自分自身のルールを定義できるようにするためだ。`apps/sounds/catalog/chipvoice-recipes.mjs`の`chipvoiceGroups`/`groupCandidates`がその機構である：イベント×チップの各グループは、固定された4件のリストではなく、順序付けられた候補のラダーを持つ - ラダーの各段は、イベントが持つ2つの手調整済みの形のいずれかの上に、独自の長さのストレッチ、整数半音の`detune`ナッジ（chipvoice自身のトップレベルの半音オフセット）、音量テーブルのシフトを適用し、それぞれが段を上がるごとに符号を反転させながら大きさを増していく。`build-catalog.mjs`の`renderGroupVariants`が候補を順にレンダーし、可聴かつ既に採用したどのテイクともバイト列が異なる最初の4件を採用する - 無音またはバイト列が重複したレンダーは出荷せずスキップする。ほとんどのグループは最初の4つの候補をそのまま採用するが、残りのラダーは、一部のチップ/ロールの組み合わせ自身の量子化（ノイズボイスのクランプされた0-15の周期、60Hzのエンジンフレームに丸められる長さ、そしてSNESに限っては、`perc`ロールのレシピがどの楽器であっても同じ周期アドレス方式のボイスを共有すること）が、長さと`detune`だけでは本当のバリエーションを保証できないほど粗いために存在し、それゆえ音量テーブルのシフトという3つ目の独立したレバーが存在する。

<a id="loudness-trim-and-determinism"></a>
## ラウドネス、トリム、決定性

カタログビルド（`apps/sounds/scripts/build-catalog.mjs`と`scripts/lib/audio.mjs`）は各テイクをゼロ交差でトリムして文書化されたフェードを付け、（最初のバリアントだけでなく）*すべての*バリアントでラウドネスを測定し、規定の帯域から外れたものを拒否する：モーメンタリー最大-18 LUFSという上限、トゥルーピーク <= -1 dBTPという上限、先頭無音は10ms以内、クリッピングなし - そして**どちらかの上限に達していること**も必須であり、壊れたレベリング処理（ゲイン段の欠落や誤った目標値など）は静かに小さい音で出荷されるのではなく、大きく失敗する。`scripts/lib/audio.mjs`の`levelToConvention`はレンダーごとに単一の線形ゲインを適用する：モーメンタリーLUFSを-18に持っていくゲインと、トゥルーピークを-1 dBTPに持っていくゲインのうち、より小さい方（両者が競合する場合はピーク上限が勝つ）である。したがって正しくレベリングされたバリアントは常に、2つの上限の少なくとも一方に丸め誤差の範囲内まで到達する - `scripts/lib/checks.mjs`の`checkOneCeilingBinds`はまさにそれを検証する：`lufs >= -18 - eps OR peakDb >= -1 - eps`、eps は0.2 dB。これはバリアント間の統計（観測された最大の差やマージン）を一切必要としない - ゲインがどう計算されたかから導かれる、バリアントごとの厳密な帰結であるため、たまたま同じビルド内の別バリアントの正当な差の範囲に収まってしまう壊れたバリアントに騙されることがない。これは、導出された下限方式が残していた抜け穴である。`apps/sounds/test/checks.test.mjs`の否定的テストは、2つの上限とワンシーリング・バインド・ゲートのいずれについても、合格するファイルがたまたま合格しているだけでなく、各チェックが違反するように作られたファイルを実際に落とすことを証明する。ビルドは同じレシピに対して決定的である：`scripts/check-determinism.mjs`（下の「継続的インテグレーション」参照）がカタログ全体を新たにビルドし直し、コミットされたカタログ自身のバリアントごとのSHA-256に対してCIの実行のたびにそれを証明する。

<a id="content-addressing"></a>
## コンテンツアドレッシング

すべてのバリアントは`.ogg`、`.mp3`、`.wav`にエンコードされ、それぞれ`/f/<sha256>.<ext>`として配信される。ここでの`<sha256>`は共有のグループキーではなく、そのファイル*自身*のバイト列のハッシュである - `scripts/lib/audio.mjs`の`encodeVariant()`はエンコード後に各形式をハッシュし、`catalog.json`の`Variant.files`に形式ごとの`{sha256, bytes, url}`を記録する。バリアントは依然としてトップレベルの`sha256`（どの形式固有のエンコーダーが動く前に生成される、正準WAV/PCMのハッシュ）も持ち、形式に依存しないバリアントの識別子として有用だが、下流の何も、`.ogg`や`.mp3`が兄弟ファイルと名前を共有していると仮定してはならない：CLIの`verifyDownload`とブラウザスモークテストは、いずれも取得したばかりのファイルを、そのファイル自身のURLに埋め込まれたハッシュに対して検証する。

<a id="the-rest-api"></a>
## REST API

公開・鍵不要の`/api/v1`（`apps/sounds/src/app/api/v1`）：`GET /categories`、`GET /sounds`（検索：`q`、`category`、`style`、`tag`）、`GET /sounds/{id}`、`GET /sounds/{id}.zip`、`GET /packs`、`GET /packs/{id}`、`GET /packs/{id}.zip`、そして`POST /api/v1/resolve`（1回の呼び出しでゲーム1本分のイベントすべてに答える呼び出しである：`{events, style, formats, exclude}`を受け取り`{manifest, resolved, unresolved}`を返す。`formats`はマニフェストのファイルに使う`ogg`/`mp3`/`wav`の1〜2個を選び、`exclude`は与えられた音のidを候補プールから除外する、CLIの`swap`を支える機構である）。`GET /schema/manifest-1.json`はマニフェスト自身のJSON Schema（draft 2020-12）を配信する。`apps/sounds/test/manifest.test.mjs`は実際の`buildManifest()`の出力をこれに対して検証し、さらにスキーマが実際に不正なものを拒否することも証明する。すべてのルートは`web-kit/http`のルートエンベロープの上に構築され、`web-kit/limit`でIPごとにレート制限される（決定47） - `POST /resolve`は、他の点では読み取り専用のAPIの中で唯一の書き込み的な呼び出しである。

<a id="the-manifest-soundsjson"></a>
## マニフェスト（sounds.json）

`sounds.json`は、すべての生産者と消費者が共有する唯一の契約である：`POST /api/v1/resolve`、`GET /packs/{id}`、そしてCLI自身が書き出すファイルは、すべて`buildManifest()`（`apps/sounds/src/lib/catalog.ts`）の出力である。その`base`は`files`/`fallback`のパスが何に対する相対パスかを示す（サーバーは`"/"`を返すが、CLIがディスクに書き出すファイルは代わりに`"./"`を持ち、パスもそれに合わせて書き換えられるため、書き出されたファイルは単体で持ち運べる）。`credits`は、音のidで重複排除した上で、それぞれ異なる音のライセンス、作者、出所、必要なクレジット表記を列挙する。

<a id="the-cli"></a>
## CLI

`packages/gamesounds/bin/gamesounds.mjs`（依存なし）は、同じ公開APIの上に構築された小さなコマンド群である：

- `add <event...> [--style] [--formats] [--api] [--dir] [--json]` はイベントを音に解決し、音声をダウンロードして`sounds.json`と`SOUNDS-CREDITS.md`を`<dir>`（既定はカレントディレクトリ）に書き出す。
- `search <query> [--style] [--category] [--limit] [--api] [--json]` はカタログに対する自由文検索で、`add`する前にイベントidを見つけるためのもの。
- `list [--dir] [--json]` は`<dir>/sounds.json`で既に解決済みのイベントを報告する。
- `swap <event> [--style] [--api] [--dir] [--json]` は1つのイベントを、既に選ばれている音ではない次点の音に再解決し（`POST /resolve`の`exclude`）、`sounds.json`内でそれを置き換える。代替が存在しない場合は書き込まずにその旨を報告する。
- `sync [--dir] [--api] [--json]` は`sounds.json`が参照するすべてのファイルが依然として存在し、依然として自身のコンテンツアドレス化された名前にハッシュすることを検証する：欠けているファイルは再ダウンロードして再検証し、存在するが改ざんされているファイルは決して黙って上書きせず、きっぱりと拒否する。

`--formats <fmt[,fmt]>`は`ogg`/`mp3`/`wav`のうち1〜2個を選ぶ（既定は`ogg,mp3`）。最初がプライマリファイル、2番目（あれば）がフォールバックであり、単一の形式では`fallback`フィールドそのものが書かれない。`--json`はどのコマンドでも、文章による出力を機械可読なサマリーに切り替える。ダウンロードはコンテンツアドレスであるため、ディスク上に既にあるファイルは決して再取得されず、`add`を再実行すると既存の`sounds.json`を上書きするのではなく新しいイベントをマージする。ダウンロードされたすべてのファイルのハッシュは、コマンドがそれを信頼する前に自身のコンテンツアドレス化されたURLに対して検証される（上の「コンテンツアドレッシング」参照） - `packages/gamesounds/test-cli.mjs`は実際のローカルサーバーに対して5つのコマンドすべてを駆動する：合格基準の例、冪等な再実行、マージ、`.ogg`だけを書き出す`--formats ogg`、選ばれる音を変えつつ`sounds.json`をスキーマ有効に保つ`swap`、そして欠けたファイルを再ダウンロードしつつ改ざんされたファイルを拒否する`sync`。

<a id="the-runtime"></a>
## ランタイム

`gamesounds`のランタイム（`packages/gamesounds/src/runtime.ts`）は、依存の無い小さなWeb Audioプレーヤーであり、サイトとは別に公開されているため、生成されたゲームは`sounds.json`と音声がローカルに揃えば`import { loadSounds } from "gamesounds"`してサーバーを介さずに音を鳴らせる。`loadSounds()`はマニフェスト（ローカル、または稼働中のAPIに対する`{remote: true, events, style}`）を読み、`GameSounds`ハンドルを返す：`play(event, options)`（ラウンドロビンのバリアント選択、ピッチジッター、イベントごとのクールダウン）、`loop(event)`、優先度スティーリング付きのイベントごと・グローバルのボイス上限、`duck()`（スケジュールされたアタック/リリースのゲインランプ）を持つ名前付きバス、そしてiOSの最初のジェスチャー要件のための`unlock()`。`packages/gamesounds/test/runtime.test.mjs`は、これらすべてをブラウザではなく偽の`AudioContext`（`packages/gamesounds/test/fake-audio-context.mjs`）に対して駆動し、`currentTime`を手動で進めるため、クールダウンやスティーリングのタイミングは本物の時計と競合せず正確である。

<a id="the-site"></a>
## サイト

`apps/sounds`（Next.js App Router）は、`<audio>`ではなくWeb Audioの上に構築された、キーボード優先の結果リストである：`/`で検索にフォーカス、`j`/`k`で選択を移動、`space`または`1`-`8`でバリアントを再生、`r`でランダムなバリアントを再生、`d`でダウンロード。ページ：`/`、`/c/<category>`（子カテゴリへ再帰するか、リーフの音を一覧する）、`/s/<id>`（音自身のページ：すべてのバリアント、ライセンス、測定値、エージェント用のスニペット）、`/packs/<id>`、`/docs`。ホームページのカテゴリカードは、そのブランチ自身の子孫リーフの中で最も評価の高い音をプレビューする（すべての最上位ブランチは、直接ファイルされたものを持たないハブである）。どのカードも再生できないプレビューを主張しない。投票ボタンや「サンドボックスで試す」リンクは無い：フェーズ1には投票するためのアカウントが無く、サンドボックスはフェーズ2である - 裏に何もないコントロールは、コントロールが無いより悪い（[バックログ](BACKLOG.md)参照）。

`apps/sounds/src/lib/player.tsx`は、`AudioContext`の生成（いつでも安全で、ジェスチャーは不要）と、それを再開すること（`play()`の内部、`.start()`の直前だけで行い、iOSのジェスチャー要件を満たす）を分離している。これにより`preload()`は早い段階から積極的にデコードできる：共有された`IntersectionObserver`が結果の行がビューに入るとプリロードし、行をホバーまたはキーボードで選択してもプリロードされる。いずれもバウンド付きの並行度を持つセマフォ（`MAX_CONCURRENT_DECODES`）を通るため、長いリストをスクロールしても無制限に並列デコードが開かれることはない。行の`data-preload-state="ready"`は、単なるUIフラグではなく、デコードキャッシュが実際に満たされたことの観測可能な証拠である。再生は音のidごとに現在鳴っているソースの`Map`を保持する：既に鳴っている音を再びトリガーすると、先に前のボイスを停止する（スパムガード - キーを押し続けても無制限にボイスが積み重なることはなくなった）。そして常駐する`MiniPlayer`は、再生中の音のタイトル、バリアント、ライセンス、ソースリンクとともに、生存中のボイス数を`data-active-voices`として公開する。`Waveform.tsx`は、`Date.now()`ではなく`AudioContext.currentTime`を`requestAnimationFrame`経由で駆動するプレイヘッドを波形の上に走らせる（そのためタブがバックグラウンドになると自然に一時停止し、音声クロックと一致する）。

<a id="for-agents"></a>
## エージェント向け

`/llms.txt`、`/skill.md`、`/openapi.json`、`/.well-known/mcp.json`はすべて1つの`openApiSpec()`（`apps/sounds/src/lib/openapi.ts`）から導出されており、APIは1か所にしか記述されていない。`/skill.md`は、ランタイムのスニペットや生のエンドポイント表より先にCLI（ローカルで使える`sounds.json`への最短経路）を紹介する。

<a id="deploy"></a>
## デプロイ

`public/f/`（コンテンツアドレス化された音声）はgitignoreされており、`generated/catalog.json`はコミットされている。Vercelは音声を一切レンダーしない：レンダーにはffmpegが必要（Vercelには無い）で、ffmpegのバージョンが違うと「不変」であるはずのURLの裏で`.ogg`/`.mp3`が違うバイト列に再エンコードされてしまう。代わりにこれはapps/web自身のaudio-storeパターン（決定40）に従い、gamesoundsのより単純な、既に自己命名済みのファイル向けに移植したものである（決定50）：`apps/sounds/scripts/audio-store.mjs`は`catalog.json`から直接すべての`AudioFile`を読み取り（ファイルが既に自身のコンテンツを名前にしているため、別のレポートを解析する必要は無い）、`GAMESOUNDS_BLOB_READ_WRITE_TOKEN`で鍵付けされたVercel Blobストアに対して`pull`/`check`/`push`する（ルートの`package.json`の`sounds:pull`/`sounds:check`/`sounds:push`、`sounds:build`のそば）。鍵は一度だけ書かれ、決して削除されない。`apps/sounds/audio-store.json`の`base`は`/f/<sha256>.<ext>`に対する`next.config.ts`のフォールバックの書き換え先である：開発環境とテストではローカルの`public/f/<file>`が勝ち（先にチェックされる）、ミスした場合だけストアにフォールバックする - `src/lib/files.ts`の`readPublicFile`はzipルートのためにも同じことを行い、ストアからのダウンロードのバイト列を、信頼する前にそのパス自身に埋め込まれたsha256に対して検証する。`vercel.json`の`buildCommand`は`web-kit`とサイトのビルドだけであり（`catalog:build`もffmpegもネットワークも無い）、`ignoreCommand`は`apps/sounds`、`packages/gamesounds`、`packages/web-kit`、`pnpm-lock.yaml`、`vercel.json`自身のいずれかが変わらない限りデプロイ全体をスキップする。

<a id="continuous-integration"></a>
## 継続的インテグレーション

`sounds`のCIジョブは決してネットワークに触れない：第三者のソースが無いため、`catalog:build`がカタログ全体を自身でレンダーし（packages/chipvoice自身のオフライン合成が唯一のソースである）、`catalog:check-determinism`が、その新しくビルドされたカタログのWAV/PCMハッシュ(どの形式固有のエンコーダーが動く前に生成される、各バリアント自身の識別子)が、すべての音についてコミットされた`catalog.json`のエントリと一致することを証明する(`apps/sounds/scripts/check-determinism.mjs`、`apps/sounds/test/determinism.test.mjs`で否定的にテストされている)。これは`.ogg`/`.mp3`のバイト列については意図的に何も検証しない。これらはffmpegのビルドやプラットフォームをまたいで同一であるとは期待されていないためである - そのため、続くユニットテスト、本番ビルド、e2eスモーク/CLIテストはすべて、作者自身のマシンからコミットされたカタログではなく、CIが自分自身のためにたった今レンダーしたカタログ(それらのステップの前に`generated/catalog.json`へコピーする)に対して、しかしサブセットではなくすべての音を自己完結的にカバーして実行される。Blobストア自身のバイト列を信頼すること(上の「デプロイ」参照)は一度限りの、プッシュ時のチェックであり(コミットされたカタログとストアに対する`pnpm sounds:check`)、CIが実行のたびに再検証するものではない。

<a id="testing"></a>
## テスト

`apps/sounds`：`pnpm test`（スキーマ、検索/解決ロジック、音声処理、決定性、ワンシーリング・バインド・ラウドネスゲートとchipvoiceのバリアント数下限を含むビルドチェックの否定的ケース）に加えて`node test-smoke.mjs`（Playwright、`finally`でクローズ、実際にビルドしたサイトに対して実行 - ホームが読み込まれ、検索が結果を見つけ、可視化時のプリロードがデコードキャッシュを満たし、再生が本物の`AudioBufferSourceNode`を開始し、ミニプレーヤーと波形のプレイヘッドが再生を追跡し、スパムガードがアクティブなボイス数を制限し、ダウンロードのバイト列がそれ自身のSHA-256と一致し、キーボードショートカットが動く）。`packages/gamesounds`：`npm run test:unit`（偽`AudioContext`によるランタイムスイート）に加えて`node test-cli.mjs`（実際のローカルサーバーに対して5つのCLIコマンドすべてを実行：冪等性とマージのために`add`を2回、`--formats ogg`、`search`、`list`、`manifest-1.json`に対してスキーマ検証される`swap`、欠けたファイルを再ダウンロードしつつ改ざんされたファイルを拒否する`sync`）。
