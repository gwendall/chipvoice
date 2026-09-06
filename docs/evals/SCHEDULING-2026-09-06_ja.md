<a id="scheduling-design-and-qualification--2026-09-06"></a>
# 予約処理の設計と検証 — 2026-09-06

<p align="center">
  <a href="SCHEDULING-2026-09-06.md">English</a> &bull;
  <a href="SCHEDULING-2026-09-06_ja.md">日本語</a>
</p>


`feat/playable-demo`のPR #20内の後続です。初CIの適合性ジョブで、ROMログを多数の`push`引数へ展開した`TransportCore.schedule`が失敗しました。利用者は引数展開だけでなく設計の修正を要求しました。[決定23](../DECISIONS_ja.md)に選択と制限を記録します。

<a id="what-the-failure-revealed"></a>
## 失敗が示したもの

量は実機の正当な通信です。アドレス／データ順序、反復書き込み、再トリガーを省略できません。wrapperが冗長なbuffer／cloneを作り、コアも履歴を繰り返しsort／shiftしていました。

| 操作 | 以前 | 共通scheduler |
| --- | --- | --- |
| 整列capture追加 | 引数展開、全sort、別コアqueue | 1runへ参照を線形コピー |
| 別batch追加 | 保留履歴を再sort | 必要なら新batchだけsortしrunをheapへ |
| 消費 | wrapper splice／map、複数コアのshift | 元recordを返し参照解除、run先頭を進める |
| idle chip cycle | 保留配列を見る | キャッシュした次時刻と比較 |
| キャンセル | wrapper filter | 該当runを圧縮、所有者なしraw書き込みを保持 |
| オフライン命令履歴 | 時計ゼロ固定 | host render時計、期限切れをその場で除去 |
| オフラインreset | reset前後にsample初期化 | reset後に1回 |

r個のrunで消費O(log r)、単一captureでO(1)。キャンセルは対象runを走査します。参照配列容量はrun消費まで残り、消費済みobjectは即解放します。持続音復帰用の現在／将来frameは保ちます。MDの受理済み実機書き込みは`Array.shift()`でなくring FIFOです。実行時依存とブラウザ通信プロトコルは追加しません。workletにはschedulerコードが増えるためbundle縮小とは主張しません。

ビルドは古い生成物を消し、全5worklet入口を統一して除外します。削除wrapperが増分`dist`に残らないようにします。

<a id="local-qualification"></a>
## ローカル検証

混雑ホストに配慮して順次実行し、以下が成功しました。

- `pnpm build`、`pnpm typecheck`。
- `pnpm test:unit`：既存音声／機能、500,000書き込み、独立stable-sortモデルとの4,000回決定的ランダム予約／キャンセル、FIFO拡張／折り返し、オフライン時計、期限切れ解放、sample初期化1回。
- 全5曲ゴールデン不変、各コアの128／4096サンプルブロック一致。Stop、遅延／重複効果音、持続音復帰成功。
- `pnpm --filter chipvoice-conform mixer`：以前落ちたcapture経路が完了。square、triangle、noise、DMCの既存実機録音条件を維持して成功。
- `pnpm --filter chipvoice-web test`：一時SQLiteの本番APIとChromiumデスクトップ／タッチ模擬。5worklet実音、切り替え、Stop、SFX、編集、全楽譜共有、下書き、実例、ステレオ出力が例外なく成功。
- `pnpm --filter chipvoice test:fresh`：空プロジェクトへpacked packageを導入し、発音、曲、SFXへのボイス貸与を確認。

変更しなかった5曲のハッシュ：

| 機種 | ハッシュ |
| --- | --- |
| NES | `8220846152b9937b` |
| Game Boy | `8cada5531fa0aa04` |
| Mega Drive | `109733dc8469f745` |
| SNES | `5b2fe9e2f23e1872` |
| C64 | `cc2a1343fa4f0849` |

ミキサー相殺はsquare -32.7 dB、triangle -33.0 dB、DMC -31.0 dB。noiseは録音との差4 dB以内です。CPUではなく適合性の測定です。

新画像／動画は`.artifacts/demo/`。デスクトップ／携帯と動画抽出フレームで機種操作、可視化、パッドを確認しました。出力はライブラリとバイト一致し、ffprobeでPCM16、44.1 kHz、stereo、6.666667秒です。将来音が鳴るはずの時点後もStop出力ピーク0.001未満。

全5コーパス、NES／GB ROM、ミキサーはCIに残します。全実行結果はPR現revisionを参照してください。以前のV1結果を本変更の再実行と扱いません。今回再実行したのはChromiumで、以前のFirefox／WebKitは[V1評価](DEMO-2026-09-05_ja.md)にあります。

<a id="limits-and-follow-ups"></a>
## 制限と後続

利用者のホストは混雑しているため、ローカル結果から遅延、throughput、CPU改善値を出しません。冗長処理と悪いスケーリングを除き音声を保持したことを示します。代表端末、実Safari／携帯、低レートCPU検証はバックログです。packed buffer／共有メモリ／先読み上限は負荷測定後に検討します。任意イベントの破棄は最適化として認めません。この評価時点でPRは未マージ／未公開です。
