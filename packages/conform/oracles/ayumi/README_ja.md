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

見つかった限界はない。このチップのあらゆるジェネレータについて、ノイズ
LFSR を含めて全面的に信頼できるオラクルである。Ayumi の `update_noise` は
`bit0 ^ bit3` という 1 つの新しいビットを計算し、それをビット 16 に挿入する
- フィボナッチ形式の LFSR である - これは MAME 自身の `noise_rng_tick()`
（`src/devices/sound/ay8910.h`、ライセンス BSD-3-Clause、Couriersud）と一致
しており、この構成が「AY-3-8910 および YM2149 の実チップで検証済み」である
と述べる、このプロジェクトが見つけた唯一の情報源である。`Ay8910` 自身のノ
イズジェネレータ（`packages/chipvoice/src/chips/ay8910.ts` の `tick()`）は
現在、同じ構成を実装している。`docs/DECISIONS.md` の decision 48 に記録さ
れている通り、このチケットの初期のバージョンは nesdev の「ビット 16 と 13
にタップを持つ」という記述をガロア形式の構成（シフトアウトされたビットを
タップされた 2 つの位置に直接 XOR する）と読んでいたが、レビューでその読み
は誤りだと判明した - 「タップ」はフィボナッチ形式の語彙であり、ガロア形式
の読みに同意していた唯一の情報源（Game_Music_Emu の `Ay_Apu`）にはハード
ウェア検証済みという裏付けがなかった。トーン、ミキサー/ゲート、固定ボリュ
ーム、エンベロープジェネレータ、そして今やノイズジェネレータまで、すべて
がこのオラクルに対して調整も一定シフトもなしで 100% 一致している - Ayumi
の `update_tone` は `Ay8910` 自身の `toneCounter` と同じ離散的な「カウンタ
対閾値」方式で各レジスタ書き込みの次のリロード時に新しい位相を開始する
（Game_Music_Emu の `Ay_Apu` のようなデルタ持ち越しの複雑さを調停する必要が
ない - `oracles/game-music-emu-ay.mjs` 自身の「既知の限界」参照）し、エン
ベロープテーブル（`ayumi.c` の `Envelopes[16][2]`/`reset_segment`）はどちら
かを信頼する前に `Ay8910` 自身の `ENVELOPE_SHAPES` テーブルと突き合わせ済
みである（`ay8910.ts` 自身のクラスdocコメント）。

<a id="a-second-oracle"></a>
## 2 つ目のオラクル

Game_Music_Emu の `Ay_Apu`（`oracles/game-music-emu-ay.mjs`、
`oracles/game-music-emu/README.md` 自身の「AY-3-8910/YM2149（`Ay_Apu`）」節）
が、このコアに対するもう一方のオラクルである。`core`（DAC モード、両オラク
ルに対して厳密一致でゲート）については裏付けとなるが、`edge` については報
告専用にとどまる: 自身のノイズ LFSR はガロア形式でハードウェア検証済みと
文書化されておらず、自身のトーン/ノイズタイミングも調整前提のオフセットを
抱えている - `docs/DECISIONS.md` の decision 48 がその両方の記録であり、後
続のチケット（MSX の AY-3-8910 ホストや、YM2203/2608 の SSG 部分 - どちら
も `ay8910.ts` 自身のクラスdocコメントで将来のホストとして名前が挙がって
いる）がこれを再導出せずに済むよう、明示的に書かれている。
