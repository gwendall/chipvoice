<a id="changelog"></a>
# 変更履歴

<p align="center">
  <a href="CHANGELOG.md">English</a> &bull;
  <a href="CHANGELOG_ja.md">日本語</a>
</p>

`chipvoice`パッケージとそのSDKの主な変更点を新しい順に記載します。現在のクイックスタートと機能概要は[README_ja.md](README_ja.md)を参照してください。

<a id="unreleased"></a>
## 未リリース

SIDに第2のモデルが加わりました。既定の`"6581"`に加えて、`Chip.create`、`renderPerformance`／`renderProject`のオプション、プロジェクトの`settings.model`に`model: "8580"`を指定できます。8580に関するすべての事実は文書かオラクル自身のテーブルに対する測定から来ており、そのGPLソースを移植したものは一つもありません(決定41)。合成波形はreSID-fp自身の8580テーブルに対して独立にフィットしたもので、reSID-fp自身の8580コードがこのパッケージの共有モデルより詳細なトランジスタモデルを使っているため、6581の完全一致には届きません。フローティング波形出力とノイズレジスタのテストビットリセットはより長いコンデンサ放電で減衰します。OSC3(`$D41B`)は波形出力より1サイクル遅れてサウトゥース／トライアングルのパイプラインを読みます。DACはキンクのある6581と違いほぼ線形です。フィルターはreSIDの`filter.cc`の8580 R5カットオフ直線とQテーブルを、6581の測定済み曲線の代わりに直接読みます。第2のオラクルブロック、8580として設定したreSID-fpがデジタル側を検査し(`corpus/c64/parity-residfp-8580.json`、`check:residfp-8580`、CI)、99.28%一致、2件の相違はいずれも合成波形フィット自身の限界で説明できます。[docs/chips/c64_ja.md#8580](docs/chips/c64_ja.md#8580)を参照してください。6581の既定動作は変わりません。

メガドライブの`perc: "punchy"`意図は、キック、スネア、ハイハットをPSGノイズキットの代わりにチャンネル6上のFMパッチとして再生します。PSGノイズキットは既定のパーカッションのままです。YM2612のLFOは、パッチが求める場所ならどこでも鳴るようになりました。レジスター`$B4`の`ams`／`pms`、`$60`のオペレーター自身の`am`、`$22`のLFO自体の有効化と周波数です。移植可能な編曲器(`"bright"`のビブラート、FMキットのハイハット)とネイティブドライバー(`FmPatch.lfoFrequency`、`MD_PATCHES.shimmer`)の両方で鳴ります。以前はレジスターは書かれていましたが、起動時の`$22` = 0がそれらを無効にしていました。ネイティブドライバーは、音符の新しい`ch3`フィールド(`fm3`限定)、レジスター`$27`と`$A8`〜`$AE`を通じてチャンネル3の特殊モードにも届きます。ノイズキットが編曲器の既定であり続ける理由、チャンネル3の特殊モードがそこに出てこない理由は[docs/chips/md_ja.md](docs/chips/md_ja.md#driver-coverage)を参照してください。同時に修正：`MdDriver.noteOff()`がFMドラムのヒットの後に不要なPSG無音書き込みを送り、チャンネル6を実際にはキーオフしていませんでした。また、パーカッションパートのFM楽器(`planPerformance`)がノイズ音声自身のリダイレクトを経由せず直接fm6に割り当てられることがあり、同じハードウェアチャンネル上で旋律のfm6音符と衝突する可能性がありました。FMパーカッションは常にノイズ音声を経由するようになり、ノイズ音声がFMパッチを鳴らしている間はfm6を旋律の割り当てから外します。`prepareMixPhrase`も同じ重複を明示的に拒否し、ドラムキットにfm6を奪われた場合も他の代替と同様に診断として報告され、無言ではありません。

Game Boyの矩形波ノート（ch1、ch2）のトリガーは、周波数タイマーの下位2ビットをゼロにせず保持するようになりました。Pan Docsの「Obscure Behavior」（「When triggering Ch1 and Ch2, the low two bits of the frequency timer are NOT modified」）の通りです。トリガーされたノートの最初のデューティ段、そしてその後の全エッジは、以前より最大3サイクル遅く来るようになります。SameBoy参照実装に対して残る差の詳細は[docs/chips/dmg.md](docs/chips/dmg.md#known-deviations)を参照してください。

`validateSong`は、整った楽譜でもそのチップにはできないことを、ドライバーが黙ってクランプや打ち切りをする代わりに診断するようになりました。ボイスを音域外に振るビブラートやその音高で1レジスターステップ未満に潰れるビブラート（`vibrato_range`、`vibrato_resolution`）、ドライバーの60Hzフレームクロックが解決できないビブラートレート（`vibrato_rate`）、保持音を音域外へ運ぶスライドや周期テーブルの粗い区間を横切るスライド - 特に2A03とゲームボーイのテーブルの低音端（`slide_range`、`slide_resolution`）、レジスターに届く前にチップが丸める小数のボリュームステップ（`volume_step`）を報告します。声の予算の衝突も報告します。SIDの和音と打楽器がともにv3を使うような、物理ボイスを共有する役割（`voice_share`）、2A03の単一ノイズチャンネルのようにキットの1パートが1ボイスを共有するチップで、前の音の減衰が終わる前に次のドラムが来る場合（`perc_voice`）です。既存の`pitch_range`と`chord_capacity`を含め、すべての診断がメッセージに加えて`measured`と`limit`を持ちます。`Issue`は`voice`、`measured`、`limit`を任意フィールドとして追加し、既存の形は変わりません。出力音の変更はありません。これらは診断であり、修正ではありません。

SIDのフィルターは、見た目だけの汎用代替ではなく、編曲器自身の言葉から到達できるようになりました。leadの`sweep`はノート全体でcutoffを開き、bassの`resonant`は高いresonanceを一定に保ちます。両方lowpassです。各voiceは`$D417`の自分のrouting bitだけを立てて消し、共有されるresonance、cutoff、modeは実際に後から時間的に書き込まれた側のものになります。SIDには3voice共通のフィルターが1つしかなく、実機と同じ調停です。`SidDriver`はフィルターを使うvoiceの書き込みを、そのvoice自身の直前のフレームとだけ重複排除し、他のvoiceの書き込みとは比べません。ノートはまとめて1回で発行され、しかもノートは実際に書き込みが時間上どこに来るかではなく開始順に発行されるため、voiceを越えて共有される「最後に書いた値」と比べると、本当に必要な書き込みを取り落とすことがあったからです。`validateSong`に`filter_conflict`が加わり、異なるフィルター設定を求める2つのトラックが同時に鳴る最初のステップを名指しします。負けた側を耳で見つけさせるのではなく、名前を付けます。新しい`Instrument.pulseWidth`フィールドはドライバー層でframe単位のpulse-width sweepを与えますが、内蔵presetはまだ使いません。`script-filter`と`song-filter`がC64のconformanceコーパスに加わり、reSID-fpとのparityは100%を保ちます。フィルターはアナログ段のモデルであり、harnessが比較するデジタルの軌跡には触れないからです。

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
