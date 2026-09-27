# NESキャプチャベンチ

<a id="nes-capture-bench"></a>
<p align="center">
  <a href="HARDWARE-BENCH.md">English</a> &bull;
  <a href="HARDWARE-BENCH_ja.md">日本語</a>
</p>

decision 38は、[HARDWARE-EVIDENCE.md](HARDWARE-EVIDENCE.md#nes-2a03)の無償証拠が尽きた時点で、キャプチャ用ベンチを検証するために1台のNESを購入するよう定めます。ミキサーは実録音に対して既に測定済みですが、フィルターコーナーはまだです。P2-3はまずハードウェアなしでこのベンチをソフトウェアだけで構築し実証しました。コミット済みのテストROM、同期マーカー・クロックドリフト補正・帯域別スペクトル誤差・コーナーフィッティングを備えた`bench:nes:render`／`bench:nes:compare`、そして意図的に誤ったコーナー・ゲイン・遅延・ドリフト・DCオフセット・ノイズを合成キャプチャから許容誤差内で復元するCIセルフテストです。詳しくは[CONFORMANCE.mdのアナログ段プロトコル](CONFORMANCE.md#the-analog-stage-protocol)と`docs/chips/2a03.md`のキャプチャベンチの段落を参照してください。本書はその後半、どの実機とキャプチャ経路を買うべきかを出典・確認日付付きで示し、実機到着後に実行するキャプチャ当日の正確なコマンドを示します。

**調査のみです。本書に載せたものは何も購入・注文・カートに入れていません。** 以下の各価格・仕様には出典と確認日（特記なき限り2026-09-27）を付けています。1つの確かな数値に絞れなかったものは、推測せずそのまま「不明」と明記します。

<a id="unit"></a>
## 実機

決め手は「NESかファミコンか」ではなく、実際にコンポジット映像＋音声のRCAジャックを備えて出荷された特定モデルかどうかです。それ以外はコンソールとインターフェースの間にRF復調器が必要になり、これ自体がチップ本来のフィルターと切り分けられない高域損失の原因になります（[使ってはいけないもの](#what-not-to-use)参照）。

- **NES-001（フロントローダー、1985年）、推奨。** 標準でRF（スイッチボックス経由）に加えて、本体側面に真のコンポジット映像とモノラル音声のRCAジャックを備えており、改造不要です。[The Silicon Underground, "How to connect a NES to a modern TV"](https://dfarq.homeip.net/how-to-connect-a-nes-to-a-modern-tv/)（確認2026-09-27）。[PCWorldのNES分解記事](https://www.pcworld.com/article/503959/inside_the_nes.html)（確認2026-09-27）も同内容を裏付けます。
- **NES-101（トップローダー、1993年）、標準では対象外。** 再設計でコンポジット／音声ジャックが廃止され、RF出力のみになりました。[RetroFixesのNES-101コンポジットAVアップグレード製品ページ](https://www.retrofixes.com/products/nes-toploader-av-upgrade)（確認2026-09-27）。[Ultimate Pop Culture WikiのNES-101ページ](https://ultimatepopculture.fandom.com/wiki/Nintendo_Entertainment_System_%28Model_NES-101%29)（確認2026-09-27）も同内容です。
- **ファミコン HVC-001（1983年）、標準では対象外。** RF出力のみで、AV出力は一切ありません。[NESdev wiki, "Family Computer"](https://www.nesdev.org/wiki/Family_Computer)（確認2026-09-27）。
- **AVファミコン HVC-101（1993年）、有効な第二候補。** 標準でコンポジット映像と2系統のモノラル音声を持つ「マルチ出力」端子（スーパーファミコンと同形状）を備え、RFモジュレーターを内蔵していません。コンポジットが唯一の使用方法であり、むしろNES-001よりも出力経路がクリーンな面すらあります（近くにRFモジュレーターがなく、音声への漏れ込みがありません）。[NESdev forums, on the HVC-101's connector pinout](https://forums.nesdev.org/viewtopic.php?t=20163)、[gbasp.ruのAVファミコンレビュー](https://gbasp.ru/avfamicomreview-en.html)（いずれも確認2026-09-27）で裏付けられています。日本から購入する場合やファミコン側のハードウェアを検証したい場合はこちらが良い選択ですが、日本国外での入手コストは高く（[入手](#sourcing)参照）、基板リビジョンの資料もNES-001より薄いです。

いずれもRP2A03／RP2A07系で、このベンチのスクリプトが前提とするNTSCクロック（1.789773 MHz、[NESdev wikiのCPUページ](https://www.nesdev.org/wiki/CPU)で確認、2026-09-27）で動作します。PAL版ではなくNTSC地域の実機を買ってください。PAL版RP2A07自身のクロックとDMAタイミングは`packages/conform/src/bench/script.mjs`が前提とするものと異なります。

**推奨：NES-001。** 「標準でコンポジット、RF不要」という同じ理屈はAVファミコンにも当てはまりますが、NES-001の方が日本国外では安く、入手しやすく、輸入の手間もありません。

<a id="board-revisions"></a>
### 基板リビジョン

NES-001の基板には`NES-CPU-04`から`NES-CPU-11`までの型番がシルク印刷されていますが、これは開けてみないと分からず、外側のラベルにもリビジョンは対応しません。出品情報にもほぼ記載がありません。判明している差異はほぼすべてCICロックアウトチップとCPU／PPUのダイのステッピング（2A03E／G／H、2C02E／G／H）に関するものです。NESdevの管理者Lord Nightmareによる整理を参照：[NESdev forums, "Anyone know differences between NES-001 (NTSC) Revisions?"](https://forums.nesdev.org/viewtopic.php?t=15985)（確認2026-09-27）。コンポジット／音声のアナログ出力段そのものを変えるリビジョンを記載した出典は見つかりませんでした。これは「調査していない」であって「無いと判明した」ではありません。AVファミコンHVC-101の基板（`HVCN-CPU-01`、`-02`など）には1つだけ具体的に記録された差異があり、7805レギュレーター付近のコンデンサの値が初期基板と後期基板で異なりますが、そのコンデンサが電気的に何をしているかを述べた出典はなく、同様に「不明」として扱います。参照：[famicomworld.comフォーラム, "Capacitor list for Famicom AV version"](https://www.famicomworld.com/forum/index.php?topic=9993.0)（確認2026-09-27）。いずれにせよ、実機のリビジョンを知る唯一の方法は購入後にケースを開けてシルク印刷を読むことです。

<a id="power"></a>
### 電源

| 実機 | 純正アダプター | 出典 |
| --- | --- | --- |
| NES-001 | NES-002：9 V AC、1.3 A、米国120 V入力、2ピンバレル、コンソール内部でDCに整流 | NESdev forums（確認2026-09-27） |
| AVファミコン HVC-101 | HVC-002系：10 V DC、850 mA、センターネガティブ、日本100 V入力 | NESdev forumsおよびiFixit Answers（確認2026-09-27） |

2つのアダプターは互換ではありません。ファミコンは既にDC入力を前提としているため、NESのACアダプターを繋ぐと壊れる可能性があります（「NES-002（AC出力）でAVファミコンを電源供給しようとすると、コンソールを壊す」[NESdev forums, "Powersupply for Famicom AV HVC-101?"](https://forums.nesdev.org/viewtopic.php?t=13926)、確認2026-09-27）。

いずれもスイッチング電源ではないため、形状だけ合わせたプラグアダプターを異なる電圧の商用電源に使うのは安全ではありません。米国仕様NES-001の純正アダプターを220-240 Vで使った場合、NESdevの投稿者は定格の約2倍の出力を計測しています：[NESdev forums, on running a NES-002 at 230 V](https://forums.nesdev.org/viewtopic.php?t=25182)（確認2026-09-27）。どちらの方向（米国機を米国外で、日本機を日本外で）でも、実用的な解決策はコンソール自身のDC出力仕様に合わせた100-240 V対応の汎用リプレイスメントアダプターで、"Retro-Bit"や"Retro Game Supply"といった名称でどちらのコンソール向けにも売られており、おおよそ$15-25です（小売検索、確認2026-09-27）。形状だけのアダプターは避けてください。

<a id="sourcing"></a>
### 入手

| 実機 | 価格 | 出典 |
| --- | --- | --- |
| NES-001、単体（本体のみ） | 通常$108.29 | [PriceCharting](https://www.pricecharting.com/game/nes/nintendo-nes-console)（確認2026-09-27） |
| NES-001、基本セット（本体・コントローラー・PSU・RFスイッチ） | $35-60 | [mcmrose.com, "How Much Is An Original Nintendo Worth In 2026?"](https://www.mcmrose.com/how-much-is-an-original-nintendo-worth/)（公開2026-01-26、確認2026-09-27） |
| NES-001、箱付き／コンプリート | $120-170 | 同出典 |
| AVファミコン HVC-101、単体 | 通常$125.00 | [PriceCharting](https://www.pricecharting.com/game/famicom/av-famicom)（確認2026-09-27） |
| AVファミコン HVC-101、日本国内オークション平均 | 約¥13,227（2026年9月下旬時点の約¥157／$1で約$78-85） | [aucfan.com](https://aucfan.com/search1/q-hvc.2d101/s-mix)（確認2026-09-27） |
| AVファミコン HVC-101、日本からの発送 | $88-120＋国際発送費約$10 | eBay出品、検索経由（確認2026-09-27） |

NES-001の基本セットにはRFスイッチが含まれますが、コンポジットケーブルは含まれません。別途明記されていない場合はコンポジット／RCAのAVケーブルも予算に入れてください。よくある安価な復刻アクセサリーですが、今回の調査では単価を特定できておらず、上表の$0という含意ではなく「未調査の小さな追加費用」として扱ってください。NES-101と初代ファミコンHVC-001は標準で対象外のため、この表から除外しています。

<a id="the-rest-of-the-bench"></a>
## ベンチの残り

<a id="flash-cart"></a>
### フラッシュカート

**Krikzz EverDrive N8 Pro（NES、72ピン）、$159.00。** メーカー直販サイトで在庫あり：[krikzz.com](https://krikzz.com/our-products/cartridges/everdrive-n8-pro-72pin.html)（確認2026-09-27）。FPGAでマッパー000-255をエミュレートするため、NROM／マッパー0（このベンチのROM）はその中で最も単純なケースです。[NESdev wikiのEverdrive N8ページ](https://www.nesdev.org/wiki/Everdrive_N8)（確認2026-09-27）で確認済み。KrikzzはウクライナからのUS発送で、製品ページに発送費の記載がないため、$159.00は本体価格のみと考えてください。米国内から発送が早いと思われる代替はStone Age Gamerで、同じカートリッジを$204.99で販売しています（[stoneagegamer.com](https://stoneagegamer.com/everdrive-n8-pro-base-black-nes.html)、確認2026-09-27）。購入した実機がファミコンだった場合は、同店の60ピン`N8 Pro Fami`が対応するSKUです。

<a id="audio-interface"></a>
### オーディオインターフェース

**Behringer UMC202HD、$86.90（Sweetwater経由、確認2026-09-27）。** 24ビット、最大192 kHz（96 kHzも選択可能）、XLR／TRSコンボのライン入力2系統、Midasマイクプリアンプを備え、信号経路にEQ／コンプレッサー／リミッターは一切ありません。[Behringer公式製品ページ](https://www.behringer.com/en/products/0805-AAR)（確認2026-09-27）で確認済み。ライン入力の最大レベルは+20 dBuです。

有力な代替は**Focusrite Scarlett 2i2（第4世代）、$228.00**（B&H、確認2026-09-27）で、こちらも24ビット／96 kHzです。切り替え可能な3つの色付け機能（Air、倍音的な色付けでデフォルトはオフ、Auto Gain、Clip Safe）を備えており、録音前にAirがオフであることを確認すれば本測定に使用できます。ライン入力の最大レベルは16 dBuです。信号経路に予期しない色付けを一切加えないという要件からは、UMC202HDの方がより安全な既定の選択です。

<a id="cables-and-gain-staging"></a>
### ケーブルとゲインステージング

NES／ファミコンの音声出力は**モノラル**です。キャプチャすべき信号はRCAジャック1本のみです。標準信号がモノラルであるからこそ「疑似ステレオ」ケーブルが専用に販売されていることからも裏付けられます（[Stone Age Gamerの疑似ステレオAVケーブル製品ページ](https://stoneagegamer.com/simulated-stereo-av-cable-for-nes.html)、確認2026-09-27）。このベンチに必要なのは、非バランスのRCA→1/4インチTS（TRSではなく、1/8インチミニアダプターでもない）ケーブル1本で、インターフェースのコンボジャックの**ライン**側に接続します。XLRのマイク側は絶対に使わないでください。ライン信号に対してゲインが大きすぎます。**Hosa CPR-100**または同等品が長さに応じておおよそ$13-23です（Hosaおよび販売店の出品情報、検索経由、確認2026-09-27。特定のSKUには絞り込めていません）。

ヘッドルームについて：一般家庭用のコンポジット／ライン音声は名目上-10 dBV、約-7.8 dBuです。上記どちらのインターフェースもライン入力で16-20 dBuまで受け付けるため、おおよそ24-28 dBの余裕があります。正しいライン入力にゲインつまみを下げて接続していれば、このコンソールの標準的な信号でクリップする可能性は低いです。実際のリスクはマイク入力に誤って接続すること、あるいは改造機で標準より信号が大きいことです。DI／レベル整合ボックスは、クリーンで再現性のあるゲインステージングのための保険として推奨されますが、レベルの観点で必須というわけではありません。使う場合、**ART CLEANBoxPro**（Sweetwaterで$72.89、この調査時点でバックオーダー、確認2026-09-27）はレベル変換を行いますが、メーカー自身の製品説明によれば、これはグラウンドループ・アイソレーターでは**ありません**。

<a id="ground-loops"></a>
### グラウンドループ

Focusrite自身のハムノイズに関するサポート記事は、順に次を推奨しています。非バランスの家庭用ソースにはグラウンドリフトスイッチ付きのDIボックスを使うこと。コンソール・インターフェース・コンピューターを同じコンセントまたは電源タップに接続し、ループを引き起こすグラウンド電位差を最小化すること。それでもハムが残る場合はトランス式のグラウンドループ・アイソレーターを使うこと（例としてARTのCleanBoxシリーズを名指ししています）。[Focusrite support, "Why is there unwanted hum noise in my monitors"](https://support.focusrite.com/hc/en-gb/articles/211615185-Why-is-there-unwanted-hum-noise-in-my-monitors)（確認2026-09-27）。その背景にある機構、すなわち別々にコンセントへ接続された機器間の小さなグラウンド電位差と、それをバランス回線が受信側でコモンモード除去する仕組みは、Bill Whitlockによる広く引用されるAES論文["Understanding, Finding & Eliminating Ground Loops"](https://www.jensen-transformers.com/wp-content/uploads/2014/08/generic-seminar.pdf)（確認2026-09-27）に記載されています。同じコンセントを共有してもハムが出る場合、実用的な機器は**ART CleanBox II**、トランス絶縁型のハム除去機で、Focusriteの記事が名指ししている製品そのものです。現在の価格は1つの確かな数値に絞り込めませんでした。検索結果は複数の販売店でおおよそ$61-100の範囲に分かれ、出品日もまちまちだったため、確かな数値ではなく目安の範囲として扱ってください。

<a id="what-not-to-use"></a>
### 使ってはいけないもの

- **HDMIキャプチャーカードやアップスケーラー。** NESにはネイティブのHDMIがないため、アップスケーラーとキャプチャードングルの両方が必要になり、安価なキャプチャー機器は多くの場合、音声を元のソースにかかわらず固定の48 kHz PCMストリームへ強制変換します。あるキャプチャーカードの仕様自体が「入力音声フォーマットを自動的に48 kHz PCMステレオ音声へ変換する」と明記しています（[AGPTEKのUSB 3.0 HDMIキャプチャーカード仕様](https://www.agptek.com/AGPTEK-USB-3-0-HDMI-HD-Video-Capture-1089-212-1.html)、確認2026-09-27）。これはこのベンチの目標である96 kHzを下回る強制リサンプルであり、CONFORMANCE.mdのプロトコルが避けるよう求める種類の追加処理そのものです。
- **どの実機であってもRF出力。** NES／ファミコンのRF変調はRF変調されたテレビでの再生を前提に設計されており、復調器に届く前に音声の高域成分を落とします。NESの開発者自身が[NESdev forums, "What are your opinions on RF audio on the NES?"](https://forums.nesdev.org/viewtopic.php?t=11505)（確認2026-09-27）で直接論じており、[ConsoleModsのNES映像出力に関する記事](https://consolemods.org/wiki/NES:Video_Output_Notes)も同内容を裏付けます。これが上記でNES-101と初代ファミコンHVC-001を対象外とする理由です。
- **Bluetoothや無線音声アダプター。** 必須のベースラインBluetooth音声コーデックであるSBCなど、非可逆コーデックを前提としており、音声データを削り、おおよそ250-350 msの遅延を加えます（[SoundGuysのBluetoothコーデック解説](https://www.soundguys.com/understanding-bluetooth-codecs-15352/)、確認2026-09-27）。非可逆圧縮と遅延の両方が、クリーンなフィルター応答測定には不適格です。
- **スピーカーの音をマイクで録音すること。** コンソール自体のライン出力が実際に何をしているかに、部屋自身の音響特性とマイク自身の周波数応答が上乗せされます。コンソール自体のアナログ段を測るという目的そのものを損ないます。
- **自動ゲイン制御付きのUSB「ゲームキャプチャー」機器。** 定義上、信号に応じて動くゲインをかけるか、上記HDMIカードのように固定サンプルレート変換を内蔵しています。いずれもこのベンチが依拠する「追加の色付けをしない」という要件に反します。

<a id="shopping-list"></a>
## 買い物リスト

| 項目 | 価格 | 備考 |
| --- | --- | --- |
| NES-001（コンポジットAVケーブル付きの、十分にコンプリートなセット） | $120-170 | 上記[入手](#sourcing) |
| 100-240 V対応汎用リプレイスメント電源アダプター | $15-25 | 120 V電源でも保険として推奨、それ以外では必須 |
| Krikzz EverDrive N8 Pro（NES） | $159.00 | ウクライナからのKrikzz自身の発送費は未確定で別途 |
| Behringer UMC202HD | $86.90 | |
| Hosa CPR-100 RCA→1/4インチTSモノラルケーブル | $13-23 | |
| ART CLEANBoxPro（任意、ゲインステージングの保険） | $72.89 | この調査時点でバックオーダー |
| ART CleanBox II（任意、実際にハムが出た場合のみ） | $61-100 | 1つの確かな数値に絞り込めていません |

**コア合計（本体・アダプター・カート・インターフェース・ケーブル、任意のボックスは除く）：**
おおよそ**$395-465**です。税、ウクライナからのKrikzz自身の発送費、そして購入したセットにコンポジットAVケーブルが含まれていない場合のその費用は含みません。CLEANBoxProを加えるとおおよそ**$470-540**、実際にハムが出た場合のみCleanBox IIも加えるとおおよそ**$530-640**になります。上記の数値はすべて本書内の出典と確認日にたどれるものであり、記憶で書いたものはありません。

<a id="capture-day-procedure"></a>
## キャプチャ当日の手順

以下のコマンドはすべてリポジトリのルートから実行します。`chipvoice-conform`は`packages/conform`自身のパッケージ名です。

1. **ROMを確認する。** コミット済みのテストROM（`packages/conform/roms/bench/nes-analog-script.nes`）は基本的に再構築不要です。もし再構築が必要になった場合は、`pnpm --filter chipvoice-conform bench:nes:build`が`script.mjs`からこのROMと`packages/conform/corpus/2a03/hardware-script.json`を書き直し、新しいROMのSHA-256をそのJSONファイルに記録します。手で入力することはありません。書き込んだROMのハッシュはそのファイルに対して`shasum -a 256 packages/conform/roms/bench/nes-analog-script.nes`で確認してください。
2. **参照レンダリングを作る（任意だが推奨）。** `pnpm --filter chipvoice-conform bench:nes:render`は`packages/conform/.artifacts/nes-bench/nes-analog-script.profile.wav`（出荷時の`nesdev`プロファイル）と`...flat.wav`（DAC曲線のみ）を書き出します。カートに書き込む前の簡単な試聴確認になりますが、後述の`bench:nes:compare`は自身でも両方を再レンダリングします。
3. **カートに書き込む。** `nes-analog-script.nes`をEverDriveのSDカードにコピーし、直接起動します（選択後にメニュー操作は不要）。スクリプト全体を1回、およそ27秒間再生した後、自身へのジャンプで永久に停止するため、録音を始めた後は急ぐ必要はありません。
4. **ベンチを結線する。** コンソールのコンポジット音声RCAジャックから、RCA→1/4インチTSケーブル（使用する場合はDIボックスも経由）を通してインターフェースのライン入力へ。マイク入力ではありません。コンソール・インターフェース・コンピューターは、上記[グラウンドループ](#ground-loops)のとおり同じコンセントに接続します。
5. **96 kHz、24ビットで、途切れなく1回録音する。** 録音を開始してからカートを起動し、スクリプト全体（約27秒）を前後1〜2秒の無音を挟んで再生し、その後停止します。モノラルWAVとして保存します。
6. **比較する。**
   ```
   pnpm --filter chipvoice-conform bench:nes:compare \
     /absolute/path/to/capture.wav \
     --json .artifacts/nes-bench/capture-day.json \
     --sheet ../../docs/chips/2a03.md
   ```
   これは同期マーカーを見つけ、実機自身のクロックドリフトを補正し、ドリフト、フィットしたコーナー、`nesdev`プロファイルに対する帯域別最大誤差を表示します。`--sheet`を渡しているため、他のシート上の生成済み数値と同じように、手ではなくスクリプト自身によって結果を`docs/chips/2a03.md`の`bench:begin`／`bench:end`ブロックへそのまま書き込みます。終了コード0はCONFORMANCE.mdの40 Hz-15 kHzで1 dBの許容誤差に対するPASS、非ゼロはFAILですが、それでもシートに記録すべき正直な結果です。
7. **実際のキャプチャが得られたら`docs/BACKLOG.md`／`_ja`と`CHANGELOG.md`／`_ja`を更新します。** テスト基盤を追加するだけでなく、公開済みの利用者に見える挙動（シート自身のアナログ段の数値）が変わるためです。
