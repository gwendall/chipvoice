<a id="oracle-mesen-2"></a>
# 参照基準：Mesen 2

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>


Mesen 2のNES APU（`Core/NES/APU/`）をネイティブビルドし、`nes-snd-emu`参照と同じ方法でレジスターログで動かします。<https://github.com/SourMesen/Mesen2>のコミット`b9fa69ddc6d0a331fb103fdb5eef6904305703c2`（2026-06-04）からGPL-3.0で同梱しています（[LICENSE](LICENSE)）。本リポジトリのビルトインポリシー（決定41）に従い、`packages/conform`配下だけで独立したネイティブプロセスとして動作します。ここのコードは`chipvoice`パッケージへは入らず、そちらはMITのままです。

<a id="what-is-mesens-and-what-is-not"></a>
## Mesenのコードと本プロジェクトのコード

`vendor/`配下は固定コミットから無変更です。`NES/APU/NesApu.*`、`SquareChannel.h`、`TriangleChannel.h`、`NoiseChannel.h`、`DeltaModulationChannel.*`、`ApuFrameCounter.h`、`ApuEnvelope.h`、`ApuLengthCounter.h`、`ApuTimer.h`、それらが必要とする2つの小さなインターフェース`NES/INesMemoryHandler.h`と`NES/NesConstants.h`です。

`shim/`配下は全てこちらのものです。実際のMesenのクラス（`NesConsole`、`NesCpu`、`NesMemoryManager`、`NesSoundMixer`、`Serializer`/`ISerializable`、`Emulator`、`ConsoleRegion`/`NesConfig`設定）の代わりとなる、最小限のコンソール、CPU、メモリーマネージャー、サウンドミキサー、シリアライザーです。実際のMesenのそれらはコンソール全体（PPU、マッパー、セーブステート、完全な6502、パン・フィルター付き音声）を動かしますが、この参照はAPU自身のレジスターデコードとチャンネルの出力レベルしか要らないため、APUがコンパイルのためのインターフェースだけを必要とする箇所は、ポインターの入れ物か何もしない実装にしてあります。

- `shim/NES/NesConsole.h` - APUの各クラスが辿るポインター（`GetApu`、`GetCpu`、`GetMemoryManager`、`GetSoundMixer`、`GetEmulator`、`GetRegion`、`GetNesConfig`）と、DMCが読む`uint8_t memory[0x10000]`。
- `shim/NES/NesCpu.h` / `.cpp` - サイクルカウンター（1から数え、どのサイクルをAPUサイクルと呼ぶかをchipvoiceと揃えます。フレームカウンターの3または4サイクルの`$4017`遅延とDMCの開始遅延がその偶奇から決まります。ヘッダーのコメントを参照、P2-1）、APUが立てて読む`IRQSource`フラグ、そして`StartDmcTransfer()`：`console->memory[apu->GetDmcReadAddress()]`を同期的にストールなしで読み、そのまま`apu->SetDmcReadBuffer()`へ渡します。詳細は下の「DMCのメモリー読み出し」を参照。
- `shim/NES/NesMemoryManager.h` - `$4000-$401F`への書込を、`GetMemoryRanges()`でそのアドレスを申告したチャンネルへ振り分けます。実際のMesenのコンソールが起動時に全ての`INesMemoryHandler`を配線するのと同じ方式です。
- `shim/NES/NesSoundMixer.h` - 実際のMesenのミキサーは各チャンネルをステレオストリームへ再標本化しますが、この参照はそれを一切聴きません。各チャンネルがすでに行っている`AddDelta(channel, time, delta)`呼び出しを、何かへ混ぜる代わりに声ごとの`(絶対サイクル, 差分)`として記録するだけです。絶対サイクルをフレームごとの`time`引数からどう復元するかは、ファイル自身のコメントを参照してください。
- `shim/NES/NesTypes.h` - 同梱ファイルが参照する列挙体と状態構造体（`AudioChannel`、`IRQSource`、`MemoryOperation`、6つの`Apu*State`構造体）だけを、原文のまま切り詰めて写したものです。実物のファイルが持つPPU・カートリッジ・マッパー宣言は省いています。
- `shim/Shared/SettingTypes.h` - `ConsoleRegion`と、同梱APUコードが読む7個のフラグだけを持つ`NesConfig`で、いずれもMesen実物の既定値（`false`）です。この参照はNTSC専用で、chipvoice自身の`CPU_HZ`と一致します。
- `shim/Shared/Emulator.h`、`shim/Utilities/{ISerializable,Serializer}.h` - 単純な代用品です。この参照は状態の保存・復元を一切行わないため、同梱の`Serialize()`メソッドはコンパイルさえ通ればよい死んだコードです。
- `shim/pch.h` - Mesen自身の`Core/pch.h`（エミュレーター全体向けの大きな事前コンパイル済みヘッダー）の代用品です。同梱APUファイルが必要とするのは標準ヘッダー数個と、Mesenのコードが使う`__forceinline`／`__noinline`のエイリアスだけなので、このshimはそれだけを用意します。

