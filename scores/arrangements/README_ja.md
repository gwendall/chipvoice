<a id="complete-arrangements-and-repeatable-console-porting"></a>
# 完全な編曲と再現可能な機種間移植

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

[プレイグラウンド](https://chipvoice.dev/ja)では、各曲を元の機種でオリジナルの音源コマンドから再生します。カートリッジを選ぶと元の機種も選択され、他機種版はアレンジと明示します。3 曲すべてに A/B 用の独立した参照音声があります。

| 楽曲 | ネイティブ原典 | 検証 |
| --- | --- | --- |
| Mario · Ground Theme | NTSC NSF。イントロと 5,184 フレームのループ、88.5375 秒 | 41,999 件の演奏コマンドが絶対 CPU サイクルを含め Game_Music_Emu と一致 |
| Zelda · Overworld | バンク切り替えを使う NTSC NES NSF、トラック 2。イントロと 1,920 フレームの反復周期 | 28,306 件の演奏コマンドが同一 CPU サイクルで Game_Music_Emu と一致。ディスクシステム版ではなく NES 版 |
| Sonic · Green Hill Zone | NTSC メガドライブ VGM。53.1993 秒、14.7993 秒からループ | FM・PSG・DAC の 458,039 コマンドが VGM のサンプル時刻で GME と一致。FM 6 声と DAC 両出力も 68,010,485 内部クロックにわたり Nuked-OPN2 と一致 |

以前の Sonic と Zelda はファンによる MIDI 採譜でした。検証対象は MIDI の音符であり、元ゲームではありませんでした。Sonic の MIDI 版は 291 音を省略し、原典にある 448,596 件の DAC サンプル書き込みを含んでいませんでした。ネイティブ再生ではゲームの設定とサンプルを保持します。出典 URL、クレジット、ハッシュ、制限は原典 JSON と参照マニフェストに記録します。

<a id="three-interfaces-one-audio-engine"></a>
## 3 つのインターフェース、1 つの音声エンジン

- `Score` とプリセット：ゲームと作曲向けのシンプルな音楽 API。
- `Performance`、独自音色、エクスプレッション：多声音楽と明示的なボイス割り当て。省略した音と音色の代替をすべて報告します。
- ネイティブのレジスタープラン：同じ音源コアでオリジナルのハードウェアコマンドを実行します。有限の音色一覧ではなく、チップの動作規則を実装します。

```ts
import {importVgm, renderPerformance, isolateNativePerformance, mdChip, toWav} from 'chipvoice';

const native = importVgm(vgmBytes);
const wav = toWav(renderPerformance(native, mdChip));
const drums = isolateNativePerformance(native, ['fm6']);
```

`importVgm` は NTSC メガドライブの YM2612 と SN76489 のクロック・設定を使う非圧縮 VGM 1.50〜1.71 に対応します。FM・PSG 書き込み、待機、DAC データブロック、PCM シーク、DAC 書き込み＋待機を扱います。不明なコマンド、別のハードウェア、不正な入力やループ位置は明示的に拒否します。上限は 8 MiB、10 分、バス書き込み 200 万件。DAC バンクには上限付きバッファを 1 個使い、サンプルごとのバンク確保はしません。VGM の時刻は毎秒 44,100 tick であり、元ゲームのサンプル未満の CPU バス時刻は復元できません。ブラウザーのレンダリングは交換可能な worker 内で行い、小さな VGM はネイティブのソロに必要な時だけ取得します。

```ts
import {importMidi, planPerformance, renderPerformance, snesChip} from 'chipvoice';

const score = importMidi(midiBytes, {title: 'My arrangement'});
const plan = planPerformance(score, snesChip, {allowLoss: true});
console.log(score.notices, plan.losses);
const audio = renderPerformance(plan, snesChip);
```

MIDI SMF 0/1 の PPQ 読み込みは原典の tick、多声、ベロシティー、プログラム、音量・エクスプレッション、ベンド、サステインを保持します。未対応のコントローラーは報告します。上限は引き続き 8 MiB、256 トラック、25 万チャンネルイベント、10 万音符、展開後のエクスプレッション 20 万点です。UTF-8 が不正なら Windows-1252 へのフォールバックを明示します。欠けたパートを埋めるためにベース、和音、ドラム、アルペジオを創作しません。

<a id="native-source-reproduction"></a>
## ネイティブ原典の再現

ダウンロードしたアーカイブ、ゲームの実行可能ファイル、参照ビルドはローカルの `.artifacts` に置きます。出典を明記して選択した音源ログと生成音声は、決定 29 に基づくデモ素材であり、ライブラリーコードのライセンス対象ではありません。NES の実行可能バイト列は同梱しません。Sonic の VGM は音源コマンドとサンプルデータであり、実行可能な ROM ではありません。原典 JSON に記載した出典と正確なハッシュを使用してください。

```sh
python3 scores/arrangements/native-oracle.py mario.nsf .artifacts/arrangements
node scores/arrangements/capture-mario.mjs mario.nsf .artifacts/reproduced
python3 scores/arrangements/native-oracle.py zelda.nsf .artifacts/native-songs/zelda-oracle 100 1
node scores/arrangements/capture-zelda.mjs zelda.nsf .artifacts/reproduced
python3 scores/arrangements/vgm-oracle.py sonic.vgm .artifacts/native-songs/sonic-oracle 54
node scores/arrangements/capture-sonic.mjs sonic.vgm .artifacts/reproduced
node scores/arrangements/verify-native-songs.mjs
node scores/arrangements/verify-ym-native.mjs
```

独立した GME のリビジョンは `fe8da4b6d3876d7542c2fb69d94487e19836d678` です。変更はログ記録だけで、デコーダー、CPU、エミュレーション、フィルター、リサンプラーは変更しません。NES の比較は最初の演奏 PLAY から始め、初期化は別途定義します。NSF キャプチャーはバンク切り替えあり・なしの NTSC 2A03 NSF v1 に対応し、拡張音源、ハードウェア読み取り、未対応 CPU 命令は拒否します。Mario の 5,184 フレームと同様、Zelda の 1,920 フレームの反復コマンド周期を全体で検証します。

Sonic では GME がデコードした VGM トレースから独立してバス書き込みを復元し、ネイティブの Nuked-OPN2 へ入力します。論理 VGM 書き込みは参照実装のバッファ方式に合わせ、FM ポートの各バイト間を 15 内部クロック空けて直列化します。同一サンプル時刻のバッチで処理待ちの音色・音程設定を上書きしないための処理で、元の CPU バス時刻を復元するものではありません。ストリーミング SHA-256 は全曲の全内部クロック後における FM 6 声と DAC 両出力を対象とします。参照マニフェストに結果と範囲を記録します。検証を通すための音程丸め、時間伸縮、任意の音声位置合わせは行いません。

<a id="portable-observation-is-not-native-emulation"></a>
## 移植用の観測はネイティブエミュレーションではない

NES の発音とエンベロープ・タイマー状態は自前コアで 240 Hz 観測します。Sonic の移植用観測器は通常 FM のキーオン・オフ、周波数変化、音色、PSG 音源の動作、DAC バーストを抽出します。これらは楽譜表示と他機種版のデータを生成しますが、**独立した音楽オラクルではありません**。レビュー済み抽出のハッシュで変更を検出し、未変更のネイティブコマンドを再生の正とします。FM エンベロープ・余韻、ステレオ、正確な DAC ドラムの種類は移植用音符に完全には復元していません。DAC バーストは現在汎用打楽器に割り当て、オリジナルサンプルを保持するのはメガドライブのネイティブ再生のみです。

アロケーターは優先度の高い区間から予約し、すべての損失を報告します。割り当て済みの音を短縮したり奪ったりしません。移植版のソロは割り当て後に行います。ネイティブのソロは有効ビット・キーオン・音量をマスクし、共有ラッチ、FM の時刻、PSG 音源 3 のノイズ用クロックを保持します。4 声の機種では 8 パートのメガドライブ曲の同時発音をすべて維持できません。テンポ変更と移調は音楽表現を使い、アレンジと表示します。

<a id="evaluate-and-publish-a-snapshot"></a>
## スナップショットの評価と公開

```sh
pnpm --filter chipvoice build
pnpm arrangements:check
pnpm arrangements:eval
node scores/arrangements/verify-publication.mjs
```

12 ミックスすべてを順番に 2 回レンダリングし、繰り返し PCM の一致、有限値・クリッピングなし、SNES 内部ドライ／エコーのヘッドルームを検証します。ロスレス FLAC とレポートは `apps/web/public/arrangement-data/`、WAV は artifacts に保存します。公開検証は現在の SDK、原典、評価方法、独立した証拠、完全なデコード時間、WAV と FLAC のロスレス一致を結び付けます。参照音声の欠落や元の機種でのアレンジへの置換は失敗します。

独立 PCM は GME によるもので、フィルターとリサンプラーは当方と異なります。レジスターやデジタルコアの一致は、最終 PCM の一致や実機測定を意味しません。アナログ出力と PSG 精度には既存の適合性検証の限界が残ります。A/B は共通の時刻と減衰のみの音量合わせを使い、万能な忠実度の百分率は示しません。

<a id="long-midi-import-regression"></a>
<a id="playback-and-midi-regression"></a>
## 再生と MIDI の回帰検証

デッキはホームにあり、`/lab/arrangements` はそこへ転送します。`/lab` には技術的なエンジン比較を、**Make a loop** にはコンパクトなトラッカーを残します。曲全体のシーク、再スタート、ループは原典の時刻を使います。設定変更は現在の再生を続けたまま worker で準備し、中止した処理は適用されません。ネイティブのソロは元の音を保持します。編集版・ソロでは A/B を無効にします。読み込みとエラーを表示し、Stop は常に優先します。

```sh
SITE=http://127.0.0.1:3074 node apps/web/test-midi-import.mjs
SITE=http://127.0.0.1:3074 node apps/web/test-native-songs.mjs
```

テストでは実際のブラウザー再生、読み込み、原典選択、ネイティブ A/B、ソロ、モバイル表示を操作します。成果物にはスクリーンショットと出力測定を含みます。[トランスポート仕様](../../docs/UNIFIED-PLAYGROUND_ja.md)も参照してください。
