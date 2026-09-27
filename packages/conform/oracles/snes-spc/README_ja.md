<a id="oracle-snes_spc"></a>
# 参照基準：snes_spc

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Shay Green（blargg）のsnes_spc 0.9.0。実機自身の出力に照らして書かれたS-DSPの「highly accurate」版をネイティブビルドし、レジスターログで動かします。<https://github.com/blarggs-audio-libraries/snes_spc>からLGPL 2.1で同梱します（[LICENSE](LICENSE)）。ここの参照ビルドは検証道具です。パッケージには別途このファイルの派生移植があり、独自コードのMITと区別してLGPLを適用します。

<a id="what-is-blarggs-and-what-is-not"></a>
## blarggのコードと本プロジェクトのコード

`snes_spc/SPC_DSP.*`、`snes_spc/blargg_*.h`、そして以下のCPU参照実装が
追加した`snes_spc/SNES_SPC.*`、`snes_spc/SNES_SPC_misc.cpp`、
`snes_spc/SNES_SPC_state.cpp`、`snes_spc/SPC_CPU.h`は本人の無変更コード
です。2ファイルはこちらのものです。

- `main.cpp`がログの`# memory`行からSPC700と共有する64 KBへサンプルを読み、SPC700時計の`$F2`／`$F3`書込を適用し、DSPを1クロックずつ実行します。この目的の`SPC_DSP_OUT_HOOK`で左右16ビット語の全変化を`<cycle> <voice> <value>`として出します。
- `play-spc.cpp`は標準入力から`.spc`ファイル全体（ヘッダー、ID666、ARAM、
  DSPレジスター）を読み、`SNES_SPC`にそれを読み込ませ、指定サイクル数
  だけ実SPC700（`SPC_CPU.h`）を動かし、蓄積済みソースが既に提供する
  `SPC_DSP_WRITE_HOOK`と`SPC_DSP_OUT_HOOK`という拡張点を通じて2種類の
  トレースを出します。CPUが行う全DSPレジスター書き込み（`--writes`:
  `<cycle> <register> <value>`、16進）と、全出力サンプル（`--samples`:
  `<cycle> <voice> <value>`、`main.cpp`と同じ形）です。どちらも指定しない
  場合は両方を人間が読める形で出します。ログからDSPだけを動かす
  `main.cpp`と異なり、これはblargg自身のCPUで実際に`.spc`ファイルを再生
  するものです - `importSpc`の新CPUとスナップショットローダーの参照
  実装であり、移植したS-DSPだけの参照ではありません。

初回にそれぞれシステムC++コンパイラーで`build/`へ作ります。

<a id="what-these-oracles-are"></a>
## この参照が示すもの

本S-DSP（`packages/chipvoice/src/chips/snes/sdsp.ts`）は`SPC_DSP.*`の行単位の移植で、DSP出力ストリームを比較します。このチップのデジタル出力はDACへ渡す語そのものなので、ストリームはチップ出力であり、実機からのデジタル取得も同じ種類です。コーパスのスクリプトと曲で、エコーとFIRを含めサンプルごとに一致します。`packages/conform/src/spc/check.mjs`（`check:spc`）は、実際の`.spc`ファイルから`play-spc`を、パッケージ自作の新SPC700（`spc700.ts`、`ssmp.ts`）とその`importSpc`スナップショットローダーと並べて動かします。これにより、上のDSP専用比較では全く見えない相違 - CPUより下流から始まるため - が、新CPU、そのタイマー、またはスナップショット復元のいずれかだと分かります。[docs/chips/snes_ja.md#spc再生](../../../../docs/chips/snes_ja.md#spc-playback)を参照してください。

いずれも対象外はDACとその後の本体アナログ出力で、chipvoiceの該当段は仮実装です。
