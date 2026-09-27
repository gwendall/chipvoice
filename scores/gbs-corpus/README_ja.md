<a id="a-corpus-of-real-gbs-command-streams"></a>
# 実在するGBSコマンド列のコーパス

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

[`importGbs`](../../packages/chipvoice/src/gbs-import.ts)は、ドキュメントのみ（Pan Docs、gbdevのオペコード表、GBSフォーマット仕様書 - decision 41）から起こした独自のSM83 CPUを通して`.gbs`（Game Boy Sound）ファイルを再生し、`dmg`上の`PerformancePlan`を返します。このディレクトリーは、[`scores/nsf-corpus`](../nsf-corpus/README_ja.md)が2A03のために行っているのと同じ方法でコーパスを育てます。実在する多数のGBSファイルを、独立したGBSプレイヤーであるGame_Music_Emuの`Gbs_Emu`に対して断定ではなく**採点**します。アドレス・値・サイクルの一致数と全体数、そして最初の相違です。ドライバー固有の癖や本当の欠落が、投げられたassertionではなく記録された知見になります。

<a id="what-is-in-the-corpus-and-what-is-not"></a>
## コーパスに含まれるもの、含まれないもの

`sources.json`が、コミットされた各ファイルのタイトル、作者、ドライバー、出典URL、ライセンス、ライセンスURL、SHA-256、採点時間を記録します。各ファイルは次のいずれかです。

- 再配布を明示的に許可するライセンス（CC0、CC-BY、パブリックドメイン、または同等の許諾的ライセンス）を持つ**自作のGBS**であり、商用ゲームの吸い出しは決して含みません。
- **本プロジェクト自身が作成した**もの（今のところコーパスにある唯一のファイル`pulse-sweep.gbs`がこれです。手で組んだSM83プログラムで、パブリックドメインです）。

gitignoreされた`.artifacts/gbs-private/`ディレクトリーも同じ方法で採点されます。コミットできない所有者自身のローカルファイルのためです。CIはこのディレクトリーを用意しないため、CIの実行には一切影響しません。その結果はprivateと明記してコンソールに出力されるだけで、コミットされるJSONやシートには含まれません。

実在する、独立して作られたホームブリューのGBSファイル（hUGETrackerやGBT Playerのデモなど）はまだコーパスにありません。本チケットの期限内には、出典とライセンスを確認したうえで見つけることができませんでした。すでにある自作ファイルと並行して、実在するドライバー出力でコーパスを育てることは今後の課題です。

<a id="running-it"></a>
## 実行方法

```sh
pnpm --filter chipvoice build
node scores/gbs-corpus/corpus.mjs --no-oracle   # 本実装の記録だけを検証。参照実装のビルドなし
pnpm gbs-corpus:check                            # コーパス全体をGame_Music_Emuと比較
pnpm gbs-corpus:sheet                            # docs/chips/dmg.mdの生成ブロックも書き換える
```

`pnpm gbs-corpus:check`は、NSFのために`scores/arrangements/native-oracle.py`がすでに構築している同じ固定版Game_Music_Emu参照実装（revision
`fe8da4b6d3876d7542c2fb69d94487e19836d678`）を、`gme/Nes_Apu.cpp`ではなく`gme/Gb_Apu.cpp`に対して同じ方法でパッチを当てて構築し（`native-oracle-gbs.py`）、コミットされた各ファイルで`importGbs`を実行し、`compareGbsTrace`（`compare.mjs`）で両者の書込み列を比較します。`--no-oracle`はその構築と比較を丸ごと省略し、本実装の記録が何コマンドを生み出すかだけを採点します。ネットワークがない場合や、新しい出典ファイルを追加している最中に便利です。

`matched`（アドレス・値・サイクルの三つすべて）と`valueMatched`（アドレスと値のみ、位置ごと、サイクルは無視）の両方を報告します。両者は正当に異なりうります。`pulse-sweep.gbs`がなぜ全ての書込みのアドレスと値を実行全体を通して順序どおり一致させながら、Game_Music_Emu自身のCPUコアに対するサイクル一致の得点は低いのか、その理由は`compare.mjs`のdocstringを参照してください - これは独立に作られた二つのCPUコア間のオペコード別タイミングに関する、記録され理解された相違であり、壊れたプレイヤーではありません。一方、値のうえでコマンドが1つも一致しないファイルは構造的な問題であり、その場合スクリプトは非ゼロで終了します。

<a id="adding-a-file"></a>
## ファイルを追加する

1. ライセンスが再配布を明示的に許可していることを確認してそのURL、作者、正確なライセンス識別子を記録するか、あるいは自分でプロジェクトのためにファイルを作成します（パブリックドメインとして、その旨を明記します）。
2. `.gbs`を`files/`に置き、`sources.json`にエントリーを追加します（`file`、`title`、`author`、`driver`、`url`、`licence`、`licenceUrl`、`sha256`、必要に応じて`track`と`seconds`）。参照実装のビルドに時間をかける前に、`node scores/gbs-corpus/corpus.mjs --no-oracle`を実行して`importGbs`がそもそも再生できるか確認します。
3. `pnpm gbs-corpus:sheet`を実行してGame_Music_Emuと比較し、`docs/chips/dmg.md`を更新します。`python3 docs/check-translations.py --sync-generated`を実行して生成ブロックを日本語版にも反映します。

`importGbs`が未実装のSM83オペコード、未対応のヘッダー項目、あるいはそのドライバー自身のINIT/PLAYには厳しすぎる予算を理由にファイルを拒否する場合、修正は`packages/chipvoice/src/chips/gb/cpu.ts`や`packages/chipvoice/src/gbs-import.ts`側の仕事です（`packages/chipvoice/test/`内の単体テスト付きで）。ドキュメントから組み立て、Game_Music_Emu自身のCPUコアがそのオペコードで何をしているかを読んで真似ることは決してしません。Game_Music_Emuとの本当のAPUやCPUタイミングの相違は、黙って修正するのではなく、シート上の知見として記録します。
