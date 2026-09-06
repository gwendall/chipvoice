<a id="oracle-nuked-opn2"></a>
# 参照基準：Nuked-OPN2

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Alexey Khokholov（Nuke.YKT）のNuked-OPN2 1.0.12。チップのダイ画像から書かれ、サイクル精度で照合されたYM3438エミュレーターをネイティブビルドし、レジスターログで動かします。<https://github.com/nukeykt/Nuked-OPN2>からLGPL 2.1で同梱します（[LICENSE](LICENSE)）。ここの参照ビルドは検証用で、`chipvoice`へ同梱しません。パッケージ内の派生移植のライセンスは下記とルートREADMEを参照してください。

<a id="what-is-nukeds-and-what-is-not"></a>
## Nukedのコードと本プロジェクトのコード

`ym3438.c`と`ym3438.h`は本人の無変更コードです。1ファイルはこちらのものです。

- `main.cpp`がログを読み、YM2612モードへ内部サイクルごと1件の`$A04000-$A04003`書込を送り、全チャンネルの9ビット出力の全変化を、Mega Driveのマスター時計で`<cycle> <voice> <value>`として出します。別チップであるPSG書込は飛ばします。

初回にシステムCコンパイラーで`build/`へ作ります。

<a id="what-this-oracle-is"></a>
## この参照が示すもの

ダイ自体を除けば、手順の中で最も強い種類です。Nuked-OPN2はダイの読解であり、chipvoiceのYM2612は名前も保った行単位の移植です（`packages/chipvoice/src/chips/md/ym2612.ts`）。その検証範囲で参照一致は内部サイクル単位のシリコン一致の根拠となり、ハーネスの差は移植の修正箇所を示します。全アルゴリズム、feedback、detune、包絡線各段、SSG-EG、LFO、ch3特殊モード、DACを使うコーパスで全声が一致します。

対象外は文献実装のSN76489 PSGとアナログ段です。NukedのYM2612 DACモデルは作者自身が未検証とし、chipvoiceの2チップのミックスも仮実装です。
