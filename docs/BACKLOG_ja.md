<a id="backlog"></a>
# バックログ

<p align="center">
  <a href="BACKLOG.md">English</a> &bull;
  <a href="BACKLOG_ja.md">日本語</a>
</p>


[ロードマップ](ROADMAP_ja.md)が方向を示し、この文書は各チケットの実行状態を追跡します。PR開始／終了時に更新し、branchとともに*doing*、PRと学びとともに*done*へ動かします。計画を変える発見は末尾に日付付きで記録し、該当ticketも同じcommitで更新します。

状態：`todo`（未着手）、`doing`（作業中）、`done`（完了）、`dropped`（理由付き中止）。既存表の`implemented`は実装済み、`partial`は一部完了です。履歴の状態は当時のまま残します。

<a id="midi-import-feedback--2026-09-06"></a>
## MIDIインポートの表示 — 2026-09-06

- done — `fix/midi-import-feedback`（0.15.1）：準備段階、sample比の進捗／経過時間、明示fallback付き旧MIDI文字decode、channelラベル、実音までの長時間MIDI E2Eを実装。利用者のlocal Musha Aleste MIDIで再現し、source bytesはlocalに保持。

<a id="unified-playground-and-transport--2026-09-06"></a>
## 統合プレイグラウンドと再生操作 — 2026-09-06

- 実装／検証済み：[仕様](UNIFIED-PLAYGROUND_ja.md)。`/`で完全編曲を既定にし旧URLを転送。全曲pause／seek／restart、loop／end、output-clock cursor、段階的composerが原典、import、draft、共有を保持。browser／audio評価と2軸review成功。[証拠と画像](evals/UNIFIED-PLAYGROUND-2026-09-06_ja.md)。

<a id="complete-arrangements--2026-09-06"></a>
## 完全アレンジ — 2026-09-06

- done — `feat/complete-arrangements`（0.15.0）：exact-tick多声音MIDI、音符別損失報告付き決定的interval allocation、native Mario抽出／独立GME比較、Zelda／Sonic全MIDI、公開deck、local worker render。[評価とレビュー](evals/COMPLETE-ARRANGEMENTS-2026-09-06_ja.md)にatomic bus、SNES有音高8voice、有限MIDI表現、正確な参照binding、公開検査を記録。
- todo — Zelda／Sonicの原作固有楽器をnative sourceで独立確認。完全MIDI転記はnative音色の認証ではない。
- todo — pan、modulation／aftertouch、SysEx bankなどMIDI表現adapterと独立review済み参照。eventは保持し未対応を明示する。

<a id="phase-1-the-bench"></a>
## フェーズ1. ベンチ

| # | チケット | 状態 | 場所 |
| --- | --- | --- | --- |
| P1-1 | chip cycle単位event | done | 0.4.0 |
| P1-2 | byte register：`RegisterEvent`は`{at, addr, value}`、coreが`$4000-$4017`をdecodeしdriverがencode | done | 0.5.0。学びは末尾 |
| P1-3 | digitalとanalogを分離し、mix／resample／filter前のcycle出力と名前付き独立出力stage | done | PR #2。`Nes2A03`、`NesOutputStage`、`NESDEV_PROFILE`。golden不変 |
| P1-4 | voiceごとの変化stream `(cycle, value)`で一致率を測るtrace | done | PR #2。`DigitalChip.trace`、`ChipDefinition.digital()` |
| P1-5 | `conform`：corpusを両coreで実行し初相違とJSON数値を出す | done | PR #3、`packages/conform` |
| P1-6 | 参照1：LGPL sourceをvendorしてnative buildしたNes_Snd_Emu、Blip_Bufferを記録sinkへ | done | PR #3。制限はsheet |
| P1-7 | corpus1：独自曲／feature scriptのbyte write log | done | PR #3、12 log |
| P1-8 | harnessでsheet数値更新 | done | PR #3、marker間を`--sheet`更新 |
| P1-9 | subsetの`conform`をCIへ | done | PR #3、commit済みbaseline比較 |
| P1-10 | 5-step frameと`$4017`write timing | done | 0.5.0、P1-2と同時。decoderにも必要 |
| P1-11 | blargg APU ROM用6502 fixture | done | PR #7、29/29、CI対象 |
| P1-12 | corpus2：logger付き参照で実game NSFを再生 | doing | 最初の完全sourceはMario Ground Theme、41,999命令が固定GMEとexact cycle一致。広いNSF corpusは残件 |
| P1-13 | 参照2：Mesen 2 APU／puNESで旧参照とROMが確定しないenvelope、sweep、triangle開始を確認 | todo | P1-6で発見。frame timingはROMで確定 |
| P1-14 | triangleをrun別時間shiftとsequencer位置offsetで比較し、開始規約だけで低一致にならないmetric | done | PR #4。隠れたstepを復元し全triangle runがstep時刻で整合 |