`main.cpp`はこちらのものです。chipvoiceのレジスターログを標準入力から読み、各書込のサイクルまで`NesApu::ProcessCpuClock()`をCPUサイクル単位で動かし（`NesApu::WriteRam`自身が使う「古い値まで追いつかせてから新しい値を適用する」という規約通りにメモリーマネージャーで書込を適用し）、いずれかの声の差分合計が変化するたびに`<cycle> <voice> <value>`をサイクル順に出力します。声は0から4：スクエア1、スクエア2、三角波、ノイズ、DMCです。`AudioChannel`自身の順序であり、chipvoiceの順序でもあります。

ハーネスが初回使用時にシステムC++コンパイラーで`build/`へビルドします。

<a id="the-value-each-voice-reports"></a>
## 各声が報告する値

各声が出力する値は、その`AudioChannel`についての`AddDelta`の差分を合計したもので、まさにMesen自身の`GetOutput()`（スクエア／三角波／ノイズ各チャンネルの`_timer.GetLastOutput()`、DMCの7ビットカウンター）がそのサイクルで報告する瞬間の出力レベルと同じです。これは`packages/chipvoice/src/chips/nes/dsp.ts`の`Chip.outputs()`が各声へ書き込み、`Chip.trace()`が変化として報告するのと同じ量です：2つのパルス・三角波・ノイズは0-15、DMCは0-127。値そのものが変化したときだけ変化を出力するのは、どちらの側でも`trace()`自身の規約と同じです。

<a id="the-dmcs-memory-reads"></a>
## DMCのメモリー読み出し

ログの`# memory ADDR: hex...`行は、書込を適用する前に`console.memory`へ読み込まれます。`NesCpu::StartDmcTransfer()`はこの配列を、CPUストールを一切模倣せずに同期的に読みます。この参照を追加したチケットはまさにその単純化を求めていました。ログ駆動の実行ではDMAのCPUストールがAPU自身のタイミングを変えないためです（ここにはストールで遅延させるべきCPUのプログラムカウンターがそもそもありません）。`StopDmcTransfer()`は何もしません。常に同期的に完了する転送が保留状態のまま残ることはないためです。

<a id="power-on-and-reset"></a>
## 電源投入とリセット

`main.cpp`は毎回Mesen自身の電源投入状態から始めます。`NesApu`のコンストラクター自身が`Reset(false)`を呼び、`main.cpp`が最初の書込の前に追加するのは`SetRegion(ConsoleRegion::Ntsc, true)`だけです。これは実際のMesenのコンソールも起動時に一度呼ぶもので、同梱の`ApuFrameCounter::Run()`が全く進まなくなる前に必要です（そのステップサイクル表は`SetRegion`でしか埋まらず、`Reset`では埋まりません）。電源投入以外のリセット経路はありません。曲の途中から始めるつもりのコーパススクリプトも、この参照は同じ、chipvoice自身がトレースを始めるのと同じ冷えた状態から始めます。

<a id="known-limits-of-this-oracle"></a>
## この参照の既知の限界

