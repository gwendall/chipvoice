<a id="complete-arrangements--2026-09-06"></a>
# 完全アレンジ — 2026-09-06

<p align="center">
  <a href="COMPLETE-ARRANGEMENTS-2026-09-06.md">English</a> &bull;
  <a href="COMPLETE-ARRANGEMENTS-2026-09-06_ja.md">日本語</a>
</p>


再利用可能な経路は`importMidi → Performance → planPerformance → renderPerformance`です。独立した原典パートと正確なtickを保ち、省略音符と楽器／実機上の妥協をすべて報告します。存在しない伴奏を作りません。この段階の公開`/lab/arrangements`は全ミックス、パート分離、ローカルMIDI、テンポ／移調、マリオのネイティブA/B参照を提供します。既存トラッカーと公開API形式は維持します。

<a id="source-evidence"></a>
## 原典の証拠

| 原典 | 範囲 | 独立した証拠 |
| --- | --- | --- |
| マリオ地上テーマ | 4ボイス、1,276音符／打音、導入＋5,184フレーム反復全体、88.5375 s | 全41,999音楽命令のアドレス、値、順序、絶対CPUサイクルが固定Game_Music_Emuと一致 |
| ゼルダOverworld | Colletti MIDI、4パート、592音符、38.9147 s | midoによる独立台帳で全形式、パート、音高、境界、velocity、program、tempoを確認 |
| ソニックGreen Hill Zone | Turret 3471 MIDI、14パート、2,367音符、導入と主周期2回、91.45 s | 同じ全パートMIDI独立検査 |

ネイティブ参照はログだけのパッチを当てたGame_Music_Emu revision `fe8da4b6d3876d7542c2fb69d94487e19836d678`です。命令digestは`1a956e4e7a753a8383892108a82e4c70e7f3caf319b4934c641ab76e9661f67d`。NSF、独立PCM、raw trace、移植用抽出はそれぞれ固定hashを持ちます。`compare-native.mjs`は時間シフト／伸縮なしに実際の両実行traceを比較し、反復全体を検査します。

マリオの240 Hzエンベロープ／タイマー抽出は独自observerであり、レビュー済みhashは変更防止であって独立参照ではありません。ファミコン版は無変更のnative命令、他機種は移植です。ゼルダ／ソニックは完全なファンMIDI転記で、**原作ゲームの音色認証ではありません**。MIDI programはnative patchではありません。

<a id="allocation-and-audio-evaluation"></a>
## 割り当てと音声評価

| 曲 | ファミコン省略 | Game Boy省略 | メガドライブ省略 | スーパーファミコン省略 |
| --- | ---: | ---: | ---: | ---: |
| マリオ | 0 | 0 | 0 | 0 |
| ゼルダ | 2 | 2 | 0 | 0 |
| ソニック | 892 | 892 | 291 | 75 |

優先順の区間割り当てでメロディ／ベース予約を保ち、割り当て済み音を短縮／奪取しません。各原典IDは計画か省略報告に1回だけ現れます。ソロでもミックスの割り当てを保持します。SNESは8ボイス全部を有音高パートに利用でき、MDのPSG3はノイズ時計に予約します。音高範囲とパレット代替はボイス不足と分けて報告します。

`pnpm arrangements:eval`は12全ミックスを順番に各2回レンダリングし、PCM完全一致、有限／非クリップ、SNES dry／echo加算余裕を検査します。`verify-publication.mjs`は配備FLACをWAVへ結び付け、全デコード長を確認し、古いengine／source／evaluation識別や不完全な組み合わせを拒否します。公開録音の検証であり万能の忠実度%ではありません。コアは既存適合性検査で独立に確認します。

<a id="browser-evaluation"></a>
## ブラウザ評価

`apps/web/test-arrangements.mjs`は`.artifacts/arrangements/browser/`に画像／動画を記録します。初回操作の遅延音声、native／reference A/B、nativeパート分離、4機種の連続選択、ソニック全14パート、ローカル多声音MIDI、不正importエラー保持、tempo／transpose、処理中Stopを試します。320／390／768pxで横はみ出しと14px未満の文字なし。`test-buffer-playback.mjs`は遅い／失敗／キャンセル選択中の実音、最新選択優先、Stop、重複上限を測ります。

対話再生はデコードbufferの継ぎ目に3 ms taperを適用し、出力録音と独立PCMは変更しません。導入は1回、その後native loop startへ戻ります。A/Bは共有時計と減衰だけのRMS整合を使います。全renderとMIDI解析は交換可能なworkerで行い、準備中は現音声を続けます。

<a id="standards-review"></a>
## Standardsレビュー

文書化規則への違反はありませんでした。重大な設計／正確性問題として、独立sortしたバスbyteによるselector/data破壊、有限MIDIからの過大controller展開、置換準備中に旧decodeがcommitする問題を発見しました。atomic bus transaction、展開前200,000 expression point上限、同期的選択キャンセルで修正しました。再確認で消えるimportエラーを発見し、独立stateとブラウザ回帰を追加しました。

<a id="spec-review"></a>
## Specレビュー

別agentもバス問題、SNESを7有音高ボイスに制限していた問題、古い音声選択、マリオ移植抽出の保護不足、参照PCMと原典の結び付け不足を指摘しました。実曲のレジスタ宛先検査、8ボイス回帰、mutation、固定manifest、直接trace比較で修正しました。古いファイル読み込み失敗が新workerを停止しないよう、終了前にも所有権を検査します。

<a id="reproduce-and-extend"></a>
## 再現と拡張

[ワークフロー](../../scores/arrangements/README_ja.md)にimport、独立台帳、native capture、正確なtrace比較、公開コマンドがあります。SDK単体検査は不正MIDI、running status、sustain、重複音、controller／bend／tempo、決定的割り当て、損失を網羅します。mutationは欠落／捏造音符／パートと改変音楽／native命令を拒否します。合成バス衝突は共有FMラッチ、実曲は意図と実宛先を比較します。

混雑ホストのrender時間を性能基準にしません。この段階では専用deckとJSON／SDKを使用します。ゼルダ／ソニックnative patch、追加MIDI表現、コンパクトな公開トラッカー形式への統合は別作業です。

<a id="qualified-result"></a>
## 検証結果

全12ミックスでバイト再現性、有限／非クリップPCM、SNES内部余裕が成功しました。公開整合、原典／transaction、MIDI／allocator単体、型検査、アレンジブラウザ、共通buffer transportもローカル成功。遅延／失敗読み込み中RMS約0.091、Stop後0、同時buffer source最大4を観測。修正後、両レビューに重大な残件なし。

native digestと全snapshot metadataは[公開報告](../../apps/web/public/arrangement-data/report.json)にもあります。原典には休符があるため、1フレームの無音では故障とせずフレーズ区間で音を確認します。

![完全アレンジ画面](arrangements-desktop.png)
![390pxのアレンジ画面](arrangements-mobile.png)