<a id="phase-2-nes-to-100-"></a>
## フェーズ2. NESを100%へ

| # | チケット | 状態 | 場所 |
| --- | --- | --- | --- |
| P2-1 | 全相違を修正するか参照側の誤りを説明 | todo | |
| P2-2 | DMC | done | PR #5、0.6.0。1bit周期差で同じstep。末尾参照 |
| P2-3 | analog参照実機をcapture／測定 | doing | PR #8、blargg NES録音と同等にmix相殺。filterはline-out待ち |
| P2-4 | package README／skillにsheetをリンクしてrelease | todo | |

<a id="phase-3-game-boy"></a>
## フェーズ3. Game Boy

| # | チケット | 状態 | 場所 |
| --- | --- | --- | --- |
| P3-1 | Pan Docs／blargg資料からDMG APU、SM83でdmg_sound確認 | done | `packages/chipvoice/src/chips/gb`、`packages/conform/src/roms/{sm83,gb}.mjs` |
| P3-2 | 2chipに基づく`ChipSpec`、`RegisterEvent`、楽器モデル | done | `ChipDriver`、`FrameState`、`ChipSpec.roles`、`chips/{nes,gb}/driver.ts`。2A03 golden不変 |
| P3-3 | Game Boy自動sheet | done | `docs/chips/dmg.md` |
| P3-4 | 強い参照：register log駆動SameBoy、またはSM83上のGBSから実曲log | todo | Gb_Snd_Emuは2005年製でtrigger時に初step |
| P3-5 | 既知scriptでDMG line-out測定 | todo | P2-3同様、実機が必要 |
| P3-6 | API／studio／skillで`chip: "dmg"`を受理しrender／再生、editor selectorと変更説明 | done | `apps/web`、skill 0.4.0 |

<a id="phase-4-the-portable-score"></a>
## フェーズ4. 移植可能な楽譜

| # | チケット | 状態 | 場所 |
| --- | --- | --- | --- |
| P4-1 | eventからVGM出力、corpusへVGM入力 | done | PR #4。`toVgm`、`recordSong`、harness `import-vgm` |
| P4-2 | score：roleとintent | done | `score.ts`の`Score`、`arrange`、`INTENTS`。決定16 |
| P4-3 | chip別arranger | done | `chips/nes/arranger.ts`、`chips/gb/arranger.ts`、P3-2以降の`ChipSpec.roles`／`ChipDriver` |
| P4-4 | API／wire formatの楽器 | done | catalogue単語の`intent`として保存／fork／render、skill 0.5.0 |
| P4-5 | skillにchip固有の書き方 | done | skill 0.5.1、単語別catalogueとchip別作曲節。MCP serverでなくagentが読むfile |
| P4-8 | studio各rowのintent picker | done | P8-6、PR #20で出荷 |
| P4-6 | FamiStudio方式のsweepによる滑らかなvibrato、period上位境界で位相をresetしない | done | `NesDriver.smoothHighByte`、golden変更、末尾参照 |
| P4-7 | agentの曲が良く聞こえることを独立の測定目標に | doing | `feat/console-listening-evals`、[試聴方法と初見](AUDIO-EVALUATION_ja.md)、preset matrix、stems、native SNES比較、level整合版比較。人の参照試聴は残件 |
| P4-9 | SNESパレット：独自／許諾BRR、作成済みenvelope、多声和音を明示参照で評価 | doing | build時独自BRR、hardware envelope、同時和音を実装。[測定と受け入れ](SNES-PALETTE_ja.md)。選定音楽参照での試聴は未完、DSP一致だけで音楽的類似は証明しない |

