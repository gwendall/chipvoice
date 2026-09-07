<a id="automatic-mixing-api-and-qualification"></a>
# 自動ミックス API と検証

<p align="center"><a href="MIXING-API.md">English</a> &bull; <a href="MIXING-API_ja.md">日本語</a></p>

<a id="what-the-policy-does"></a>
## ポリシーの動作

`planPerformance(score, chip)` は楽器の実測した音量特性を使って移植版のバランスを調整します。
曲名、ソースのハッシュ、カタログ ID は判断に使いません。`importVgm` や NSF キャプチャの
ネイティブコマンド再生には適用しません。`mix: false` は従来の音量制御を保持し、
ボイス割り当ての修正は引き続き適用します。従来のコンパクトな `Score` 再生は作者の楽器音量を
保持します。自動ミックスには `Performance` または以下のフレーズ API を使います。

まず楽器を解決し、対応するハードウェアボイスを選びます。次にベロシティ、エクスプレッション、
楽器の実測特性、パートの明示設定、同時発音数を組み合わせます。4 音の和音はパートの音量予算を
分担し、各音を独立して正規化しません。同時発音数による音量変化には 30 ms の指数遷移を使います。
ソロは割り当て後に適用し、同じ同時発音数の判断を保持します。

校正済みの元ハードウェア情報があれば、その音量応答を経由して変換します。MIDI や未知の元音色では、
基準 RMS と控えめな役割別の重みで近似します。既定値はメロディー 1、和音 0.65、ベース 0.55、
打楽器 0.45 です。常にメロディーを主役にする規則ではありません。伴奏の音符は追加しません。
明示したトリムと重要度はベロシティ、プログラム、ハードウェアのエンベロープとは別です。

```ts
import {planPerformance, renderPerformance, mdChip} from 'chipvoice';
const authored = {
  ...score,
  parts: score.parts.map(part => part.id === 'bass'
    ? {...part, mix: {importance: 1, gainDb: -2}}
    : part),
};
const plan = planPerformance(authored, mdChip, {allowLoss: true});
console.log(plan.mix, plan.losses);
const audio = renderPerformance(plan, mdChip);
```

`importance` は 0–1、`gainDb` は −96〜+12 dB を指定できます。重要度 0 は元の音符や
割り当てを変えずに無音にします。ボイス不足による音符の省略には引き続き `allowLoss` が必要です。
自動減衰の上限は役割と同時発音数のトリムを指します。校正はその音量に到達するためにレジスタ制御を
変換するもので、作者のゲインを追加する処理ではありません。明示した無音は保持します。

<a id="calibration-and-uncertainty"></a>
## 校正と不確実性

`MIX_PROFILE_VERSION` は応答スキーマと検証したエンジン世代を識別します。標準測定値は
`scores/mixing/calibration-manifest.json` でコンパイル済みチップコードと測定方法に結び付け、
CI は古い測定を拒否します。エンジンや出力を変更した場合は再生成とレビューが必要です。
公開済み世代との互換性がなくなる場合はプロファイルのバージョンを上げます。SDK のリリースを
またいでカスタムプロファイルを使う場合は再検証してください。

標準コレクションは 44.1 kHz の 90 個の音色・ボイスプロファイルで、音高（またはノイズ周期）、
長さ、制御値のグリッドを持ちます。RMS とピークは一定制御の合成音符を実際のドライバ、チップ、
出力段に通し、ゲイン 1 で測定します。外部のソフトウェア音量エンベロープはプランナーが適用し、
応答表に焼き込みません。ハードウェアのエンベロープは測定に含めます。逆変換で目標 RMS を
制御値に戻します。FM はキャリアの減衰を符号化する直前まで小数精度を保持します。
ゲームボーイの波形音量とファミコンの三角波の段階的な制約は保持し、追加のゲイン段で物理挙動を変えません。

これは振幅の校正であり、知覚ラウドネスや音色の正しさを保証する判定器ではありません。
音高と長さの補間、短いアタック、リリース、デューティや波形の変化、ステレオ、非線形な同時ミックスは、
単独の持続音測定と異なります。評価器はステムの加算ではなく実際の全体ミックスを測定します。
NES の観測済みエンベロープには汎用ソフトウェアのエンベロープを二重適用しません。
FM の移植用観測は保持中の全パッチ変更、DAC 音色、ステレオを完全には復元しません。
MIDI の未対応イベントは保持して明示し、再現済みとは表現しません。

未校正のカスタム音色は、明示的な控えめのフォールバックをすぐ使用します。
準備時、例えばワーカー内で測定するには次を使います。

```ts
import {calibrateMixInstrument, MixProfileBank, mdChip,
        planPerformance} from 'chipvoice';
const measured = calibrateMixInstrument(mdChip, 'fm1', myInstrument);
const profiles = new MixProfileBank([measured]);
const plan = planPerformance(score, mdChip, {allowLoss: true, mix: {profiles}});
```

