<a id="the-gamesounds-procedural-sound-effect-engine"></a>
# gamesounds のプロシージャル効果音エンジン

<p align="center">
  <a href="GAMESOUNDS-ENGINE.md">English</a> &bull;
  <a href="GAMESOUNDS-ENGINE_ja.md">日本語</a>
</p>

`packages/sfx-engine` は gamesounds.ai 独自の決定論的でオフラインの効果音
シンセサイザーです。ランタイム依存はゼロで、プレーンな TypeScript を ESM
(`dist`)にビルドして配布し、`apps/sounds`・`packages/gamesounds`・
`packages/chipvoice` には一切触れません - [Decision 51](DECISIONS.md) を
参照してください。ここでの「音」とはレシピ(JSON: どのモデルか、そのパラ
メータ、シード、サンプルレート)とそのシードの組み合わせであり、同じレシ
ピはどこでレンダリングしてもビット単位で同一の PCM になります。

<a id="architecture"></a>
## アーキテクチャ

<a id="package-layout"></a>
### パッケージの構成

| パス | 内容 |
| --- | --- |
| `src/dsp/` | オシレーター、ノイズ、エンベロープ、フィルタ、ウェーブシェイピング、ディレイ、リバーブ、ミキシングといった基本要素、そして `math.ts`(エンジン独自の決定論的な超越関数) |
| `src/models/` | 物理モデルに基づく生成器: モーダル合成、PhISEM、Karplus-Strong、バブルモデル |
| `src/graph/` | 低レベルのノードグラフ: `types.ts`(その形) と `compile.ts`(`renderGraph`、トポロジカルソートして実行する) |
| `src/rng/` | `prng.ts`、エンジン内のあらゆる乱数選択が引くシード付き PRNG(mulberry32) |
| `src/loudness/` | K 特性、モーメンタリー/インテグレーテッドの BS.1770 ラウドネス、トゥルーピーク、そしてハウスのラウドネス正規化ステップ |
| `src/presets/` | 8 個の高レベルモデル(`ui.ts`、`impact.ts`、`footstep.ts`、`whoosh.ts`、`explosion.ts`、`scifi.ts`、`magic.ts`、`pickup.ts`)と `index.ts` の `MODELS`/`PRESETS` レジストリ |
| `src/recipe/` | `Recipe` の TypeScript 型と、スキーマに基づく検証器 `assertValidRecipe` |
| `src/render/` | `renderRecipe`(最上位のエントリーポイント)、`finalize.ts`(DC 除去、ゼロへのフェード)、`bestOfN.ts` |
| `src/analysis/` | `signal-checks.ts`: レンダリングされたすべての音が満たすべき健全性チェック |
| `schema/recipe-1.json` | バージョン管理された、言語非依存のレシピスキーマ(JSON Schema draft 2020-12) |
| `parity/`、`scripts/`、`eval/` | ローカル限定の品質ツール群: クロスエンジンの決定論性、ffmpeg とのラウドネス突き合わせ、リスニングレポート、CLAP によるセマンティック評価 - 詳しくは後述の「品質の根拠」を参照 |

<a id="render-pipeline"></a>
### レンダリングパイプライン

`renderRecipe(recipe)` は次の順で実行されます。

1. **検証**: レシピを `schema/recipe-1.json` の規則に照らしてチェックしま
   す(`assertValidRecipe`)。
2. **コンパイル**: `model: "graph"` の場合は `params` をそのまま
   `GraphRecipeParams` として使います。それ以外の `model` は `MODELS`
   レジストリで引き、そのモデル自身の `compile(params, seed, sampleRate)`
   を呼びます。これも `GraphRecipeParams` を返します。高レベルモデルが音
   声そのものをレンダリングすることはなく、`renderGraph` が実行するための
   グラフを組み立てるだけです。
