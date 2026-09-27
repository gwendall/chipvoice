<a id="vices-testprogssid-as-a-second-digital-verification"></a>
# VICEの`testprogs/SID`：第二のデジタル検証

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


`vice-sid/`はVICEの`testprogs/SID`の一部です。エミュレーター本体のプロジェクトが持つSID用テストプログラムで、いくつかは実機の6581・8580チップと照合して書かれています。`testprogs`はVICEのSubversionリポジトリの別系統トップレベルパスで、プロジェクトのGitHubミラーには含まれないため、`https://svn.code.sf.net/p/vice-emu/code/testprogs/SID`からr46273で直接同梱しています。`LICENSE`はそのリビジョンでのVICE自身の`COPYING`（GPL 2以降）です。`docs/DECISIONS.md`の設計判断41が、このプライベートハーネス内に限りGPLのテストプログラムを許可しており、公開パッケージには入りません。

8グループ14本を選びました。理由はどれもハーネスが持たないC64の機能を必要とせず、自力で判定を返せるからです。判定はVICE自身のデバッグカートリッジ規約です。`$D7FF`の1バイト（0で成功、`$ff`で失敗）と`$D020`のボーダー色、その後は自分自身へのジャンプ。一部はKERNALのCHROUTを経過を表示するためだけに呼びますが、ランナー（`packages/conform/src/roms/c64.mjs`）はその呼び出しをKERNALを読み込まずno-opとして処理します。結果と、唯一の失敗の診断は`docs/chips/c64.md`のテストROM節にあります。

- `ringmod/` - OSC3から読むリング変調。
- `osc3-wave0/` - 合成波形のゼロをOSC3から読み戻す。
- `oscinit/`と、その`noiseinit.prg`・`allinit.prg` - 位相蓄積器とノイズレジスタの電源投入値。
- `busvalue/` - 書き込み専用または存在しないレジスタの読み出しが返す内部データバスのラッチ。ここでは**失敗**します（P2-1、シート参照）。
- `osc_topbit/` - 合成波形の最上位ビットをOSC3から読む`_old`（6581）版。このチップは6581専用なので`_new`（8580）版は対象外とし、同梱も実行も集計もしていません。選んだ14本に8580専用はありません。
- `envelope/` - `testADSRDelayBug`：ステップ途中のレート変更。
- `resid-test/` - Dag Lem自身のreSIDテストプログラムから4本。`envrate`と`envtime`はCIAタイマーを32ビットカウンターに連結し、15段のADSRレートとADSR各段の長さをサイクル単位で測ります。`envsustain`はサステイン比較を、`noisetest`はノイズLFSRの周期を検査します。各参照表がどの実機で検証されたかは同梱readme（`resid-test/readme.txt`）に書かれています。

<a id="not-run"></a>
## 対象外

VICE本家の`testprogs/SID`にはこの14本より多くのプログラムがあります。対象外にした理由：

- `resid-test/envdelay`、`oscsample0`、`oscsample1` - 自分のコードを書き換えながら表を辿る「genrun」サンプラーで、他の4本の`resid-test`が既にカバーしている領域に対し実装リスクが見合いませんでした。
- `resid-test/boundary*`、`resid-test/envsample*`、`waveforms/*`（別系統のトップレベルグループ） - `.d64`ディスクイメージや別の`.prg`から追加データを読み込みますが、ランナーはそれをモデル化していません。
- `wb_testsuite`、`wf12nsr` - 対話的、または事前のウォームアップ実行に依存します。
- `env_test` - 画面に棒グラフを描くだけで、ここでは画面を読みません。
- `exp_counter_reset` - KERNALの画面エディタ`$e536`を呼びますが、ランナーが持つのはCHROUTのみのスタブです。
- `sidcheck.prg` - 採点方法が信頼できるほど明確に文書化されていません。
- `bitfade` - 書き込み専用レジスタやOSC3のビットが書き込みなしで減衰する時間をコンデンサー放電として測り、実機の実測サイクル数と比較します。合否判定ではなくアナログ測定です。
- `noisewriteback` - 合成波形でのノイズレジスタ書き戻し（`sourceforge.net/p/vice-emu/bugs/746`）。同梱readmeは可聴・視覚的な比較としており、`$D7FF`式の判定はありません。
- `noiselfsrinit` - 8580専用。
- `chipmodel`、`detect*`（デモのSID個数検出ルーチンである`detectmirrors`を含む）、`paddles*`、`stereo`、`mapping`、`testwave00`、`zerolevel`、`writedelay` - アナログ測定またはハードウェア検出ツールで、デジタル一致検査ではありません。
- `csid-light-tests` - 第三者のサウンドテストで、実機検証プログラムではありません。

<a id="known-limits"></a>
## 既知の制約

ランナーはC64そのものではありません。ROMはなく、VIC-IIはラスタ行だけに縮小され、CIA1タイマーはこの14本が使う範囲だけをモデル化しています。詳細は`packages/conform/src/roms/c64.mjs`のドキュメントコメントにあり、選んだプログラムはいずれもそれ以上を必要としません。