パートの `instruments` で `myInstrument` を明示的に選択してください。キャッシュの識別には
音色の全内容、ボイス、サンプルレート、プロファイルのバージョンを使います。外部のソフトウェア音量表は
音色の識別を変えません。バンクはデータをコピーして凍結し、カスタム項目を最大 64 件保持します。
準備は最大 256 測定点、合計 64 秒の模擬音符時間に制限し、ライブの音符や音声コールバックから
自動実行しません。これは処理量の上限で、実時間 64 秒以内の保証ではありません。
カスタムプロファイルは指定したボイスに対応します。標準 FM と NES パルスの共有については、
発音開始位置の差を別途測定します。計画の既定値は 44.1 kHz です。別のチップ描画レートには
`mix.sampleRate` を指定し、未検証の指定レートではフォールバックします。計画後に
`renderPerformance` のレートを変更しても、生成済みレジスタ制御の再校正は行いません。
48 kHz での感度実験は、48 kHz の標準プロファイルの認証ではありません。

`plan.mix.calibratedNotes`、`fallbackNotes`、`diagnostics` を確認してください。診断は
`plan.losses` にも含めます。校正済みとは応答表が見つかったという意味で、原曲との同一性ではありません。
楽器の上限を超える目標は制限して明示します。特に NES の三角波は連続音量調整ができず、
大きな NES ノイズ音はメガドライブの PSG の音量上限を超える場合があります。
ハードウェアが実現できない音量比まで保持するとは保証しません。

<a id="bounded-game-phrases"></a>
## 処理量を制限したゲーム用フレーズ

`prepareMixPhrase` は `planPerformance` と同じポリシーを使い、音声レンダリングやネットワークの
判定器を必要としません。割り当て済みのボイスを指定し、2 秒以内に終了する最大 128 音を受け取ります。
同じ物理ボイスで重なる音符は拒否します。呼び出し元は APU とトランスポートを継続し、返された音符の
相対位置を音声クロックに合わせて予約します。将来のボイスは割り当てず、フレーズ境界を越える任意の
持続音まで対応するとは主張しません。その調整はゲーム側のボイス管理が担当します。

```ts
import {APU, mdChip, instrumentsFor, prepareMixPhrase} from 'chipvoice';
const ctx = new AudioContext(); // ユーザー操作から作成・再開する
const apu = new APU(ctx, mdChip);
await apu.init(ctx.destination);
const phrase = prepareMixPhrase(mdChip, [{
  voice: 'fm1', part: 'lead', role: 'lead', at: 0,
  note: 'C4', duration: 0.25, instrument: instrumentsFor('md').lead,
}]);
const boundary = ctx.currentTime + 0.1;
for (const note of phrase.notes)
  apu.playNote(note.voice, {...note, at: boundary + note.at});
// 同じ APU をリセットせずに次のフレーズを準備する。
// 停止、効果音の競合管理、古い準備結果の破棄はホストが担当する。
```

未知の将来の曲は参照せず、入力の楽器や音符も変更しません。Worklet はミックスポリシーを
読み込まず、プロファイルの検索や準備用オブジェクトの毎サンプル確保も行いません。
ウェブプレイヤーは既存のワーカー中止とクロスフェードを保持し、パラメータ変更時は
現在のバッファを再生しながら次のバッファを準備します。

<a id="reproducible-evaluation"></a>
## 再現可能な評価

```sh
pnpm --filter chipvoice build
node scores/mixing/check-calibration.mjs
node scores/mixing/diagnose.mjs .artifacts/automatic-mixing/current
node scores/mixing/check-baseline.mjs .artifacts/automatic-mixing/current/report.json
node scores/mixing/validate-profiles.mjs
node scores/mixing/evaluate.mjs
node scores/mixing/benchmark.mjs
node scores/mixing/ablate.mjs
node scores/mixing/analyze.mjs .artifacts/automatic-mixing/current/report.json
```

標準測定の再生成には `node scores/mixing/calibrate.mjs` を使い、再ビルドしてから来歴を検証します。
開発用と未使用検証用のソース群は `scores/mixing/contract.json` に記載します。
`evaluate.mjs --held-out` の前に候補を固定します。検証結果をアルゴリズムの変更に使った場合、
その曲は開発用になり、新しい検証曲が必要です。元のコマンド記録はポリシーから独立しています。
派生した音符の観測は独立した参照実装ではありません。

開発用の除去実験は、推定した役割の重みと同時発音数による分担の 2 箇所だけを無効にして候補をバンドルします。
校正、作者の明示設定、ボイス割り当ては保持し、変換内容とバンドルのハッシュを別途記録します。
SDK を変更せず、固定した検証曲で再調整もしません。`analyze.mjs` はエンベロープ相関と
粗いスペクトル重複の指標を追加しますが、知覚的なマスキングやクリックの判定器ではありません。

正しさの検査は音符の追跡、再現可能な PCM、不正値、最終出力のクリッピング、SNES 内部の加算飽和を
対象にします。音響レポートでは RMS、ピーク、クレストファクター、ステレオ、アタックのエンベロープ要約、
スペクトルを別々に示します。好みや知覚的なマスキングの不存在は保証しません。
同じホストで交互に実行する計画時間の測定はポリシーの追加コストを分離します。
実機のスマートフォン・Safari と人間による比較試聴には、それぞれの証拠が必要です。
未完了の条件は[順序付きチケット](AUTOMATIC-MIXING_ja.md)を参照してください。
