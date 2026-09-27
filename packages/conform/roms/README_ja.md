
<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

BlarggのAPUテストROM。出典はhttps://github.com/christopherpow/nes-test-roms
（Shay Greenのテスト。あらゆる用途で自由に使用可能）。スイートはapu_test（2011、$6000プロトコル）、apu_reset（2011、$6000、リセットボタンが必要）、dmc_tests（2011）、apu_2005（2005、画面出力のみ）です。`dmg_sound/`はGame Boy向けのblargg同等スイートで、同種のプロトコル（`$A000`）で報告します。

`vice-sid/`は別種のROMスイートです。VICE自身の`testprogs/SID`で、GPL-2、決定41の下で同梱し、ハーネスが持つ6510で実行します。どのプログラムを使い、どれを対象外にしたかは[専用のREADME](vice-sid/README_ja.md)にあります。

`cpu_instrs/`（命令の挙動）と`instr_timing/`（命令のタイミング）は、blargg自身によるGame Boy向けの別スイートで、出典はhttps://github.com/retrio/gb-test-roms
です - 同じ作者の元々のgb-tests（かつてblargg.parodius.comにあり、現在は閉鎖）をそのまま再配布したリポジトリです。このリポジトリにも正式な`LICENSE`ファイルはなく、上記の`dmg_sound/`が前提とする同じ「自由に利用可能」という非公式な位置づけです。正直に開示しておくと、このリポジトリ自体の`dmg_sound/01-registers.gb`は、ここに既にベンダリングしているファイルとバイト単位で一致しません。つまり同じ作者のテスト一群の別の特定ビルドであり、既存の`dmg_sound/`のファイルの出典ではありません - ここから取得したのは`cpu_instrs/`と`instr_timing/`のみです。両スイートとも、`dmg_sound/`の`$A000`プロトコルより古いプロトコルを使います: このハーネスが描画しない画面に判定を出力しつつ、同じ内容を1バイトずつシリアルポート（`$FF01`/`$FF02`）にも送り、それを[`cpu-instrs.mjs`](../src/roms/cpu-instrs.mjs)が捕捉します。ここにある他のどのスイートとも異なり、この2つはハーネス独自のCPUフィクスチャではなく、パッケージ自身の`chips/gb/cpu.ts`を対象に実行します - それこそが目的で、特に`instr_timing`は、いかなる参照エミュレータとも無関係に、パッケージ自身のSM83のタイミングを実機のGame Boyの挙動と照合します。