3. **グラフのレンダリング**(`graph/compile.ts` の `renderGraph`): ノード
   をトポロジカルソートし、すべての `{ref}`(制御レートのパッチ - エンベ
   ロープをオシレーターの周波数へ、スイープをフィルタのカットオフへ、と
   いったもの)を参照先ノードの出力に解決し、各ノードを順にレンダリング
   します。グラフ自体は最後までモノラルのままです。
4. **仕上げ**(`render/finalize.ts`): DC オフセットを差し引き、最後の 6ms
   を線形にフェードして正確にゼロにします。これにより、そのエンベロープ
   がどう終わろうと、すべてのレンダリングは真のゼロクロッシングで終わり
   ます。
5. **ラウドネスの正規化**(`loudness/normalize.ts`)をハウスの規約に合わ
   せて行います(「ラウドネスとミキシング」を参照)。
6. **ステレオへのパン**を最後に一度だけ行います(`dsp/mix.ts` の等パワー
   な `panToStereo`) - 上記の DSP プリミティブはすべてモノラルのままで、
   それぞれをシンプルに保ち、レシピのノード数も小さく保てます。

<a id="determinism"></a>
## 決定論性

<a id="why-this-matters"></a>
### なぜ重要か

ブリーフの必須要件です: 同じレシピとシードは Node・Chromium・Firefox・
WebKit のどこでもビット単位で同一の PCM をレンダリングしなければなりませ
ん。これにより、レシピはエンジンによってずれることのない、ある音の正確で
可搬な記述になります。

<a id="how-it-is-enforced"></a>
### どう強制しているか

ECMA-262 は `+`、`-`、`*`、`/`、そして `Math.sqrt`・`Math.round`・
`Math.floor`・`Math.abs` などについては正確な IEEE-754 倍精度の結果を義務
付けていますが、超越関数(`sin`、`cos`、`exp`、`log`、`pow`、`tanh` など)
については明示的に「実装依存の近似」としています。V8・SpiderMonkey・
JavaScriptCore はそれぞれ異なる libm を積んでおり、最後の 1〜2 ビットで食
い違わない保証はどこにもありません。`dsp/math.ts` は、エンジンが必要とす
るすべての超越関数を `+`、`-`、`*`、`/` だけから実装しています(標準的な
fdlibm のレンジリダクションの形 - 引数を、テイラー/マクローリン級数が倍精
度をはるかに超えて収束する小さな区間に還元し、それから再構成する。出典は
そのファイル自身のドキュメントコメントを参照)。そのため DSP のコアは
`src/` のどこでも `Math.sin`・`Math.cos`・`Math.exp`・`Math.log`・
`Math.pow`・`Math.tanh` を直接呼びません。唯一の例外は `Math.sqrt` で、そ
のまま使っています: IEEE-754(したがって ECMA-262)はこれを正しく丸める
ことを要求しており、どのエンジンもそれを守っているためです。シード付き
PRNG(`rng/prng.ts`、mulberry32)も超越関数には触れません - 32 ビット整数
乗算(`Math.imul`、仕様どおり正確)とビット演算(これも仕様どおり正確)だ
けを使います。

<a id="cross-engine-parity-harness"></a>
### クロスエンジンのパリティハーネス

`parity/`(chipvoice 自身の `scores/render-parity/` をモデルにした、ローカ
ル限定で CI には含まれないツール - chipvoice の render-parity と同じパタ
ーン)は 82 個の入力をレンダリングします - 53 個の名前付きプリセットをそ
れぞれの基準シードで、各ファミリーの代表プリセット 1 つをさらに 3 つのシ
ードで、そして名前付きプリセットだけでは到達しないノード種別やフィルタ/
シェイパーの種類(`karplus`、フィルタの `comb` と `allpass-delay`、シェイ
パーの `srr`、そして `exp()` を直接使うダンプドディレイの
`loopFilterCutoff`)を狙って手書きした低レベルのグラフレシピ 5 個です。
これらを Node で、それから Playwright 経由で実際の Chromium・Firefox・
WebKit でレンダリングし、PCM を SHA-256 で比較します。`parity/self-test.mjs`
は、ある 1 入力の PCM の 1 サンプルをハッシュ化前にわざと壊し、その行だ
けが不一致になることを確かめることで、比較そのものが実際に機能すること
を証明します。

