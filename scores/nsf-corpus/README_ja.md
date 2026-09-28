<a id="a-corpus-of-real-nsf-command-streams"></a>
# 実在するNSFコマンド列のコーパス

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

[完全な編曲](../arrangements/README_ja.md)は、ゲームごとに1曲（マリオ、ゼルダ）について、実在するNSFのINIT／PLAYコマンドを本実装が捉えたものが、独立したNSFプレイヤーであるGame_Music_Emuと正確なCPUサイクル単位で一致することを証明しています（decision 29）。このディレクトリーは、それをゲームごとの1曲から、複数のサウンドドライバーにわたる多数の独立してライセンスされたNSFのコーパスへと広げます。それぞれを断定ではなく**採点**します。一致したコマンド数と全体数、そして最初の相違のサイクルとレジスターです。ドライバー固有の癖や本当の欠落が、投げられたassertionではなく記録された知見になります。

<a id="what-is-in-the-corpus-and-what-is-not"></a>
## コーパスに含まれるもの、含まれないもの

`sources.json`が、コミットされた各ファイルのタイトル、作者、サウンドドライバー、出典URL、ライセンス、ライセンスURL、SHA-256を記録します。1つを除く各ファイルは以下のとおりです。

- 再配布を明示的に許可するライセンス（CC0、CC-BY、パブリックドメイン、または同等の許諾的ライセンス）を持つ**自作またはデモ向けのNSF**であり、商用ゲームの吸い出しは決して含みません。
- **NTSC、2A03専用**です。拡張音源のNSF（VRC7、FDS、N163、Sunsoft 5B、MMC5）は本チケットの対象外です（VRC6だけは今のところNEXT-14が担当します）。`capture-nsf.mjs`はそれ以外を無条件に拒否します。

唯一の例外は`vrc6-probe`（NEXT-14の2巡目）です。KonamiのVRC6を宣言し、毎フレーム3つのオシレーターすべてに書き込む、自作の小さなNSF（CC0、`make-vrc6-probe.mjs`、`scores/psid-corpus/make-fixtures.mjs`が2つのSIDプローブに使うのと同じ自作フィクスチャーの流儀）です。本プロジェクトが見つけたどのVRC6 NSFも、このコーパス自身の規約が求めるライセンスを持たなかったため、目的に応じて作られたプローブが代わりを務めます。ここでは`capture-nsf.mjs`自身のVRC6ルーティングを検証し、さらに`nsf-export`自身のコーパスがこの同じ`sources.json`を読むため、`exportNsf`のVRC6往復と、Game_Music_Emuの`Nsf_Emu`自身がVRC6ファイルを実際に再生することも、あちらのコーパスにある2A03ファイルすべてと全く同じゲートで証明します。

gitignoreされた`.artifacts/nsf-private/`ディレクトリーも同じ方法で採点されます。コミットできない所有者自身のローカルファイル（ライセンス不明な個人の吸い出しなど）のためです。CIはこのディレクトリーを用意しないため、CIの実行には一切影響しません。その結果はprivateと明記してコンソールに出力されるだけで、コミットされるJSONやシートには含まれません。

<a id="running-it"></a>
## 実行方法

```sh
pnpm --filter chipvoice build
node scores/nsf-corpus/test-compare.mjs   # 比較器だけを検証。参照実装のビルドなし
pnpm nsf-corpus:check                     # コーパス全体をGame_Music_Emuと比較
pnpm nsf-corpus:sheet                     # docs/chips/2a03.mdの生成ブロックも書き換える
```

`pnpm nsf-corpus:check`は、マリオとゼルダのために`scores/arrangements/native-oracle.py`がすでに構築している同じ固定版Game_Music_Emu参照実装（revision
`fe8da4b6d3876d7542c2fb69d94487e19836d678` - 2巡目でこのパッチを拡張し、`gme/Nes_Vrc6_Apu.cpp`からのVRC6書込も、下記の`vrc6-probe`のために記録するようにしました）を構築し、コミットされた各ファイルで`scores/capture-nsf.mjs`を実行し、`compareNsfTrace`（`compare.mjs`）で両者の記録を比較します。`--no-oracle`はその構築と比較を丸ごと省略し、本実装の記録が何コマンドを生み出すかだけを採点します。ネットワークがない場合や、新しい出典ファイルを追加している最中に便利です。

`compare-native.mjs`の厳密なサイクル一致assertion（マリオ自身のドライバーに固有のマーカーバイト`$4017 === 255`に基準を取るため、他のドライバーには一般化できません）とは異なり、この比較器はドライバーについて何も仮定しません。両方の記録の電源投入時の一連の書込（いずれもサイクル0に刻印されます。各側が正確に何を書き込むか、なぜそうなるかは`compare.mjs`のdocstringを参照）を取り除き、残りを先頭から位置ごとに比較します。一致すればマリオと同じ形で報告され、相違があればサイクル・レジスター・両方の値とともに報告されます。assertionの失敗として投げるのではありません。すでに一致しているものを確認するだけでなく、本当の欠落を見つけて記録することが目的です。

<a id="adding-a-file"></a>
## ファイルを追加する

1. ライセンスが再配布を明示的に許可していることを確認し、そのURL、作者、（示されていれば）正確なライセンス識別子を記録します。
2. `.nsf`を`files/`に置き、`sources.json`にエントリーを追加します（`file`、`title`、`author`、`driver`、`url`、`licence`、`licenceUrl`、`sha256`、必要に応じて`track`と`frames`）。参照実装のビルドに時間をかける前に、`pnpm nsf-corpus:check --no-oracle`を実行して`capture-nsf.mjs`がそもそも再生できるか確認します。
3. `pnpm nsf-corpus:sheet`を実行してGame_Music_Emuと比較し、`docs/chips/2a03.md`を更新します。`python3 docs/check-translations.py --sync-generated`を実行して生成ブロックを日本語版にも反映します。

特定の問いを立てられる実在する再配布可能なファイルが存在しない場合（VRC6自身がそうでした）、`make-vrc6-probe.mjs`のような自作のCC0フィクスチャーが代替になります。`scores/psid-corpus/make-fixtures.mjs`と同じ流儀で、欠けているものをまさに検証する短い手作業アセンブルの`.nsf`を、それを作ったスクリプトと一緒にコミットし、`url`は第三者ではなくそのスクリプトを指します。

`capture-nsf.mjs`が未実装の6502オペコードや、そのドライバーには厳しすぎる1フレームのINIT予算を理由にファイルを拒否する場合、修正は`scores/capture-nsf.mjs`や`packages/conform/src/roms/cpu6502.mjs`側の仕事です（単体テスト付きで）。`packages/chipvoice`では決して修正しません。Game_Music_Emuとの本当のAPUの相違は、黙って修正するのではなく、シート上の知見として記録します。
