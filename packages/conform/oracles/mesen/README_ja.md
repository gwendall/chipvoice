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

<a id="build"></a>
## ビルド

C++17コンパイラーだけで、他には何も要りません。追加のシステムパッケージも標準ライブラリー以外のライブラリーもありません。`-w`以外の警告抑制なしで、clang（macOS、ローカル使用）とgcc（`ubuntu-latest`、CI使用）の両方でクリーンにビルドできます。

<a id="trusted-voices"></a>
## 信頼する声

5つ全部：p1、p2、tri、noi、dmc。`nes-snd-emu`と違い、この参照のノイズは文献通りの電源投入値で始まり、文献通りの極性とフィードバックタップで動き、ミュート中も正確に刻まれるため、そのビットパターンも検査対象です。これは`nes-snd-emu`には解決できない唯一の点です。この参照が確定させている唯一の限界は上記の三角波の電源投入値で、これはこの参照と実機の両方から見て既知で理解済みの違いであり、シートがまだ答えを必要としている生きた疑問ではありません。
