# レンダーの一致性

<a id="render-parity"></a>
<p align="center">
  <a href="RENDER-PARITY.md">English</a> &bull;
  <a href="RENDER-PARITY_ja.md">日本語</a>
</p>

MIX-14: 固定した入力セットがNodeと、自動化できるすべてのブラウザエンジンで同じPCMにレンダーされるかを確認します。`pnpm render-parity:sheet`で生成され、表を手で編集しないでください。

<a id="what-this-measures"></a>

## この測定が示すもの

固定された22件の小さな入力セット（公開済みの各アレンジメントを、それが再生できる各チップで短く切り出したもの、加えて、公開アレンジメントが到達しないC64をカバーするため各チップにつき数個の音色カタログのプリセット）。すべての入力は`PerformancePlan`であり、`packages/chipvoice/dist`の`renderPerformance`でレンダーされます。これはNode自身のオフラインレンダーと、（AudioWorkletProcessorがインスタンス化するのと同じ`ChipCore`クラスであることにより）サイトのリアルタイム再生パスの両方が使う関数そのものです。比較は生のfloat32 PCMバイトのSHA-256ハッシュを取り、16ビットの`toWav`出力は使いません。WAVファイルでは示せないほど小さな差でもハッシュが変わります。

<a id="last-run"></a>

## 直近の実行

- 日付: 2026-09-28T18:58:08.411Z
- リビジョン: `67386ba3102e0aa11cca50d82ccd9378929ac3cd`
- Node: v22.22.3

| エンジン | バージョン | 結果 |
| --- | --- | --- |
| Chromium | 151.0.7922.34 | all 22 match |
| Firefox | 153.0 | all 22 match |
| WebKit（PlaywrightのSafari代替、Safari本体ではない） | 26.5 | all 22 match |

<a id="results"></a>

## 結果

| 入力 | 種類 | チップ | 秒数 | Node SHA-256 | Chromium | Firefox | WebKit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| mario-2a03 | arrangement | 2a03 | 6.0 | `a17a93143152ca39…` | 一致 | 一致 | 一致 |
| mario-dmg | arrangement | dmg | 6.0 | `e040db30278d198e…` | 一致 | 一致 | 一致 |
| mario-md | arrangement | md | 6.0 | `84c20218f7ff1f2e…` | 一致 | 一致 | 一致 |
| mario-snes | arrangement | snes | 6.0 | `a4b38abbd778164b…` | 一致 | 一致 | 一致 |
| zelda-2a03 | arrangement | 2a03 | 6.0 | `e2b8d55359b40b0b…` | 一致 | 一致 | 一致 |
| zelda-dmg | arrangement | dmg | 6.0 | `9913b11c01f6aa1a…` | 一致 | 一致 | 一致 |
| zelda-md | arrangement | md | 6.0 | `ba30377a47560429…` | 一致 | 一致 | 一致 |
| zelda-snes | arrangement | snes | 6.0 | `e48021faaeb987ff…` | 一致 | 一致 | 一致 |
| sonic-2a03 | arrangement | 2a03 | 6.0 | `52d4e0b214afa431…` | 一致 | 一致 | 一致 |
| sonic-dmg | arrangement | dmg | 6.0 | `52230d6ace5de88d…` | 一致 | 一致 | 一致 |
| sonic-md | arrangement | md | 6.0 | `1f7ae17bd2389fdf…` | 一致 | 一致 | 一致 |
| sonic-snes | arrangement | snes | 6.0 | `1154274247dfdd52…` | 一致 | 一致 | 一致 |
| 2a03-lead-0 | preset | 2a03 | 1.2 | `da89f6de20923814…` | 一致 | 一致 | 一致 |
| 2a03-perc-k | preset | 2a03 | 1.2 | `32d55e22baf66cec…` | 一致 | 一致 | 一致 |
| dmg-lead-0 | preset | dmg | 1.2 | `4a9ac546dbe7e930…` | 一致 | 一致 | 一致 |
| dmg-perc-k | preset | dmg | 1.2 | `0ccd58ff9b83d424…` | 一致 | 一致 | 一致 |
| md-lead-0 | preset | md | 1.2 | `29e79c04c96a9ad7…` | 一致 | 一致 | 一致 |
| md-perc-k | preset | md | 1.2 | `b9a476361c0ebd4b…` | 一致 | 一致 | 一致 |
| snes-lead-0 | preset | snes | 1.2 | `a50e9d62a23ee8b7…` | 一致 | 一致 | 一致 |
| snes-perc-k | preset | snes | 1.2 | `52a64f4279058f09…` | 一致 | 一致 | 一致 |
| c64-lead-0 | preset | c64 | 1.2 | `e17460251730c6d0…` | 一致 | 一致 | 一致 |
| c64-perc-k | preset | c64 | 1.2 | `773c55dbf7900034…` | 一致 | 一致 | 一致 |

上記のすべての環境が、すべての入力についてバイト単位で同一のPCMを生成しました。

<a id="what-still-needs-a-person"></a>

## 人手がまだ必要な部分

PlaywrightのWebKitはCIやワークステーションで自動化できる中で最もSafariに近い代替ですが、Safari本体ではなく、上記のどのエンジンも実機のスマートフォンではありません。次の2つは手動のままです。

- **実際のSafari**（macOSまたはiOS）。Playwrightでは起動できません。
- **実機のスマートフォン**。その音声経路（実際のDAC、そのOSバージョンに紐づく実際のブラウザビルド）はこのリポジトリの何によっても代替できません。

確認するには、その端末で **https://chipvoice.dev/lab/render-parity** を開いてください。このシートと同じ固定入力セット（ページを軽く保つため、それぞれ短く切り出したもの）を取得し、同じブラウザで同じ`renderPerformance`呼び出しを使ってレンダーし、ページを構築したNodeの参照値の横に各入力のハッシュを表示します。入力ごとに一致・不一致が分かり、ページを開く以外の準備は不要です。所要時間は約1分です。リンクを開き、すべての行が終わるのを待ち、すべての行が一致するか確認してください。不一致があれば、ページに表示される端末・OS・ブラウザのバージョンとともに報告する価値があります。

これまでの手動確認（`scores/render-parity/manual-checks.json`に記録し、このシートが表示します。行はここではなくそちらに追加してください）。ページのNode参照値はエンジンとともに再構築されるため、各確認は記載したデプロイについてのものです。

| 日付 | デプロイ | ブラウザ | 端末 | 結果 |
| --- | --- | --- | --- | --- |
| 2026-09-28 | `6da5ac1` | Chrome | デスクトップ | 22件すべて一致 |
| 2026-09-28 | `6da5ac1` | Safari | Mac | 22件すべて一致 |
| 2026-09-28 | `6da5ac1` | Safari | iPhone 16 Pro | 22件すべて一致 |

<a id="what-runs-in-ci"></a>

## CIで実行される内容

`pnpm render-parity:check`（Node対Chromium・Firefox・WebKitの3エンジンすべて）はすべてのpushとpull requestで実行されます。その直後に`pnpm render-parity:self-test`が実行され、ブラウザのレンダーに意図的な差を1つ仕込み、チェックがそれを捉えることを確認します。これによりゲートが実際に機能することを証明します（常にPASSを表示するだけではないことを）。上記のシート（本ファイル）は別のローカル限定のステップ - `pnpm render-parity:sheet` - で、数値が変わったときに手動で実行してコミットします。フィクスチャの更新だけが必要なエンジン作業には`pnpm render-parity:fixture`単体を実行します（ブラウザもシートも不要で、`check.mjs`が比較に使うNode側の抜粋のみを再生成します）。
