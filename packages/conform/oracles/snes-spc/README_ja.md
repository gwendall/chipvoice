<a id="oracle-snes_spc"></a>
# 参照基準：snes_spc

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Shay Green（blargg）のsnes_spc 0.9.0。実機自身の出力に照らして書かれたS-DSPの「highly accurate」版をネイティブビルドし、レジスターログで動かします。<https://github.com/blarggs-audio-libraries/snes_spc>からLGPL 2.1で同梱します（[LICENSE](LICENSE)）。ここの参照ビルドは検証道具です。パッケージには別途このファイルの派生移植があり、独自コードのMITと区別してLGPLを適用します。

<a id="what-is-blarggs-and-what-is-not"></a>
## blarggのコードと本プロジェクトのコード

`snes_spc/SPC_DSP.*`と`snes_spc/blargg_*.h`は本人の無変更コードです。1ファイルはこちらのものです。

- `main.cpp`がログの`# memory`行からSPC700と共有する64 KBへサンプルを読み、SPC700時計の`$F2`／`$F3`書込を適用し、DSPを1クロックずつ実行します。この目的の`SPC_DSP_OUT_HOOK`で左右16ビット語の全変化を`<cycle> <voice> <value>`として出します。

初回にシステムC++コンパイラーで`build/`へ作ります。

<a id="what-this-oracle-is"></a>
## この参照が示すもの

本S-DSP（`packages/chipvoice/src/chips/snes/sdsp.ts`）はこのコードの行単位の移植で、DSP出力ストリームを比較します。このチップのデジタル出力はDACへ渡す語そのものなので、ストリームはチップ出力であり、実機からのデジタル取得も同じ種類です。コーパスのスクリプトと曲で、エコーとFIRを含めサンプルごとに一致します。

対象外はDACとその後の本体アナログ出力で、chipvoiceの該当段は仮実装です。
