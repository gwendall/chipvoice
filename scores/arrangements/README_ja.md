<a id="complete-arrangements-and-repeatable-console-porting"></a>
# 完全な編曲と再現可能な機種移植

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


[編曲ラボ](https://chipvoice.dev/ja)にはプレイグラウンドと試聴ラボから到達できます。原典の編曲全体を保持し、各パートを分け、他機種へ収める費用を報告します。コンパクトなトラッカー曲には旧旋律エディターも残ります。

| 曲 | 原典の完全な範囲 | 検証 |
| --- | --- | --- |
| Mario · Ground Theme | ネイティブNTSC導入＋5,184フレームの1ループ、88.5375秒、4声、抽出1,276音／打音 | 41,999音楽書込が独立Game_Music_Emu実行と正確な絶対CPUサイクルで一致 |
| Zelda · Overworld | Colletti MIDIの全4パート、592音、38.9147秒 | 独立mido台帳で全パート、音高、開始、解放、ベロシティー、program、tempoを検査 |
| Sonic · Green Hill Zone | Turret 3471 MIDIの全14パート、導入と主題2周期、2,367音、91.45秒 | Zeldaと同じ独立mido台帳検査 |

Marioはネイティブ原典の再構成。ZeldaとSonicは完全な**MIDI採譜**で、元ゲーム楽器の検証ではありません。原典JSONにURL、作者／説明、チェックサム、正確なtick、残る通知を記録します。欠けたパートを埋めるためベース、和音、ドラム、アルペジオを自動作曲しません。

<a id="the-interface"></a>
## インターフェース

```ts
import {importMidi, planPerformance, renderPerformance, toWav, snesChip} from 'chipvoice';

const score = importMidi(midiBytes, {title: 'My arrangement'});
// 公開前にscore.noticesとscore.partsを確認。
const plan = planPerformance(score, snesChip, {allowLoss: true});
console.log(plan.losses); // 省略音符と音色／ハードウェア上の妥協を明示
const wav = toWav(renderPerformance(plan, snesChip));
```

`Performance`は`Score`を補い、既存トラッカー文書、API、下書き、共有曲を変えません。整数tick、テンポマップ、独立パート、多声音符区間、ベロシティー、program、時刻付き表情を持ち、原MIDIのチャンネルイベントも将来のアダプター向けに保持します。

`importMidi`はPPQ時刻のSMF 0/1に対応します。running status、重複音、チャンネル共通のprogram／volume／expression、ベンドとRPNベンド範囲、sustain、all-notes-offを処理します。途中で切れたファイル、不正status／data、対応のない解放、未終了音／ペダル、長さ0、SMPTE、format 2を拒否します。上限は8 MiB、256トラック、250,000チャンネルイベント、演奏100,000音、展開表情200,000点、レンダー10分。コントローラーの展開先数を展開前に検査し、MIDIをコードとして実行しません。未対応コントローラー、aftertouch、SysEx設定を報告し、pan、modulation wheel、ゲーム固有サンプルを黙って再現済みと主張しません。解析とレンダーは交換可能なブラウザーworker内です。文字はUTF-8を先に試し、不正なら明示通知付きWindows-1252へ戻します。古い西欧ファイルに対応しますが、万能な文字コード検出ではありません。原名を保持し、重複名はUIでチャンネル番号を添えて区別します。

自動の役割推定は下書きです。返されたtrack／channel IDでレビュー済み`parts`設定を渡すか、返されたパートの役割／優先度を編集します。原音IDが割当後も残り、全省略を追跡できます。高い優先度から区間を確保し、先に始まる低優先和音が将来の旋律の声を埋めないようにします。原音を短くしたり途中で奪ったりしません。区間は二分探索し、ドライバーが状態をキャッシュするため符号化は後で時刻順に行います。SNES全8声で有音高音を鳴らせます。

バス上のレジスター選択とデータを不可分にし、Mega Drive共通FM周波数ラッチも保護します。遅延取引は実機間隔を保ち、追加最大遅延を明記します。原典検査器はSNES／FMの生成書込先を独立に復号し、全バイトをドライバーの意図と比較します。有限でクリップしない音声だけでは誤レジスターを見抜けません。Mega DriveのPSG3はノイズ時計用、DMCは汎用の有音高声ではありません。ソロは**割当後**に行い、同じ省略を保ちます。

既定では発音予算超過は例外です。`allowLoss: true`は返された省略を受け入れる明示選択です。他の損失項目は汎用GM系音色への置換、実機包絡線制約、音高／ベンド範囲外を示します。GM program一致がゲームのパッチを再現するとは主張しません。レビュー済み`part.instruments[chipId]`（または`[chipId + ':' + program]`）でパレットを上書きできます。楽譜の表情は適用し、任意パレットの追加ビブラート、アルペジオ、スライドは、原典を飾らず省略として報告します。

対話用途はworkerでレンダーします。コンパイルと全ファイル描画はオフライン処理で、リアルタイムMIDI入力シンセではありません。音声コアと各サンプル経路は変えていません。`renderPerformance(plan, chip, {onProgress})`は各オフラインブロック後に完了フレーム割合0〜1を任意報告します。workerの通知は整数%ごと最大1回。デッキは保留ファイル名、準備段階、実描画%、経過時間、自動再生予定を示します。タイトル表示だけでは音声準備済みの証拠になりません。

<a id="reproduce-source-import"></a>
## 原典読込を再現する

```sh
pnpm --filter chipvoice build
pnpm arrangements:import song.mid new-arrangement.json reviewed-options.json
# 任意の設定ファイルは{title, parts: {"track-1-ch-1": {role, priority}}}を持つ。
# 出力は新規作成だけを許可し、レビュー済み原典の誤置換を防ぐ。

python3 -m venv .artifacts/arrangement-tools
.artifacts/arrangement-tools/bin/pip install -r scores/requirements.txt
.artifacts/arrangement-tools/bin/python scores/arrangements/extract-midi-reference.py \
  song.mid > .artifacts/independent-reference.json
pnpm arrangements:check
```

独立Python台帳は固定したZelda／Sonic用です。sustain付き原典は参照方法がレビューされるまで意図的に拒否します。SDKのsustainは別の手作り統合試験を持ちます。CIや候補のコンパイルで参照を再生成しません。パート／音の削除追加、音高、時刻、velocity、program、tempoの改変は全て失敗する必要があります。CLIは見える4機種で各原音が1回割り当てられるか省略報告にあるかも確認します。予約意図の検証であり、実機量子化後の音響音高ではありません。

<a id="reproduce-the-native-mario-reference"></a>
## Marioのネイティブ参照を再現する

`mario.json`の原典ハッシュで識別する正確なNSFを使います。NSF／ROMバイトと独立エミュレータービルドはローカル成果物に残し、サイトやnpmへ同梱しません。ソフトウェアライセンスは作曲、採譜、ゲームデータへ再許諾しません。原典追加ではクレジットを保持し、再配布権を確認します。

```sh
python3 scores/arrangements/native-oracle.py source.nsf .artifacts/arrangements
node scores/arrangements/capture-mario.mjs source.nsf .artifacts/arrangements/reproduced
node scores/arrangements/compare-native.mjs .artifacts/arrangements \
  .artifacts/arrangements/reproduced/mario-native.json
```

ネイティブツールはGame_Music_Emuの固定改訂`fe8da4b6d3876d7542c2fb69d94487e19836d678`へ記録だけのAPUパッチを当ててビルドし、独立PCMを作ります。`captureNsf`は別のテストCPUでバンクなしNTSC NSF v1を実行し、バンク付き、拡張音源、未対応ハードウェア読書、非公式命令は明示的に失敗します。万能NSFプレイヤーではありません。

Marioの旧16666 µsヘッダーはGME同様NTSC映像時刻と解釈します。繰り返す5,184フレームの音楽命令周期全体を検査します。参照台帳は初回PLAY後の全音楽命令を固定し、初期化は明示NSFリセット手順に従い41,999件に数えません。チェックサム一致はアドレス、バイト、順番、**正確な絶対サイクル**を含み、時間伸縮、音高丸め、任意の整列はしません。

ネイティブ・ファミコン再生は無変更の命令を使います。移植用にはオフライン観測器が実効エンベロープ／timerを240 Hzで読み、実機の発音アタックを保ちます。前後の無音包絡線部分を切り、Game Boyノイズ包絡線を0で始めるのを避けます。この観測器は本コアを使い、**独立した証拠ではありません**。無変更命令列がネイティブの真値で、移植表情と対象楽器は適応です。別のレビュー済みチェックサムで抽出の偶発変更を防ぎますが、独立した音楽参照とは表示しません。

<a id="evaluate-and-publish-a-snapshot"></a>
## スナップショットの評価と公開

```sh
pnpm arrangements:check
pnpm arrangements:eval
node scores/arrangements/verify-publication.mjs
```

順番に評価します。12の完全ミックスを各2回レンダーし、PCM完全再現、有限／非クリップ、SNES内部dry／echo加算の余裕を確認して、`apps/web/public/arrangement-data/`へロスレスFLACとレポートを書きます。中間WAVは`.artifacts`です。参照マニフェストは正確なNSF、固定エミュレーター改訂、トラック、サンプル形式、全PCM、書込トレースを固定チェックサムに結び付けます。公開検証器は12ケースの行列、現在のエンジン／原典／評価ID、参照由来、デコード全長、FLACとWAVのロスレス一致を検査します。通常Web CIに入り、不完全／古い素材は合格できません。独立GME録音には固有フィルターとリサンプラーがあり、PCM差は正確な命令証拠を無効にしません。実機録音でも万能な音楽品質点数でもありません。デジタルコアは別の適合性試験で確認します。

公開デッキは操作後だけ録音を読みます。テンポ、移調、ソロ、読込MIDIは交換可能workerで描画し、旧ジョブを終了し、現在聞こえる録音を保ち、最後に完了した選択を同じ楽曲位相へクロスフェードします。パラメーター変更は置換の完成前に保留デコードを直ちに取り消し、古い音の確定を防ぎます。読込失敗では音楽と、消えず対処できるエラーを保ちます。読込中もStopが優先です。

ネイティブ導入は1回だけ、以降は原典のループ開始へ戻ります。再生だけに3 msの短い端部減衰を付けて境界クリックを抑え、ダウンロードと参照PCMは変えません。A/Bは同期時計と減衰のみのRMS合わせを使います。テンポ、移調、ソロを編集すると参照比較を無効にし、編集版を元の取得と扱いません。

<a id="explicit-remaining-limits"></a>
## 明示する残る限界

- ZeldaとSonicのネイティブ楽器検証には、それぞれ独立したゲーム参照と固有マップが必要です。MIDI program確認だけでは足りず、採譜という表示を保ちます。
- 4チャンネル機ではSonicの14パートを同時再現できません。原典全体は保持しても移植で音を省略します。音ごとの会計はレポートを正とし、割合を忠実度%としません。
- 読込MIDIの役割とGM系音色はレビューが必要です。未対応表情は将来用に保持／報告し、黙って合成しません。
- 完全編曲は当初専用ラボ／プレイヤーとJSON／SDKの手順を持っていました。4役割トラッカーと公開APIは引き続き`Score`を使います。

<a id="long-midi-import-regression"></a>
### 長いMIDI読込の回帰

```sh
# CIは生成した82.5秒MIDIを使い、利用者のファイルを配布しない。
SITE=http://127.0.0.1:3074 node apps/web/test-midi-import.mjs
# 任意のローカル再現。ブラウザー内で解析しアップロードしない。
SITE=http://127.0.0.1:3074 MIDI_FILE=/absolute/path/song.mid \
  MIDI_CHIPS='Famicom,Game Boy,Mega Drive,Super Famicom' \
  node apps/web/test-midi-import.mjs
```

試験は目に見える進捗と実レンダー／デコード完了を待ち、ブラウザー出力を測ります。準備中Stop、旧トラック名、モバイルの読込配置、ブラウザーエラーも検査し、画像／動画／結果を`.artifacts/midi-import/e2e/`へ書き、CIでアップロードします。

<a id="unified-playground-transport"></a>
## 統合プレイグラウンドの再生制御

完全編曲デッキが今はホームです。`/lab/arrangements`は`/`へ戻り、技術エンジン比較は`/lab`へ残ります。一時停止／再開、先頭、曲全体のスライダー／楽譜シーク、任意ループに対応します。ネイティブMarioは導入後を繰り返し、機種／テンポ／ソロ変更は原典時刻の位相を保ちます。**Make a loop**は保存下書き付きで既存トラッカーを開きます。[操作と時刻の仕様](../../docs/UNIFIED-PLAYGROUND_ja.md)を参照してください。
