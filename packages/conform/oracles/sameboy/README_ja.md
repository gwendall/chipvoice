<a id="oracle-sameboy"></a>
# 参照基準：SameBoy

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Lior HalphonによるサイクルアクシュレートなGame Boyエミュレーター、SameBoyをDMG-Bとして設定し、レジスターログで駆動します。<https://github.com/LIJI32/SameBoy>のコミット
[`213a12ce93d66b105a113debd9396306066a7cfc`](https://github.com/LIJI32/SameBoy/commit/213a12ce93d66b105a113debd9396306066a7cfc)
（2026-07-10）からExpat Licenseで同梱しています（[LICENSE](LICENSE)）。リポジトリ内の検証道具で、この参照のファイルは`chipvoice`パッケージに入りません。独自実装コードはMITです。

<a id="what-is-sameboys-and-what-is-not"></a>
## SameBoyのコードと本プロジェクトのコード

`vendor/apu.c`、`vendor/apu.h`、`vendor/defs.h`、`vendor/model.h`は、固定したコミット時点のLior Halphonの無変更コードです。同梱したのはAPUだけです。SameBoy本来の`Core/gb.h`はCPU、PPU、メモリマッピング、コンソール全体を引き込みますが、レジスターログに対して`apu.c`を動かすのにそのどれも要りません。次の3ファイルはこちらのものです。

- `gb.h`はSameBoy本来の`Core/gb.h`（`vendor/apu.c`がそのまま`#include`しており、こちらで編集できません）の代替です。`GB_gameboy_t`は上流の`defs.h`で前方宣言された不透明型（`struct GB_gameboy_s; typedef struct GB_gameboy_s GB_gameboy_t;`）なので、`apu.c`が実際に参照するフィールドだけを持つ独自の`struct GB_gameboy_s`をここで定義します（同梱したソースを`gb->`で全数grepして特定）。加えて`GB_IO_*`レジスタオフセット、`GB_ENUM`と`GB_ASSERT_NOT_RUNNING_OTHER_THREAD`マクロ、`apu.c`のSGBイントロ無音判定が完全型を要求するための1フィールドだけの`GB_sgb_t`代替も含みます（`sgb`は常にnullで、この判定自体は実行されません）。`apu.c`はフィールドを名前でしか参照しないため、フィールドの並び順は問いません。
- `shim.c`は`apu.c`が外部に呼ぶ2関数、`GB_get_clock_rate`と`GB_is_cgb`を実装します。DMG-Bはモデルも速度も変わらないため、どちらも定数です。
- `main.c`はchipvoiceのレジスターログを読み、APUを1 Tサイクルずつ駆動し、`GB_get_channel_amplitude(gb, voice)`の全変化を`<cycle> <voice> <value>`として出力します。これは既にDACへの入力そのもの、0〜15で、変換は不要です。`gb->apu.samples[voice]`を直接読まないのは、SameBoyがチャンネルのDACがオフの間にNR50またはNR51が書かれると無効化用の番兵値（`0x10`。DAC本来の0〜15の範囲外）をそこへ置き、DACがオフのままだとその番兵が上書きされないためです（`update_sample`のDMG分岐：`if (!GB_apu_is_DAC_enabled(...)) value = gb->apu.samples[index];`、つまり配列は番兵を保持したままになります）。`GB_get_channel_amplitude`はSameBoy自身が公開しているこの問いへのアクセサで、チャンネルが有効でなければ常に0を返します。これは`dsp.ts`自身の`output()`が使うのと同じ「DACオフなら0」という規約です。

初回にシステムCコンパイラーで`build/`へ作ります。フラグは`-std=c11`でなく
`-std=gnu11`です。`vendor/apu.c`が使う`M_PI`はISO Cでなく`<math.h>`への
POSIX／BSD拡張で、AppleのlibcはstdによらずM_PIを公開するためmacOSでの
ローカルビルドではこの差に気づけませんが、glibcは`-std=c11`の
`__STRICT_ANSI__`下でこれを隠し、Linux上のビルドはそのまま失敗します。GNU
C11はISO C11の上位互換なので、`apu.c`自体が依拠する挙動は変わらず、この一つ
の宣言が見えるようになるだけです。フラグは`sameboy.mjs`の`build()`にあり、
同梱ファイル自体は無変更のままです。

`main.c`は以前、パース済みの書き込み列をAPUに渡す前に、サイクルだけを比較する
`qsort`で再ソートしていました。これは二重に不要かつ危険でした。`formatLog`
（`log.mjs`）は既に安定ソートでログファイルを書き出しており、`main.c`自身の
読み込みループもサイクルが後退するファイルを拒否するため、`qsort`にかける
配列は既にサイクル単位で非減少でした。同じサイクルを共有する書き込みの順序
（コーパスでは、チャンネルの設定レジスタとトリガーが同じサイクルでログされ
るのが普通です）に対する`qsort`の並び順はC標準では未規定で、glibcとApple
libcの実装は実際に異なる結果を返しました。その結果、同一の、無変更の
`vendor/apu.c`がgcc/Linuxとclang/macOSで実質的に異なるトレースを生成し、CIが
それを検出しました。修正は同梱ファイルでなく`main.c`側にあります。不要な
再ソートを取り除いたことで、書き込みはどのプラットフォームでもログが最初か
ら示す順序どおりに適用されます。

<a id="the-frame-sequencers-phase"></a>
## フレームシーケンサーの位相

`dsp.ts`のフレームシーケンサーは、`reset()`で0から始まる16ビットのカウンター`divider`のビット0x1000の立下り・立上りエッジです。SameBoyのものも、`div_counter`という同じビットの同じエッジです（立下りで`GB_apu_div_event`、立上りで`GB_apu_div_secondary_event`）。これを`main.c`の`tick_div`で、`Core/timing.c`の`GB_set_internal_div_counter`（TIMAとシリアルポートも駆動するため同梱していません。ここではどちらも読みません）から再現しています。両トレースともサイクル0で`div_counter = 0`、`divider = 0`から駆動するため、両者は最初から同じ位相にあり、揃えるべきずれはどちらの向きにもありません。適用も不要です。

両者が実際に異なる唯一の時間基準は、SameBoy独自の内部クロックである`apu.apu_cycles`です。実機のAPUはCPUのTサイクルレートの半分で刻みます（`Core/timing.c`の`timers_run`はTサイクル4つごとに`1 << !cgb_double_speed`を加算、つまりDMG-Bなら4につき2）。`main.c`はこの比を、Tサイクルを1つずつ`apu_cycles`へ積み、2 Tサイクルごとに1回だけ`GB_apu_run`へ流すことで再現しています。これはSameBoy本来の内部スケジューリング（通常は4 Tサイクル、1 Mサイクル単位でしか進みません）とは異なりますが、`div_counter`をここでTサイクルごとに1ずつ進めるのはSameBoy本来の内部粒度より細かく、`dsp.ts`自身のTサイクル単位のトレース分解能（そのフレームシーケンサーのエッジは4の倍数でない奇数サイクル値に落ちます）に合わせるために必要です。結果として、本来の遷移サイクルがペアの前半であっても後半のサイクルで刻まれることがあります。これはこの駆動系自身が生む実在の小さな（APUの1ティックあたり最大2 Tサイクル、トリガー自身の遅延計算を経て積み重なると実測でおよそ6〜10サイクルの残差)丸めであり、SameBoyともchipvoiceとも無関係です。シート上で小さな一定シフトの下でエッジが揃い、それ以外に説明のつかない相違があれば、この原因を指しています。

