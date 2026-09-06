<a id="documents"></a>
# ドキュメント

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


コードと同じリポジトリで、目的、方法、判断を管理します。

| 文書 | 内容 |
| --- | --- |
| [ロードマップ](ROADMAP_ja.md) | ロードマップと各段階の受け入れ |
| [デモ仕様](DEMO_ja.md) | 遊べるデモの仕様 |
| [統合プレイグラウンド](UNIFIED-PLAYGROUND_ja.md) | 完全アレンジと再生操作 |
| [作曲操作](COMPOSITION-CONTROLS_ja.md) | 作曲操作と出典付き曲 |
| [連続再生](CONTINUOUS-PLAYBACK-LAB_ja.md) | 連続再生と公開試聴ラボ |
| [サイトの国際化](INTERNATIONALIZATION_ja.md) | Web辞書、ルーティング、メタデータ |
| [楽譜モデル](SCORE_ja.md) | 移植可能な楽譜と編曲モデル |
| [適合性検証](CONFORMANCE_ja.md) | 検証方法、コーパス、参照実装 |
| [試聴評価](AUDIO-EVALUATION_ja.md) | 試聴方法と音声測定 |
| [SNESパレット](SNES-PALETTE_ja.md) | SNESの楽器、エンベロープ、和音 |
| [プロジェクト監査](AUDIT-2026-09-05_ja.md) | プロジェクト監査（フランス語原文） |
| [設計判断](DECISIONS_ja.md) | 設計判断と理由 |
| [バックログ](BACKLOG_ja.md) | チケット、状態、発見 |

<a id="developer-guides"></a>
## 開発者ガイド

- [SDKとAPIリファレンス](../packages/chipvoice/README_ja.md)
- [原典に忠実なメロディ手順](../scores/README_ja.md)
- [完全MIDIとネイティブ編曲](../scores/arrangements/README_ja.md)
- [テストROMの出典](../packages/conform/roms/README_ja.md)
- [コンソールロゴの出典](../apps/web/public/machines/README_ja.md)
- [日本語共有カードのフォント](../apps/web/assets/fonts/README_ja.md)

<a id="chip-sheets-and-oracles"></a>
## チップ別の検証と参照

- [2a03](chips/2a03_ja.md) · [nes-snd-emu](../packages/conform/oracles/nes-snd-emu/README_ja.md)
- [dmg](chips/dmg_ja.md) · [gb-snd-emu](../packages/conform/oracles/gb-snd-emu/README_ja.md)
- [md](chips/md_ja.md) · [nuked-opn2](../packages/conform/oracles/nuked-opn2/README_ja.md)
- [snes](chips/snes_ja.md) · [snes-spc](../packages/conform/oracles/snes-spc/README_ja.md)
- [c64](chips/c64_ja.md) · [residfp](../packages/conform/oracles/residfp/README_ja.md)
- [シートのテンプレート](chips/TEMPLATE_ja.md)

<a id="evaluations"></a>
## 評価報告

- [完全アレンジ — 2026-09-06](evals/COMPLETE-ARRANGEMENTS-2026-09-06_ja.md)
- [作曲ツールとAPI基盤 — 2026-09-06](evals/CREATIVE-2026-09-06_ja.md)
- [遊べるデモV1評価 — 2026-09-05](evals/DEMO-2026-09-05_ja.md)
- [ホットパスの割り当て監査 — 2026-09-06](evals/HOT-PATHS-2026-09-06_ja.md)
- [英語／日本語Webサイト — 2026-09-06](evals/INTERNATIONALIZATION-2026-09-06_ja.md)
- [日本版コンソールのプレイグラウンド評価](evals/JAPANESE-PLAYGROUND-2026-09-06_ja.md)
- [MIDIインポートの進捗表示 — 2026-09-06](evals/MIDI-IMPORT-PROGRESS-2026-09-06_ja.md)
- [フロントエンドの読みやすい文字 — 2026-09-06](evals/READABLE-TYPE-2026-09-06_ja.md)
- [ループ録音の評価 — 2026-09-06](evals/RECORDING-2026-09-06_ja.md)
- [予約処理の設計と検証 — 2026-09-06](evals/SCHEDULING-2026-09-06_ja.md)
- [統合プレイグラウンド評価 — 2026-09-06](evals/UNIFIED-PLAYGROUND-2026-09-06_ja.md)

<a id="translations"></a>
## 翻訳

[RTK](https://github.com/rtk-ai/rtk/blob/develop/README_ja.md)に倣い、原文の隣に`_ja.md`を置き、各文書に言語リンクを付けます。日本語内の文書リンクは日本語へ、原文見出しの明示anchorは従来のfragmentへ対応します。コード、API識別子、コマンド、hash、ROMの実出力は原表記を保持します。第三者のREADME、ライセンス本文、AGENTS.md／CLAUDE.mdは翻訳しません。

内容変更では原文と日本語を同時に更新してください。局所判断はコードコメント、全体判断はDECISIONS.mdへ記録し、実装と食い違う古い説明は修正するか歴史と明記します。生成表は原文と同じ値を使います。ハーネスで数値を更新した後、以下を実行してください。新しい生成文言は`translations/generated-ja.json`も更新し、未対応形式を黙って英語で通さないようにします。

```sh
python3 docs/check-translations.py --sync-generated
python3 docs/check-translations.py
```