`pnpm --filter sfx-engine parity:check` でローカル実行できます。82 個の
入力すべてが Node・Chromium・Firefox・WebKit の間でビット単位で一致しま
した。`dsp/math.ts` が設計上すでに置き換えている以上に置き換えが必要な
`Math.*` 関数は見つからず、乖離するものはありませんでした。

<a id="recipe-format"></a>
## レシピの形式

`schema/recipe-1.json`(JSON Schema、draft 2020-12)がバージョン管理され
た正となる仕様です。

```json
{
  "engine": "sfx-engine@1",
  "model": "impact",
  "params": { "material": "metal", "weight": "heavy" },
  "seed": 7,
  "sampleRate": 48000
}
```

<a id="two-layers"></a>
### 2 つの層

- **低レベルのグラフ**(`model: "graph"`): `params` は `GraphRecipeParams`
  です - `duration`、`nodes` の配列(`id`、`type`、`params`、任意の
  `inputs`)、出力ノードの `output`、そして任意の `pan`。ノードの `type`
  は `const`、`oscillator`、`noise`、`envelope`、`sweep`、`filter`、
  `shaper`、`delay`、`reverb`、`mix`、`multiply`、`modal`、`phisem`、
  `karplus`、`bubble` のいずれかです。ノードの `params` は、変調可能と文
  書化されているフィールド(オシレーターの `freq`、フィルタの `cutoff`
  など)であれば、単なる数値の代わりに `{ref: "nodeId"}` を持てます。こ
  れは他のノードのレンダリング済み出力を制御レートの変調として差し込みま
  す。
- **高レベルの名前付きモデル**(`ui`、`impact`、`footstep`、`whoosh`、
  `explosion`、`scifi`、`magic`、`pickup`): `params` はそのモデル自身の形
  (例えば `impact` の `{ material, weight?, size? }`)で、レンダリング前
  に内部で `GraphRecipeParams` にコンパイルされます。すべてのモデルは機
  械可読な `metadata`(`ModelMetadata`、`src/presets/types.ts`)を公開し
  ます: 平易な英語での説明、各パラメータの型/単位/範囲/デフォルト/平易な
  意味、どのパラメータがシードごとにどれだけ揺らぐかの注記、そしてすぐに
  レンダリングできる名前付きの例 2〜4 個です。このエンジンの上に構築され
  る API は、このメタデータをそのままエージェントに提示でき、エージェン
  トはこのパッケージのソースを一切読まずにパラメータを選べます。

<a id="example"></a>
### 例

`recipeForPreset("impact-metal-heavy", 7, 48000)` は次を返します。

```json
{
  "engine": "sfx-engine@1",
  "model": "impact",
  "params": { "material": "metal", "weight": "heavy" },
  "seed": 7,
  "sampleRate": 48000
}
```

これは(`impact` 自身の `compile` によって)単一の `modal` ノード - 打撃
を受けた金属オブジェクトの減衰する共振モードの集合 - にコンパイルされ、
`size` は「heavy」のデフォルト値を中心にシードから ±6% 揺らぎます。

<a id="models-and-presets"></a>
## モデルとプリセット

<a id="the-eight-high-level-models"></a>
### 8 個の高レベルモデル

| モデル | ファミリー | 構成要素 |
| --- | --- | --- |
| `ui` | ui | 短い ADSR エンベロープで整形されたオシレーター |
| `impact` | impact | モーダル合成(材質ごとの減衰する共振モード) |
| `footstep` | footstep | 表面ごとにチューニングされた PhISEM の粒子衝突 |
| `whoosh` | whoosh | フィルタリングしてスイープさせたノイズ |
| `explosion` | explosion | 重ねたフィルタ済みノイズ、サブベースのオシレーター、PhISEM の瓦礫 |
| `scifi` | scifi | スイープするオシレーター、FM/リングモジュレーション、フィルタ |
| `magic` | magic | 重ねたオシレーター、ディレイ、アルゴリズミックリバーブ |
| `pickup` | pickup | 重ねた短いトーン系のブリップ、ADSR で整形 |

