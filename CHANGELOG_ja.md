<a id="changelog"></a>
# 変更履歴

<p align="center">
  <a href="CHANGELOG.md">English</a> &bull;
  <a href="CHANGELOG_ja.md">日本語</a>
</p>

`chipvoice`パッケージとそのSDKの主な変更点を新しい順に記載します。現在のクイックスタートと機能概要は[README_ja.md](README_ja.md)を参照してください。

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