<a id="operations"></a>
## 運用

| # | チケット | 状態 | 場所 |
| --- | --- | --- | --- |
| OPS-1 | 廃止apps/apiをrootとするVercel `chipvoice-api`がrepo接続を残しpushごとに失敗していた | done | 実siteは`chipvoice` project。参照なしを確認して2026-09-04にCLI削除。PR #1〜#11で赤表示、#1で修正すべきだった |

<a id="phase-5-mega-drive"></a>
## フェーズ5. メガドライブ

| # | チケット | 状態 | 場所 |
| --- | --- | --- | --- |
| P5-1 | Nuked-OPN2をvendor、native buildしregister logと各channel traceのYM2612参照に | done | `packages/conform/oracles/nuked-opn2` |
| P5-2 | Nuked逐行TypeScript移植を`DigitalChip`へ、FM6chとDAC | done | `chips/md/ym2612.ts`、全script一致 |
| P5-3 | 資料からSN76489と数式test | done | `chips/md/sn76489.ts`、参照はP5-8 |
| P5-4 | 2chipを1`ChipCore`へ、ladder DAC、仮出力stage、worklet | done | `chips/md/dsp.ts`、出力はplaceholder |
| P5-5 | MD driver／arranger、intent→FM patch、chord→PSG、kit→noise | done | `chips/md/driver.ts`、`arranger.ts`。FM drumは後続 |
| P5-6 | YM／PSG VGM、API／studio／skill | done | `toVgm({ chip: "md" })`、skill 0.6.0 |
| P5-7 | Nuked全voice比較、script／song corpusのsheet | done | `docs/chips/md.md` |
| P5-8 | PSG参照：MAME `sn76496` shimまたはMaster System ROM | todo | noise系列とperiod 0は資料由来 |
| P5-9 | 既知scriptでModel 1 line-out測定 | todo | P2-3同様、実機必要 |
| P5-10 | channel 6のFM drumとarranger LFO | todo | 現kitはPSG noise |

<a id="phase-6-snes"></a>
## フェーズ6. SNES

| # | チケット | 状態 | 場所 |
| --- | --- | --- | --- |
| P6-1 | snes_spc S-DSPをnative参照に、log memoryのsample RAMとstereo sample trace | done | `packages/conform/oracles/snes-spc` |
| P6-2 | S-DSP逐行TypeScript移植を`DigitalChip`へ、digital左右をvoice pairとして比較 | done | `chips/snes/sdsp.ts`、初回から全log一致 |
| P6-3 | 64 KB sample RAM、SPC700 `$F2`／`$F3`経由DSP、仮出力、worklet | done | `chips/snes/dsp.ts` |
| P6-4 | BRR encoderと`Instrument.sample` | done | `chips/snes/brr.ts`、`ChipDriver.memory()` |
| P6-5 | intent別sample、ADSR、特徴的echo、sample kitのdriver／arranger | done | `chips/snes/driver.ts`、`arranger.ts` |
| P6-6 | API／studio／skill。VGMにS-DSPなし、SPC内driverは後続 | done | skill 0.7.0、SPCはP6-9 |
| P6-7 | output streamでsnes_spc比較するsheetとcorpus | done | `docs/chips/snes.md` |
| P6-8 | 既知scriptでDSP streamまたは実機line-out capture | todo | 実機必要 |
| P6-9 | file内driverで任意SPC playerから再生できるexport | todo | |
| P6-10 | 複数voiceの実三和音とnoise hats | todo | 旧記録ではarpeggioのみ。現在の同時和音はP4-9／SNES-PALETTE参照、noise hatsは別残件 |

