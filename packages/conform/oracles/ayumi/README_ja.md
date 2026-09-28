<a id="oracle-ayumi"></a>
# オラクル: Ayumi

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

Peter Sovietov 氏の Ayumi。AY-3-8910/YM2149 コア（`Ay8910`、
`packages/chipvoice/src/chips/ay8910.ts`）に対する 2 つ目の、独立したオラクル
で、このチップを最初にホストするのは Sunsoft 5B 拡張音源（NEXT-15）である。
<https://github.com/true-grue/ayumi> から MIT ライセンス（[LICENSE](LICENSE)
参照）でベンダリングし、リビジョン
`07c08b4874c359169e4a028edf73f046d8b763e2` に固定している。これはこのリポジ
トリ内のツールであり、`chipvoice` パッケージには何も含まれない。

<a id="what-is-sovietovs-and-what-is-not"></a>
## Sovietov 氏のものと、そうでないもの

`ayumi.c`/`ayumi.h` は彼のもので、無変更である。`main.cpp` はこちら側のもの
で、chipvoice のレジスタログを読み込み、それで Ayumi を駆動し、各チャンネル
の生の 0-31 デジタルインデックスの変化を `<cycle> <voice> <value>` として出
力する - これは `Ay8910.trace` が生成するのと同じ単位であり、Game_Music_Emu
の `Ay_Apu`（`oracles/game-music-emu-ay.mjs`）とは異なる。後者が独自の振幅テ
ーブルのバイト値を報告するのは、その生のインデックスが公開アクセサのないプ
ライベート状態だからである。`main.cpp` 自身のモジュールdocコメントに、駆動
系の設計全体が書かれている: 2 段のクロック層（入力クロックからジェネレータ
ティックへ 16:1、`Ay8910.clock()` 自身の `prescaleCounter` と一致）、ジェネ
レータティックから `ayumi_process()` へ 8:1（`DECIMATE_FACTOR` 経由）、そし
てなぜ Ayumi の公開構造体フィールドを読み、ミキサーのゲート・インデックス式
を自前で再計算しているのか（`update_tone`/`update_noise`/`update_envelope`/
`update_mixer` を直接呼ばない理由） - これらは `static` であり Ayumi の公開
APIの一部ではなく、「オラクルにパッチを当ててコア側の挙動を採用させない」
というこのチケット自身のレビュー教訓が、それらを公開するためだけに変更する
ことを禁じているからである。ハーネスは初回使用時にシステムの C++ コンパイ
ラでビルドし、`build/` に置く。

<a id="known-limits-of-this-oracle"></a>
## このオラクルの既知の限界

- **ノイズジェネレータの 17 ビット LFSR は、このコア自身のものとは証明可能
  に等価でない別の構成である。** Ayumi の `update_noise` は `bit0 ^ bit3` と
  いう 1 つの新しいビットを計算し、それをビット 16 に挿入する - フィボナッ
  チ形式の LFSR である。nesdev の Sunsoft 5B オーディオページはこの実ジェネ
  レータについて「ビット 16 と 13 にタップを持つ 17 ビット線形帰還シフトレ
  ジスタ」としか述べておらず、これを文字通り読む - シフトアウトされたビッ
  トをタップされた 2 つの位置に直接 XOR する - とガロア形式の構成になる。
  `Ay8910` 自身のノイズジェネレータ（`packages/chipvoice/src/chips/ay8910.ts`
  の `tick()`）は現在これを実装しており、独立に書かれた Game_Music_Emu の
  `Ay_Apu` が同一のガロア式を使っていることで裏付けられている。
  `docs/DECISIONS.md` の decision 47 に、このプロジェクトが行った徹底的な探
  索（あらゆる挿入ビット、あらゆる XOR タップ、あらゆる出力ビット）の記録が
  あり、Ayumi の形式をどう並べ替えてもガロア形式の系列を再現できないことが
  示されている - これは 2 つの独立した本物の参照実装同士の、正真正銘の不一
  致であり、どちらのエンジニアリングにもバグがあるわけではない。ゲートがノ
  イズジェネレータに依存するコーパススクリプト
  （`corpus/ay8910/edge/noise-sweep.log`、`tone-noise-mixed.log`、および
  `gate-toggle.log` の 4 つの区間のうち 2 つ）は、このオラクルに対しては
  `--report` のみで、厳密一致のゲートには使わない。
- **トーン、ミキサー/ゲート、固定ボリューム、そしてエンベロープジェネレー
  タには既知の不一致がなく、厳密一致でゲートされている。** Ayumi の
  `update_tone` は、`Ay8910` 自身の `toneCounter` と同じ離散的な「カウンタ
  対閾値」方式で、各レジスタ書き込みの次のリロード時に新しい位相を開始する
  （Game_Music_Emu の `Ay_Apu` のようなデルタ持ち越しの複雑さを調停する必要
  がない - `oracles/game-music-emu-ay.mjs` 自身の「既知の限界」参照）。エン
  ベロープテーブル（`ayumi.c` の `Envelopes[16][2]`/`reset_segment`）は、ど
  ちらかを信頼する前に `Ay8910` 自身の `ENVELOPE_SHAPES` テーブルと突き合わ
  せ済みである（`ay8910.ts` 自身のクラスdocコメント） - `corpus/ay8910/core`
  （DAC モードのみ）と `corpus/ay8910/edge` 内のトーン/エンベロープのログは
  すべて、このオラクルに対して調整や一定シフトなしで 100% 一致している。

<a id="a-second-oracle"></a>
## 2 つ目のオラクル

Game_Music_Emu の `Ay_Apu`（`oracles/game-music-emu-ay.mjs`、
`oracles/game-music-emu/README.md` 自身の「AY-3-8910/YM2149（`Ay_Apu`）」節）
が、このコアに対するもう一方のオラクルである。この 2 つは単純にどちらかが
常に上位互換というわけではなく、重複しない別々の機能について信頼されてい
る - `docs/DECISIONS.md` の decision 47 が、どちらがどちらであるか、なぜそ
うなのかの記録であり、後続のチケット（MSX の AY-3-8910 ホストや、
YM2203/2608 の SSG 部分 - どちらも `ay8910.ts` 自身のクラスdocコメントで将
来のホストとして名前が挙がっている）がこれを再導出せずに済むよう、明示的
に書かれている。
