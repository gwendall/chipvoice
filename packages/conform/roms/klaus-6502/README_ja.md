# Klaus Dormannの6502ファンクショナル/デシマルテスト、`Cpu6510`で実行

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

自己完結した2本の6502プログラムで、専用オラクルではなく`chipvoice`自身の
`Cpu6510`（`packages/chipvoice/src/chips/c64/cpu6510.ts`）に対して実行する。
どちらも自分自身を検証し、判定をメモリまたは固定のプログラムカウンタに残す
ので、比較対象は他に要らない。`docs/DECISIONS.md`の決定41の下で`vice-sid/`
と同様に同梱: GPLのテストプログラムはこの非公開ハーネスでは問題なく、公開
パッケージに入れることは決してない。

- `6502_functional_test.bin` - NMOS 6502のすべての正式オペコード、アドレシ
  ングモード、フラグ更新を検証する。出典は
  `https://github.com/Klaus2m5/6502_65C02_functional_tests`のコミット
  `7954e2dbb49c469ea286070bf46cdd71aeb29e4b`（2020-01-05）。GPL-3.0、本ディ
  レクトリの`LICENSE`。リポジトリ自身のビルド済み`bin_files`のコピーで無改
  変。SHA-256は
  `fa12bfc761e6f9057e4cc01a665a7b800ff01ae91f598af1e39a1201d01953fd`。フラッ
  トな64 KiBのイメージ（ファイルオフセット = アドレス、アセンブラ自身のビル
  ドログの記述どおり）として読み込み、`$0400`から開始、デシマルモードは有効
  （ビルドの既定）: 成功すると`$3469`で自分自身への`jmp *`に入って停止す
  る。それ以外の`jmp *`は失敗で、ランナーが報告するアドレスに留まる。
- `6502_decimal_test.bin` - Bruce ClarkによるADC/SBCのデシマル（BCD）モード
  検証（パブリックドメイン、`http://www.6502.org/tutorials/decimal_mode.html`）。
  同じKlaus2m5リポジトリに収録されているコピーを、ここでは`ca65`
  V2.18（`cc65` 2.19）を使い、ca65構文へ移植した
  `https://github.com/amb5l/6502_65C02_functional_tests`のコミット
  `966b1a35049f9d8be44ad092ec6d43d5ba1831b3`にあるその移植版自身の
  `example.cfg`リンカスクリプトでアセンブルした - ファンクショナルテストと
  異なり、Klaus2m5のリポジトリにはこちらのビルド済みバイナリは同梱されてい
  ない。ここに同梱したバイナリのSHA-256は
  `b179ca4c5a305de2d0cde9ccaa04861be965e2a85b9d3d1230dcc47a396ca43f`。
  `$0400`から開始し、プログラムカウンタが`$044b`（`DONE`、ソースの末尾にあ
  る65C02の`STP`バイトの直前で、これは`Cpu6510`が実装していないNMOS以外の
  オペコード）に達した瞬間にランナーは停止し、`$0b`の`ERROR`を読む -
  `0`が成功、`1`が失敗で、対象となる130,050通りの加算・減算はすべて第二の
  エミュレータではなく計算で求めた予測値と比較している。

どちらのプログラムも単一の決定的な実行で結果があらかじめ分かっており、レジ
スタ単位の比較ではないため、`run.mjs`のVICE-SID方式のディスパッチではなく
`packages/conform/src/roms/klaus6502.mjs`と`pnpm check:6510`に組み込んであ
り、結果は`docs/chips/c64.md`の独立した`<!-- cpu6510:begin -->`ブロックに書
き込む。`vice-sid`のROM表（ハーネス自身の、より古い`Cpu6510`が派生元ではな
い別ファイルの`Cpu6502`で実行する）とは別枠である。
