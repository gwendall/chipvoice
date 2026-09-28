<a id="oracle-nuked-opm"></a>
# 参照基準：Nuked-OPM

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Alexey Khokholov（Nuke.YKT）のNuked-OPM 1.0。John McMasterによるチップのダイ画像から書かれ、サイクル精度で照合されたYM2151エミュレーターをネイティブビルドし、レジスターログで動かします。<https://github.com/nukeykt/Nuked-OPM>からLGPL 2.1で同梱します（[LICENSE](LICENSE)）。コミット`f209e6ed3712032b641d53ce8fb24824eae6adc3`に固定しています。本リポジトリ内のツールであり、参照実装そのものは同梱しません。ただし`ym2151.ts`（`packages/chipvoice/src/chips/ym2151.ts`）は`opm.c`を行単位で移植したものであるため、公開パッケージのライセンスはこれにより単純なMITではなく`(MIT AND LGPL-2.1-or-later)`です（決定17、決定51）。

<a id="what-is-nukeds-and-what-is-not"></a>
## Nukedのコードと本プロジェクトのコード

`opm.c`と`opm.h`は本人の無変更コードです。1ファイルはこちらのものです。

- `main.cpp`がログを読み、YM2151モード（`opm_flags_none`。Nuked-OPMが合わせて実装するYM2164/OPPは別チップであり本プロジェクトの対象外です。`docs/DECISIONS.md`の決定51を参照）へ、ログの2サイクルごとに1回`OPM_Clock`を呼びつつ2ポートへ書込を送り（このチップの内部ステートマシンは入力クロックの半分の速さで動きます）、2本のDACピンの全変化を`<cycle> <voice> <value>`として出します。声0が左、1が右で、このチップが持つ唯一の出力です。

初回にシステムCコンパイラーで`build/`へ作ります。

<a id="what-this-oracle-is"></a>
## この参照が示すもの

ダイ自体を除けば、手順の中で最も強い種類です。Nuked-OPMはダイの読解であり、chipvoiceのYM2151は名前も保った行単位の移植です（`packages/chipvoice/src/chips/ym2151.ts`。原作のYM2164/OPP専用分岐は除いています。詳細は同ファイルのdocコメントを参照）。その一致は内部サイクル単位のシリコン一致の根拠となり、ハーネスの差は移植の修正箇所を示します。

対象外はYM2164（OPP、本プロジェクトが必要としない別チップ）と、実チップのタイマーやCSMモードのうち可聴でない部分（この移植も同様にモデル化していません。`docs/chips/ym2151.md`を参照）です。