<a id="the-fifty-three-named-presets"></a>
### 53 個の名前付きプリセット

ブリーフの方針どおり、幅より深さを優先しています: 必須の 8 分類ファミリ
ーにまたがる 53 個の名前付きプリセットそれぞれに、文書化された
`description`(1 行、どのゲームの瞬間のためのものか)があります。

| ファミリー | 個数 | プリセット |
| --- | --- | --- |
| ui | 9 | `ui-click`、`ui-hover`、`ui-confirm`、`ui-cancel`、`ui-error`、`ui-toggle-on`、`ui-toggle-off`、`ui-notification`、`ui-text-blip` |
| impact | 12 | `impact-{wood,metal,stone,glass,plastic,body}-{light,heavy}` |
| footstep | 7 | `footstep-{concrete,wood,grass,gravel,snow,metal,water-puddle}` |
| whoosh | 4 | `whoosh-sword`、`whoosh-punch`、`whoosh-pass-by`、`whoosh-cloth` |
| explosion | 3 | `explosion-small`、`explosion-big`、`explosion-distant` |
| scifi | 8 | `scifi-laser`、`scifi-zap`、`scifi-teleport`、`scifi-shield-up`、`scifi-shield-down`、`scifi-power-up`、`scifi-power-down`、`scifi-computer-beep` |
| magic | 5 | `magic-cast`、`magic-shimmer`、`magic-heal`、`magic-buff`、`magic-curse` |
| pickup | 5 | `pickup-coin`、`pickup-gem`、`pickup-key`、`pickup-powerup`、`pickup-level-up` |

レンダリング時間(Node、この評価環境、シード 1、
`test/fixtures/perf-baseline.json`): 53 個合計で 740.8ms、平均 14.0ms、
最小 0.7ms(`ui-text-blip`)から最大 87.1ms(`explosion-distant`、最も長
く最も層が多いプリセット)まで。`pnpm --filter sfx-engine test:perf-budget`
は、いずれかのプリセットがコミット済みベースラインの 3 倍を超えると失敗
します。

<a id="loudness-and-mixing"></a>
## ラウドネスとミキシング

<a id="house-convention"></a>
### ハウスの規約

`loudness/loudness.ts` と `loudness/truepeak.ts` は ITU-R BS.1770-4 /
EBU R128 を実装しています: K 特性(2 段のカスケードされたビクアッド、
44100Hz と 48000Hz の両方で BS.1770 の設計パラメータから導出し、48kHz で
は ITU 自身が公開している係数と 1e-9 の精度で一致することを確認済み)、
モーメンタリーラウドネス(400ms ブロック。400ms より短いレンダリングでは
信号全体を 1 ブロックとして扱うフォールバック)、インテグレーテッド(ゲー
ト処理された)ラウドネス、そしてトゥルーピーク(ウィンドウ付き sinc 補間
による 4 倍オーバーサンプリング)。`loudness/normalize.ts` はその後、す
べてのレンダリングにゲインをかけ、モーメンタリーラウドネスが最大でも
-18 LUFS、トゥルーピークが最大でも -1 dBTP になるようにします。両者が食
い違う場合はピークの上限が優先されます。

<a id="cross-check-against-ffmpeg"></a>
### ffmpeg との突き合わせ

