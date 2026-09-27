<a id="changelog"></a>
# 変更履歴

<p align="center">
  <a href="CHANGELOG.md">English</a> &bull;
  <a href="CHANGELOG_ja.md">日本語</a>
</p>

`chipvoice`パッケージとそのSDKの主な変更点を新しい順に記載します。現在のクイックスタートと機能概要は[README_ja.md](README_ja.md)を参照してください。

<a id="unreleased"></a>
## 未リリース

Game Boyの矩形波ノート（ch1、ch2）のトリガーは、周波数タイマーの下位2ビットをゼロにせず保持するようになりました。Pan Docsの「Obscure Behavior」（「When triggering Ch1 and Ch2, the low two bits of the frequency timer are NOT modified」）の通りです。トリガーされたノートの最初のデューティ段、そしてその後の全エッジは、以前より最大3サイクル遅く来るようになります。SameBoy参照実装に対して残る差の詳細は[docs/chips/dmg.md](docs/chips/dmg.md#known-deviations)を参照してください。

`validateSong`は、整った楽譜でもそのチップにはできないことを、ドライバーが黙ってクランプや打ち切りをする代わりに診断するようになりました。ボイスを音域外に振るビブラートやその音高で1レジスターステップ未満に潰れるビブラート（`vibrato_range`、`vibrato_resolution`）、ドライバーの60Hzフレームクロックが解決できないビブラートレート（`vibrato_rate`）、保持音を音域外へ運ぶスライドや周期テーブルの粗い区間を横切るスライド - 特に2A03とゲームボーイのテーブルの低音端（`slide_range`、`slide_resolution`）、レジスターに届く前にチップが丸める小数のボリュームステップ（`volume_step`）を報告します。声の予算の衝突も報告します。SIDの和音と打楽器がともにv3を使うような、物理ボイスを共有する役割（`voice_share`）、2A03の単一ノイズチャンネルのようにキットの1パートが1ボイスを共有するチップで、前の音の減衰が終わる前に次のドラムが来る場合（`perc_voice`）です。既存の`pitch_range`と`chord_capacity`を含め、すべての診断がメッセージに加えて`measured`と`limit`を持ちます。`Issue`は`voice`、`measured`、`limit`を任意フィールドとして追加し、既存の形は変わりません。出力音の変更はありません。これらは診断であり、修正ではありません。

<a id="0191-console-changes-without-a-dropout"></a>
## 0.19.1：途切れないコンソール切り替え

曲の途中で未準備のコンソールへ切り替えても、音が途切れなくなりました。逐次再生で新しいソースの最初のブロックが残りわずかな状態で届いた場合、準備済みの連続した読み込みで延長し、再生位置より少なくとも 0.75 秒先から始めます。別のソースを準備している間、再生中のソースは 1.5 秒ではなく 3 秒先までスケジュールします。未準備のレンダーと CPU を奪い合うためです。

`BufferPlayback` は隣の `ProgressivePlayback` と同じく TypeScript になりました。公開される型定義は、エントリー・クロック・グループ・パートを `any` のままにせず型付けします。音の変更はありません。公開済みのすべての編曲は 0.19.0 とバイト単位で同一にレンダーされ、既存の API も変わりません。

<a id="0190-a-games-own-mega-drive-driver"></a>
## 0.19.0：ゲーム専用の Mega Drive ドライバー

`MdDriver` とは別の、2 つ目の Mega Drive ドライバーです。複数のコンソールへ編曲する音楽ではなく、この機種のためだけに書かれた音楽を対象とします。詳細は[ネイティブドライバーのガイド](docs/MD-NATIVE-DRIVER_ja.md)を参照してください。

- `compileMdVoices(voices)` は、ハードパンと音符ごとのパッチを持つ `fm1`〜`fm6`、`psg1`〜`psg3`、ノイズチャンネル、DAC の PCM ストリームを駆動し、ハードウェアにできないことは拒否します。
- `arrangeMdTracker(song, {tailBars, bank})` はテキスト形式のトラッカーをコンパイルします。音符、休符、タイ、スライド、アーティキュレーション、パッチ、音量、ドラム、エコーチャンネル、ループ位置に対応します。
- `MD_BANK` は FM パッチ、PSG とノイズの音色、合成 PCM ドラムキットを提供します。
- ゲーム音声用のヘルパーで効果音をレンダー・トリム・レベル調整・パックできます：`renderMdEvents`、`trimRender`、`levelRender`、`scaleRender`、`packSprite`、`renderOnset`。
- `FmOperator.ssg` は両方のドライバーで SSG-EG を設定します。省略した場合は従来の音のままです。

<a id="0180-progressive-interactive-playback"></a>
## 0.18.0：対話操作向けの逐次再生

Web の作曲画面は `new ProjectPlayer({preview: true})` を使用します。この SDK のオプションは、オフライン書き出しと同じプロジェクトコンパイラと音源コアを使い、生成できた PCM ブロックから順に再生します。再生前に曲全体を WAV に変換してデコードする必要はありません。`previewMetadata` は長さ・ネイティブ再生の状態・ミックス結果を公開し、`losses` は両方の再生モードで使用できます。プレビューモードの `prepared` は `null` のままです。ファイルが必要な場合は `prepareProject()` または `renderProject()` を明示的に呼び出します。

```js
import {ProjectPlayer} from 'chipvoice';

const player = new ProjectPlayer({preview: true});
// Call play from a user gesture to unlock browser audio.
void player.play();
await player.load(project);
await player.update({tempoScale: 1.25});
player.setTitle('New title'); // Metadata only; no audio preparation.
```

準備中も現在の音を維持し、再生・一時停止の最新の操作を尊重します。表示は音声出力クロックに従います。ワーカーを再利用し、バリエーション・PCM・DSP 状態のキャッシュには上限があります。ただし、未準備の設定へ曲の途中で変更するときは DSP の履歴を再構築する必要があります。音符の位置だけではエンベロープ、サンプル位置、フィルタ、エコーを復元できません。ブラウザの音声解除、未取得のデータ、出力機器の遅延も残ります。既存の `ProjectPlayer()` の既定動作は互換性のため全体バッファ方式を維持します。
