<a id="japanese-share-card-font"></a>
# 日本語共有カードのフォント

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


`chipvoice-japanese.woff`は**Noto Sans CJK JP Regular**のサブセットです。SIL Open Font Licenseを`OFL.txt`に同梱しています。サーバー側の共有カード描画だけが読み、サイトはシステムの日本語フォントを使い、フォントファイルをダウンロードしません。

出典：https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf

再現方法（fontTools 4.62.1）：

```sh
python3 -m fontTools.subset NotoSansCJKjp-Regular.otf --unicodes='U+0000-00FF,U+2000-206F,U+3000-30FF,U+4E00-9FFF,U+FF00-FFEF' --flavor=woff --output-file=chipvoice-japanese.woff
```

かな、CJK統合漢字、ラテン文字、全角形、句読点を含み、利用者の日本語曲名を実行時の外部フォント要求なしで描画します。