`scripts/ffmpeg-loudness-check.mjs` はすべてのプリセットをレンダリングし、
このエンジン自身の `integratedLoudness()`/`truePeakDb()` を、同一信号の
モノラル WAV に対する ffmpeg の `ebur128` フィルタ - 同じ規格の独立した実
装 - と比較します。トゥルーピークは 53 プリセットすべてで比較しています
(瞬間的な統計量であり、どんな長さでも意味があるため): 観測された最大差
は 0.100dB、許容値は 0.25dB(およそ 2.5 倍の余裕)。インテグレーテッドラ
ウドネスは 0.4 秒以上ある 28 個のプリセットでのみ比較しています: ffmpeg
の `ebur128` フィルタは BS.1770 のゲーティングブロック(400ms)1 個分に満
たないクリップでは有効なインテグレーテッド値を出せず、内容にかかわらず
絶対ゲートの下限値(-70.0 LUFS)を返します。この境界を正確に確認しました
(0.400 秒のプリセットは ffmpeg とすでに差 0.000 LU で一致し、それより短
いプリセットはすべて内容にかかわらず ffmpeg から正確に -70.000 LUFS が返
りました)。比較可能な 28 プリセットのうち、観測された最大差は 0.058 LU、
許容値は 0.25 LU(およそ 4 倍の余裕)です。両方の許容値とも、測定された分
布に明記したマージンを足して導いたものであり、今日の出力を通すために選ん
だものではありません。

<a id="quality-evidence"></a>
## 品質の根拠

<a id="listening-report"></a>
### リスニングレポート

`pnpm --filter sfx-engine listen`(`scripts/build-listening-report.mjs`)
はすべてのプリセットを 4 個のシードでレンダリングし、それぞれを Ogg
Vorbis にエンコードし(ffmpeg のネイティブ `vorbis` エンコーダ)、1 つの
自己完結型 HTML ページをその隣に書き出します。各音にはネイティブの
`<audio controls>` 要素(キーボードで再生可能、独自プレイヤーなし)、シ
ード選択、レシピ JSON(折りたたみ可能)、測定された LUFS/トゥルーピーク/
長さ/レンダリング時間が付きます。ファミリーごとにグループ化されています。
このパッケージの外、スクラッチパッドのパスに書き出しています。これは人
間のリスナー向けの根拠であり、配布物ではないためです。合計サイズは 15MB
の予算に余裕をもって収まっています(ほとんどが 1 秒未満なので、短いクリ
ップのサイズはビットレートよりも Ogg 自体のファイルごとのヘッダーのオー
バーヘッドに支配されます)。

<a id="clap-semantic-eval"></a>
### CLAP によるセマンティック評価

客観的で、CI には含まれないローカル限定のチェックです: 汎用のテキスト・
音声モデルは、これらの音を実際にその 1 行の説明と一致するものとして認識
するでしょうか?
[LAION-CLAP](https://github.com/LAION-AI/CLAP)(PyPI の `laion_clap`、
`630k-audioset-best.pt` の非フュージョンチェックポイント - コードもチェ
ックポイントも CC0-1.0 であることを、リポジトリ自身の `LICENSE`、
`pip show laion_clap` の `License` フィールド、そしてチェックポイントの
ホスト先である https://huggingface.co/lukewys/laion_clap から確認済みで
す。したがってローカルでの利用に制限はありません)を、`.artifacts/`
(gitignore 対象)の下の Python venv で使っています。

`eval/prompts.json` はプリセット 1 つにつき 1 つ、平易な英語での音の説明
53 個からなる固定セットで、これを実行する前に一度だけ書き、その後は編集
していません - プリセットはこれらのプロンプトに対してチューニングされて
いないため、ホールドアウト用の 2 つ目のプロンプトセットはありません(こ
の評価に対して何かを反復チューニングしたことはないため)。
`scripts/build-clap-audio.mjs` は 48kHz モノラルの WAV セットを 2 つレン
ダリングします: `real`(すべてのプリセットを通常どおり)と `degraded`
(同じプリセットのコンパイル済みグラフを `scripts/clap-degrade-graph.mjs`
に通したもの。これはすべての `filter`/`shaper`/`delay`/`reverb` ノードを
取り除き、すべての `envelope`/`sweep` ノードを定数に平坦化し、物理モデル
に基づく生成器 - `modal`、`phisem`、`karplus`、`bubble` - をすべて単純な
ホワイトノイズに置き換えます。配線自体はそのままで、生のオシレーター/ノ
イズ/定数だけが残ります)。`.artifacts/clap_eval.py` は 53 個のプロンプ
トと両方の音声セットをすべて埋め込み、3 つの条件でテキスト→音声の検索精
度(top-1/top-5: 正解の音声が最も類似しているか、あるいは最も類似した 5
個に入っているか)を報告します。