- **三角波の電源投入値。** Mesenの`ApuTimer::_lastOutput`は既定で0であり、`TriangleChannel::Reset()`は15を書き込みません。そのため、この参照の三角波はシーケンサーが最初に進むまで電源投入時から0を読みます。nesdevとblarggの`apu_mixer`テストは、実機とchipvoiceがそこで15を読むと述べています（`docs/chips/2a03.md`の「電源投入状態」を参照）。Nes_Snd_Emuの三角波も同じ方向に同じ限界を持ちます。三角波のレジスターを一度も書かないスクリプトは、スクリプト全体の長さにわたってこの不一致を保持するため、シートの表でそれらのログの三角波行が0%になっています。
- **sweepの電源投入状態。** `SquareChannel::TickSweep()`はdividerをP+1から1へ数え、先に減算してから結果を比較します。nesdevのページ（そしてchipvoiceの`clockSweep()`）はPから0へ数え、先に比較します。同じユニットで、一方の読みでdividerがdなら他方ではd+1です。ただし`Reset()`はdividerと周期の両方を0にし、これは1〜P+1の範囲外なので、最初の減算でバイトが255に巻き戻ります。チャンネルに最初の`$4001`／`$4005`書込があり、その後に半フレーム時計が来るまで、sweepは遅れて発火します。`script-sweep-up`のpulse 2では4ステップ系列まるごと1回分です。両方を1（nesdevの0）に初期化した試作ビルドは、2本のsweepスクリプトの全エッジでchipvoiceと一致します。nesdevはdividerの電源投入値を示していません。曲はこれに出会いません。chipvoiceのドライバーは毎音の開始時に`$4001 = $08`を書くためです。
- **出力が変わるのは書込かタイマーのtickのときだけ。** 矩形波チャンネルはレジスター書込とタイマーのreloadで出力を計算し直しますが、`TickEnvelope()`と`TickLengthCounter()`はそうしないため、エンベロープの1段、再始動、長さの満了は最大でタイマー1周期遅れて現れます。ノイズチャンネルはタイマーのtickでしか出力を計算し直さず、書込でも行いません。実機では音量がそのままミキサーへ通ります。コーパス中のこうした区間は全てタイマー1周期以内に閉じ、それらの箇所で出力を更新する試作ビルドでは全て消えます。
- **reloadと同じサイクルの書込。** `WriteRam`は書込を適用する前に、全チャンネルを書込自身のサイクルまで進めます。そのため矩形波のタイマーがreloadするサイクルに落ちた周期の書込は、そのreloadに反映されません。chipvoiceとNes_Snd_Emuは先に適用します。これが書込のサイクルについてのハーネスの取り決めです。コーパスでは2回（`song-studio`のpulse 2、`song-golden`のpulse 1）で、それぞれ曲の残り全体に一定の位相差を残します。このシムはchipvoiceの順序を採ると他の全てが1サイクルずれます。ここのパルスタイマーは固定のAPUサイクルの偶奇ではなく、最初の周期書込が残した位置から2P+1サイクルを数えるため、このコーパスで位相がchipvoiceと揃うのは、まさにreloadが先だからです。
- **DMCの最初のバイト、そして冷えたバッファーからの再始動全て。** CPUストールを一切模倣しないため、この参照のDMCは最初のサンプルバイトをchipvoice自身から54サイクルずらして再生します。これは`nes-snd-emu`参照がすでに示す大きさと同じですが、原因は別です（そちらは電源投入時のビット数がnesdevと食い違い、この参照はそうではありません）。最初以降の各段は同じ値をずらしただけで運びます。冷えたバッファーからチャンネルを再始動するログ（コーパスの`script-dmc`）だけがこれを示します。

<a id="vrc6-audio-next-14"></a>
## VRC6音源（NEXT-14）

NEXT-14の2巡目で、Konamiの拡張音源VRC6向けに、すでに同梱済みのGame_Music_Emu（`../game-music-emu`）と並ぶ、2つ目の独立した参照実装が求められました。Mesen 2もVRC6音源をエミュレートしています。場所は`Core/NES/Mappers/Audio/{Vrc6Audio,Vrc6Pulse,Vrc6Saw}.h`です - `Core/NES/Mappers/Konami/VRC6.h`ではありません。そちらはマッパー／バンク切り替えクラスで、これらを`#include`しているだけです。音源クラス自体は、この参照実装の他の部分と同じ固定コミットで`vendor/NES/Mappers/Audio/`配下に同梱し、加えて拡張音源チップが共有する抽象基底`NES/APU/BaseExpansionAudio.{h,cpp}`も同梱しています。`NesTypes.h`の`AudioChannel`列挙型はすでに`VRC6 = 7`を挙げており、`NesApu::AddExpansionAudioDelta`もすでにミキサーへ転送していました - どちらも将来のチケット向けに書かれていて、それが今回のチケットだったわけです。そのためシムの変更は`NesSoundMixer.h`の`deltas[]`配列をインデックス7を持てるよう5声から8声に広げただけで済み、2巡目では同梱コード自体に一切手を入れていません。3巡目は、印付きで出典を明記した唯一の例外を加えました：`Vrc6Pulse.h`の`GetVolume()`に小さなchipvoiceパッチが入っています（下記参照）。`Vrc6Audio.h`と`Vrc6Saw.h`は無変更のままです。

