<a id="oracle-ymfm"></a>
# 参照基準：ymfm

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Aaron Gilesによるymfm。独立した2つ目のYM2151モデルをネイティブビルドし、レジスターログで動かします。<https://github.com/aaronsgiles/ymfm>からBSD 3条項ライセンスで同梱します（[LICENSE](LICENSE)）。コミット`81aec25ccbb98f4873a255f7551ac4dadac59b4a`に固定しています。ここの参照ビルドは検証用で、`chipvoice`へ同梱しません。

<a id="what-is-ymfms-and-what-is-not"></a>
## ymfmのコードと本プロジェクトのコード

`src/ymfm.h`、`src/ymfm_fm.h`、`src/ymfm_fm.ipp`、`src/ymfm_opm.h`、`src/ymfm_opm.cpp`は本人の無変更コードです。ymfmの`ym2151`クラスが必要とするファイルのみで、それ以上はありません（YM2608/YM2610/OPL系列は同梱していません。本プロジェクトでは不要です）。1ファイルはこちらのものです。

- `main.cpp`がログを読み、2ポートへ書込を送りつつチップを動かし、2つの出力チャンネルの全変化を`<cycle> <voice> <value>`として出します。声0が左、1が右です。ymfmの`generate()`はNuked-OPMの`OPM_Clock`のようなサイクル単位モデルではありません。その時点のレジスター状態から完成済みの1サンプルを1呼出で生成し、サンプル内のどこで書込が起きたかという概念がありません。そのため書込はサイクル単位で差し込むのではなく、該当するサンプル期間（ログの64サイクルごと、このチップのclock/64のレート）へまとめます。最小限の`ymfm_interface`派生クラスはフックを何も上書きしません。タイマー、IRQ、busyフラグのいずれも`generate()`の出力に影響しません。

初回にシステムC++コンパイラーで`build/`へ作ります。

<a id="what-this-oracle-is"></a>
## この参照が示すもの

独立して書かれた2つ目のモデルです。ダイ画像からではなく、公開文献や他のエミュレーターの挙動から書かれ、実機キャプチャーで調整されています。有用な照合先ですが、本プロジェクトの正とはしません。chipvoiceのYM2151（`packages/chipvoice/src/chips/ym2151.ts`）はダイ画像由来のNuked-OPMを行単位で移植したものです（`docs/DECISIONS.md`の決定51）。2つの参照が食い違う場合は同決定の前例（決定48）に従います。ダイ画像由来の側を採り、食い違いはチップ自身のシート（`docs/chips/ym2151.md`）に明記し、黙って吸収しません。

そのため、この参照の照合は常に`--report`のみで、完全一致では判定しません。ここでの差はそれ自体では移植の不具合の証拠ではなく、どちらが正しいか、なぜかをシートに書く契機に過ぎません。