<a id="known-limits-of-this-oracle"></a>
## この参照の既知の限界

Gb_Snd_Emu（その参照実装自身の[README](../gb-snd-emu/README_ja.md)を参照）よりはるかに実機に近く、DAC、電源スイッチ、分周器自身のフレームシーケンサー、ゾンビモード、出力サンプルへ畳み込むのでなくレジスタレベルでモデル化したスイープを備えます。chipvoiceとまだ食い違う点は、ボイスごとにサイクルと両方の値を添えてシートに記載しています
（[`docs/chips/dmg.md`](../../../../docs/chips/dmg.md)、「SameBoyとの比較」）。要点は次の通りです。

- トリガー直後の矩形波ボイスの最初のデューティエッジだけは実機では瞬時ではありません（SameBoy自身の`sample_surpressed`フラグとトリガー時の`delay`フィールド）。chipvoiceの`Pulse`はトリガーが立った瞬間の現在のデューティビットを読んでしまい、既にこの遅延をモデル化している波形チャンネルとは異なります。最初の1エッジ以降は完全に一致するため、上記の`qsort`修正前に見えていたログ全体の大半を占める残差ではなく、トリガーごとに1エッジだけの小さな残差になりました。修正は別チケット（P2-1）向けのchipvoice側の所見であり、本参照実装の修正対象ではありません。
- ノイズチャンネルのコールドスタートは、これとは別の、はるかに大きな食い違いです。chipvoiceの最初のノイズノートは即座に鳴りますが、SameBoyの対応するノートは1ノート分丸ごと遅れてから鳴り始め、その後は両者が揃って進みます。矩形波の1エッジ分の遅延とは異なり、これは上記の`qsort`修正の影響を受けませんでした（このログの同時書き込みは、どちらのコンパイラでも既にファイル順に並んでいたためです）。したがって`qsort`のバグとは独立した、実在する食い違いです。これも同じくP2-1向けで、本参照実装の修正対象ではありません。
- SameBoyのゾンビモードのグリッチ（`nrx2_glitch`）は、中間値`0xFF`を経由するDMG-B固有の2段階モデルで動作し、これは実機のpre-CGBハードウェアで一部非決定的であると本人のコメントも認めています。単純なケースではchipvoiceの単純な1段階モデルと一致し、非ゼロのperiodでの方向反転では食い違います。
- この駆動系自身の2 Tサイクル単位の`apu_cycles`バッチ処理（上記）により、ある遷移が2サイクルの境界のどちら側に丸められるかがたまにずれます。見つかったどの例も、次のサンプルまたはデューティエッジで即座に自己修正し、恒久的なずれは残りません。

<a id="trusted-voices"></a>
## 信頼するボイス

4つ全てです。DAC、電源スイッチ、分周器駆動のフレームシーケンサーを備えたサイクル精度のDMGコアであり、`dsp.ts`が自ら依拠するのと同じモデルなので、一部だけでなく全ボイスで比較します。chipvoiceとまだ食い違う点はボイスごとにシートで診断しており、ここでは除外しません。これはGb_Snd_Emuの参照実装モジュールが、より多くの既知の限界を抱えながらも採っているのと同じ方針です。
