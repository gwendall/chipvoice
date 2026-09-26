<a id="a-games-own-mega-drive-driver"></a>
# ゲーム専用のメガドライブdriver

<p align="center">
  <a href="MD-NATIVE-DRIVER.md">English</a> &bull;
  <a href="MD-NATIVE-DRIVER_ja.md">日本語</a>
</p>

移植用のscoreは、5機種で演奏される4つの役割です。一つの機種のために書かれたゲームは、その機種のすべてを使いたがります。FM 6チャンネル、完全な左右定位、DACのPCMドラム、矩形波3音、独自のレートのノイズ、そして1992年のサウンドプログラマーが使った技です。この経路がそれを提供します。ネイティブのメガドライブdriver、出発点になるbank、テキストtracker、そしてrenderからゲームが出荷するファイルまでの数手順です。`MdDriver`の中ではなく横に置く理由は[決定32](DECISIONS_ja.md#32-a-games-own-mega-drive-driver-beside-the-portable-one-2026-09-26)を参照してください。

これは、サウンドトラック全体と40の効果音がこの上で書かれたシューティングPunk Forceから抽出しました。抽出は、その楽譜を旧コードと新コードでcompileして確認しました。レジスター書き込みはバイト単位で同じ、その後のすべての手順から出るサンプルも同じです。

<a id="the-pieces"></a>
## 構成

| Export | 役割 |
| --- | --- |
| `compileMdVoices(voices)` | voiceをマスタークロック上の`RegisterEvent`にし、最も混んだ書き込みの遅れを返す |
| `arrangeMdTracker(song, {tailBars, bank})` | テキストで書いた曲をそのvoiceにし、ループ点を返す |
| `MD_BANK`、`MD_PATCHES`、`MD_PSG_INSTRUMENTS`、`MD_NOISE_INSTRUMENTS`、`MD_DRUMS` | FMパッチ、PSGとノイズのエンベロープ、合成PCMキット |
| `mdDrumStream(hits, rate, seconds)`、`mdDrumSample(name, rate)` | キットをDAC用の一本のストリームに混ぜる |
| `mdPatchWithRelease(patch, rr)` | キャリアが早く止まるパッチ、効果音用 |
| `renderMdEvents(events, {seconds, profile, gain})` | 書き込みを新しいメガドライブで演奏する |
| `MD_BRIGHT_PROFILE` | Model 1の段を12 kHzまで開き、ハイハットの高域を残す |
| `trimRender`、`levelRender`、`scaleRender`、`packSprite`、`renderOnset` | trim、ピーク上限の下で音量感による調整、効果音を一つのファイルに詰める、音の始まりを求める |

<a id="voices"></a>
## Voice

voiceは機種のチャンネルの一つと、それが演奏するものです。時刻は秒、音程はMIDI半音（小数でデチューン）、音量は線形です。

| Voice | 受け取るもの | 備考 |
| --- | --- | --- |
| `fm1`〜`fm6` | `pan`（`L`、`R`、`C`）、`gain`、`notes` | 各音符は`FmPatch`を持つ。`levels`でフレームごとに形づける |
| `psg1`〜`psg3` | `gain`、`notes` | 各音符はフレームごとのdB値の`envelope`と`hold`を持つ |
| `noise` | `gain`、`hits` | hitは`envelope`と、`rate`（tone 3の周期）または`fixed`レートを持つ。`white: false`は周期ノイズ |
| `dac` | `pan`、`stream` | `MD_DAC_HZ`（約13.3 kHz）のPCMストリーム。FM 6を使う |

すべての音符は、しゃくり（`bend`、`bendFrames`）、前の音からのスライド（`glide`、フレーム単位。前の音に接する音へのglideはレガートで新しいアタックなし）、終わりの下降（`fall`、`fallAt`）、遅延ビブラート（`vibrato: {delay, hz, depth}`）、スイープ（`sweep`、フレームあたり半音）を持てます。すべては1フレームに1回、毎秒60回動きます。

`compileMdVoices`は機種にできないことを拒否します。未知のvoice、二度指定されたvoice、`fm6`と並ぶ`dac`、`rate`を使うノイズと並ぶ`psg3`（rateはtone 3の周期です）、そして一つのチャンネルで同時に鳴る二つの音符です（音符は時刻順に並び、各音符は次が始まる前に終わる。接する場合はレガート）。ノイズのhitは次のhitで打ち切られます。

```ts
import { compileMdVoices, mdDrumStream, mdPatchWithRelease, MD_PATCHES, MD_DAC_HZ } from "chipvoice";

const shot = compileMdVoices([
  { voice: "fm1", notes: [{ at: 0, until: 0.05, pitch: 88, sweep: -4, patch: mdPatchWithRelease(MD_PATCHES.zap, 11) }] },
  { voice: "noise", hits: [{ at: 0, until: 0.033, envelope: [-6, -16], rate: 1 }] },
  { voice: "dac", stream: mdDrumStream([{ at: 0, drum: "boomS", volume: 0.5 }], MD_DAC_HZ, 0.6) },
]);
```

<a id="the-bus"></a>
### バス

書き込みは、driverが分割しないトランザクション（周波数の2レジスター、パッチ）にまとめます。YM2612の書き込みはbusyフラグの後ろに並び、1書き込みあたり内部32サイクルです。PSGは独自の列に並びます。フラグが通す以上を求めるフレームは遅れて届き、`lateCycles`がその量をマスターサイクル（毎秒`MD_MASTER_HZ`）で示します。Punk Forceの曲は、DACを流しながら2.8〜4.5 msが最大です。

パッチはチャンネルごとに一度書かれ、新しいパッチは異なるレジスターだけを書きます。LFOはoffです（起動時に`$22` = 0を書く）。そのためパッチの`ams`、`pms`とオペレーターの`am`はまだ効きません。`ssg`はレジスター`$90`に届きます。

<a id="the-tracker"></a>
## Tracker

曲はテキストのセクションで、チャンネルごとに1行です。16分音符が1ステップです。

| トークン | 意味 |
| --- | --- |
| `E5:4` | E5を16分4つ分。長さは引き継がれる（`E5:2 G5 A5`はすべて2） |
| `r:4` | 休符 |
| `-:4` | 前の音をさらに伸ばす |
| `^E5` | 全音下からしゃくり上げる |
| `~G5` | 前の音からスライド、新しいアタックなし |
| `E5'` `E5!` `E5>` | スタッカート（半分）、アクセント（x1.26）、終わりで下降 |
| `@mute` | 以降の音符はこのパッチまたはPSG楽器を使う |
| `%60` | 以降の音符を60 %で |
| `\|` | 小節線、検査される |

ドラムとノイズの行は、bankの`drumLetters`と`noiseLetters`から16分ごとに1文字を取ります。`.`と`-`は無音です。既定のbankでは、DACで`k`キック、`s`スネア、`S`強いスネア、`x`両方、`h` `m` `l`タム、ノイズで`h`ハイハット、`H`強いハイハット、`o`オープンハイハット、`c`クラッシュです。

チャンネルは`voice`を名指しし、`pan`、`patch`、`volume`、`transpose`、`vibrato`（4分音符以上の音符に。既定は8フレーム、6.3 Hz、0.3半音）を設定できます。`echo: {of, delay, volume}`は、このチャンネルに独自の行がないところで、別チャンネルの書かれた音符を遅く小さく複製します。行を書いたセクション（ハーモニー）はそれを保ちます。ノイズの`snareWires`は、DACのスネアすべてにbankのスナッピーを重ねます。DACの13 kHzでは運べない音です。

`tailBars`は終わりの後にループセクションをその小節数だけもう一度演奏し、二周目が一周目と一致するところでループを切れるようにします。`loopStart`と`loopEnd`は秒で返ります。

```ts
const song = arrangeMdTracker({
  bpm: 160, order: ["intro", "A"], loop: "A",
  channels: {
    lead: { voice: "fm1", patch: "lead", vibrato: {}, volume: 0.52 },
    echo: { voice: "fm2", pan: "R", patch: "lead", echo: { of: "lead", delay: 3, volume: 0.3 } },
    drums: { voice: "dac" },
    hats: { voice: "noise", volume: 0.9, snareWires: true },
  },
  sections: {
    intro: { bars: 1, drums: "k...s...k.k.S..." },
    A: { bars: 1, lead: "^E5:3 G5:3 B5:4 A5:2 G5:2 F#5:2", drums: "k.k.s..kk.k.S...", hats: "h.h.h.h.h.h.h.hH" },
  },
}, { tailBars: 1 });
```

<a id="from-writes-to-the-files-a-game-ships"></a>
## 書き込みからゲームが出荷するファイルまで

事前renderした音声を再生するゲームは、コアをビルドスクリプトに置き、ファイルを出荷します。Punk Forceのスクリプトはこれだけで、エンジンの残りはありません。

```ts
import { arrangeMdTracker, compileMdVoices, renderMdEvents, trimRender, levelRender, packSprite, renderOnset, toWav, MD_BRIGHT_PROFILE } from "chipvoice";

const opts = { profile: MD_BRIGHT_PROFILE, gain: 0.9 };

// A loop: once through plus a bar of its start, so the jump lands on a downbeat
// even when a decoder shifts the audio by a few milliseconds.
const a = arrangeMdTracker(song, { tailBars: 1 });
const loop = levelRender(renderMdEvents(compileMdVoices(a.voices).events, { seconds: a.loopEnd + 16 * a.step, ...opts }), { peak: 0.89 });

// A jingle: rendered past its end, then cut where it died away.
const j = arrangeMdTracker(jingle);
const once = levelRender(trimRender(renderMdEvents(compileMdVoices(j.voices).events, { seconds: j.totalSeconds + 1.2, ...opts })), { peak: 0.89 });

// Effects: each alone on a fresh chip, levelled by loudness under a ceiling, laid end to end.
const parts = Object.entries(SFX).map(([name, fx]) => [name, levelRender(trimRender(renderMdEvents(compileMdVoices(fx.voices).events, { seconds: fx.seconds + 1, ...opts })), { peak: 0.95, rmsDb: fx.rms })]);
const { render, sprites } = packSprite(parts, { gapSeconds: 0.15 });

const wav = toWav(render); // then any encoder
const onset = renderOnset(render);
```

**デコーダーのずれ。** エンコーダーの遅延を無視するMP3デコーダーは、音声を数ミリ秒遅れて始めます。各renderの`renderOnset`をファイルの横に保存し、実行時にデコード後のバッファーを同じ方法で測り（冒頭のピークの4分の1に達する最初のサンプル）、その差をすべてのループ点とsprite位置に足します。測定は十数行なので、プレイヤーは実行時にchipvoiceとそのコアを読み込まず、自前のコピーを持てます。

エンコードは呼び出し側の仕事です。`toWav`はどのエンコーダーも受け付けるWAVを書きます。

<a id="what-is-checked"></a>
## 検証内容

- `test/md-native.mjs`：起動時の書き込み、busyフラグの間隔、パッチ差分、パン、レガート、レベル、ビブラート、PSGとノイズのバイト、DACの速さ、拒否、bank、trackerの全トークン、tailありなしのループ点、エコー、スナッピー。FM 1のA4は440 Hz、完全な左は左だけで聞こえる。
- `test/game-audio.mjs`：答えがわかっている信号でのtrim、scale、level、sprite、onset、brightプロファイルの高域。
- `test/golden-md-native.mjs`：全voiceを使う曲の書き込みとrenderのハッシュ。
- 抽出：Punk Forceの5曲（ステージは1,515,150書き込み、ボスは1,001,067）と40の効果音が、ゲーム自身のdriverと同じ書き込みにcompileされ、render、trim、level、spriteで同じサンプルになる。
