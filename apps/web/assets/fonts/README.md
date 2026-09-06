# Japanese share-card font

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


`chipvoice-japanese.woff` is a subset of **Noto Sans CJK JP Regular** (SIL Open Font License, included in `OFL.txt`). It is loaded only by the server-side share-card renderer; the website uses system Japanese fonts and downloads no font file.

Source: https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf

Reproduction (fontTools 4.62.1):

```sh
python3 -m fontTools.subset NotoSansCJKjp-Regular.otf --unicodes='U+0000-00FF,U+2000-206F,U+3000-30FF,U+4E00-9FFF,U+FF00-FFEF' --flavor=woff --output-file=chipvoice-japanese.woff
```

Includes kana, CJK unified ideographs, Latin, full-width forms and punctuation so user-written Japanese song titles render without runtime requests to a font provider.