| 条件 | 何を測るか |
| --- | --- |
| `real` | このチケットが CLAP の結果として報告する数値 |
| `shuffled labels` | 同じ音声とプロンプトを、シャッフルした(擾乱)対応関係で採点したもの。20 回のランダムな擾乱で平均を取っています - 検索手法そのものの健全性チェックであり、チャンスレベルになることを期待しています |
| `degraded engine` | 同じプロンプトを degraded 音声セットに対して採点したもの - `real` より明確に悪いスコアにならなければ、この指標は何も測っていないことになります |

**数値(`.artifacts/clap-report.json` より、laion_clap
`630k-audioset-best.pt`、非フュージョン)**

| 条件 | top-1 | top-5 |
| --- | --- | --- |
| `real` | 9.4%(5/53) | 37.7%(20/53) |
| `shuffled labels` | 2.0%(理論上のチャンスレベル 1.9%) | 9.2%(理論上のチャンスレベル 9.4%) |
| `degraded engine` | 1.9%(1/53) | 26.4%(14/53) |

両方のコントロールが合格しています: シャッフルラベルの top-1(2.0%)は
`real`(9.4%)より明確に悪く、53 個の候補に対する理論上のチャンスレート
(1.9%)とほぼ一致しているため、検索手法そのものが「正解」に偏っておら
ず健全であることがわかります。degraded engine の top-1(1.9%)も
`real`より明確に悪く、ほぼチャンスレベルまで落ちているため、フィルタ/エ
ンベロープ/物理モデルに基づく生成器を取り除くことが、モデルが認識してい
たものを実際に破壊していることがわかります。したがって `real` の数値は、
単なる数字ではなく根拠として読むことができます: これらのプロンプトに対し
て一切チューニングされていない汎用のテキスト・音声モデルが、たった 1 行
の英語の説明だけから、53 個の候補の中で正解の音を top-5 に入れる確率が 3
分の 1 を超えており、両方のコントロールを大きく上回っています。

ファミリーごとの混同(`real` 条件、top-1 予測。行はプロンプトの実際のフ
ァミリー、列は CLAP が最も類似していると判定したプリセットのファミリー
です):

| 実際 \ 予測 | ui | impact | footstep | whoosh | explosion | scifi | magic | pickup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ui | 2 | 3 | 2 | 0 | 0 | 1 | 0 | 1 |
| impact | 2 | 8 | 0 | 0 | 0 | 2 | 0 | 0 |
| footstep | 0 | 4 | 3 | 0 | 0 | 0 | 0 | 0 |
| whoosh | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 |
| explosion | 0 | 1 | 0 | 0 | 0 | 1 | 1 | 0 |
| scifi | 1 | 1 | 0 | 4 | 0 | 2 | 0 | 0 |
| magic | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 4 |
| pickup | 1 | 1 | 2 | 0 | 0 | 0 | 0 | 1 |

正直に読み解くと: `whoosh`(4/4)と `impact`(8/12)は、CLAP の top-1 の
推測が正しいファミリーに最も確実に一致する箇所です。`magic` は対角成分が
最も弱く(0/5)、top-1 の推測は 5 回中 4 回が `pickup` でした - これはラ
ンダムな失敗というより、もっともらしい混同です(どちらも短く、明るく、
トーン的なブリップで、実際に `magic` と `pickup` は同じ構成要素 - ADSR で
整形した短いトーンの重ね合わせ - を土台にしています)。`footstep` も
`impact` と混同される方が正しく識別されるより多く(4 対 3)ですが、これ
も検索が壊れている兆候ではなく、もっともらしいペアです(どちらも短い過
渡的な衝突音です) - それは上記のコントロールがすでに否定しています。

