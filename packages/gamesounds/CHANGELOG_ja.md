<a id="changelog"></a>
# 変更履歴

<p align="center">
  <a href="CHANGELOG.md">English</a> &bull;
  <a href="CHANGELOG_ja.md">日本語</a>
</p>

npmパッケージ`gamesounds`（[gamesounds.ai](https://gamesounds.ai)のCLIとランタイム）の主な変更点を新しい順に記載します。現在のクイックスタートと機能概要は[README_ja.md](README_ja.md)を、完全なデータモデル・タクソノミー・APIリファレンスはメインリポジトリの
[docs/GAMESOUNDS_ja.md](https://github.com/gwendall/chipvoice/blob/main/docs/GAMESOUNDS_ja.md)
を参照してください。

<a id="010-gamesounds-first-npm-release"></a>
## 0.1.0：gamesounds最初のnpmリリース

初回公開。`npx gamesounds add <event...>`はゲームイベント（カテゴリID、単
純なリーフ名、または`leaf/tag`）をgamesounds.aiに対して解決し、音声をダウ
ンロードして`sounds.json`と`SOUNDS-CREDITS.md`を書き出します。ダウンロー
ドしたファイルのSHA-256は、信頼する前に必ずサーバー自身のコンテンツアド
レス名と照合されます。`search`、`list`、`swap`、`sync`がCLIを補います。
`import { loadSounds } from "gamesounds"`は、マニフェストがローカルの
`sounds.json`（`loadSounds({ manifest })`）であってもライブで解決される
もの（`loadSounds({ remote: true, events, style })`）であっても、ラウン
ドロビンのバリアント、ピッチジッター、クールダウン、イベント単位とグロー
バルなボイス上限（優先度によるスティール付き）、`duck()`を持つ名前付き
`Bus`、iOSのジェスチャー要件に必要な`unlock()`をゲームに提供します。
`schema/manifest-1.json`は`sounds.json`自身が公開しているJSON Schema
（draft 2020-12）で、独自ツールが書くマニフェストを検証するためにイン
ポートできます。gamesounds.aiが配信するすべての音は、chipvoice自身のチッ
プエミュレーションかgamesounds自身の決定論的な`sfx-engine`によってレンダ
リングされており、サードパーティの音や外部の生成APIは一切使いません
（[docs/DECISIONS_ja.md](https://github.com/gwendall/chipvoice/blob/main/docs/DECISIONS_ja.md)の決定52を参照)。MIT。
