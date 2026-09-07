<a id="chipvoice"></a>
# chipvoice

<p align="center">
  <a href="https://github.com/gwendall/chipvoice/blob/main/packages/chipvoice/README.md">English</a> &bull;
  <a href="https://github.com/gwendall/chipvoice/blob/main/packages/chipvoice/README_ja.md">日本語</a>
</p>


ブラウザーでもオフラインでも使える5つのクラシック音源チップ：**NES（2A03）、Game Boy、Mega Drive、SNES、Commodore 64**。楽譜は4つの音楽的役割を選んだハードウェアへ編曲します。効果音は音楽から物理チャンネルを借り、終了時に返します。Stopは将来の音楽の書き込みを取り消します。

デジタルコアは参照エミュレーターと実機用テストROMで検証します。[適合性シート](https://github.com/gwendall/chipvoice/blob/main/docs/README_ja.md#chip-sheets-and-oracles)に検証済みの挙動と残る差を記載します。すべてのアナログ特性を実機で測定したという主張ではありません。

完全な多声音楽には、小さな4役割の`Score`を補う`Performance`を使います。正確なtickと表情を持つMIDIを読み込み、明示的なハードウェア割当を作り、損失を確認してworkerでレンダーします。

```ts
import {importMidi, planPerformance, renderPerformance, toWav, snesChip} from 'chipvoice';
const source = importMidi(midiBytes); // Uint8Array、SMF 0/1、PPQ時刻
const plan = planPerformance(source, snesChip, {allowLoss: true});
console.log(source.notices, plan.losses); // 役割、音色、省略された音符を確認
const wav = toWav(renderPerformance(plan, snesChip));
```

`allowLoss`がなければ、発音数予算による省略は例外になります。テンポマップ、同時発音、ベロシティー、サステイン、ピッチベンド、音量／エクスプレッションを保持し、未対応コントローラーも保存して報告します。GM系パッチは近似で、元ゲームの楽器認証ではありません。[編曲の手順](https://github.com/gwendall/chipvoice/blob/main/scores/arrangements/README_ja.md)に入力制限、原典検査、実機由来の参照、worker再生を記載します。

メガドライブのネイティブ再生は `importVgm(vgmBytes)` と同じ
`renderPerformance(plan, mdChip)` エンジンを使い、FM 音色、PSG コマンド、
オリジナルの DAC サンプルを保持します。`isolateNativePerformance(plan, ['fm6'])`
は共有バス時刻を維持してハードウェアの声をソロにします。上限付き VGM
インポーターは未対応コマンドを拒否し、すべての VGM 音源やストリーム形式への
対応は主張しません。[ネイティブ原典の手順](https://github.com/gwendall/chipvoice/blob/main/scores/arrangements/README_ja.md)を参照してください。

```bash
npm i chipvoice
```

```ts
import { Chip } from "chipvoice";

const chip = await Chip.create();     // ブラウザーが音声を許可するクリック内で呼び出す
chip.play(THEME);

// 銃声が0.1秒間pulse 2を借り、その間は和音が途切れる。
// この制約がゲーム機らしい音を作る。
chip.sfx("p2", {
  note: "B6",
  instrument: { duty: 0, volume: [13, 12, 10, 8, 5, 2], slide: -3.4 },
  duration: 0.1,
});
```

コピーするファイルもビルド工程も設定も不要です。workletをインライン化してblob URLでブラウザーへ渡すため、`npm install`だけで導入できます。

同じ曲をGame Boyで鳴らすにはオプション1つを変えるだけ。各チップが4行を固有のチャンネルへ割り当て、固有の流儀でレジスターを書きます。ベースは波形チャンネルへ移り、音量変化は再トリガーになり、ドラムの減衰は実機エンベロープになります。

```ts
const gb = await Chip.create({ chip: "dmg" });
gb.play(THEME);                       // 同じ4行の曲
gb.sfx("ch2", { note: "B6", instrument: LASER, duration: 0.1 });
gb.spec.voices;                       // ch1, ch2, ch3, ch4：sfx()へ渡すボイス名
```

`THEME`のように楽器を明記した曲も、4行と役割ごとの音色意図を1語で示す**楽譜**も使えます。各チップの編曲器がその意図を固有の楽器へ変換します。単語は全チップ共通で、`INTENTS`が意味と一覧を提供します。

```ts
import { arrange, INTENTS } from "chipvoice";

const song = arrange(
  { bpm: 152, order: [0], patterns: [...], intent: { lead: "bright", bass: "hollow" } },
  "dmg",
);
gb.play(song);                        // 12.5%パルスのリード、波形RAMの矩形波
INTENTS.bass.hollow;                  // 説明文：Game Boyの波形チャンネルでは矩形波、NESでは三角波のみ
```

**[試す](https://chipvoice.dev/ja)** — 3カートリッジ、5機種、エディター、音楽からチャンネルを奪う様子を見られる4つのアーケードパッド。曲はURL内にあるので、リンクがセーブファイルです。

<a id="why-not-oscillators"></a>
## オシレーターを使わない理由

ブラウザーの「8ビット」ライブラリは一般に`OscillatorNode`の`type: "square"`とゲイン包絡線を使います。しかし調整でなく構造に関わる3つの理由で、ゲーム機そのものの音にはなりません。

- **`PeriodicWave`は帯域制限されます。** Web Audioは波形をアンチエイリアス処理します。2A03は全高調波を持つ生の矩形波を出し、この違いを切り替える設定はありません。
- **2A03は非線形にミックスします。** 2パルスは`95.88 / (8128/(p1+p2) + 100)`、三角波とノイズは別曲線へ通します。同時に鳴る2音は各音の単純な和ではありません。
- **3つのアナログフィルター**、90 Hzと440 Hzのハイパス、14 kHzのローパスが、NESの箱鳴り感と軽い低域を作ります。

そこで8要素のデューティー列と15ビットLFSRをチップクロックで進め、実機のDAC曲線で混ぜてフィルターへ通します。書き込みにはCPUサイクルを付け、サンプル内のどこにあってもそのサイクルへ適用するので、スライドは予約したフレームに届きます。

<a id="four-channels-and-the-fight-over-them"></a>
## 4チャンネルをめぐる競合

| チャンネル | 通常の音楽 | 通常の効果音 |
| --- | --- | --- |
| `p1` | 主旋律 | ゲームオーバー |
| `p2` | アルペジオ和音 | その他全般 |
| `tri` | ベース | 爆発の低音 |
| `noi` | ドラム | 命中、爆発、風切り音 |

使うのは4声だけで、音楽と効果音が取り合います。ブラウザーのチップチューンライブラリが音楽と効果音へ別のトラックを与えるのは、実機にはできなかったことです。この制約がなくなることが、音の違いの大きな理由です。（チップにはメモリーのサンプルを再生する第5のDMCがあり、多くのカートリッジのドラムに使われます。本実装にもありますが、まだ楽器から到達できません。）

`chip.sfx()`は効果音の長さだけチャンネルを確保します。シーケンサーは音を予約するたびに空きを確認し、使えない音を飛ばします。

```ts
chip.canPlay("p1");        // 現在リードのボイスを使えるか
```

<a id="writing-music"></a>
## 音楽を書く

16分音符ごとに1トークン、4チャンネルを文字列で書きます。

```ts
const PATTERN = {
  bass:  `A1  .   A1  .   A1  .   A1  .   A1  .   A1  .   A1  .   G1  .`,
  lead:  `E4  .   .   .   G4  .   A4  .   .   .   B4  .   C5  .   .   .`,
  chord: `A3  .   .   .   .   .   .   .   .   .   .   .   .   .   .   .`,
  chordShape: [[0, 3, 7]],   // 持続する1音を60 Hzでアルペジオ化
  perc:  `K   .   H   .   S   .   H   .   K   .   H   K   S   .   H   .`,
};
```

音名は`A4`や`F#3`、`.`は保持、`=`は停止。ドラムは`K`キック、`S`スネア、`H`ハット、`O`オープンハットです。**ベース行のトークン数がパターン長**を決めるので、5拍子の小節も書けます。

楽器はFamiTrackerが採用したフレームごとのテーブルです。実機ドライバーが毎NMIに書いたものと同じ形です。

```ts
const LEAD = {
  duty: 1,                                   // 0 = 12.5%, 1 = 25%, 2 = 50%
  volume: [15, 15, 14, 13, 12, 12, 11, 10],  // 60 Hzの各フレームに1要素
  sustain: true,                             // ノートオフまで末尾の値を保持
  vibrato: { depth: 0.18, rate: 8, delay: 12 },
};
```

SNESの和音は同時発音し、三和音で3声、拡張和音で最大5声を使います。和音全体の音量予算を各音へ分け、控えめにステレオ配置します。5音を超える形は検証警告を出し、全音程を保つ単声アルペジオへ切り替えます。他の機種は1つの保持音をフレームレートでアルペジオ化します。

ライブで滑らかに置き換えるには、同じAudioContextへ第2のチップを準備し、予約の先読み範囲内で`oldChip.phaseAt(at)`を読み、`newChip.play(nextSong, position, at)`を呼びます。位置にはグリッドステップ内の小数`progress`も含められます。note-on後に出力ノードをクロスフェードし、旧チップを破棄します。デモの`LivePlayback`がこの有界な引き継ぎを実装します。通常の`play(song)`は準備用の先読みを維持し、オフラインは楽曲時刻0から始めます。

<a id="snapping-effects-to-the-beat"></a>
## 効果音を拍へ合わせる

Rezの手軽な工夫です。自分の音をグリッドへ合わせると、リズム感がなくても音楽的に聞こえます。

```ts
chip.sfx("noi", { ...boom, delay: chip.beatDelay() });
```

既定の上限は120 ms。それを超えると即時再生します。拍に合うことより操作へ間に合うことが重要だからです。**銃には使わないでください。** 8分音符遅れる射撃はトリガーが鈍く感じられ、シューティングでは許容できません。

<a id="rendering-without-a-browser"></a>
## ブラウザーなしでレンダーする

エンジン版、楽譜、レンダー設定を固定すれば結果は決定的です。キャッシュキーにはエンジンとエンコーダーの版を含めます。公開APIは安定した曲URLを再検証し、公開レンダーを30秒へ制限し、要求ごとに削除状態を確認します。

```ts
import { renderSong, toWav } from "chipvoice";

const audio = renderSong(THEME, { seconds: 30 });
writeFileSync("theme.wav", toWav(audio));
```

両環境で同じDSPが動きます。`src/chips/nes/dsp.ts`は通常のTypeScriptモジュールで、Nodeはそれをimportします。ビルドはworkletの外殻と一緒に自己完結スクリプトへまとめ、文字列を`addModule`へ渡します。blob URLにはimportの相対解決先がないからです。リアルタイムとファイルの違いはサンプル時計の出所だけで、workletは`currentFrame`、オフラインはカウンターです。

`test/parity.mjs`が両方を測って比較します。ラウドネスは千分の1、明るさは6%以内で一致し、残りはブラウザーが任意の位置でコンテキストを開始するためです。

<a id="how-accurate-is-it"></a>
## どれほど正確か

正確さは形容詞でなく測定です。**適合性シート**[`docs/chips/2a03.md`](https://github.com/gwendall/chipvoice/blob/main/docs/chips/2a03_ja.md)に、どの参照で何を検証し、何が異なるかを記載します。[`docs/CONFORMANCE.md`](https://github.com/gwendall/chipvoice/blob/main/docs/CONFORMANCE_ja.md)が全チップ共通の手順です。シートで確認するまでは、時計は数式に一致し、ミキサーとフィルターは文献の曲線で、ドライバーが使わない部分はWikiから実装した未検証のもの、というのが正直な要約です。

各pushで4つのテストを実行します。

| | |
| --- | --- |
| `test/validate.mjs` | 不正な曲に検証器が正しい指摘をすること |
| `test/clock.mjs` | 各声の速度とデータシート数式、フレームカウンター位相、レジスターとnesdevの一致 |
| `test/driver.mjs` | スイープバイト、位相再始動、各チャンネル自身のレジスターでの消音など、NESが必要とした書き込み |
| `test/golden.mjs` | 固定曲が同じバイトになること。ハッシュが変われば音が変わった |

特に見るのはゴールデンハッシュです。実機へ近づける修正でも変わるので、そのコミットに何がなぜ変わったかを書きます。その説明なく変わるハッシュは回帰です。

さらに各pushで`packages/conform`の`conform`が2つを行います。レジスターログのコーパスを本チップとblarggのNes_Snd_Emuへ通してサイクル比較し、全曲のパルスは一致します。残る差がバグでなく参照の規約である理由はシートに記載します。また専用6502でblarggの全APU ROMを実行し、長さ、サイクル精度のフレーム時刻、IRQ、リセット、DMCの29個がすべて合格します。各チャンネルをDMCのDACと打ち消すミキサーテストも、本人が録音した実NESと同程度に打ち消します。DAC曲線は仮定でなく測定です。

`src/chips/gb/dsp.ts`から`gbChip`として公開するGame Boyにも同じ手順を適用します。`test/gb.mjs`が時計を数式と比較し、専用SM83で12個の`dmg_sound` ROMが全合格し、Gb_Snd_Emuとも比較します。シートは[`docs/chips/dmg.md`](https://github.com/gwendall/chipvoice/blob/main/docs/chips/dmg_ja.md)。`test/gb-driver.mjs`が書き込み、`test/golden-dmg.mjs`が2A03の`golden.mjs`同様にレンダーを固定します。

第3はMega Driveの`mdChip`。`src/chips/md/ym2612.ts`はNuked-OPN2の行単位の移植で、全声の全サイクルがハーネスで一致します。SN76489は文献から実装しました。`Chip.create({ chip: "md" })`は旋律／ベースをFM、和音をPSG、キットをノイズへ割り当てます。独自音色には4オペレーターの`Instrument.fm`を使えます。シートは[`docs/chips/md.md`](https://github.com/gwendall/chipvoice/blob/main/docs/chips/md_ja.md)。**ライセンス：** YM2612のファイルはNuked-OPN2の派生でLGPL 2.1です。パッケージの表記は`(MIT AND LGPL-2.1-or-later)`。この節で扱う他の独自コードはMITです。

第4はSNESの`snesChip`。`src/chips/snes/sdsp.ts`はsnes_spcから行単位で移植した第2のLGPLファイルで、DSP出力がサンプルごとに一致します。すべてがサンプル音源です。`Chip.create({ chip: "snes" })`はビルド時に作成・符号化した独自BRRバンクを、実機のエコー付きで鳴らします。旋律の意図はフルート／ブラス／マレット、和音はハープ／ストリングス、ベースはピック／リード／シンセベースを選びます。各音に固有のアタック、持続ループ、実機エンベロープがあります。旧波形とドラムも使え、`encodeBrr`も公開します。`Instrument.sample`はドライバーバンク内のサンプル名です。シートは[`docs/chips/snes.md`](https://github.com/gwendall/chipvoice/blob/main/docs/chips/snes_ja.md)。

第5はC64の`c64Chip`。`src/chips/c64/sid.ts`の6581 SIDを文献から書き、ハーネス参照のreSID-fpと全声の2デジタル値で一致します。4行に3声を使い、`Chip.create({ chip: "c64" })`は旋律とベースへ各1声、第3へ和音とキットを割り当て、ドラムが和音を切り、後で和音が戻ります。`Instrument.waveform`は音符全体またはフレームごとに波形を選びます。アナログの`SID_6581_PROFILE`は非線形DACラダー、測定曲線上のフィルター、出力段のプロファイルです。シートは[`docs/chips/c64.md`](https://github.com/gwendall/chipvoice/blob/main/docs/chips/c64_ja.md)。

<a id="the-song-as-bytes-vgm"></a>
## 曲をバイトにする：VGM

NESにとって曲はレジスター書き込みで、本ライブラリも同じです。最も直接的なファイルはその一覧です。チップチューンの交換形式VGMにすれば対応プレイヤーで開け、実機のVGMプレイヤーならチップ自体で鳴らせます。

```ts
import { recordSong, toVgm } from "chipvoice";

const { events, cycles } = recordSong(THEME, { seconds: 30 });
writeFileSync("theme.vgm", toVgm(events, cycles, { title: "Theme", author: "me" }));
```

`recordSong`は`renderSong`と同じドライバーとシーケンサーを実行し、鳴らす代わりに書き込みを保存します。`toVgm`は形式の時計である44100 Hzのサンプルへ丸め、プレイヤーに名前を出すGD3タグを書きます。`loopAtCycle`を渡すとそこへループします。

<a id="checking-a-song-before-playing-it"></a>
## 再生前に曲を検証する

```ts
import { validateSong } from "chipvoice";

const { ok, issues, measured } = validateSong(song);
```

耳なしで作曲するものに厳しい性質があります。**音名の誤記は無音になります。** 音名でないトークンは0 Hzへ解決し、ドライバーが何も予約せず戻るので、エラーなしで曲の途中に穴が空きます。

そのため各指摘に`silent`を付け、普通の誤りと、証拠を残さない誤りを区別します。

```json
{ "level": "error", "track": "lead", "step": 12, "token": "H4",
  "message": "not a note name. A note is a letter A-G, an optional # or b, then an octave: A4, F#3, Bb2. Use . to hold and = to cut",
  "silent": true }
```

ループ長、オンセット密度、旋律の音域も測り、反復として聞こえ始める14秒未満のループへ警告します。

<a id="other-chips"></a>
## ほかのチップ

NES、Game Boy、Mega Drive、SNES、C64の5機種を出荷しています。`ChipSpec`が声と役割割当を定義し、`ChipCore`が時刻付きのレジスター書き込みを受け、バッファーを埋めます。楽器はフレームテーブル、FMパッチ、サンプルに対応します。

移植可能な楽譜は4役割を保ちます。Mega DriveはFMの旋律／ベースとPSGの和音／ドラム、SNESはサンプル音声、C64は第3声の和音／打楽器共有へ割り当てます。原文のこの節ではSNES三和音、FM打楽器、SIDフィルター制御をバックログとして記載しています（現在のSNES同時和音は上の節を参照）。VGM出力はNES、Game Boy、Mega Drive。SNESとC64のログをファイルへ出す機能はまだ出荷していません。

`validateSong`は機種別の基音とアルペジオの音域警告を出します。楽譜を保存しますが、すべての変調が表現範囲内に収まる保証はしません。[移植可能な楽譜](../../docs/SCORE_ja.md)と各シートで、能力、およびコーパス一致と実機測定の違いを確認してください。

<a id="controlled-variations"></a>
## 制御された変奏

```ts
import { varyScore } from "chipvoice";
const variation = varyScore(score, {
  kind: "melody", // または"drums"、"timbres"
  locked: ["bass", "chord"],
  seed: 42,
});
```

変奏はローカルで再現可能です。旋律は既存のピッチクラスを使い、無音パターンを含むリズムを保ち、ドラムは作成済みグルーヴを選びます。ロックした役割は音符と音色を維持します。編集で明示的な再生IDを外し、`arrange`が新しいIDを導きます。デモにはUndo、任意のMIDI音符入力、揃ったステム、取消可能な5機種ZIP出力があります。

<a id="api"></a>
## API

| | |
| --- | --- |
| `Chip.create(options?)` | チップを起動。AudioWorkletがなければ`null`に解決し、呼出元がクラッシュせず縮退できる |
| `chip.play(song)` | 曲を開始。同じ`song.id`の再生中は何もしない |
| `chip.stop()` | 停止し全チャンネルを解放 |
| `chip.position(into?)` | 今聞こえるステップとorder番号。呼出元の保存領域を任意に渡せる |
| `chip.quantizedPosition()` | 入力時に最も近い16分音符。パターン／ループの折返しも含む。再生前や予約の空白では`null` |
| `chip.sfx(channel, opts)` | 音楽からチャンネルを取り、効果音を再生 |
| `chip.canPlay(channel, at?)` | チャンネルが空いているか |
| `chip.beatDelay(maxWait?)` | 次の8分音符までの秒数。上限あり |
| `chip.setGain(0..1)` | 段差はクリックになるためランプで変更 |
| `chip.output` | 全音声が通るノード。解析と録音用 |
| `chip.audioContext` | 他の音声と同じコンテキストを共有するために使う |
| `chip.dispose()` | workletを解放し、自分で作ったコンテキストなら閉じる |

曲はオブジェクト同一性でなく`id`で照合します。呼出時のスプレッドで1項目を変えた変種は、同一性検査では毎回別物になり、毎回曲を最初から始めてしまいます。

**独自シーケンサーを使う場合。** `Chip`は全体を提供し、ゲームの通常の入口です。すでに一時停止、保持、再開などの音楽状態機械があるなら、音符をレジスターへ変えworkletと通信する部分だけを使えます。個別に公開しています。

```ts
import { APU, type NoteSink } from "chipvoice";

const apu = new APU(ctx);
await apu.init(master);          // workletを読み込み接続
apu.playNote("p2", { note: "B6", instrument: LASER, duration: 0.1, at });
```

`OfflineDriver`はworkletの代わりにチップコアへ書く同じクラスで、`renderSong`が使います。

<a id="releasing"></a>
## リリース

タグを契機にGitHub Actionsから**trusted publishing**で公開します。npmがワークフローのOIDCトークンを短命の認証情報へ交換し、秘密を保存しません。漏洩、更新、失効忘れの対象がなくなります。原文では、npmが2027年1月に直接公開用の2FA回避トークンを廃止する予定であり、代案には期限があると記載しています。

```
cd packages/chipvoice
npm version patch --no-git-tag-version      # or minor, or major
git commit -am "chipvoice $(node -p 'require("./package.json").version')"
git tag -a "v$(node -p 'require("./package.json").version')" -m "chipvoice $(node -p 'require("./package.json").version')"
git push --follow-tags                         # follows annotated tags only, hence -a
```

1操作でなく3段階なのは、`npm version`がコミットとタグを行うのはパッケージがリポジトリ直下にある場合だけだからです。これはワークスペース内なので、そのまま実行するとファイルだけを更新し、ほかは黙って何もしません。

タグと`package.json`が違えばワークフローは公開を拒否します。先に`test:fresh`でtarballを空のプロジェクトへ入れ、ブラウザーで動かします。これだけが`npm install`で実際に届くものを見ます。`files`の誤り、exportの欠落、workletの同梱漏れは、リポジトリ内部では正常に見えるからです。

<a id="where-it-comes-from"></a>
## 出自

1995年のVirtual Boyの赤4階調で描くワイヤーフレームのレールシューター、[redburner.com](https://redburner.com)から抽出しました。その全音声がこのコードから出ることが、実際の統合試験になります。

独自コードはMIT、派生YM2612とS-DSPコアはLGPL-2.1-or-later。パッケージのライセンスは`(MIT AND LGPL-2.1-or-later)`です。ソースヘッダーと同梱の通知を参照してください。ゲーム機マークの権利は各所有者に帰属します。

<a id="demo-and-transport"></a>
### デモと再生制御

デモは編集、下書き、公開を通じて完全な楽譜を保持します。楽譜と実行可能なブラウザー例をコピーするか、ステレオWAVへ出力できます。ローカルのミュート／ソロと、録音しなかったライブ効果音は出力楽譜に入りません。

`chip.play(song, { step, orderIndex })`で楽曲内の位置から開始します。インスタンスを置き換えるときは`chip.position()`を読み、別機種でも同じ区間を比較します。`arrange(score)`は対象チップを保持し、`renderSong`は明示的な上書きがなければそれに従います。置き換えたインスタンスは必ず破棄してください。

サーバー音声リンクは現在配信中のレンダラーを使い、バイト列を再検証します。リリースをまたいで再現するには楽譜を保存し、パッケージ版を固定します。[デモ仕様](https://github.com/gwendall/chipvoice/blob/main/docs/DEMO_ja.md)を参照してください。

<a id="shape-a-composition"></a>
### 曲を調整する

`shapeScore(source, { transpose: 7, drums: 60 })`は有音高パートを7半音上げ、原典ドラムの60%を保持します。キック／スネアと強拍を決定的に優先します。和音の音程、休符、時刻は保持します。結果は通常の楽譜で、`arrange`、再生、録音、出力へ渡せます。各プレビューは同じ原典へ適用し、`{transpose: 0, drums: 100}`なら原典そのものを返します。`transposeBounds(source)`は1オクターブ内で可能な移動量を返し、範囲外は音を切り詰めず例外にします。[楽譜の手順](https://github.com/gwendall/chipvoice/blob/main/scores/README_ja.md)を参照してください。

<a id="straight-notes-and-triplets-0140"></a>
### 通常の音符と3連符（0.14.0）

`Score.stepsPerBeat` / `Song.stepsPerBeat`は`4`（既定）または`12`です。1トークンが1グリッドステップ。4分音符あたり12ステップなら、BPMを変えず16分音符と3連符を表現できます。`loopSeconds`、ライブ取得、レンダー、パッド量子化、楽譜変換がこのグリッドを使います。使わない役割は`=`の後に`.`を並べて無音にします。編曲器のためにベースを創作する必要はありません。

オフラインの`renderSong`と`recordSong`は楽曲時刻0から始まり、全ループ時間に最後の音が入ります。ライブは準備の先読みを維持します。この修正で音声ゴールデンスナップショットを意図的に更新しました。取得時間はWAVと同じサンプル丸めを使います。44100 Hz以外でレンダーする場合、`recordSong`にも同じ`sampleRate`を渡すと、長さがサンプル数で端数になるループも最後のサンプルまで正確に再生できます。取得はコアのイベント列を共有し、休符は過去の取得履歴を再走査せず、不要になった将来の書き込みを取り消します。

決定的な旋律検査、許容差、音響／DSPの忠実度との違いは[原典比較の手順](https://github.com/gwendall/chipvoice/blob/main/scores/README_ja.md)に記載します。

<a id="offline-arrangement-progress"></a>
### オフライン編曲の進捗

`renderPerformance(plan, chip, {onProgress: fraction => { /* UIを更新 */ }})`は処理済み音声フレームを0〜1の割合で報告します。長いレンダーはworkerへ置き、UIへの通知を間引きます。このコールバックは生成PCMを変えません。編曲ラボは解析、レンダー、再生準備の状態を実演します。MIDI読込はUTF-8の名前を保ち、古い西欧テキストにはWindows-1252へのフォールバックを報告します。
