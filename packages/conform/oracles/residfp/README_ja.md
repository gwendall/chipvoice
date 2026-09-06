<a id="resid-fp-as-the-c64-oracle"></a>
# C64参照としてのreSID-fp

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


`residfp/`は[reSID-fp](https://github.com/drfiemost/residfp)です。libsidplayfp内の、Dag LemのreSIDをLeandro Niniがフォークした版をそのまま同梱します。VICEとreSIDの作者がダイ解析と実チップ標本から再構成したSIDの2生成器で、発振器の23ビットノイズと2サイクルのシフトパイプライン、kevtrisの取得値へ合わせた複合波形、包絡線の15ビットrateレジスター、指数カウンター、gate変更のサイクルごとの状態機械を含みます。`SID.cpp`のリンク依存でフィルターとリサンプラーもありますが、参照では実行しません。

`main.cpp`はハーネス側です。ログを読み、6581として1サイクルずつ進め、DAC前の各声の12ビット波形と8ビット包絡線カウンターの全変化を出します。正誤を定義できるデジタル部分です。DACとフィルターによる出力はchipvoice側のプロファイルです。`--tables`は6581波形表を出し、chipvoiceの複合波形モデルをそこへ合わせます。

`sidcxx11.h`はlibsidplayfpの代わりで、`residfp/siddefs-fp.h`は隣のテンプレートにconfigure変数を埋めたものです。

reSID-fpはGPL 2以降です。ここではテスト用で、文献から書いたパッケージへそのコードは入りません。`docs/DECISIONS.md`の設計判断18を参照してください。