`main-vrc6.cpp`が2つ目のドライバーで、こちらのコードです。chipvoiceのVRC6レジスターログを`main.cpp`が2A03のログを読むのと同じ方法で読みますが、`Vrc6Audio`は`NesApu::ProcessCpuClock()`（カートリッジのマッパーチップには無関係）ではなく、自身の`Clock()`で直接刻みます。そして、ミキサーの1本のVRC6ラインの変化を毎回`<cycle> 0 <value>`として出力します。声が1本しかないのは、実際のMesenの`Vrc6Audio::ClockAudio`が両パルスと鋸歯状波を1つの`outputLevel`へ合計してから初めて`AddExpansionAudioDelta`を呼ぶためです - 3声を別々には公開しないため、この参照実装はGame_Music_Emuのように声ごとには比較できません。`oracles/mesen-vrc6.mjs`はchipvoice側で埋め合わせます（`chips/vrc6.mjs`の`chipVrc6Combined`、つまり`vrc6-combined`）：chipvoice自身の3声を同じように合計して15倍することで、比較の両辺が同じ1つの量になります。

Mesenは、Game_Music_Emu自身の`Nes_Vrc6_Apu`には検証できないもの（この参照実装と`../game-music-emu`自身の「既知の限界」を参照）を検証する独立した手段です：`Vrc6Pulse::Clock`には4サイクル以下の周期を除外するガードがなく、`Vrc6Saw::WriteReg`の無効化パスはアキュムレーターを明示的にゼロ化します（nesdevと本コアに一致；Game_Music_Emu自身の`run_saw`はそこを凍結するだけです）、そして`$9003`はこの参照実装に直接届きます（Game_Music_Emu自身のディスパッチはこれを落とします）。一方で`Vrc6Saw::Clock()`は自身のタイマーを`_enabled`でゲートしています - nesdevの文章（「Eをクリアしても周波数分周器はリセットされない」）からの、本コアが従っていない未文書の相違です - そのためコーパス自身の無効化・再有効化スクリプト（`corpus/vrc6/edge/saw-enable.log`）は、無効化区間を鋸歯状波自身の全分周期のちょうど整数倍に保つよう書かれており、この特定の相違を相違として測定する代わりに回避しています。

この参照実装が報告するあらゆるエントリーには、鋸歯状波でもパルスでも同じ1つのオフセットが掛かっています：一定の-1サイクルで、`main-vrc6.cpp`が`main.cpp`と共有し、実際のMesenが`ProcessCpuClock`がそのサイクル分すでに進んだ後で`WriteRegister`をフレーム途中に呼ぶのに合わせている、「書込のサイクルまで古いレジスター状態でエミュレートしたCPUを追いつかせてから、書込を適用する」という同じ規約から来ています。`corpus/vrc6/core/saw-worked-example.log`で測定し（8999/8999エッジがシフト-1で一致）、`corpus/vrc6/core/pulse-levels.log`（鋸歯状波の動きが全くない、30/30エッジが同じシフト）で独立に確認済みです - この補正の完全な導出と、より早い、鋸歯状波専用に絞った版がなぜ2回目の測定の後で不要と分かったのかは、`oracles/mesen-vrc6.mjs`自身のコメントを参照してください。

`corpus/vrc6/core`と`corpus/vrc6/edge`の全ログが、この参照実装に対して100.0000%です（`check:vrc6-core-mesen`、`check:vrc6-edge-mesen`）。

