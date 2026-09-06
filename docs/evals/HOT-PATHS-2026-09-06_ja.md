<a id="hot-path-allocation-audit--2026-09-06"></a>
# ホットパスの割り当て監査 — 2026-09-06

<p align="center">
  <a href="HOT-PATHS-2026-09-06.md">English</a> &bull;
  <a href="HOT-PATHS-2026-09-06_ja.md">日本語</a>
</p>


[予約処理の再設計](SCHEDULING-2026-09-06_ja.md)の後続を`f654876`基準でレビューしました。5チップの時計／出力、worklet、キュー、音楽ドライバー、ポーリング、オフライン出力／符号化、デモアニメーションを対象とします。同じPR #20内で、この時点ではマージ／本番リリース前です。

<a id="findings-and-changes"></a>
## 発見と変更

| 頻度／経路 | 発見 | 修正 |
| --- | --- | --- |
| GB／MD／SNESの毎出力サンプル | `end()`が左右2要素を生成し即座に分解破棄 | コア固有の再利用倍精度タプル。演算順序を保持 |
| Game Boy波形出力ごと | `Wave.output()`内の表リテラル | モジュール単位の表 |
| NES／GB長さ時計、NES有効化書き込み | チャンネル参照の一時配列 | GBは安定リスト、NESは直接参照。リセットを維持 |
| C64発振器時計 | 毎サイクル配列分解／反復 | 添字による直接アクセス |
| MD／SNES各音楽フレーム | 書き込みclosure再生成、FM音高の一時object | noteごとのwriter、FM音高はpacked register word |
| BRR候補探索ごと | 16サンプルに最大52配列とwinner object | 呼び出し内の2バッファを改善時交換、winnerはscalar |
| MP3各フレーム | 所有済みlamejs出力の再コピーと全ブロックview再作成 | 所有出力保持、完全ブロックはPCMを直接再利用、末尾だけview。monoは右バッファ不要 |
| UI各poll | 新位置object、filter／mapボイス配列、JSON化、closure可否検査 | 任意の呼出側位置格納、scalar／mask比較、変化時だけReact snapshot |
| シーケンサー各pump | 捨てるためだけの位置snapshot | 内部readerで期限切れ処理 |
| 再生位置／所有状態更新 | 楽譜再token化、音高／形状／style再計算 | パターンidentityで形状をmemo化 |
| スコープ／待機ページ | 毎frame closure、音源作成前から動作 | 添字描画、初期水平線は1回。出力node作成後にpoll開始 |

これはソース上の生成箇所と所有権の監査で、実測GC回数ではありません。JITが一部を消す可能性があります。44.1 kHzでは旧タプル生成箇所を各ステレオコアで毎秒44,100回通ります。新経路は1個を保持し、依存や共有可変scratch poolを追加しません。

<a id="ownership-and-deliberate-limits"></a>
## 所有権と意図的な制限

- scratchはコア、符号化呼び出し、または呼出側が所有し、独立処理間で上書きしません。
- `Chip.position()`は既定で独立snapshot。`position(into)`だけ再利用し、nullなら`into`を変更しません。Reactへは変更時の新snapshotを渡します。
- 出力段の既定snapshot動作を保持。タプルはJavaScript数値で早いFloat32丸めを避けます。
- 将来予約／復帰用のイベントとframeは独立recordのままです。消費前の再利用は将来の書き込みを壊します。外部ドライバー契約は維持。
- オフライン`subarray()`は最終PCMへのブロック単位zero-copy view。scratchとコピーへの置換は移動量を増やします。初期化／リセットと診断traceは連続音声経路と区別。
- 数値ローカル変数はローカルに保ちます。全`const`をループ外へ動かすだけではheap削減の証拠にならず、所有権／演算を曖昧にします。
- 音声開始後は曲停止中も試聴／SFX用にスコープとpollを維持。アニメーションの掃除とchip／context破棄を分離し、機種反復切り替えを保ちます。

lock済みlamejsの`encodeBuffer`／`flush`は内部バッファをコピーした新しい`Int8Array`を返します。型定義は`Uint8Array`ですが結合は両方を正しく扱います。

<a id="qualification"></a>
## 検証

- 本番ビルドと型検査成功。
- 全単体検査成功。5曲ゴールデン不変、ブロックサイズ／Stop／SFX回帰を含む。最終C64添字修正もデジタル検査とゴールデンを追加確認。
- 新検査でscratch／snapshotの同値性と独立性、位置格納とtimelineの非alias、readerなし期限切れ、修正前BRRの10ハッシュを確認。空／部分／複数ブロック、極値PCM、決定的ノイズ、loop有無を含む。
- 別bundleの`f654876`とMP3バイト比較。mono／stereo、完全／部分MPEGブロック全一致。
- 本番APIとChromiumデスクトップ／タッチ模擬が成功。5機種実音、Stop無音、効果音、切り替え、編集、共有、復元、コピーコード、バイト一致ステレオWAVを確認。全コーパス／ROM／ミキサーはPR現revisionのCI対象。画像、動画、測定、WAVは`.artifacts/demo/`。
- 形状／poll変更後のデスクトップ／携帯画像と動画フレームで、音符、再生線、機種操作、横スクロール編集の保持を確認。

ホストは混雑しています。数値的な遅延／CPU改善やアプリ全体のallocation-freeを主張しません。効果の定量化には代表端末のCPU／GC測定が必要です。特定の不要生成／コピーを除き、動作を保持したことを示します。