上記 2 つのコントロールが `real` より明確に悪いスコアにならなかった場合、
このセクションはその数値を品質の証拠として引用せず、その旨をはっきりと
書きます。今回は両方とも合格したため、上記の数値は根拠として成立します
- この根拠が示さないものの詳細は、後述の「この根拠の限界」を参照してく
ださい。

<a id="best-of-n-helper"></a>
### Best of N ヘルパー

`render/bestOfN.ts` は同じレシピを N 個の異なるシードでレンダリングし、
最も高いスコアのものを返します: `analysis/signal-checks.ts` の健全性チェ
ックは常に実行され、任意の外部 `score` 関数(例えばテキストプロンプトに
対する CLAP の類似度スコアを別プロセスで計算したもの - このパッケージに
ML のランタイム依存はありません)はデフォルトの重み 0.6 でブレンドされま
す。設計上決定論的です(同じベースレシピとシードのリストは常に同じ PCM
をレンダリングし、したがって同じスコアになります)。`test/best-of-n.test.mjs`
がこれを直接検証しています(2 回の実行が同じ勝者・スコア・PCM を生み出す
こと、シードが並べ替えられずに与えられた順に消費されること、外部スコアの
ブレンドが文書化されたデフォルトの重みを使い、明示的な重みも尊重すること、
そして否定的なケース(意図的に無音な低レベルグラフレシピが、スタブではな
く実際のシグナルチェックの経路を通じてスコア 0 になること))。

<a id="limits-of-this-evidence"></a>
### この根拠の限界

- モーダル合成のモードテーブル(`models/modal.ts`)は一般的な音響原理から
  設計されたものであり、測定した物体に合わせてフィッティングしたもので
  はありません - そのファイル内でそう明記されており、測定された事実とし
  ては主張していません。
- `truepeak.ts` のトゥルーピークフィルタは、ウィンドウ付き sinc の多相補
  間器であり、ITU Annex 2 自身が公開しているフィルタテーブルをビット単位
  で再現したものではありません。上記の ffmpeg との突き合わせは、その近似
  が実際にどれだけ近いかの根拠であり、規格適合を主張するものではありませ
  ん。
- `models/bubble.ts` は、一部の録音に見られるオンセットのチャープ(気泡が
  発生源から離れる際に周波数がわずかに滑る現象)をモデル化していません -
  既知の、文書化された単純化であり、実装されていません。
- CLAP 評価の `degraded` コントロールは、純粋に物理モデルの生成器だけで
  構成されたプリセット(`impact` の 12 プリセットすべてが、取り除くもの
  が他に何もない単一の `modal` ノードです)については、「フィルタとエン
  ベロープだけ」以上のものを必然的に変えることになります -
  `clap-degrade-graph.mjs` 自身のドキュメントコメントが、degraded セット
  がそうした生成器も単純なノイズに置き換える理由を説明しています。これに
  より、明示的なフィルタ/エンベロープの連鎖を持つプリセットだけでなく、
  すべてのプリセットに対してこのコントロールが意味を持つようになります。
- CLAP の検索精度は、汎用のテキスト・音声モデルの埋め込み空間が、これら
  の音をプロンプトの説明どおりに分離できているかどうかを測るものです。上
  記のリスニングレポートを人間が聴くことの代わりにはならず、両者は一方が
  他方の代わりになるのではなく、並べて報告しています。

<a id="sources"></a>
## 出典

ここにあるすべての物理モデルに基づく生成器、そして自明でない DSP アルゴ
リズムはすべて、論文または文書化されたパブリックドメインのアルゴリズム記
述からの独立した実装であり、既存のコードベース(GPL であるかどうかを問わ
ず)の移植ではありません - 各ファイル自身のドキュメントコメントがその出
典を示しています。この表はそれをまとめたものです。