<a id="phase-7-c64"></a>
## フェーズ7. C64

| # | チケット | 状態 | 場所 |
| --- | --- | --- | --- |
| P7-1 | GPL reSID-fpをharness限定のSID参照へ（決定B） | done | `packages/conform/oracles/residfp`、`src/oracles/residfp.mjs` |
| P7-2 | 資料からdigital SID：発振器、noise、波形選択／合成、sync／ring、rate／ADSR delay bug | done | `packages/chipvoice/src/chips/c64/sid.ts`、全logでreSID-fp一致 |
| P7-3 | analog profile：6581 DAC ladder、filter、出力 | done | `chips/c64/dsp.ts`、`SID_6581_PROFILE`。未測定、8580はP7-10 |
| P7-4 | intent波形／envelope、4roleを3voiceへ共有するdriver／arranger | done | `chips/c64/driver.ts`、`arranger.ts`。規則は`Sequencer.scheduleStep` |
| P7-5 | API／studio／skill | done | schema、openapi、skill 0.8.0、llms.txt、studio |
| P7-6 | reSID-fp digital比較sheetとcorpus | done | `docs/chips/c64.md`、`corpus/c64`、CI `check:c64` |
| P7-7 | 6510でVICE `testprogs/SID`を実行しOSC3／ENV3を読む第2検証 | todo | NESの6502同様6510が必要 |
| P7-8 | 6581 line-out captureでDAC zero、filter curve、出力をfit | todo | 実機必要 |
| P7-9 | filterを開くintentとlead sweep | todo | |
| P7-10 | 8580の合成波形、triangle／saw遅延、線形DAC、独自filterの第2profile／table | todo | |
| P7-11 | 全trace変化をmemory保持するharnessをstream比較／typed arrayへ | todo | 3 saw×8秒でOOM。dense波形corpusを短縮中 |

<a id="phase-8-the-site-as-an-instrument"></a>
## フェーズ8. サイトを楽器にする

[DEMO.md](DEMO_ja.md)が合意仕様で、決定20は19を更新します。**A**は2基盤修復、**B**は初画面、**C**はV1編集／共有完成、**D**は後の拡張です。以下の依存順に進め、既存IDは歴史参照のため保持します。V1は1 PRにまとめ、配備／実機検査とlocal完成を区別します。