NEXT-14の3巡目は、デューティジェネレーターが動く旧来の全コーパス（`corpus/vrc6`）についてさらに一歩進めました：`vendor/NES/Mappers/Audio/Vrc6Pulse.h`が、Mesenの元は無変更のパルスの上に小さな印付きchipvoiceパッチを載せています。「chipvoice patch」というコメントが、何をいつ変更したかを正確に示し、その仕組みを全文引用しています。これはGPL-3.0 5(a)（「その作品を変更したこと、および妥当な日付を示す目立つ告知を掲げなければならない」）に従ったものです。変更した1行は`GetVolume()`のデューティ比較で、`_step <= _dutyCycle`から`_step >= (uint8_t)(15 - _dutyCycle)`へ変わっています。理由：Mesenの`_step`は上向きに数えます（0から15までラップし、無効化で0にリセット）；chipvoice自身の`step`（`vrc6.ts`）は下向きに数えます（15から0までラップし、無効化から有効化への立ち上がりエッジで15にリセット）；どちらも無効化中は凍結し、その後のあらゆる無効化／再有効化のたびに同じエッジで再アンカーされるため、恒等式`s' = 15 - s`（chipvoiceのカウンターs'、Mesenのs）は最初のエッジ以降、周期・デューティ・有効化のどんな書き込み列に対しても成り立ちます - デューティを固定した1回の実行だけの話ではありません。これをchipvoice自身の`s' <= dutyCycle`に代入すると、まさに変更後の行が得られます。`docs/chips/vrc6.md`の「パルスのマッピング」に完全な導出と、Game_Music_Emuに対して直接、参照実装同士で測定した結果、その参照実装自身のパルスには同じマッピングを適用できない理由（その`phase`はどんな無効化／再有効化でも再アンカーされない点が、この参照実装の`_step`と異なる）があります。

4巡目による訂正（本ファイルの以前の文言は、このパッチと、それが可能にするゲートが証明することを誇張していました）：これは、もともと一致するはずだった2つの規約を中立的に言い換えたものではありません。この参照実装の*観測可能な*出力を変えます。パッチ前は、ここでのパルスは有効化後の最初のD+1ステップがHIGH、その後がLOWになります；Game_Music_Emu自身のパルス（電源投入時`phase = 1`）も同じくHIGHが先です。chipvoice自身のコアはLOWが先です：最初の15-DステップがLOWで、その後D+1ステップが音量になります - nesdevのVRC6音源のページを文字通り読んだものです（「15から0まで下向きに数える...現在のステップが与えられたデューティサイクルD以下のとき、チャンネル音量Vが出力され、それ以外は0となる」）。パッチは*この参照実装*もLOWが先になるようにします。すなわち、これはMesenにchipvoice自身のnesdev文字通りのデューティ位相の読み方を採用させるものであり、両側がもともと共有していた規約ではありません。帰結：デューティ位相だけに限れば、`check:vrc6-flat-mesen`の100.0000 %は独立した証拠では**ありません**。パッチこそが位相の一致を強制している当のものだからです。パッチが触れないすべてのもの - 分周器自身のカデンス、周期レジスタに対するステップのタイミング、無効化中の凍結、各有効化エッジでの再アンカー、そして出力レベルそのもの - については独立した証拠として**残ります**。どちらのデューティ位相の読み方が実機として正しいかは未決着です：本コアはnesdevの文章に従っており、Mesen 2とGame_Music_Emu（パッチなし）はどちらもその読み方に反対しており、どちらか3つを実機に対して検証する実際のVRC6カートリッジのキャプチャはまだありません（`docs/BACKLOG.md`のNEXT-14の項目がそのキャプチャを追跡しています；決着させるには本コア自身の規約を反転させるか、このパッチを外す必要があるかもしれません）。このパッチにより、パルスを無効化・再有効化するが鋸歯状波には触れない平坦コーパスの4本（`script-duty`、`script-pulse-both`、`script-pulse-enable`、`script-pulse-periods`）も、この参照実装に対して文字通り100.0000%でゲートします（`check:vrc6-flat-mesen`）、`core`や`edge`と同じです。

`check:vrc6-core-mesen`／`check:vrc6-edge-mesen`がパッチの影響を受けない（依然100.0000%）のは、デューティ位相の一致とは一切関係のない理由によるもので、3巡目のもともとの説明は誤りでした：「そこではすでにどのスクリプトも有効化区間をまたいでデューティと周期を固定しており、マッピング前後で条件が一致する」からではありません - 固定されたデューティは2つの計数方向を位相一致させません、それだけの話です。コーパスに対して直接確認した本当の理由：`corpus/vrc6/core/*.log`と`corpus/vrc6/edge/pulse-enable.log`のすべての`$9000`／`$A000`書き込みはビット7（M、「デューティ無視」）を立てています - このコーパス自身の値には`89`、`85`、`80`から`BB`までのすべてのバイト、`8D`が含まれ、いずれもビット7が立っています - これはデューティジェネレーターを両側とも完全に迂回します（`_ignoreDuty`／`mode`はどちらも、`_step`／`step`を一切参照せず無条件に`_volume`／`volume`を返します）。3巡目以前は、Mesenに対する厳密ゲートはデューティジェネレーターを一切検証していませんでした。`check:vrc6-flat-mesen`が最初にそれを検証するゲートであり、デューティ位相の極性自体を除く上記のすべての理由について厳密です。

旧来コーパスの残り3本（`script-all-three`、`script-saw-enable`、`script-saw-rates`）はパルスだけでなく鋸歯状波も無効化・再有効化し、3巡目以前からの回帰なし基準の慣習（`check:vrc6-mesen`）のままです。理由は別の、本物のものです：`Vrc6Saw::Clock()`は周波数分周器を含む本体全体を`if(_enabled)`の内側に置いているため、無効化中は分周器が完全に一時停止し、止まった場所から再開します。一方chipvoice自身の`Vrc6Saw.clockDivider()`は`enabled`にかかわらず毎サイクル無条件に刻み、nesdevの文章（「Eをクリアしても周波数分周器はリセットされない」）を文字通り実装しています。`docs/chips/vrc6.md`の「鋸歯状波の分周器と無効化」に、それぞれの最初の相違サイクルがあります。これは上で触れた、`corpus/vrc6/edge/saw-enable.log`がすでに構造的に回避している同じ分周器凍結の挙動です（その無効化区間は鋸歯状波自身の全分周期のちょうど整数倍になっているため、一時停止する分周器も止まらず数え続ける分周器も次の発火に同じタイミングで到達します）。平坦コーパスはこの制約を意識して作られていないため、回避するのではなく測定された相違としてそれを露呈させる側になっています。4本目の平坦コーパススクリプト`script-saw-worked-example`は、無関係な理由でこの参照実装に対して99.9972 %に留まっていました - 上記の鋸歯状波の無効化の挙動ではなく、2つの別々のハーネスのバグ（1つはこの参照実装自身の`main-vrc6.cpp`、もう1つはGame_Music_Emuのドライバー）がどちらもログ自身のサイクル予算ちょうどでその最後のエッジを切り詰めていたのです。4巡目が両方を見つけて修正し（デルタフィルタに関する`main-vrc6.cpp`と`main.cpp`自身のコメント、`docs/chips/vrc6.md`の「鋸歯状波の分周器と無効化」参照）、このスクリプトも今や厳密にゲートし、`check:vrc6-flat-mesen`の除外リストから外れました。

<a id="build"></a>
## ビルド

C++17コンパイラーだけで、他には何も要りません。追加のシステムパッケージも標準ライブラリー以外のライブラリーもありません。`-w`以外の警告抑制なしで、clang（macOS、ローカル使用）とgcc（`ubuntu-latest`、CI使用）の両方でクリーンにビルドできます。

<a id="trusted-voices"></a>
## 信頼する声

5つ全部：p1、p2、tri、noi、dmc。`nes-snd-emu`と違い、この参照のノイズは文献通りの電源投入値で始まり、文献通りの極性とフィードバックタップで動き、ミュート中も正確に刻まれるため、そのビットパターンも検査対象です。これは`nes-snd-emu`には解決できない唯一の点です。この参照が確定させている唯一の限界は上記の三角波の電源投入値で、これはこの参照と実機の両方から見て既知で理解済みの違いであり、シートがまだ答えを必要としている生きた疑問ではありません。