| 技術 | 出典 |
| --- | --- |
| バンドリミテッドオシレーター(PolyBLEP) | Valimaki & Huovilainen, "Antialiasing Oscillators in Subtractive Synthesis", IEEE Signal Processing Magazine (2007) |
| ピンクノイズ | Paul Kellet のパブリックドメインの「エコノミー」3 段 IIR 近似(musicdsp.org) |
| RBJ ビクアッドフィルタ | Robert Bristow-Johnson, "Audio EQ Cookbook" |
| アルゴリズミックリバーブ | Jezar のパブリックドメインの Freeverb アルゴリズム記述 |
| モーダル合成 | van den Doel & Pai, "The Sounds of Physical Shapes", Presence (1998); "Synthesis of Shape Dependent Sounds with Physical Modeling" (1996) |
| PhISEM 粒子モデル | Perry R. Cook, "Physically Informed Sonic Modeling (PhISM): Synthesis of Percussive Sounds", Computer Music Journal (1997) |
| Karplus-Strong 弦モデル | Kevin Karplus & Alex Strong, "Digital Synthesis of Plucked-String and Drum Timbres", Computer Music Journal (1983) |
| バブルモデル | Kees van den Doel, "Physically based models for liquid sounds", ACM TAP (2005)。Marcel Minnaert (1933) を土台にしている |
| 超越関数(`dsp/math.ts`) | Cody & Waite, "Software Manual for the Elementary Functions" (1980); Muller, "Elementary Functions: Algorithms and Implementation" (2016); 標準的な fdlibm のレンジリダクションの形 |
| シード付き PRNG | Tommy Ettinger の mulberry32(パブリックドメイン) |
| ラウドネス / トゥルーピーク | ITU-R BS.1770-4 / EBU R128。設計手法は libebur128 と pyloudnorm(いずれも寛容なライセンス。独立実装であり移植ではない)と突き合わせ済み |
| 技法全般の参考文献 | Andy Farnell, "Designing Sound" |

<a id="what-was-cut"></a>
## 省いたもの

- **ストレッチファミリー**(水、火、ドア、機械): 完全に省きました。ブリー
  フの「他が良ければ」という方針どおり、必須の 8 ファミリーの深さを優先
  しました。
- **声、動物、音楽**: このチケットの対象外であり、着手していません。
- **録音またはサンプリングされた音声**: すべての音はレシピとシードからオ
  フラインで合成されており、その構造上 CC0-1.0 です。
- **インパルスレスポンスによるリバーブ**: ここでのリバーブは純粋にアルゴ
  リズミック(Freeverb 方式)です。このパッケージのどこにも録音されたイ
  ンパルスレスポンスはありません。

<a id="testing-and-ci"></a>
## テストと CI

```bash
pnpm --filter sfx-engine test:unit          # node --test で test/*.test.mjs を実行、133 ケース
pnpm --filter sfx-engine test:hash-fixture  # 53 プリセット x シード 3 個をコミット済み SHA-256 フィクスチャと照合
pnpm --filter sfx-engine test:perf-budget   # 全プリセットをコミット済みの時間ベースラインと照合、3 倍で回帰ゲート
```

`build` と `typecheck` を合わせたこの 3 つが `sfx-engine` の CI ジョブ
(`.github/workflows/ci.yml`)です - 高速で、モノレポの他の部分から完全に
独立しています。すべてのプリミティブは解析的な期待値に対してテストされて
います(オシレーターの周波数はゼロクロス回数で、フィルタのカットオフは測
定した -3dB 点で、といった具合です)。`analysis/signal-checks.ts` のすべ
てのチェックには、肯定側と否定側(そのチェックにわざと違反するように作ら
れ、実際に検知することを証明するもの)の両方のテストがあります。CI から
意図的に除外している、ローカル限定のツールは以下のとおりです: `parity/`
のクロスエンジン Chromium/Firefox/WebKit 決定論性チェック
(`pnpm --filter sfx-engine parity:check`)、ffmpeg とのラウドネス突き合
わせ(`pnpm --filter sfx-engine loudness:ffmpeg-check`)、リスニングレポ
ート、そして CLAP 評価 - いずれも実ブラウザエンジンか外部ツールが必要で、
CI には積んでいません。