| # | チケット | 状態 | 単位／依存 |
| --- | --- | --- | --- |
| P8-15 | load／editor／再生／forkで全pattern、order、chord、intent、機種を保持。title-onlyは音を変えない | implemented | A、監査1。UI前に共通document |
| P8-16 | Stop／voice stealingで予約musicをcancel、SFX後復帰とshared register所有を定義。重複SFXの実write／音test | implemented | A、監査2。安定switch／pad前提 |
| P8-17 | baseline不在／不正と予期しないcorpus構成を失敗に。明示subset維持、基盤回帰 | implemented | A、監査7。P8-15/16支援 |
| P8-1 | 本番buildの初音楽操作で1回発音。unlock、pending、古いswitchを扱い非音楽clickでは鳴らさない | implemented | B、P8-16後。browser lifecycle／hydrate |
| P8-2 | 3つの良い作曲済みcartridgeを全5機種で。初期曲load、明示Play | implemented | B、任意click autoplayと6〜8曲案を置換 |
| P8-3 | 見える5機種、位置／編集保持、重複player／不意開始なし | implemented | B、P8-15/16後。旧selectChipは位置非保持 |
| P8-5 | 音符／長さ／位置／実voice所有の4lane、mute／solo、実測時だけmeter、SFX小場面 | implemented | B、P8-16後。C64共有／reduced motion尊重 |
| P8-18 | Jump／Coin／Laser／Explosion、chip適合音、touch／keyboard、正しい中断／復帰表示 | implemented | B、P8-16後。完全game不要 |
| P8-8 | preset／chip／display／pad中心。title／account／publishは必要時、再生は匿名 | implemented | B、DEMO.mdの方向。marketing hero不要 |
| P8-14 | identity／scoreなしに初音、比較、SFX、編集、共有を測り人の利用とbaselineを観察 | partial | session counter実装。人の観察と代表端末性能は後続 |
| P8-4 | touch音と8音palette、shortcut説明、scale補助と半音階 | implemented | C、P8-16後。live録音はP8-10 |
| P8-6 | 高さで選択pattern音高編集、全score保持、role intent選択 | implemented | C、PR #20、P4-8を含む |
| P8-7 | 即試聴の読みやすいdrum step grid。arcade SFXと区別 | implemented | C、P8-15/16後 |
| P8-9 | 大きい携帯targetとoverview、scroll／pinchでpaintしない、keyboard対応 | partial | control／touch模擬実装。実携帯scroll／pinch後続 |
| P8-19 | Undo／Redo、自動local draft、不完全raw text保持と適用前validation | implemented | C、P8-15後。入力修復、可逆探索 |
| P8-20 | 現score／実行例表示copy、共有で全曲／機種復元、draft／publish区別 | implemented | C、P8-15後。往復と実例検査 |
| P8-21 | render identity／cache契約、stereo、機種tag、資産version後も安定link | implemented | C、export同一性を主張する前 |
| P8-22 | 一時DBで本番Web主要経路をCIへ、実transport／score／入力／共有検証 | implemented | A回帰、B/C行程。CIから本番writeなし |
| P8-10 | palette／drumの量子化live重ね録りとUndo | implemented | D、audio-clock capture、固定伴奏、1take1Undo、draft。[評価](evals/RECORDING-2026-09-06_ja.md)。実携帯はP8-9 |
| P8-23 | role変奏、他lock、Undo。作成済み／規則ベース、remote AI不要 | implemented | seed melody／drum／timbre、lock、Undo、無音pattern保持。決定26 |
| P8-11 | 同じtransport／所有モデルのWeb MIDI | implemented | opt-in tap、channel10 drum、模擬port cleanup。実latency未測定 |
| P8-12 | stems、全5機種、対応VGMのproducer export | implemented | cancel可WAV／stems／5機種ZIP、NES/GB/MD VGM。独立ZIPとbyte比較、決定26 |
| P8-13 | 実SID filter／sweep、SNES triad／FM drumと豊かな編曲 | todo | D、P7-9/P6-10/P5-10。見た目だけの汎用代替なし |

<a id="audit-follow-ups"></a>
## 監査の後続

[監査](AUDIT-2026-09-05_ja.md)は再現済み不具合とコード上のリスクを区別します。score／transport／frontend／cache／CIは上記phase8です。以下も明示追跡し、匿名demoをplatform全面rewriteの前提にしません。

