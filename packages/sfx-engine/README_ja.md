<a id="sfx-engine"></a>
# sfx-engine

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

gamesounds.ai 独自の効果音プロシージャル合成エンジンです。決定論的で、
オフラインで動作する float64 の DSP がレシピとシードを PCM にレンダリング
します。サードパーティの音声、録音サンプル、外部生成 API は一切使いません -
このパッケージが存在する理由は
[Decision 52](../../docs/DECISIONS.md) を参照してください。全体のアーキテク
チャ、レシピ形式、モデル/パラメータのリファレンス、決定論性の保証、品質の
根拠(とその限界)は
[`docs/GAMESOUNDS-ENGINE.md`](../../docs/GAMESOUNDS-ENGINE.md) にあります。
このファイルはビルド・テスト・使い方だけを扱います。

ここでの「音」とはレシピ(JSON: どのモデルか、そのパラメータ、シード、サン
プルレート)とそのシードの組み合わせです。同じレシピは Node・Chromium・
Firefox・WebKit のどこでレンダリングしてもビット単位で同一の PCM になりま
す。2 つの層があります。

- **低レベルのグラフ**(`model: "graph"`): ノード・パラメータ・接続 -
  オシレーター、ノイズ、エンベロープ、フィルタ、ディレイ、リバーブ、
  ウェーブシェイピング、そして 4 つの物理モデル(モーダル合成、PhISEM、
  Karplus-Strong、バブルモデル)を明示的に配線したものです。
  `schema/recipe-1.json` が完全な、言語非依存の形式です。
- **53 個の高レベルの名前付きプリセット**(`PRESETS`、例: `impact-metal-heavy`、
  `scifi-laser`)が 8 つの分類ファミリー(UI、衝突、足音、振り、爆発、
  サイエンスフィクション、魔法、拾い物)にまたがっています。それぞれが薄く、
  文書化されたパラメトリックモデルで、内部でグラフにコンパイルされます。
  すべてのモデルは LLM の読者向けに書かれた機械可読な `metadata` を公開し
  ます: 平易な英語での説明、各パラメータの型/単位/範囲/デフォルト/意味、
  どのパラメータがシードごとに揺らぐか、そしてすぐにレンダリングできる
  2〜4 個の例です。

このエンジンがレンダリングするすべての音はその構造上、パブリックドメイン
(CC0-1.0)に捧げられています。録音やサードパーティのサンプルは一切使わず、
レシピとシードからオフラインで合成されるためです。

<a id="use"></a>
## 使い方

```ts
import { recipeForPreset, renderRecipe, PRESETS } from "sfx-engine";

const recipe = recipeForPreset("impact-metal-heavy", /* seed */ 7, 48000);
const rendered = renderRecipe(recipe); // { left, right, sampleRate, durationSeconds, loudness, ... }
```

`PRESETS`・`MODELS`・`getPreset` がレジストリです。`renderRecipe` は生の
`model: "graph"` レシピ(またはそれと同じ形の任意の JSON オブジェクト)も
受け取れます - レンダリング前に `assertValidRecipe` が
`schema/recipe-1.json` の規則に照らして検証します。

<a id="build-typecheck-tests"></a>
## ビルド、型チェック、テスト

```bash
pnpm --filter sfx-engine build              # tsc -p tsconfig.build.json
pnpm --filter sfx-engine typecheck
pnpm --filter sfx-engine test:unit          # node --test で test/*.test.mjs を実行(133 ケース)
pnpm --filter sfx-engine test:hash-fixture  # 全プリセット x シード3個をコミット済みの PCM ハッシュ フィクスチャと照合
pnpm --filter sfx-engine test:perf-budget   # 全プリセットのレンダリング時間をコミット済みのベースラインと照合、3倍で回帰ゲート
```

この 4 つが `sfx-engine` の CI ジョブ(`.github/workflows/ci.yml`)です -
高速で、モノレポの他の部分から完全に独立しています(`apps/sounds`、
`packages/gamesounds`、`packages/chipvoice` とは無関係)。以下の 2 つは
ローカル限定で、CI には含まれません。実ブラウザエンジンや外部ツールが
必要なためです。

```bash
pnpm --filter sfx-engine parity:check         # Node と Chromium/Firefox/WebKit の PCM ハッシュ一致検証
pnpm --filter sfx-engine loudness:ffmpeg-check # BS.1770 ラウドネス/トゥルーピークを ffmpeg の ebur128 と突き合わせ
pnpm --filter sfx-engine listen                # 自己完結型のリスニングレポートを生成(上記ドキュメント参照)
```

CLAP によるセマンティック評価(`eval/`、`.artifacts/clap_eval.py`)も
ローカル限定です。Python の venv が必要なため、pnpm スクリプトではなく
`docs/GAMESOUNDS-ENGINE.md` の品質の根拠のセクションに文書化しています。

<a id="what-is-not-here"></a>
## ここにないもの

`apps/sounds`、`packages/gamesounds`、`packages/chipvoice` のコードは一切
なく、それらへの変更もありません - このパッケージは追加のみで、独立してお
り、ランタイム依存はゼロです。録音やサードパーティのサンプルライブラリも
どこにもありません。音声・動物の鳴き声・音楽の合成はありません(このチケ
ットの対象外 - 何を省いたかは `docs/GAMESOUNDS-ENGINE.md` の該当セクション
を参照)。インパルスレスポンスによるリバーブもありません(ここのリバーブは
Freeverb 方式の純粋なアルゴリズムです)。CLAP のモデルチェックポイントとそ
れを動かす Python の venv は `.artifacts/`(gitignore 対象)にあり、このパ
ッケージが配布する `dist` には含まれません。
