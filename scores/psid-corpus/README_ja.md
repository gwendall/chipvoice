<a id="a-libsidplayfp-oracle-for-psidrsid-playback"></a>
# PSID/RSID再生のためのlibsidplayfpオラクル

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

[PSID/RSIDの再生](../../docs/chips/c64_ja.md#psidrsid-playback)（`importPsid`、NEXT-09）は、PSIDまたはRSIDファイル自身のINITとPLAYの機械語コードを、資料から書き起こした6510と最小限で開示済みのC64環境上で実際に実行し、曲がSIDへ行ったすべての書き込みを記録します。このディレクトリーは、その書き込みストリームを独立した第二のプレイヤー、libsidplayfpと突き合わせて採点します。これは[`nsf-corpus`](../nsf-corpus/README_ja.md)がGame_Music_Emuに対してすでに取っているのと同じ「推測せず、測る」というアプローチです - ファイル形式の仕様書の文章から読み取るのではなく、INIT自身の呼び出し規約（どのレジスタが意味を持ち、どれが本当に未定義か）を実測で確定させます。

<a id="what-is-in-the-corpus-and-what-is-not"></a>
## コーパスに含まれるもの、含まれないもの

`sources.json`が、コミットされた各ファイルのタイトル、作者、ライセンス、ライセンスURL、出典URL、SHA-256を記録します。最初の2本は自作（CC0、本チケット自身のもの）で、見つけた曲の付随的な振る舞いに頼るのではなく、それぞれ狭い1つの問いを両エンジンに同時に突きつけるよう作られています - 各エントリー自身の`purpose`を参照してください。

- `convention-probe.sid`は、INIT自身の`A`、`X`、`Y`とPHPで取り出した`P`を、何もしないうちに一度だけ`$D400`〜`$D403`へそのまま格納します - 呼び出し規約そのものを、推測ではなく書き込みストリームとして読み戻すものです。
- `frame-rate-probe.sid`は、INITで開始マーカーを書き込み、その後PLAYが呼び出しのたびに1つのレジスタを多数フレームにわたってインクリメントします - PLAY自身のカデンスを、実機のライン単位VIC-II自身のラスター割り込みと突き合わせるものです。

残る4本は、自作ではなく、実在するプレイヤー自身のコマンドライン・パッカー／リロケーターが書き出した実在の曲です - `gt2-dojo.sid`、`gt2-sanction-cia.sid`、`gt2-hyperspace-alt.sid`、`gt2-consultant-alt-cia.sid`は、GoatTracker 2自身が同梱する例題曲のうち4曲（公式v2.77配布、SourceForge、GPL-2.0-or-later）を`src/gt2reloc.c` - 対話型エディター自身のF9が呼ぶのと同じリロケーターを、`GT2RELOC`ガード付きで非対話ビルドしたもの、`Usage: gt2reloc <songname> <outfile> [options]`、UI自動化は一切なし - に通したものです。この1本のツールから、2種類のドライバー×2種類のタイミングという4通りの組み合わせを網羅しています。`gt2-dojo.sid`と`gt2-sanction-cia.sid`はGoatTracker 2の標準プレイヤー（`player.s`）を使い、`gt2-hyperspace-alt.sid`と`gt2-consultant-alt-cia.sid`はその代替プレイヤー（`altplayer.s`、`gt2reloc`自身が文書化している`-A`ハードリスタートADSRフラグの値が`$f000`に達すると選ばれる、`greloc.c`が実装しているとおり）を使います。`gt2-dojo.sid`と`gt2-hyperspace-alt.sid`はPAL・1倍速なので、リロケーターは全ゼロのPSIDスピードワードを書きます - VBI時限です。`gt2-sanction-cia.sid`と`gt2-consultant-alt-cia.sid`は`-S2`（2倍速マルチプライヤー）を加えるため、リロケーターは代わりに全ワンのスピードワードを書きます - CIA #1時限です。正確なコマンドラインと配布物自身のmd5は、`sources.json`内の各エントリー自身の`purpose`を参照してください。

6本すべてが、libsidplayfp自身のアドレス／値の並びと完全に一致します。最初の相違で止めず、トレース全体を最後まで走査した上での結果です：`gt2-sanction-cia.sid`と`gt2-consultant-alt-cia.sid`の8218件と7766件のイベントは、そのすべてがlibsidplayfp自身のトレースと同じレジスタ・同じ値を持ち、他のどのフィクスチャとも同じ`matched === total`のゲート（`compare.mjs`の`comparePsidTrace`、`corpus.mjs`自身の内容ゲート）を通過します。このCIA時限の2本が一致せず、内容としてもゲートされていないのは、各PLAYフェーズの書き込みが「いつ」着地するかです：本環境自身の書き込みとlibsidplayfpのそれとのサイクル差は、常にVIC-IIバッドライン1回分の43サイクルDMAスティール（`psid-import.ts`の`BADLINE_STEAL_CYCLES`）の整数倍に、ラスター同期ディスパッチにもともとある命令境界の揺らぎ数サイクルを加えたものです。これはCIAエミュレーションのバグではありません：VBI駆動の曲は呼び出しごとのバッドライン回数が常に同じ（PAL1フレームはちょうど39バッドライン周期）なので、この比較器自身の1ファイルごとの単一キャリブレーションから打ち消し合って消える - `gt2-dojo.sid`と`gt2-hyperspace-alt.sid`がそれを正確に裏付けており、どちらもPLAYフェーズの最大サイクル偏差は3および5サイクルという、通常のライン単位の揺らぎにとどまります。CIA駆動の曲は自身のディスパッチ周期がその504サイクル周期の整数倍ではないため、どの呼び出しがバッドラインの近くに来るかは呼び出しごとに変わり、libsidplayfp自身のトレースが実際どちらに転ぶかは、その`cold:`ドライバーの儀式が最初にINITを呼ぶ瞬間のラスター位相そのものに依存します - これはPSID/RSID形式が定義していない量（実機のディスクロードとKERNALブートのタイミングは実際にばらつく）であり、libsidplayfp自身の`SidConfig::powerOnDelay`は通常の使用では意図的にこれを*ランダム化*するために存在し、このコーパス自身の決定論的テストのためだけに1つの固定値へピン留めしています。精密に計測した結果：両方のCIA時限ファイルの最大サイクル偏差は128（バッドライン2周期分、誤差1〜2サイクル以内）で、これは単独で報告され（シートの「PLAYサイクル偏差」列）、内容の一致には一切組み込まれず、より広い、仕組みから導いた境界（`corpus.mjs`の`CIA_CYCLE_BOUND = 134`。他の4フィクスチャの`PLAY_TOLERANCE = 5`より広い）でゲートされます。本プロジェクト自身のINIT時点のラスター位相を、libsidplayfp自身の実測値に強制的に合わせることも試しましたが、この乖離は大きく縮まる一方で、上記のVBI時限2本に同程度の新たな乖離が生じ、その理由はまだ完全には理解できていないため、元に戻しました。シート上には、精密に特徴づけられ構造的に説明の付いた残差として残しており、黙って修正したり曖昧なままにしたりはしません。詳しくは`docs/chips/c64_ja.md`の「既知の限界」、`packages/chipvoice/src/psid-import.ts`自身の`badlineSteal`、`docs/BACKLOG_ja.md`のNEXT-09フォローアップ（実測の前後の数値と試したことの記録）を参照してください。

HVSCと商用の吸い出しは、ここでもプロジェクトのどこでも決して対象になりません（decision 41）。

gitignoreされた`.artifacts/psid-private/`ディレクトリーも、nsf-corpus自身の`.artifacts/nsf-private/`と同じ方法で採点されます。所有者自身のローカルな、再配布できないファイルのためです。CIはこのディレクトリーを用意しないため、CIの実行には一切影響しません。その結果はprivateと明記してコンソールに出力されるだけで、コミットされるJSONやシートには含まれません。

<a id="running-it"></a>
## 実行方法

```sh
pnpm --filter chipvoice build
node scores/psid-corpus/test-compare.mjs   # 比較器だけを検証。参照実装のビルドなし
pnpm psid-corpus:check                     # コーパス全体をlibsidplayfpと比較
pnpm psid-corpus:sheet                     # docs/chips/c64.mdの生成ブロックも書き換える
```

`pnpm psid-corpus:check`は、ピン留めしたlibsidplayfpのリビジョンをクローン・ビルドしてgitignore対象の`.artifacts/psid-corpus/sidplayfp-oracle/`ディレクトリーに置き（`native-oracle.mjs`。GPL-2.0-or-later、`packages/chipvoice`には一切ベンダリングしない）、小さな独自実装のロガー（`sidplayfp-harness.cpp`）をlibsidplayfp自身の公開`SidConfig::sidEmulation`フックを通して差し込んで実行します - SIDの音声は一切模擬せず、libsidplayfp自身のソースにも一切パッチを当てません - そして、`comparePsidTrace`（`compare.mjs`）で両者の書き込みストリームを比較します。`--no-oracle`はその構築と比較を丸ごと省略し、本実装の記録が何イベントを生み出すかだけを採点します。ネットワークがない場合や、新しいフィクスチャを追加している最中に便利です。

`nsf-corpus/compare.mjs`の単一のシフトとは異なり、この比較器は2つの別々のシフトを計算します。1つはINITフェーズ用、もう1つはPLAYフェーズ用です。libsidplayfp自身のコールドスタートルーチンは、INITの実行にかかる時間に関わらず決定論的なタイミングを保証するため、INITを呼び出す前に固定のラスターラインまで待機します。これがINIT自身の絶対サイクル数を、PLAY自身の定常状態のカデンスとは共有しない大きな一回限りのオフセットだけ、我々の側からずらします。INITフェーズのイベントは、そのシフトを適用した後、サイクル許容誤差ゼロで（全フィクスチャで完全一致することを確認済み）内容ゲートの一部として判定します。PLAYフェーズの内容（アドレスと値）も同じく完全一致で判定しますが、PLAYフェーズの書き込みの「サイクル位置」は別途計測してゲートし、「一致」には一切組み込みません：`corpus.mjs`は、ラスター同期している曲については`PLAY_TOLERANCE = 5`サイクル（実測値そのもの、CIA以外の4フィクスチャの実際の最大値）で境界を設け、ディスパッチがラスター同期していないCIA時限の2フィクスチャについては、より広い、バッドライン周期から導いた`CIA_CYCLE_BOUND = 134`で境界を設けます（詳細は上の「コーパスに含まれるもの、含まれないもの」を参照）。計測した具体的なサイクル差分を含む完全な説明は`compare.mjs`自身のドキュメントコメントを参照してください。

`convention-probe.sid`自身の`X`と`Y`は比較そのものから除外されます（`sources.json`自身の`undefinedRegisters`が`compare.mjs`自身の`ignoreAddrs`になります）。ファイル形式の仕様書は`X`も`Y`も一切定義しておらず、本プロジェクトは意図的にこれらを0にしており、libsidplayfp自身の参照ドライバーは、無関係なCIA／ラスター設定の分岐が最後に読み込んだ値をそのまま保持しているだけです - どちらの側でも文書化された値ではなく、採点すべき正解がありません。この2つの書き込みは一致としても相違としてもカウントされず、そこで止まらずに比較は先へ進みます。そのため、シート自身の「一致」列は、最初に予期される相違までではなく、それ以外の`A`、`P`、そしてPLAYフェーズ全体を本当に反映します。

<a id="adding-a-file"></a>
## ファイルを追加する

1. ライセンスが再配布を明示的に許可していることを確認し、そのURL、作者、（示されていれば）正確なライセンス識別子を記録します。HVSCと商用の吸い出しは決して対象になりません（decision 41）。
2. `.sid`を`files/`に置き、`sources.json`にエントリーを追加します（`file`、`title`、`author`、`licence`、`licenceUrl`、`url`、`sha256`、必要に応じて`seconds`と`purpose`）。参照実装のビルドに時間をかける前に、`pnpm psid-corpus:check --no-oracle`を実行して`importPsid`がそもそも再生できるか確認します。
3. `pnpm psid-corpus:sheet`を実行してlibsidplayfpと比較し、`docs/chips/c64.md`を更新します。`python3 docs/check-translations.py --sync-generated`を実行して生成ブロックを日本語版にも反映します。

`importPsid`が未実装の6510オペコード、未対応の形式機能、または厳しすぎる1フレームのINIT予算を理由にファイルを拒否する場合、修正は`packages/chipvoice/src/psid-import.ts`や`packages/chipvoice/src/chips/c64/cpu6510.ts`側の仕事です（単体テスト付きで）。ここで曖昧にごまかすことは決してありません。libsidplayfpとの本当の相違は、黙って修正するのではなく、シート上の知見として記録します。