| # | チケット | 状態 | 優先／依存 |
| --- | --- | --- | --- |
| AUD-1 | stable user、API key、browser session分離。再login復元、atomic token、agent key不変 | implemented | account所有、独立key／session、atomic login、失効、UI。決定28 |
| AUD-2 | render CPU測定、variant上限／cache、同時dedup。worker／storageは測定に応じる | partial | workerと時間／同時／頻度／cache上限、version key、dedup、条件GET実装。代表CPU／分散は未完、決定27 |
| AUD-3 | 低sample rate予約、readerなしtimeline上限、beatDelay契約修復 | partial | 予約、host時計expiry、直接shared bus queue実装（決定23）。低rate性能は別 |
| AUD-4 | 機種／voice音域とarrange診断、明示target保持 | partial | target、基音／arpeggio範囲、不正pattern実装。全変調／voice budgetは残件 |
| AUD-5 | 正確なerror処理のversioned DB migration | implemented | atomic version移行、新旧／冪等／失敗rollback、決定28 |
| AUD-6 | root／npm README、metadata、能力、licenseを整合しcorpusと実機証拠を分離 | implemented | 5機種、実編曲、license、version音声、証拠をREADME／SCORE／OpenAPI／skill／generatorで整合 |
| AUD-7 | 5core、driver、encode、animationのhot-path allocation／copy監査と所有scratch | implemented | [監査と検証](evals/HOT-PATHS-2026-09-06_ja.md)。代表CPU／GCはAUD-3と残件 |

<a id="later-phases"></a>
## 後のフェーズ

決定20によりphase8 V1受け入れまで新systemを閉じます。任意のDがgateを無期限に延長することはありません。V1後は需要に従います。

<a id="discoveries"></a>
## 発見

**2026-09-07、文書の日本語版。** `docs/japanese`でroot／SDK READMEと全first-party文書をRTK式`_ja.md`へ翻訳します。言語link、原文anchor、生成数値整合を検査します。第三者資料、license本文、agent命令は原文のままです。PR #37で完了：43文書、実行内容を保持した32例、GitHub Markdown描画、2軸レビューを確認。生成表の未知見出しは拒否し、レビューしたSNES説明は現在の同時和音機能を保持します。

**2026-09-05、phase8と監査後続。** 利用者が遊べるlibrary demoと明確化。DEMO.mdにV1／後続を記録。title-only forkの全score損失とStop後／SFX上書きを先に修復します。任意clickを明示Playへ、多数presetを良い3曲へ。録音／MIDI／変奏／stemsはV1後。IDを保持し前提と不足結果を追加、仕様を書くだけで実装完了にしません。

**2026-09-04、P7-1〜P7-6。** 第5chip SIDはGB以来の資料実装で、datasheet、kevtris、plogue、VICE／reSID知見に基づき、GPL参照はharnessだけ（決定18）。起動resetでnoiseを1回進め、rate8を資料の391でなく実測392へ直すと全stream一致しました。合成波形は隣接bitとpulseの影響を6数値で表し全table一致（`fit:c64`）。4行3voiceは初の不足で、noteを先にwriteへ展開するdriverは後から撤回できないため、drumがchordを切って戻す規則をsequencerへ置きました。各drumは指定duration通り全chipでstepより短く終わります。可聴sawは毎cycle変わり3本×8秒でharness OOMしたため、波形自体の検査以外はpulseにします（P7-11）。

**2026-09-04、P6-1〜P6-7。** S-DSP逐行移植は初回からnative出力一致。問題はprogramでした。実capture起動stateの28 KB echoがESAからRAM末尾を折り返しsampleを上書きし、noise clock停止のkey-on voiceがenvelopeで増える定数を出してdriftに見えました。IPL同様key-off、echo write停止、旧delay待機をdriver／script／testへ追加。BRR初版は半scaleでdecode後2倍という単位を誤り、`2^shift`と予測の2倍を修正してsine飽和を解消。8voice共有KOFFは時間順でない予約状態を保てないためnote-offは固有GAIN。`ChipDriver.memory()`と`Instrument.sample`でbankとsample名を表します。

**2026-09-04、P5-1〜P5-7。** YM2612はYM3438 transistor由来Nukedを名称保持で移植。初回93%、各run最大41cycle shiftは2規約差でした。traceを内部cycle末尾でなく先頭へ、writeを次cycleでなく指定開始cycleへ合わせると8algorithm×3feedback、envelope／keyscale、detune／multiple、全LFO／感度、SSG-EG8形、ch3特殊、DACが全voice一致。register slot pipelineは12-slotがoperatorへ来るまでdataを反映せずbusyより速いwriteを失うためdriverで間隔を確保。68000／YM／PSG全てに整数となるmaster clockをlog単位にしました。PSG16bitのtap0／3は最大長でなく7 × 8191 = 57337shift（32767でない）。数式testで固定、参照未導入。

**2026-09-04、P4-6。** blargg／FamiStudioの滑らかなvibratoは、`$4003`なしでperiod上位を1動かすため低位`$FF`／`$00`、方向付きshift7 sweep、5-stepの`$4017`強制clock、解除、低位復元を使います。`period >> 7`は境界1つを越え2つは越えません。A4の毎秒6回phase resetが消えました。`$4017`の3／4cycle待機後に解除し、2pulseをずらして交錯を防ぎます。golden変更。参照は強制half frameが0／1cycle後で、hardwareは3／4（`apu_test`成功）。e2e pulse2の1音がその間にreloadし、以後数cycleずれる差をbaselineへ記録。

**2026-09-04、P4-2／P4-3／P4-4。** 第2chipで草案より小さいscore設計へ。保存互換のため`chord`をharmonyへ改名しません。intentはparameterでなく単語。GBの`"hollow"`はwave RAM矩形波、NESでは意味がなくbrightness 0.6では表せません。wireに楽器を入れずrole単語を保存し各arrangerで対応付けます。intentなしの両golden不変。studioとAPIのarrange共通化で手管理の楽器重複を除去。両chipは4role／4voiceなのでbudgetは未検証、PSG音域がarrange validationを要求します。

**2026-09-04、P3-2。** instrument table、arpeggio、slide、vibratoから共通`FrameState`（音量、Hz、duty、noise）を作り各`ChipDriver`がregister化。byte／address／clockの`RegisterEvent`は不変、`ChipSpec`には4role→voiceを追加。GBでは音量変更がretriggerを要するがduty位置を保ち、bassのwave RAMは停止中だけwrite。noise retriggerは最初15shift無音にしdrum rateではframeの大半を失うため、音量表を初期hardware envelopeへfit。2A03 golden不変。noise indexとpitch tableは2A03単位と明記し、他chipでrate／比率へ変換します。

**2026-09-04、P3-1。** SameBoy `apu.c`はemulator state密結合で結局再構成を要するためPan Docs／blarggから実装。根拠は移植でなくROMです。SM83で初回11/12、残るwave RAM破損はfetch後の既読byteでなく、fetch前2cycleの次byteで起こると修正し全成功。SameBoyも同じ。資料未確定の有効voiceだけtimer進行と、trigger後period＋6cycleのwave初fetchを採用。後者はROM09／10／12が2cycle差に敏感です。Gb_Snd_Emu 0.1.4はtrigger即step、timer非reload、時刻0 frame、DAC／power／zombie欠如で厳密cycleは一致しませんがrunは整合し、ROM外の短noise形とenvelope段階を確認できます。

**2026-09-04、P1-2。** decoded commandはhardware不能のperiod上位phase保持とsweep register省略を許していました。`$4001`negateなしではperiod `$400`以上（G#2以下）がmuteされます。実driver同様`$4001 = $08`を設定し、上位境界は`$4003`のphase restartを通すようにしました。低音pulseが鳴ります。

**2026-09-04、P2-3。** blarggの`apu_mixer`録音で実機所有なしにDAC曲線を測れます。各channelとDMC逆波形の中央相殺は本実装pulse -32.7 dB、triangle -33、DMC -31、実機-32.2／-30.9／-27.2でした。決定5のclick回避起動位置では22 dB悪く、実機位相へ戻しclickを出力段へ移して解消。もっともらしい判断より測定を優先しました。

**2026-09-04、P1-11。** 6502で2011 `apu_test`／`apu_reset`、`dmc_tests`、2005 frame集の29ROM全成功。frameはnesdev通りで旧参照が2cycle遅いと確定。同cycle haltはclock後、length reloadはcounter0以外無視という知見を実装。envelope／sweep／linearのclock付近とvoice出力はROM外です。

**2026-09-04、P2-2。** DMC stepは1bit周期差で同値。Nes_Snd_Emuは残1bit、nesdev／Mesenは8bit、実hardware起動は未確定です。参照`$4011`はpop用DAC補正で値もregisterそのものではありません。8を保持し、初byteの実captureで解決できます（P2-3領域）。

**2026-09-04、P1-6初回。** 全曲とsweep-down／mute／restartのpulseはcycle一致、未対応edgeなし。差はframe2cycle遅れ、triangle reload即step、`reset()`が全voiceへ`$4003`を書いて初frameでenvelope15になる参照規約。sheetに記録し、CIは達成不能なゼロ差でなくbaselineを使います。第2参照はP1-13。

**2026-09-04、P1-6。** 2005 Nes_Snd_Emu 0.1.7はframeを均一7458で進め（実7457/14913/22371/29829でない）、noiseを`1 << 14`から始め、bit0がsetのとき出力する逆極性です。mute中も正確に進めず、無音後phaseは近似。pulse／triangleのcycle参照として使い、noiseは数式とpulse共有envelopeで確認しsheetに明記します。

**2026-09-06、P4-7。** SNES全3loopはnative DSP一致ですがmaster減衰前dry sumが32-clock窓の13〜20%で飽和。voice音量低下でdry／echo入力clipを除きexact一致を維持。`recordSong`最終blockの早期stopも発見し、全5機種の完全PCM replayで防止。[評価方法](AUDIO-EVALUATION_ja.md)参照。

**2026-09-06、連続再生と公開lab。** tempo／score／instrument／chip変更でも小数位相handoffでPlayを保持。local／public `/lab`はbuffer A/Bを共有。共通primitiveと`/lab/components`でidentityを記録しStorybookは必要時まで後続。公開corpusはversion付きon-demand snapshot。[実装と回帰](CONTINUOUS-PLAYBACK-LAB_ja.md)。

**2026-09-06、作曲操作。** 共通40〜300 BPM sliderと同期manual input、group Undoを追加。追加操作とMario／Zelda／Sonic出典案は[作曲操作](COMPOSITION-CONTROLS_ja.md)に記録。この記録時点では案は未実装／公開corpus外。

**2026-09-06、親しみのある曲。** Mario Ground、Zelda Overworld、Sonic Green Hillをcredit付き4bar学習編曲として5機種へ追加し、playground／labで出典と移植注記。移調と決定的drum activityは可逆live操作。[score手順](../scores/README_ja.md)は任意MIDI抽出、review recipe、再現compile、明示rhythm削減、公開を扱います。swingとrole gainは後続。

<a id="source-faithful-melody-workflow-follow-up-to-28"></a>
### 原典に忠実なメロディ手順（#28の後続）

4bar編曲と自動root／fifth bass／drumを廃止し、Mario50bar、Zelda24bar、Sonic24bar主周期へ延長。固定MIDI参照とmutation付きnote比較で415音符を5sequencer role mapに対し確認。12-step quarter grid、fork／grid保持、原典／編集済みラベル、無音drum操作を追加。offline起動paddingが終音を切る問題を修正し、register capture終端をWAVのsample丸めへ整合。[方法、範囲、制限](../scores/README_ja.md)参照。

recorderもcore event queueを使い、短音の休符が古い将来releaseをcancelするようにしました。GBで修正前失敗する回帰を追加。全theme公開／forkはcartridge title区切りと長曲の30秒preview、social metadataも検査します。

追加忠実度には原作音声との転記比較とDSP後の音高／articulation測定が必要です。多声編曲は明示転記の原典voiceを使い、汎用伴奏の追加はこのpipelineから外します。
