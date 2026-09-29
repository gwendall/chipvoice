<a id="decisions"></a>
# 決定記録

<p align="center">
  <a href="DECISIONS.md">English</a> &bull;
  <a href="DECISIONS_ja.md">日本語</a>
</p>


同じ議論を意図せず繰り返さないため、プロジェクト全体の判断と理由を記録します。小さな局所判断は該当コードのコメントへ置きます。各項目に日付、決定、理由、変化を記します。

<a id="decided"></a>
## 決定済み

<a id="1-accuracy-is-a-sheet-not-an-adjective-2026-09-04"></a>
### 1. 精度は形容詞でなくシートで示す（2026-09-04）

README、パッケージ説明、skillでチップ全体を「サイクル精密」「完全」と呼びません。[CONFORMANCE.md](CONFORMANCE_ja.md)の共通方法によるシートに、何をどの参照で検証し何が異なるかを書きます。

**理由：** ノイズが1オクターブ低い2A03を精密と呼んでいました。言葉には検査が伴っていませんでした。「未検証」と書く方が正直です。

**変化：** READMEからシートをリンクし、出荷する最初のコミットから全チップに`docs/chips/<id>.md`を用意します。

<a id="2-cores-are-borrowed-and-verified-except-the-2a03-2026-09-04"></a>
### 2. 2A03以外はコアを再利用して検証する（2026-09-04）

第2チップ以降は小さく許容的なライセンスなら移植、それ以外はWebAssembly化した参照コアを共通`ChipCore`の後ろへ置くという当初方針です。既存2A03は置換せず検証します。

**理由：** ダイ写真と論理解析器を持つ人たちのC実装を使います。一から書き直すと2A03の数式テストで見つけた種類のバグを再導入します。

**変化：** 作業を解析でなく移植、wrapper、ライセンス、編曲にします。当初案ではworklet内でbase64 binaryをinstantiateするWebAssembly形を追加します。後の例外と実際のTypeScript移植は決定14／17／18に記録します。

<a id="3-a-second-chip-before-the-score-abstraction-2026-09-04"></a>
### 3. 楽譜の抽象化より先に第2チップ（2026-09-04）

Game Boyを実装し、実例2つで`ChipSpec`、`RegisterEvent`、楽器モデルを見直してから移植可能な楽譜を設計します。

**理由：** 1例からの一般化は悪い抽象化になりがちです。Game Boyは比較的安価な第2例で、波形チャンネルという実際の差を持ちます。

<a id="4-event-time-is-in-chip-cycles-2026-09-04"></a>
### 4. イベント時刻はチップサイクル（2026-09-04）

`RegisterEvent.at`はサンプル時計と同じ原点からのサイクル数で、毎秒`ChipSpec.clockHz`進みます。書き込みはサンプル内の位置にかかわらず指定サイクルで到着します。コアは要求サンプル位置から正確な整数演算で時計を導き、1秒のサンプルを1秒のサイクルに対応させます。

**理由：** 参照とVGMはサイクル、ドライバーはフレームを使います。サンプル時刻では特定レートに縛られ、書き込みをサンプル先頭へ丸め、bit-exact比較が変換問題になっていました。

**変化：** `Math.round(seconds * clockHz)`で記録しドライバーからsample rate overrideを除去。サブサンプル差だけでgoldenが変わりました。44100／48000でも同じサイクルへ届くことを`test/clock.mjs`で検査。VGMはイベントの直列化です。

<a id="5-the-triangle-starts-at-a-zero-output-phase-2026-09-04---superseded-by-13"></a>
### 5. 三角波を出力ゼロの位相から開始（2026-09-04） - 13で置換

高域通過フィルターへのDC段差を避けるため、実機のstep 0／出力15でなくstep 15／出力0で起動していました。同日撤回し13へ置換しました。

<a id="6-ci-runs-the-unit-tests-the-release-runs-the-browser-2026-09-04"></a>
### 6. CIは単体、リリースはブラウザ（2026-09-04）

`ci.yml`はpush／PRで型、build、validator、clock、goldenを実行し、`publish.yml`はtarball新規導入とbrowser検査を保持します。

**理由：** PlaywrightとChromium取得は分単位で、当初はreleaseのゲートに適していました。単体は秒単位で通常回帰を捕捉します。後のWeb機能追加に伴うCI拡張は評価／バックログに記録します。

<a id="7-licences-mit-stays-mit-2026-09-04"></a>
### 7. ライセンス：MITを維持（2026-09-04）

当初は`chipvoice`をMIT互換コードだけにしGPLを入れず、LGPLのWebAssemblyはsource付き別optional packageとする方針でした。

**理由：** ゲームへの導入を容易にし、コアのライセンスを明確に保つためです。

*17で改訂：* YM2612はWebAssemblyでなく同package内のLGPL移植ファイルになりました。ライセンス欄を`(MIT AND LGPL-2.1-or-later)`とし、LICENSEに該当ファイルを明記します。LGPLを使えない利用者も除外対象を判断できます。

<a id="8-documents-live-in-the-repository-in-english-2026-09-04"></a>
### 8. 文書はリポジトリ内の英語で管理（2026-09-04）

`docs/`にロードマップ、方法、シート、本記録を置き、コードと同じコミットで更新します。当初はリポジトリの言語である英語を使う方針でした。

**理由：** 外部文書はずれやすく、コードと異なる言語だけでは読者を制限するためです。

**2026-09-07改訂：** 英語原文を保ち、利用者の依頼によりRTK式の`_ja.md`兄弟ファイルを追加します。各文書に言語リンクを置き、内容変更時は両方を更新します。既存のフランス語監査は原文のまま残します。

<a id="9-the-dsp-is-typescript-and-the-worklet-is-a-bundle-2026-09-04"></a>
### 9. DSPはTypeScript、workletはbundle（2026-09-04）

`dsp.ts`は通常の型検査対象`ChipCore`です。`worklet.ts`がimportし、`scripts/build-worklet.mjs`がesbuildで自己完結scriptへbundleして`addModule`用文字列を生成します。テスト／scriptはJavaScriptのまま`dist`をimportし、Nodeと配布物の間に変換層を挟みません。

**理由：** 以前はworkletへ貼るためimportなしJavaScriptと`@ts-nocheck`を音源中心部に使っていました。制約はsourceでなく出力scriptにあり、bundlerで解決できます。イベント単位変更や当初のWebAssembly計画も型付きの方が容易です。

**変化：** `dsp.js`、`worklet-shell.js`、`dsp.generated.ts`を削除。golden不変で言語以外の動作保持を確認しました。

<a id="10-audio-urls-stay-immutable-a-deploy-changes-what-they-serve-next-2026-09-04-superseded-by-21"></a>
### 10. 音声URLを不変にしデプロイで次の内容を変更（2026-09-04、21で置換）

旧方針は`/s/{id}.mp3`と1年immutableを保ち、deploy時edge purge後に新engineで再生成するものでした。保存済みdownloadは元のままです。

**理由：** version入りpathで既存共有リンクを壊さず、曲自体が不変でengine変更が少ないため短cacheの再renderを避ける意図でした。

**変化：** 音が変わるreleaseをskillへ告知し、E2Eがバイト比較するpackageとsiteを一緒にreleaseする方針でした。browser cacheが残る問題のため、現在は21を適用します。

<a id="11-register-writes-are-bytes-2026-09-04"></a>
### 11. レジスタ書き込みはバイト（2026-09-04）

`RegisterEvent`は`{ at, addr, value }`です。コアが`$4000`〜`$4017`を実機同様にdecodeし、driverがnoteをencodeします。`duty`、`period`、`trigger`、`stop`のdecode済み形式を廃止しました。

**理由：** 実機、ログ、VGM、参照が扱うのはbyteです。旧形式は位相再開なしの周期上位変更と、必要なスイープ設定の省略を許していました。NESでは`$4001`が`$08`になるまでperiod `$400`以上がmuteされます。実レジスタ経路を通すことで実機にない操作を避けます。

**変化：** 無音化は全enableを同時変更する`$4015`でなく各チャンネルのレジスタを使います。200 ms先を予約するdriverは将来の他ボイス状態を知れません。周期上位境界のvibrato／slideは当初位相を戻し、回避するsweep技法は後続。低音pulseが鳴り、5ステップと`$4017`遅延も実装。`RegisterEvent`を機種非依存にしました。

<a id="12-ci-checks-a-parity-baseline-not-zero-divergence-2026-09-04"></a>
### 12. CIは相違ゼロでなく一致率baselineを検査（2026-09-04）

毎pushで参照と比較し、各ログ／ボイスの一致数が`packages/conform/corpus/2a03/parity.json`未満なら失敗します。`pnpm --filter chipvoice-conform baseline`で意図的に更新し、原因変更と同じcommitのdiffを証拠にします。

**理由：** 2005年のNes_Snd_Emu 0.1.7には、2サイクル遅いframe、reload直後の三角波step、resetで残るenvelope開始、DMC初期規約などの差があります。こちらのバグでない差をゼロに要求しても成功不能です。baselineで回帰を止め、新参照で確定したら100へ近づけます。

**変化：** 音の変わるPRは`golden.json`と`parity.json`の両diffで方向を示します。

<a id="13-the-triangle-powers-on-as-the-hardware-does-the-output-stage-primes-2026-09-04"></a>
### 13. 三角波は実機通り起動し出力段を定常化（2026-09-04）

三角波はstep 0／出力15。`NesOutputStage`は最初のsampleで、その一定入力を受け続けた状態へfilterを設定し段差を避けます。

**理由：** blarggの`apu_mixer`は起動から三角波をゼロへ進めDMCとの混合表を測ります。step 15起動では15へ着地し、実録音より22 dB悪化しました。実機のstep 0なら正しく相殺します。デジタルは実機に従い、クリックはアナログ段で処理します。

**変化：** 5を撤回。位相とともにgoldenとbaselineを更新。参照は出力0から起動するため三角波の無音サイクルも相違になります。

<a id="14-the-game-boys-chip-is-written-from-the-documents-not-ported-2026-09-04"></a>
### 14. Game Boyは移植でなく資料から実装（2026-09-04）

`gb/dsp.ts`をPan Docs／blargg資料から独自実装し、同じ`DigitalChip`／`ChipCore`に置きます。当初はSameBoyの`apu.c`移植案でした。

**理由：** SameBoyのAPUはemulator stateと密結合し、interfaceへ合わせるだけで全面的な変更が必要でした。検証の根拠はsourceでなく難しい挙動をサイクルで検査する`dmg_sound`です。資料で未確定の「有効中だけtimer進行」と波形RAM破損窓はSameBoyに従い明記します。Nukedのようにダイ由来source自体が根拠なら移植方針を維持します。

**変化：** P3-1、roadmap表、シートCore欄を更新。6502に加えSM83をハーネスへ追加。

<a id="15-the-driver-splits-at-the-frame-2026-09-04"></a>
### 15. ドライバーはフレームで分ける（2026-09-04）

共通driverが楽器を読み`FrameState`（音量、Hz音高、duty、noise index、bend）を生成し、各`ChipDriver`がnoteのframesをレジスタへ変換します。4行は役割で、`ChipSpec.roles`がボイスへ対応付けます。

**理由：** FamiTracker式の表はSNES以前の各フレーム書き換えモデルに合います。違うのは表の読み方でなく、音量がNESではbyte、GBではretrigger、ベースがtriangle periodかwave RAMかという実現方法です。分岐をframe以下に置けばarpeggio／slide／vibratoを共有でき、各chipが慣習を自分のファイルで表せます。個別に表を読む設計では第3チップからずれます。2A03 golden不変が境界の適切さを示します。

**まだ2A03固有のもの：** noise indexとpitch table単位は`FrameState`に明記して残します。既存曲の単位であり、第3例なしの無理な一般化を避けます。

<a id="16-the-score-carries-words-not-instruments-2026-09-04"></a>
### 16. 楽譜は楽器でなく単語を持つ（2026-09-04）

4行、tempo、order、役割ごとの`INTENTS`カタログの単語を持ちます。各chipが楽器へ変換し、役割名`lead`、`chord`、`bass`、`perc`を維持します。intentなしは従来の楽器を数値まで再現します。

**理由：** duty／volume table、wave RAM、4 operatorなどはchip固有です。保存形式に直接入れると1機種専用になります。「明るいlead」の単語なら各chipの慣習を許せます。GBの`"hollow"`はwave RAMの矩形波を意味しNESでは意味がなく、単一brightness値では表現できません。

**変化：** `Score`、`arrange`、`INTENTS`を追加。API schema／spec／skillがcatalogueを参照し、studioとAPIで同じarrangeを使います。validatorは未知語を示し、`SCORE.md`を草案から決定へ変更。

<a id="17-the-ym2612-is-nuked-opn2-ported-line-for-line-and-nuked-is-its-oracle-2026-09-04"></a>
### 17. YM2612はNuked-OPN2逐行移植、参照もNuked（2026-09-04）

`chips/md/ym2612.ts`は`ym3438.c`の名称を保つTypeScript移植で、並べて読めます。ネイティブNukedを参照にします。派生ファイルはLGPL 2.1でnoticeを付け、package欄を`MIT AND LGPL-2.1-or-later`、LICENSEにファイル名を記載。独自部分はMITです。

**理由：** WebAssemblyではこのchipだけtoolchainとブラックボックスが増えます。移植ならdevtoolsで読め、内部traceも取れます。ダイ由来の参照をoracleとして維持します。DMGはROMが根拠、ここはsourceが根拠という違いです。

**変化：** READMEに境界を説明。同日SNESの`chips/snes/sdsp.ts`もsnes_spc SPC_DSPの同方式移植となり、第2のLGPLファイルを追加しました。

<a id="18-the-sid-is-written-from-the-documents-and-resid-fp-is-its-oracle-in-the-harness-only-2026-09-04"></a>
### 18. SIDは資料から実装しreSID-fpはハーネス参照だけ（2026-09-04）

`chips/c64/sid.ts`は6581資料、kevtrisのrate、plogue ADSR、VICE／reSIDが公開したダイ由来挙動からの独自コードです。noise tapsと2-cycle shift、合成波形write-back、gate遷移、起動値を含みます。GPLのreSID-fpはharnessだけにvendorしpackageへ入れません。このchipはMIT。合成波形は6数値／組のモデルを参照表へfitしハーネスで採点します。

**理由：** 未決Bへの回答です。GPLコアの配布は避け、1chipだけ別packageにも分けません。LGPLだったMD／SNESと違い、reSID-fpは比較対象として使います。資料実装をcycle比較して同じ一致シートを得ます。ただしclean-roomとは称しません。資料と参照sourceを並べて読み、作者が説明したモデルを使ったことを明示します。

**変化：** Bを閉じ、harnessのGPL directoryに独立LICENSE／READMEを置きます。package license欄は不変。各挙動の資料をシートへ記します。

<a id="19-no-new-systems-the-site-is-an-instrument-first-2026-09-04"></a>
### 19. 新機種より先にサイトを楽器へ（2026-09-04）

20で更新済み。初音は明示的にし、UI前にtransport／scoreの限定修復を行います。

5チップを出荷したので、サイトの体験を作るまで6番目を始めません。当初はengine／score／harness／sheetを固定し、最初のtap、開始済み画面、5機種1操作、音の出るtap、level行、高さでpitch、drum pad、その後live／MIDI／exportという順でした。

**理由：** 訪問者はtracker知識を要する編集画面、初音まで4段階、dropdown機種、空outputを見ていました。第6チップはそれを変えません。setupなし、1操作1音、pad、MIDI keyboardのような分かりやすい操作が必要です。

**変化：** phase 8をroadmap／backlogへ追加し、完了まで新機種を閉じ、READMEから案内します。

<a id="20-a-playable-library-demo-with-two-foundations-repaired-first-2026-09-05"></a>
### 20. 2基盤を先に直し遊べるライブラリデモへ（2026-09-05）

決定38で更新：V1を受け入れ、その条件のもとで新システムを再開します。

監査後の議論を[DEMO.md](DEMO_ja.md)へ定義しました。当初V1は3曲、5選択、4反応レーン、4効果音pad、編集、共有、実行例。任意clickでなく明示的な音楽操作で発音します。

**理由：** 移植曲、機種固有音、実ボイス借用を耳で示します。forkの楽譜損失とStop／SFXを上書きする保留曲は、その前提を壊すため先に修正します。コアとframeworkは保ち、transportと統合は変更可能です。

**順序：** 楽譜保持とcancelを挙動回帰付きで修復、初画面、編集／共有／codeの順です。最初から利用を測り、認証などは明示残件にして匿名再生を不必要に止めません。live録音、変奏、MIDI、stemsはV1後。新機種はV1受け入れ後に需要で判断し、任意拡張でgateを無期限に延長しません。

**変化：** 19の任意click autoplay、engine不変、14ticket全部releaseという範囲を置換。IDを保持しdelivery sliceを付与します。旧判断は歴史として残します。

<a id="open"></a>
## 未決事項

<a id="b-the-sids-licence"></a>
### B. SIDのライセンス

18で解決。資料から実装しreSID-fpはharness限定、検証シートを弱めません。

<a id="21-stable-audio-urls-revalidate-the-current-renderer-2026-09-05"></a>
### 21. 安定音声URLは現rendererを再検証（2026-09-05）

10を置換します。公開scoreは不変ですが、現serverのengine／arranger／profileでrenderします。`/s/{id}.mp3`と`.wav`はURLを保ち、`Cache-Control: public, no-cache`とrender bytes由来ETagを返します。browserは再検証し、1年古い音を保持しません。render前に存在／削除を確認。保存downloadは不変、MP3／WAVはstereoと機種tagを維持します。

engine版をまたぐ保存再現は保証しません。再現可能なprojectではnpmを固定し全scoreを保存します。content-addressed cacheとengine版別archival assetは、測定を先に行うAUD-2です。

<a id="22-cancel-musical-commands-outside-the-digital-chip-2026-09-05"></a>
### 22. デジタルchip外で音楽命令をキャンセル（2026-09-05）

queue配置は23で置換、所有権とcancel意味は維持します。

transportがvoice／effect別に将来writeを所有し、render blockごとにcoreへ供給する旧設計です。Stopで所有writeを消し、SFX終了後は完全register状態で残り持続音を復帰。初期化cancel時はpatch／sample cacheを無効化。raw busとoracle APIは従来通りです。

増分予約でMD／SNESが消費済みentryを残してcursorをresetし古いwriteを再生していました。merge前に消費済みを除去し、128／4096 blockのバイト比較と実出力cancel／復帰で回帰を確認します。両goldenは余計なretriggerが消えるため変え、raw corpus一致は保持します。

<a id="23-consume-one-shared-scheduler-directly-at-each-bus-clock-2026-09-06"></a>
### 23. 各bus時計から共通schedulerを直接消費（2026-09-06）

合法なROMログの`push(...events)`がVM引数上限を超え、22のwrapperの問題が表面化しました。spreadだけを直しても全sort、blockごとのsplice／clone、coreの第2queue、各消費時のshiftが残ります。

wrapperを除去し、各busの`EventQueue`をliveとraw replayで共有、既存hardware時計から直接消費します。入力batchをsort済みrunにしheapで先頭をmerge。整列入力の追加O(n)＋run挿入O(log r)、未整列なら新batchだけsort。消費はO(log r)、単一runはO(1)。同cycleは到着順、idleではcache済み次時刻だけ比較します。消費参照を消しrecordをcloneしません。MDはYM／PSG別時計と受理YM用ring FIFOを保ちます。

所有権はdecode前のschedulerだけが解釈します。cancelは該当runを圧縮してheapを再構築し、受理済みhardware writeを巻き戻しません。所有者なしrawは消しません。反復write、trigger、address/data順序は意味があるため、任意上限／drop／dedupを行いません。encoderはchip契約が許す不変状態の省略を続けられます。

offline hostは進む時計をdriverへ渡し、flushで全voiceの期限切れmusic／effect履歴をその場で除去します。reset後sample memory初期化は1回。live memoryは事前copyでなくstructured cloneに任せます。

tradeoffとしてrun参照配列容量は消費まで残り、objectは個別に解放、cancelは走査します。持続音復帰用frameも保つため、予定作業に比例し一定メモリstreamingではありません。各workletにコードは増えますが依存は増えません。transferable／共有memoryは実browser通信負荷の測定後に判断します。

500,000 write、random interleave／cancel、FIFO wrap、offline clock／expiry／reset、5chip block／audio、元のmixer crash、browser音声を検証。[評価](evals/SCHEDULING-2026-09-06_ja.md)参照。混雑host時間は代表値ではありません。

<a id="24-reuse-hot-path-scratch-without-sharing-retained-results-2026-09-06"></a>
### 24. 保持結果を共有せずscratchを再利用（2026-09-06）

stereo scratchはcore、BRRの2探索bufferはencode呼出、position poll bufferはdemoが所有します。`Chip.position()`など既定snapshotは独立。`position(into)`でtimelineを変えず再利用でき、Reactへ可変scratchを渡さず変更時snapshotだけを渡します。

pending registerとframeは消費まで独立、PCMのzero-copy viewは追加copyより優先します。global poolやscalarの無差別外出しでなく、所有権が許す反復生成／copyを直します。[監査](evals/HOT-PATHS-2026-09-06_ja.md)に箇所、互換性、source生成数と実GC／CPUの区別を記録します。

<a id="25-record-input-against-the-audio-timeline-commit-playback-once-2026-09-06"></a>
### 25. 音声timelineで入力記録し再生は1回commit（2026-09-06）

note／drum押下をlive AudioContext時計で記録します。`Chip.quantizedPosition()`が最寄り16分へ丸め、半分は前方。不均等pattern、反復order、loopも含み、起動／予約gapではnull。UIはsuspend中入力も拒否します。animationの前位置やschedulerの将来cursorは入力時刻にしません。

1takeをfunctional document更新と1履歴groupにし、到着ごとdraft保存。伴奏と表示は録音中固定し、Finishで同じ位置に更新scoreを1回load。既存scheduler／復帰を使い、tapごとのrestartや第2playerを作りません。tapは現chipのSFX所有で即試聴します。

役割とscaleは変更可。tempo、chip、mute／solo、曲、直接編集はFinishまでlock。Stop、Undo、focus喪失、tab非表示で終了し古いasyncが再武装しません。reloadはscoreだけを戻し、音と録音は再開しません。反復orderは共有patternを編集し、和音追加は後のvoicingと未使用shapeを保持します。

grid重ね録りなので同role／stepの最後のtapが勝ち、他tokenを保持、長さは次音／cutまでです。長押しやarcade SFXは記録せず、PCM stream、MIDI層、metronome、schema移行は不要。別操作として後で検討します。[評価](evals/RECORDING-2026-09-06_ja.md)参照。

<a id="26-creative-tools-reuse-the-score-and-tap-transport-2026-09-06"></a>
## 26. 作曲ツールはscoreとtap transportを再利用（2026-09-06）

P8-23／P8-11／P8-12は録音後の拡張です。`varyScore`は純粋なseed変換。melodyはpitch class再利用、drumは作成済みgroove、timbreはcatalogue代替を使います。lock役割は音と楽器を保持しUndoはdocument所有。AI serviceや別音楽stateを加えません。

Web MIDIはSysExなしのopt-in。note-onを既存tap／録音へ流し、releaseとvelocity-zeroではstepを書きません。channel 10はGM drumを対応付け、選択／切断／unmountでhandlerを閉じます。長押しと実機latencyは保証せず、対応は任意です。

workerでWAV、role stems、全5機種、NES／GB／MD VGMを出力します。ZIPは無圧縮entryとCRC32で依存を増やしません。bundleはscoreと整列fileを含み2loop／30秒上限、WAVは既存5分上限。cancelはworker終了。非線形出力や共有voiceがあるためisolated stemsの和がmixと同じとは限りません。

<a id="27-bound-server-rendering-independently-of-playback-2026-09-06"></a>
## 27. server renderを再生と独立に制限（2026-09-06）

要求threadでcycle DSPを動かさず、bundle済みNode workerでinstanceごとcold render 1件、deadline 45秒、V8 old generation 128 MiBを設定します（process全memory上限ではない）。同一in-flightは共有、別coldはRetry-After付き503。完了音声LRUは32 MiB／16件／10分、実worker hash＋score／options／tagsをkeyにします。

公開時間は整数1〜30、既定2loopは超過なら422、不正queryは400。coldはaddressごと6件／分、cache hitは無料。安定URLはbyte ETagと再検証、公開存在を処理前後に確認します。制限はinstance単位であり、分散quota／永続保存は需要と測定後です。混雑host時間は診断だけに使います。

<a id="28-accounts-own-songs-keys-and-sessions-authenticate-accounts-2026-09-06"></a>
## 28. 曲はaccount所有、keyとsessionは認証手段（2026-09-06）

正規化emailの安定userが公開曲を所有し、API keyはhash保存の独立credentialです。browser linkはhash付き30日sessionを作り、HttpOnly、SameSite=Lax、HTTPSではSecure cookieを使います。loginでagent keyをrotateしません。条件付きtoken claimとsession挿入を1batchでcommitし同時消費の勝者を1件にします。link期限は30分。

同じ正規化emailの旧keyを1accountへ統合し所有曲も移します。匿名公開は匿名のまま。account UIは共有内で再生／draftにlogin不要。`GET /api/me`は最新50公開、key一覧／失効はaccount単位、key削除でも所有権を保ちます。cookie writeはoriginを検査し、不正bearerからcookieへfallbackしません。

場当たり的ALTER／catchをversioned migrationへ置換。schema、backfill、version markerを1write transactionでcommitし、失敗はrollbackして可視化。初期化promiseをmodule内共有します。旧magic linkはhash化し、消費済みは旧表にも記録。旧表は残しますがuser_idを書かない旧writerへの恒常rollbackは非対応です。backup／forward repair後にidentityへ依存してください。検証は使い捨て新旧DBで行い、本番DBとメールは使っていません。

<a id="29-native-fidelity-bypasses-musical-reconstruction-2026-09-07"></a>
## 29. ネイティブの忠実度は音楽再構成を経由しない（2026-09-07）

同じ音源コアの上に 3 つのインターフェースを置きます。シンプルな楽譜とプリセット、表現力のある多声演奏と独自音色、ネイティブのレジスタープランです。チップはプリセット一覧よりはるかに多様な音を作れます。動作規則のエミュレーションに全音色の分類は不要であり、簡単な API のために低レベルの能力を制限しません。

なじみのある曲を元の機種で再生するときは、音色の自動変化とサンプルを含む元のドライバー・ログのコマンドを使用します。MIDI 採譜と移植用の音符観測は編集・他機種版に有用ですが、元の音色の証明にはなりません。Mario と Zelda は独立検証した NES NSF の実行、Sonic は DAC ドラムを含む独立デコード済み VGM を使います。カートリッジの選択で元の機種を選びます。ネイティブのソロは共有バス時刻を変えずに声をマスクし、テンポ変更・移調はアレンジとします。

VGM の時刻は毎秒 44,100 tick の論理レジスターコマンドを表し、物理バス書き込みではありません。同一サンプル時刻の複数 FM コマンドには、参照実装のバッファ方式に従う間隔、各ポートバイト間 15 内部クロックが必要です。これがないと YM2612 が適用する前に音色や音程の設定が上書きされます。同じ誤った直列化を別のコアに与えても比較は通るため、原典コマンドとコア出力の一致だけでは完全な統合テストになりません。有効なレジスター状態、独立音声、スペクトル表示、実際のブラウザー出力も検証します。バス時刻の範囲を明示し、丸め・直列化した VGM 再生を元の CPU サイクル時刻とは呼びません。

原典コマンド台帳、レビュー済み移植抽出、完全なネイティブ成果物、初期化手順、直列化バスには別々のチェックサムを持たせます。原典と独立参照を固定し、レンダリングでオラクルを再生成しません。実機のアナログ忠実度と機種間の音色完全一致は別の主張です。

依頼された有名曲デモでは、Sonic の VGM・DAC データを含む、選択して出典を明記した音源コマンドログと生成音声をリポジトリに置きます。これは CONFORMANCE.md の探索用コーパス保管規則に対する限定的な例外です。ゲーム音楽素材にはライブラリーコードのライセンスは適用せず、実行可能な NSF・ROM とダウンロードアーカイブ全体はローカルに残します。


Zelda の回帰を受け、エミュレーションの一致より先に曲の特定を検証します。誤った NSF トラックでも本実装とリファレンスは完全に一致し得ます。選択トラックを固定し、ソース採用と公開前に確認済みの旋律を独立して照合します。収録曲の特定、全コマンドの一致、実機音声の再現性は別の主張です。[回帰の証拠](evals/ZELDA-SELECTION-2026-09-07_ja.md)を参照してください。

<a id="30-agents-authorize-through-the-standard-device-grant-not-a-dialect-2026-09-15"></a>
## 30. エージェント認可は独自方言ではなく標準のデバイスグラント（2026-09-15）

エージェント認可は通信上 OAuth 2.0 を話します。Device Authorization Grant（RFC 8628）を `/api/v1/oauth/device_authorization` と `/api/v1/oauth/token` で提供し、`/.well-known/` 配下の RFC 8414 サーバーメタデータと RFC 9728 リソースメタデータで公開し、すべての `401` の `WWW-Authenticate` にメタデータ URL を繰り返します。`apps/web/src/lib/agents.ts` の許可ライフサイクルは変わっていません。標準エンドポイントはその上の第二の面であり、従来の `/api/v1/agent-requests` JSON API は非推奨エイリアスとして残るため、ペアリング済みのエージェントはそのまま動きます。

**理由。** 独自 API は標準と同じ形（秘密コード、公開コード、確認リンク、slow-down 付きポーリング）でしたが、フィールド名とエラー語彙が異なり、すべてのクライアントに chipvoice 固有のコードが必要で、スキルがプロトコルを教えなければなりませんでした。OAuth デバイスフローのクライアントはあらゆるエージェントランタイムと MCP 認可仕様に既に存在します。標準への準拠により、chipvoice のために書かれていないエージェントからも到達でき、汎用クライアント一つ、準拠チェック一つ、三行のスキル節一つで、同じ標準を話すすべてのサービスに対応できます。

**変わること。** 新しいエージェントはガイドを読む代わりにエンドポイントを発見します。スコープ名は維持され、`scopes_supported` で公開されます。未知のリクエストトークンは期限切れではなく `invalid_grant`（標準）と `invalid_token`（エイリアス）を返します。プロキシは `/.well-known/` パスに触れません。拡張子のないパスはロケールツリーへ書き換えられていました。`apps/web/test-agent-oauth.mjs` が発見、通常・終了のすべてのトークン応答、一度限りの配布、スコープ強制、エイリアスが同じ許可を共有することを固定します。`apps/web/test-auth-conformance.mjs`（2026-09-16）が外からの視点を加えます。この許可方式を実装するすべてのサービスが共有する汎用の適合性スクリプトを `apps/web/vendor/` に取り込み、RFC だけから書かれ chipvoice を知らないそのスクリプトが同じ 9 つの答えを得なければなりません。所有者の承認と拒否はブラウザのセッションであり、API 呼び出しではありません。

<a id="31-the-approval-page-answers-before-it-edits-2026-09-16"></a>
## 31. 承認ページは編集より先に答える（2026-09-16）

`/connect` では「Review access」の後、決定（有効期限、Authorize、Decline）がエージェントの権限の直後に来て、そのセクションは自動でスクロールして表示され、プロフィール編集は既定で折りたたまれます。

**理由。** 実際に初めてエージェントを接続した人は、リクエストを確認し、権限を読み、エージェントに「done」と伝えました。しかし Authorize ボタンは画面外にあり、新しいアーティストのために自動で開いたプロフィール編集がそれを押し下げていました。エージェントは誰も答えていないコードを待ち続け、自分側の障害だと語りました。決定を求めるページは、人が見ている場所にそのボタンを置かなければなりません。

**変わること。** `apps/web/src/community/Connect.tsx` はセクションを並べ替え、リクエストが読み込まれたらそこへスクロールします。`apps/web/test-artists.mjs` は確認後にボタンがスマートフォンのビューポート内にあることと編集が折りたたまれていることを固定し、`test-creator-journey.mjs` は入力前に編集を開きます。プロフィールはそこでワンクリックで編集でき、エージェントの機能にプロフィールは不要です。

<a id="32-a-games-own-mega-drive-driver-beside-the-portable-one-2026-09-26"></a>
## 32. 移植用と並ぶゲーム専用のメガドライブdriver（2026-09-26）

chipvoice は `MdDriver` の横に二つ目のメガドライブ driver、`compileMdVoices` を持ちます。`MdDriver` は移植用 score の4つの役割を演奏し、5機種で同じ曲に聞こえなければなりません。ネイティブ driver は FM 6チャンネル、矩形波3音、ノイズ、DAC を名前で受け取り、この機種のために書かれたゲームが鳴らすものを鳴らします。テキスト tracker、PCM kit 付きの bank、ゲームが出荷するまでの render 手順が付属します。[MD-NATIVE-DRIVER.md](MD-NATIVE-DRIVER_ja.md) を参照してください。

**理由。** このチップのために書かれたシューティング Punk Force は、移植用の経路では DAC kit、完全な左右定位、FM 6声、音符ごとの patch を得られなかったため、自前の driver、tracker、render script をゲームのリポジトリに育てました。その中にゲーム固有のものはなく、二本目のゲームはそれを複製したはずです。決定29はすでにネイティブのレジスタープランを同じコアの上の第三のインターフェースとして残しており、これはその一機種向けの作曲側です。`MdDriver` に組み込めば、移植用 score の約束（全機種で全役割）を他の4機種にない声に縛ることになりました。

**変わること。** `compileMdVoices`、`arrangeMdTracker`、`MD_BANK` とその部品、`renderMdEvents`、`MD_BRIGHT_PROFILE`、5つの render helper を export します。`FmOperator` は `ssg` を受け取り、両 driver が `$90` に書きます（未指定なら従来どおり0）。抽出はゲームの楽譜を両方で compile して証明しました。5曲と40効果音で同じレジスター書き込み、render、trim、level、sprite 化の後も同じサンプルです。唯一の違いは修正で、tail なしのときゲームの tracker はループ終端を0と返していました。`test/md-native.mjs`、`test/game-audio.mjs`、`test/golden-md-native.mjs` が固定します。LFO は off のまま、channel 3 特殊モードは未使用です（P5-12）。

<a id="33-the-shared-render-lease-favors-publications-and-meters-caller-time-2026-09-26"></a>
## 33. 共有render leaseは公開を優先し、呼び出し元ごとに時間を計測（2026-09-26）

evaluate、MP3エンコード、作曲検証はすでに公開レンダリングと1つのfleet全体render leaseを共有していました（decision 27）。それを許可していた`utilityWorker`は、誰が求めているか、他に何が待っているかを区別していませんでした。1人の匿名呼び出し元が繰り返しevaluateを呼び、そのたびにdeadlineいっぱいまでleaseを保持すれば、すべての公開レンダリングを無期限にキュー待ちにさせ、他のすべての呼び出し元も道連れにできました。

`apps/web/src/lib/utility-worker.ts` は、evaluate・MP3エンコード・作曲検証がleaseを取得する前に2つの許可判定を追加しました。新しくキュー待ちの公開レンダリング（レンダリング中のものだけでなく）があれば許可を即座に拒否します。ただし270秒の陳腐化窓を設け、放棄されたキュー行が処理を永久に止めないようにします。もう一つは呼び出し元ごとのrender時間予算で、新設の`worker_time_budget`テーブルに記録し、`apps/web/src/lib/projects.ts`の`chargeWorkerTime`が、保持した作業が成功・失敗・タイムアウトのいずれであっても課金します。`admitWorkerTime`は、現在の1分間にサインイン時60秒・匿名時20秒のrender時間を使い切った呼び出し元を429 `worker_budget`と正確な`Retry-After`で拒否します。これは`admitProject`がすでに許可している匿名の毎分6回のevaluateリクエストより十分小さく、短いリクエストを繰り返しても1回の長いリクエストの代わりにはなりません。すべての`utilityWorker`呼び出し元は、`evaluate/route.ts`がすでに使っていた規約に合わせてidentityを渡すようになりました。サインイン時はそのままのaccount ID、匿名時は`anonymous:`に`clientKey(request)`を付けたものです。キュー待ちの公開レンダリングは、これまでどおりオーナーの次のジョブポーリングで開始されます。サーバーレスのインスタンスがレンダリング途中で凍結しうるため、リクエストの`after()`の外では何も起動しません。

**理由。** decision 27はコストの選択として意図的にレンダリングを1つのfleet全体スロットへ制限しており、それは変わりません。この変更は同時にレンダリングできる数を増やしたり、2本目の同時実行レーンを追加したりはしません。変わるのは、複数の呼び出し元が同じ1つのスロットを求めたときに誰を優先するかです。公開レンダリングはプロダクトの中核的な約束であり、それを待つオーナーがいます。evaluateは再試行できる事前チェックです。evaluate呼び出し回数を数えること（すでにaddressごと毎分6回）は、どれだけ頻繁に尋ねられるかを制限するだけで、1回のターンが共有スロットをどれだけ長く占有するかは制限しません。毎回30秒のdeadlineいっぱいを要求する呼び出し元は、ほぼそれを使い切れてしまいます。starter fixtureと音符密度8倍の変種で計測したところ、evaluate呼び出しは曲の長さに関わらず2秒間の抜粋だけをレンダリングするため200〜470ミリ秒で完了しており、短縮した匿名15秒deadlineに対して約30倍の余裕があります。したがって短縮しても通常の呼び出し元には何のコストもかからず、行き詰まった、あるいは悪意ある匿名リクエスト1件がleaseを占有できる時間には上限がつきます。

**変わること。** `apps/web/src/lib/utility-worker.ts`はキュー待ち公開レンダリングの確認とrender時間の許可判定を得ます。`apps/web/src/lib/projects.ts`は`admitWorkerTime`/`chargeWorkerTime`と、`ProjectHttpError`への`retryAfter`を得ます。`apps/web/src/lib/project-http.ts`はこれを固定値60ではなく`Retry-After`ヘッダーに反映します。`apps/web/src/lib/migrations.ts`は`worker_time_budget`テーブルを追加します。`apps/web/src/lib/evaluation.ts`は匿名evaluateのdeadlineを15秒に短縮します（サインイン時と、`apps/web/src/lib/composition/jobs.ts`の検証ステップ向けは30秒のままで、後者も作曲アカウントのidentityを渡すようになりました）。`apps/web/test-artists.mjs`は、キュー行がevaluateをブロックすること、陳腐化したキュー行はブロックしないこと、両方の予算が正しい`Retry-After`で拒否し使い切った後に再開することを固定します。`apps/web/test-projects.mjs`は直接呼び出す`utilityWorker`を新しいidentity引数に合わせて更新します。

<a id="34-no-page-can-be-framed-an-agents-name-is-marked-unverified-and-sign-in-mail-is-throttled-per-address-2026-09-26"></a>
## 34. どのページもフレーム表示を拒否し、エージェント名は未確認と明示され、ログインメールは宛先ごとに制限される（2026-09-26）

すべての応答は `X-Frame-Options: DENY` と `Content-Security-Policy: frame-ancestors 'none'`（`apps/web/next.config.ts`）を持ちます。`/connect` では、エージェントの申告名が自己申告かつ未確認であることが、リクエストからの経過時間と、自分が今始めたのでなければ承認しないよう求める警告とともに示されます。`/api/auth/signin` は既存の IP 単位の制限に加え、送信メールを宛先アドレスごとに制限します。

**理由。** chipvoice のどのページも、承認ページ自体を含め、他サイトのフレーム内に置かれる正当な理由はなく、すべてのフレーム表示を拒否すればクリックジャッキングの一種を無償で排除できます。`/connect` では、エージェントの `label` はリクエスト作成時にエージェントが送った任意の文字列であり、単なる見出しとして表示すると chipvoice が確認済みの名前のように読めてしまいます。これはまさに、「chipvoice サポート」を名乗るエージェントが、電話や画面共有の最中に、依頼していないデバイスコードを承認させるために使う手口です。ログインリンクはアドレスにアカウントがあるかどうかを決して明かしてはいけませんが、これまでは一つのアドレスにリンクを溢れさせることを何も止めていませんでした。IP 単位の制限だけでは、多数の IP に分散された溢れを止められません。

**変わること。** `apps/web/next.config.ts` の `headers()` がすべてのパスに両方のフレーム制御ヘッダーを設定し、`apps/web/test-auth-http.mjs` が `/` と `/connect` でそれを確認します。`apps/web/src/community/Connect.tsx` は申告名に「自己申告であり、chipvoice による確認は受けていません」という注記と、経過時間を示し、今まさに自分が始めたのでなければ拒否するよう求める一文を表示します。`apps/web/src/lib/agents.ts` の `inspectAgentRequest` はその一文のために `createdAt` を返すようになりました。`apps/web/src/app/api/auth/signin/route.ts` は正規化したアドレスごとに 15 分あたり最大 3 件までリンクを許可し、上限超過には IP 単位の制限と全く同じ形（429、`Retry-After`）で答え、どちらの場合もそのアドレスにアカウントがあるかどうかは明かしません。`apps/web/src/lib/projects.ts` の `admitProject` は任意のwindow長を取れるようになり、そのwindowを次元のないindexではなく絶対timestampとして保存するため、window長の異なる呼び出し元同士が cleanup 時に互いのまだ有効な行を消してしまうことがありません。これら3つの変更はすべて `apps/web/test-auth-http.mjs` で固定され、エージェント申告名の注記は `apps/web/test-artists.mjs` でスマートフォンのビューポートに対しても確認されており、Decision 31 が直した Authorize ボタンを画面外へ押し出すことはありません。

メールで届くログインリンクは、開いただけではもうログインさせません。`GET /api/auth/redeem` はリンクがまだ有効かを確認して `/signin/confirm` へ送るだけで、そのページのボタンが同じルートへ POST します。トークンを消費するのはその POST だけです。メールスキャナーやリンクの先読みは中身を調べるためにリンクを開くため、以前の GET は本人がクリックする前に使い捨てトークンを消費してしまい、本人には期限切れのリンクに見えていました。あわせて三つの小さな修正も入ります。`apps/web/src/lib/limit.ts` の `clientKey` は `x-real-ip` を優先し、なければ `X-Forwarded-For` の右端を使います。左端はクライアントが好きに送れる値で、呼び出し元が自分のレート制限の枠を選べてしまったためです。曲の削除に使う管理キーは定数時間で比較され、未設定のときは決して一致しません。`apps/web/src/lib/db.ts` は、専用の `TURSO_DEV_AUTH_TOKEN` のない開発用データベース URL を、本番トークンで代用せずに拒否します。`apps/web/test-auth-http.mjs` は、GET が cookie を設定せずトークンを使える状態のまま残すこと、そして消費済みのトークンを二度使えないことを固定します。

<a id="35-chip-engines-load-with-what-needs-them-not-the-shared-shell-2026-09-27"></a>
## 35. チップエンジンは、それを必要とする場所と共に読み込む（2026-09-27）

`apps/web/src/studio/document.ts` は、チップのロゴとラベルの単純な配列である `DEMO_MACHINES` の隣に、モジュールスコープの `import {arrange, validateSong} from 'chipvoice'` を持っていました。全ルートに常駐する `PersistentPlayer` と、ほぼ全ページで描画される `SiteHeader`・`MachinePicker` はその配列だけを必要としていましたが、`document.ts` から読み込むとパッケージ全体、つまり5つのチップエミュレーターすべてとその内蔵AudioWorkletソースまで引き込んでいました。`validateSong` は曲の音符を各チップの音声数と照合するため、実際に全チップの具体的な仕様に依存しているからです。About、Connect、Docs、Signin と Lab の3ページは、どれもエミュレートされたチップを再生せず、事前レンダリングされた録音だけを扱うにも関わらず、使うことのないチップエンジンのJavaScriptを約627KB配信していました。

**理由。** 表示用のチップメタデータ（名前、ロゴ、年）と、実際の再生・検証エンジン（チップごとのAudioWorkletプロセッサー、各30〜56KB）が同じモジュールに存在していたため、どちらを読み込んでも両方を引き込んでいました。分離することで、共有UIシェルは軽いままにし、エディター・アレンジデッキ・Labは既に必要としている場所でそのまま実エンジンを読み込めます。

**変わること。** `apps/web/src/studio/machines.ts` が `ChipId`、`ROLES`、`ROLE_NAMES`、`MACHINES`、`DEMO_MACHINES`、`tokens`、`lengthOf` を保持します。これらは純粋なデータと文字列ヘルパーで、`chipvoice` の実行時読み込みを持ちません。`document.ts` は既存の利用者（studio エディター、アレンジ、公開ビュー）のためにそれらを re-export し、ほぼ全ルートから到達する `Player.tsx` と `ui/components.tsx` は `document.ts` の代わりに `machines.ts` から直接読み込みます。`apps/web` のビルド出力で測定すると、About、Connect、Docs、Signin と Lab の3ページはそれぞれ約627KB(初回読み込みJSのおよそ半分)減少しました。Create、Explore、Library は自らの編集機能のために実エンジンを引き続き読み込みますが、これらもそれぞれ約281KB減少しました。変更前は共有UIシェル経由でも同じエンジンを二重に読み込んでいたためです。チップ関連の仕組みを一切必要としないホームページのみ変化していません。`apps/web/test-page-weight.mjs` はサーバーもブラウザも使わずビルド済みの `.next` 出力を直接読み、これら7つの無音ページのいずれかが再び `registerProcessor` を含むチャンクを参照すれば失敗します。

<a id="36-publishing-gains-a-parity-gate-and-creates-its-own-release-2026-09-27"></a>
## 36. 公開はパリティ検証を経てから自らリリースを作成する（2026-09-27）

`publish.yml`は`test:fresh`の後、`npm publish`の前に`test:parity`を実行します。オフラインレンダリングとworkletのライブキャプチャは、音量、ヘッドルーム、明るさが一致していなければなりません。一致しなければ、リスナーがダウンロードするMP3は実際に聞いた音とは違うものになります。このチェックは常に固定ポート4181でサーバーが動いていることを前提としており、自らサーバーを起動したことがないため、このジョブが`packages/chipvoice`自体をそのポートでホストします。`npm publish`が成功した後、ジョブはタグのGitHubリリースも作成します。`gh release view "$GITHUB_REF_NAME" || gh release create "$GITHUB_REF_NAME" --verify-tag --notes-from-tag`とし、既に存在する場合はスキップします。

**理由。** チップは今や2か所で動いています。オーディオクロック上のworkletと、カウンター上のNodeです。両者が一致し続けることを確認するものはこれまで何もありませんでした。`test/parity.mjs`だけがそれを行いますが、どこでも実行されたことがありませんでした。リリース検証はまさにそのチェックがあるべき場所です。実際のChromiumが4秒間の実音声をキャプチャするため、スイートの他の部分より遅く失敗しやすく、それがCIで毎回のpushでは実行しない理由ですが、リリースは「レンダリングが実際に聞かれた音と一致する」ことが成り立たなければならない、まさにその一点です。GitHubリリースは、`npm publish`が既に成功した後で誰かが覚えていることに依存する、別の手動手順でした。0.15.0、0.15.1、0.18.0、0.19.0は、誰も覚えていなかった結果です。いずれもリリースページなしでnpmに公開され、後から手作業で補いました。既存のリリースを先に確認することで、メンテナーが自分で作った手動リリースが失敗した実行になりません。

**変わること。** `publish.yml`はリリースを作成するために`contents: write`が必要です（npmのOIDC交換に使う既存の`id-token: write`と併せて）。`test:parity`または`npm publish`が失敗した場合、リリースは依然として作成されません。

<a id="37-run-the-packages-unit-tests-with-node---test-not-a-chain-of-them-2026-09-27"></a>
## 37. パッケージのユニットテストはコマンド連結でなくnode --testで実行（2026-09-27）

`packages/chipvoice` の `test:unit` は `node scripts/run-unit-tests.mjs` になりました。これは `test/*.mjs` をディスクから読み取り（`test:parity` を自前で持つ `test/parity.mjs` だけを除く）、そのファイル一覧を `node --test --allow-natives-syntax --test-concurrency=4` に渡します。

**理由。** 旧スクリプトは `node test/a.mjs && node test/b.mjs && ...` という、ファイルごとに `&&` で連結した40個超のコマンドでした。このチェーンは最初に失敗したファイルで止まり、その後のファイルは実行も報告もされず、新しいテストファイルは著者が同じ一行に対応する `&&` 節を追加し忘れなければ加わりませんでした。強制する仕組みもありませんでした。`node --test` は途中の失敗に関わらず全ファイルを実行し、見つかった失敗をすべて報告します。ファイル一覧をディスクから読むことで、新しいファイルは誰かが配線を思い出した瞬間ではなく、存在した瞬間に加わります。

**変わること。** `scripts/run-unit-tests.mjs` が、ファイルを意図的に除外できる唯一の場所になり、名前で指定する専用の除外リストを持ちます。今日そのリストは1件だけです。`--test-concurrency=4` はCIの4 vCPUに合わせたもので、同じ49ファイルで実行時間は著者のマシン上で約48秒から約20秒になりました。`pnpm test:unit`、`pnpm test`、リリースワークフロー自身が呼ぶ `test:unit` は名前としては変わらず、その下で実行される内容だけが変わりました。

<a id="38-demo-v1-is-accepted-new-chips-reopen-with-guards-2026-09-27"></a>
## 38. デモV1を受け入れ、条件付きで新チップを再開する（2026-09-27）

[DEMO.md](DEMO_ja.md)が定義するフェーズ8のV1は、マージ済み、デプロイ済みで、本番e2eでも動作を確認しています。これを受け入れます。P8-9（スマートフォンでの編集）、P8-13（SIDのフィルター、実質はチップの作業）、P8-14（利用の計測）はまだ部分的または未着手ですが、V1を止めるのではなくV1の後に続けます。これにより、決定20が新システムに課していた制限（ロードマップの「その後」）を解除します。

**理由。** 決定20は、プロジェクトが広がる前にデモを完成させるため新システムを閉じ、任意の後続作業がその制限を無期限にしてはならないとも定めていました。デモは完成し、残りは改良です。目標は変わらず、より多くの機種、楽器、音楽を、それぞれ計測したうえで扱うことです。

**条件。** 未完了の第二オラクルのチケットが終わるまで、新しいチップには着手しません。P1-13（NES）、P3-4（Game Boy）、P5-8（メガドライブのPSG）、P7-7（VICEのテストプログラムに対するSIDのデジタル部）です。YM2612とS-DSPはすでに参照コアを行単位で移植して動かしているため、次の検証は実機です。最初の追加はNESの拡張音源（VRC6、VRC7、FDS、N163、Sunsoft 5B、MMC5）です。検証済みのチップを拡張するものであり、NSFがすでにそれを含むため、実ゲームのコーパス（P1-12）も一緒に広がります。どの追加も「チップより先に仕様書」に従い、コア、オラクル、存在する場合はテストROM、そして適合性の仕様書をそろえてから公開の機種選択に加わります。

**実機計測は無料の根拠から。** アナログ段はエミュレーターだけでは確定できません。エミュレーターは誰かの計測に合わせたモデルなので、それと一致しても証明できるのはそのモデルとの一致であって、実機との一致ではありません。フィルター、DACの特性、出力段は個体や基板の版によっても異なります。順序は、まず独立したエミュレーターのオラクルと実機の公開録音（P2-3のミキサーはすでにblarggによる彼のNESの録音で裏付けています）、次に購入する1台の参照機、NESで録音環境とその手法を検証し、それから他の機種を購入します。

**変わること。** ロードマップの「その後」に追加の順序を記し、[バックログ](BACKLOG_ja.md#next-steps-2026-09-27)が作業を順序付けます。バックログのフェーズ8と「後のフェーズ」の記述に受け入れを反映します。

<a id="39-generation-opens-as-a-closed-beta-familiar-game-melodies-stay-only-while-it-is-free-2026-09-27"></a>
## 39. 生成はクローズドベータで公開し、有名なゲームの旋律は無料の間だけ残す（2026-09-27）

プロンプトからの作曲（[GENERATIVE-COMPOSITION.md](GENERATIVE-COMPOSITION_ja.md)）は、プロジェクト外の人にクローズドベータとして公開します。招待制（最初は20人から50人、自由登録ではない）、無料で、既存のオーナーごとの1日上限（`COMPOSITION_DAILY_LIMIT`）と、モデル提供元で設定する月額の支出上限（最初は100ユーロ）で制限します。価格はその後、ベータで計測した1曲あたりのコストと、曲全体の検査と試聴を通過した曲の割合から決めます。

chipvoice.dev上のマリオ、ゼルダ、ソニックの素材（スタジオのおなじみの旋律と完全アレンジ）は、サイトが無料かつ非商用である間は残します。有料での公開の前にはこれらを公開サイトから外し、ハッシュ、台帳、計測はリポジトリに残したうえで、誰かに課金する前に法的な確認を行います。生成は既知のテーマを再現する依頼を断ります。

**理由。** 生成機能は端から端まで動作しますが、検証した曲はまだ少数で、HTTPの音響レポートは冒頭2秒しか見ておらず、金額を管理する仕組みもありません。クローズドベータなら、公開してから人前で気づくはずのことを先に計測できます。無料の保存プロジェクトでエンジンを示すためなら有名な旋律は妥当ですが、同じ素材を有料製品の隣に置くのは別のリスクです。

**変わること。** これはGEN-13を具体化します。フィクスチャのテストだけでは今後も有料の推論を始めず、計測のないベータでも始めません。作業は[バックログの次の段階](BACKLOG_ja.md#next-steps-2026-09-27)のステップ6にあります。

<a id="40-published-recordings-live-in-object-storage-under-paths-that-name-their-content-2026-09-27"></a>
## 40. 公開録音は、内容を名前に含むパスでオブジェクトストレージに置く（2026-09-27）

ラボと編曲のFLAC録音をgitから出し、公開のVercel Blobストアに移します。録音はチェックアウトの145 MBを占め、ラボを公開するたびに履歴へさらに8〜48 MBが恒久的に加わっていました。2つのレポートは各録音のSHA-256を持つマニフェストとしてリポジトリに残ります。ラボのパスはもともとエンジンのバージョンとPCMのハッシュを含んでおり、編曲のパスはFLAC自身のハッシュの先頭を含むようになりました。ストアのキーはサイトのパスそのもので、一度だけ書き込まれ上書きされないため、Next.jsは2つのフォルダーをストアへ一対一で書き換え、ブラウザはファイルを1年間保持できます。

`pnpm audio:push`は公開で増えた録音をアップロードします。`pnpm audio:pull`は検証済みのローカルコピーを取得し、サイトはストアより先にそれを配信します。CIは2つのレポートをキーとするキャッシュを通じて取得してすべてのハッシュを確かめ、`pnpm audio:check`はストアにない録音を指すレポートを失敗させます。本番e2eはサイト経由で録音をダウンロードし、そのバイト列をレポートと比べます。書き込みトークンは開発環境にだけ接続され、デプロイされたサイトは読むだけです。

**理由。** リポジトリが証明し、ストアが配信します。これらの録音はハッシュがすでにレポートに固定された決定的な出力で、バイト列をgitに置いてもハッシュ以上のものは得られず、すべてのクローンとCIのチェックアウトがそれを運んでいました。Vercel Blobはサイトのデプロイ先にあり、新しい事業者を必要とせず、この規模ではほとんど費用がかかりません。Git LFSは訪問者がダウンロードするものを変えないまま、すべてのクローンとCIの実行に帯域の上限を課していたでしょう。転送量が支配的になれば、Cloudflare R2に移ります。

**しないこと。** 履歴は書き換えないため、`.git`の大きさは変わりません。止まるのは増加だけです。アップロードしたのは現在のレポートが指す録音だけで、どのレポートも参照しなくなっていたラボのファイル（316件中169件）はなくなりました。ハッシュを含まない以前の編曲URLは404を返します。この変更をpullしたチェックアウトでは、追跡されていたラボのコピーも一緒に消えます。サイトは引き続きストアから再生し、`pnpm audio:pull`で元に戻せます。

<a id="41-reference-emulators-under-the-gpl-may-be-vendored-in-the-harness-never-in-the-package-2026-09-27"></a>
## 41. GPLの参照エミュレーターはハーネスに同梱してよいが、パッケージには入れない（2026-09-27）

ステップ1の第2の参照にはGPLのコードが含まれます。NESのMesen 2（GPL 3）と、C64のVICEのSIDテストプログラム（GPL 2）です。これらは`packages/conform`の下に、LGPLの参照と同じく、それぞれのフォルダーにライセンスと、上流のものと自分たちのものを区別するREADMEを添えて同梱できます。ハーネスがビルドしてパイプで動かす独立したプログラムとして、またはハーネスのCPUが実行するテストプログラムとして動かします。そのどれも`packages/chipvoice`へリンク、コピー、移植はしません。パッケージは`(MIT AND LGPL-2.1-or-later)`のままで（決定17）、`packages/conform`は非公開で公開もしません。

**理由。** 利用できる最も強い参照はGPLであることが多く、参照の価値はそれが何に対して検証されているかで決まります。自分たちのコアの中ではなく横で動かせば、パッケージのライセンスを変えずに、シートで最良の根拠を示せます。

**変わること。** GPLの参照からパッケージへコードを移す変更は、レビューで却下します。GPLの参照が見つけた相違は、決定14がゲームボーイのチップを書いたように、そのコードではなく資料から直します。

<a id="42-the-server-enforces-the-closed-beta-invitations-and-a-monthly-budget-2026-09-27"></a>
## 42. クローズドベータはサーバーが守る。招待制と月間予算（2026-09-27）

決定39は、プロンプト作曲を「モデル提供元で設定する」月額の支出上限つきのクローズドベータとして公開しました。本番にはそのどちらもなく、サインインしたどのアカウントでも作曲でき、金額を数える仕組みもありませんでした。これからは両方をサーバーが守ります。

- **招待制。** `COMPOSITION_ACCESS=invite`（Vercelのすべてのデプロイでの既定値）では、メールアドレスが`composition_invites`にあるアカウントだけが作曲でき、それ以外には`403 generation_invite_required`を返します。招待はメールアドレスを指すので、アカウントより先に出せます。一覧、追加、削除は`apps/web/scripts/composition-invites.mjs`で行います。テーブルを作るマイグレーションは、すでに作曲したことのある人全員を招待するので、それまでの利用を失う人はいません。
- **月間予算。** `COMPOSITION_MONTHLY_BUDGET_USD`が暦月（UTC）の上限です。その月の支出は、各生成が記録したトークン使用量をモデルの定価（GPT-6 Astraは入力、キャッシュ済み入力、出力の100万トークンあたり10、1、50 USD。OpenAIの料金ページ、2026-09-27確認）で換算したものに、実行中か、モデルに届いた後に失敗して使用量が記録されていない生成ごとの最悪値（入力32,768トークンと出力上限）を加えたものです。受付ではさらに最悪値を1件分足し、1日上限と同じ書き込みトランザクションの中で確かめるため、同時リクエストでも上限を超えません。予算を使い切ると、翌月1日までの`Retry-After`つきで`429 generation_budget`を返します。本番はこの変数がないとき、また価格の分からないモデルでは作曲を断ります。
- **理由を伝える。** `GET /api/v1/generations/access`は、サインイン中のアカウントがいま作曲できるか、できないならその理由（`invite_required`、`monthly_budget`、`daily_limit`、`disabled`）を、予算や支出額を明かさずに返します。作曲画面は理由を表示し、ボタンを無効にします。

本番は月110 USD（決定39の100ユーロ程度）から始めます。この決定以前に記録された6件の生成は、平均で入力約6,800、出力約4,100トークン、1件あたり約0.28 USDだったので、上限は月に約350曲分です。最悪値は出力上限24,000トークンで約1.5 USDで、リクエストの実行中にだけ数えます。

**理由。** 提供元での上限は請求の後に働き、そのキーのあらゆる利用にかかります。サーバーは各呼び出しの使用量を知っているので、呼び出しの前に断り、理由を示し、APIのほかの部分と一緒にテストできます。Responses APIが報告するのは金額ではなくトークン数なので、価格はコードに置きます。価格のない新しいモデルは、数えられない支出をするのではなく作曲を止めます。提供元のダッシュボードでの上限は、2つ目の柵として引き続き役に立ちます。

**変わること。** 決定39の上限は提供元からサーバーに移ります。NEXT-20の利用上限はベータ向けに整い、課金は残ります。

<a id="43-every-song-and-publication-records-the-chipvoice-engine-that-made-it-2026-09-27"></a>
## 43. すべての曲と公開作品が、それを作ったchipvoiceのエンジンを記録する（2026-09-27）

決定21は限界をはっきり述べていました。安定した音声URLはいまデプロイされているエンジンでその都度再レンダリングし、「エンジンのバージョンをまたいだアーカイブ的な再現は約束しない」、その修正は「npmパッケージを固定し、完全なスコアを保つこと」だとし、それをAUD-2に「基盤を追加する前に測定を」残していました。ところが、どのバージョンを固定すればよいかを記録するものが何もありませんでした。NEXT-11はそこを塞ぎます。`songs`、`projects`、`project_jobs`それぞれにnull許容の`engine_version`列を追加し、行が書かれる瞬間ごと - 曲の保存、リビジョンの公開、レンダージョブの作成 - に`PROJECT_ENGINE_VERSION`（chipvoiceパッケージのバージョンで、NEXT-01によりnpmが配るものと既に等しい）を刻みます。`project_jobs`はすでに実際にバンドルされたレンダラーの内容ハッシュ（`engine`列、決定27のキャッシュキー）を持っていました。バージョンはその隣に置かれ、ハッシュが「ビット単位で同じビルドか」しか答えられなかったところに、「どのnpmリリースか」を答えます。

**対象ごとに、「再現」が意味すること。**

- **ドラフト**はブラウザのローカルに留まり（CREATION.md）、刻む先のサーバー側の行がありません。`prepareProject`/`renderProject`はすでに結果に`engineVersion`を返しているので、ドラフトの書き出したJSONもダウンロードもすでにそれを知っています。ここに新たに必要なものはありませんでした。
- **保存された曲**（`/api/songs`、コンパクトな`songs`テーブル）は、保存した時点のバージョンを記録し、曲ページとAPIの両方に出します。これは決定21が`/s/{id}`について選んだことを変えません。そのURLはいまも意図的に、いま動いているエンジンで再レンダリングし、聴く人には常にいまの音を届けます。記録されたバージョンは制作の事実（「chipvoice x.y.zで作られた」)であって、`/s/{id}`が次に何をレンダリングするかを固定するものではありません。
- **完全なプロジェクト**（`/api/v1/projects`、`projects`テーブル)は、公開した瞬間のバージョンを記録します。ドキュメント自体は決定27によってすでに不変です。バージョンを記録することで、ドキュメントそのものが独立して再現可能になります。その正確な`chipvoice`リリースをインストールし、それに対して`renderProject`を呼ぶことは、当てずっぽうではなく既知の正確な操作です。
- **不変の公開作品のレンディション**（`project_jobs`、決定40)は、既存のバンドルハッシュと並んで、実際にレンダーしたバージョンを記録します。レンダーは常にいま動いているエンジンを使うため、レンディション自身のバージョンは公開作品のものと食い違うことがあります。その正確なバイト列を再現するのは、公開作品のバージョンではなく、レンディション自身のバージョンです。

**古いエンジンの入手先: サーバーにはインストールしない。** 過去のnpmリリースをそのまま別名で加え（`"chipvoice-0.19.1": "npm:chipvoice@0.19.1"`)、レンダーごとに必要な方を読み込む案を検討しました。見送った理由は次の通りです。このパッケージはすでに5つのサウンドチップコアとインライン化されたAudioWorkletのソースをバンドルしており（リリースあたり圧縮後で約760 KB)、過去のリリースを依存として1つ加えるたびに、デプロイされたVercelのファンクションがその分だけ、上限なく永久に膨らみます。公開作品は理屈の上でこれまでに出たどのリリースも必要とし得るからです。そのコストは、そのリリースが実際に求められるかどうかに関係なく、毎回のコールドスタートで支払われますし、あるパッケージ依存のセキュリティ修正が出たあとも、どこかの古い公開作品がそのバージョンを指しているかもしれないという理由で、そのバージョンを二度と落とせないということでもあります。それに対して、サーバーが古いエンジンで再レンダーする必要は本当のところありません。レンダーは常にいま動いているエンジンを使い、その事実をそのまま記録するだけなので、サーバーがインストールしていないバージョンに手を伸ばさなければならない場面はありません。

そこで採る方針は、決定21がすでに名指ししていたものです。サーバーは常にいまのエンジンでレンダーし、選べるように古いエンジンをインストールしておくことは決してしません。`createProjectJob`が、ある公開作品の、その種類での最初のレンダーを始める前に、記録された`engineVersion`をサーバーのいまのバージョンと比べ、食い違えば`409 engine_upgraded`で断ることも検討しました。見送った理由は次の通りです。ジョブの種類は`preview`と`full`の2つだけなので、次のchipvoiceリリースが出るまでに誰も`full`のレンダーを求めなかった公開作品は、所有者が新しいidのもとで再公開する以外に誰もレンダーできなくなり、共有リンクを壊してしまいます。しかも、それがそのリリースごとに起こります。その公開作品のチップの音に何も関わらないリリースでも同じです。断ることは、記録がすでに与えている以上の正直さも生みません。レンディション自身の`engine_version`が、実際にそれを作ったエンジンをすでに答えているので、それが公開作品のエンジンの録音だと名乗る必要はどこにもないからです。そこでレンダーは常に進み、ジョブは実際にレンダーしたバージョンを、公開作品自身のものと食い違うかどうかに関わらず記録します。呼び出す側が正確に過去を再現したいときの対処は変わりません。名指しされた`chipvoice`のバージョン - 公開作品のものではなく、実際にそのバイト列を作ったレンディション自身のもの - をインストールしてドキュメントをローカルでレンダーすれば、ドキュメントとそのリリースの両方が固定されているため、そのバイト列をそのまま再現します。

**この変更より前に書かれた行は`engine_version = null`のままで、「不明」として読まれ、推測はしません。** 公開作品自身の録音から遡って埋めることも検討しました。これは決定21のもう一つの提案でしたが、`project_jobs.engine`は特定のビルドの内容ハッシュであり、これまでどのテーブルもそのハッシュを、それを生んだバージョンと対にして記録していませんでした。遡って埋められる信頼できるハッシュ・バージョン対応の履歴は存在せず、行のタイムスタンプをリリース日と突き合わせて推測することは、Vercelのデプロイがタグを切った瞬間にちょうど着地したと仮定することになり、実際にはそうではありません。`null`は何も主張せず、何も損ないません。

**表示されるもの。** 曲・プロジェクト・ジョブの各APIレスポンスと、そのOpenAPIスキーマはすべて(null許容の)`engineVersion`を持ちます。`/api/v1/capabilities`はこれまでどおり自身の`engineVersion`を持ちますが、これはサーバーのいまのエンジンであって、個々の曲やレンディションのものではありません。説明文はいまそのことを明記します。レンディション自身の`engineVersion`が、その正確なバイト列を再現するためにインストールすべきものであり、公開作品自身の`engineVersion`はデプロイ後にそれと食い違うことがあります。どちらも、もう一方についての約束ではありません。公開された曲のページには、ready状態のレンディションのバージョンが公開作品のものと一致するときは「chipvoice x.y.zで作成」、食い違うときは「chipvoice x.y.zで公開、chipvoice a.b.cでレンダー」、何も分からないときは「エンジンのバージョンは記録されていません」を、英語と日本語の両方で表示します。スキルも同じ区別を説明します。

**理由。** 述べられていた限界は能力の話ではなく、記録の話でした。決定21はすでに、正確なnpmバージョンをインストールすればレンダリングを再現できることを知っており、決定27・40はすでに公開作品のバイト列を不変にしていました。欠けていたのは、実際にレンダーしたエンジンをそのまま正直に記録するバージョン番号そのものだけです。これは小さく、境界のある、テスト可能な変更です。複数バージョンをホストすることは、プロジェクトの寿命の間に何本リリースが出るかに上限のないサーバーレスのデプロイ上では、そのどれにも当たりません。そしてレンダー時に断ることは、すでに正直に記録できている稀な隙間を、本物の隙間 - 二度と誰もレンダーできない公開作品 - に置き換えてしまうことになります。

**行わないこと。** `/s/{id}`をアーカイブ的にはしません。そのURLは決定21自身の設計どおり、いまもいまのエンジンを追いかけます。これが加えるのは、それを作ったものの記録であって、いま配信するものを固定することではありません。デプロイされたサイト自身がその場で古いリリースのバイト列を作り出せるようにもしません。それは呼び出す側が、名指しされた正確で再現可能な対象に対してローカルで行う操作のままです。MIX-14（ブラウザ・Node・実機間でのレンダーハッシュの比較）とAUD-2のさらなる測定は別に残ります。

<a id="44-vgm-import-carries-dpcm-through-a-memory-block-and-rejects-what-it-does-not-model-by-name-2026-09-27"></a>
## 44. VGMインポートはDPCMをメモリブロックで運び、モデル化していないものは名前を示して拒否する（2026-09-27）

Mega Driveだけに出荷していた`importVgm`を、NES 2A03とGame Boy DMGへ拡張します。どちらもファイル形式がすでに予約しているVGMヘッダーのクロックフィールド（`0x84`、`0x80`）を読むので、1つの関数がMega DriveのYM2612クロックを他のクロックと区別していたのと同じ方法で、3機種を区別し続けます。

- **DPCMはDACストリームコマンドではなく`PerformancePlan.memory`で運ぶ。** VGMのNES DPCMサンプルデータは2つの経路で届き得ます。データブロック種別`0xC2`（「NES APU RAM write」、単純なアドレスとバイト列のダンプ）か、種別`0x07`と`0x90`〜`0x95`のDACストリームコマンド（ストリーミング再生向けの圧縮バンク形式で、アドレス空間にすでに置かれた単発サンプル向けではありません）です。`importVgm`は前者だけに対応し、`PerformancePlan.memory`へ変換します。これは`recordSong`が譜面から作曲したDMCサンプルのために既に埋めているのと同じフィールドです（`packages/conform`の`script-dmc`コーパスの項目もこれを使います）。`renderPerformance`はその扱い方を既に知っています。`core.schedule(events)`の前に`core.load(address, bytes)`を呼ぶだけです。新しい仕組みも、バルクバンクの展開処理も必要ありません。種別`0x07`／DACストリームは名前を示して拒否します。それだけを使うファイルには別の対応が必要になります。
- **NESとGame Boyの書込にはバッファ書込の間隔調整が要らない。** Mega Driveのインポーターは、実チップがポート書込と次の書込の間にサイクルを要求するためYM2612の書込の間隔を調整します。2A03とDMGのレジスターにはそうした制約がないため、それらの書込は人工的な間隔を挿入せず、書込自身のVGMサンプル時刻でそのまま`RegisterEvent`になります。
- **黙って無視したり最善努力で済ませたりせず、名前を示して拒否する。** PALなど非NTSCのクロック（NES自身の1789773 Hzから0.01%以内を許容し、これにより実際の多くのリップやVGMPlay自身が書く1789772も通り、PALの1662607とDendyの1773448はそれでも拒否されます）、ファミコンディスクシステムのビット、第二の（「デュアルチップ」）NESまたはGame Boyチップ（レジスターバイトのビット7、両機種共通のVGMの取り決め）、同じヘッダー内の別チップのクロックは、それぞれ名前付きのエラーを投げ、それらしく見えるが誤ったレンダーを作りません。この4つはいずれもどちらのチップコアもモデル化していないため、黙った部分インポートは実際に鳴った内容を誤って伝えることになります。1.50〜1.71の範囲外のVGMバージョンも同様に、どの機種か選ぶより前に働く形式チェックで拒否されます。この範囲は実際にはNESとGame BoyではMega Driveより狭くなります。VGMがそれらのクロックフィールド（`0x84`、`0x80`）を予約するのは1.61以降だけなので、それより前のバージョンのファイルはどちらの機種としても認識されずMega Driveの分岐に落ち、そこで自身のヘッダーチェックにより失敗します。クロックフィールドがヘッダーの前方にあるMega Drive自身は、1.50〜1.71の全範囲を保ちます。

**理由。** `PerformancePlan.memory`と`renderPerformance`を変更せず再利用することで、アレンジャー自身の譜面とインポートしたVGMは、いったん解析された後は区別できなくなります。これは決定21がどのパフォーマンスプランにも求めている性質と同じです。未知のバイトを読み飛ばすのではなく拒否対象に名前を付けることは、既存のMega Driveインポーターと一致し、呼び出し側が半端に読めたファイルを完全なものと取り違えないようにします。

**変わること。** `packages/chipvoice/src/vgm-import.ts`は既存のMega Driveの分岐に加えてNESの分岐とGame Boyの分岐を持つようになり、両方をパッケージのREADMEと各チップのシート（[2a03_ja.md](chips/2a03_ja.md#vgm-import)、[dmg_ja.md](chips/dmg_ja.md#vgm-import)）に記載しました。Nes_Snd_Emu／MesenとGb_Snd_Emu／SameBoyに対し、自己制作でラウンドトリップしたコーパスで採点しました。市販ゲームのリップはここにコミットしません。

<a id="45-the-spc700-and-s-smp-stay-mit-the-ipl-roms-64-bytes-are-the-one-embedded-exception-2026-09-27"></a>
## 45. SPC700とS-SMPはMITのままで、IPL ROMの64バイトだけが同梱された例外（2026-09-27）

NEXT-08は`chips/snes/spc700.ts`（CPU）と`chips/snes/ssmp.ts`（タイマー、I/Oポート、DSPアドレス/データのラッチ）を加えます。どちらもAnomieのSPC700資料とfullsnesから、`SPC_CPU.h`とは別の自分の構造で書かれています。どちらも、決定17が`ym2612.ts`と`sdsp.ts`について引いた線を越えません。snes_spc自身のCPUのコードはどちらのファイルにも取り込まれておらず、snes_spcの`SPC_CPU.h`は、決定41がすでに許すとおり、`packages/conform`の中でネイティブにビルドされた参照（`play-spc.cpp`）としてのみ動きます。したがって`chips/snes/*`はこれまでと変わらずMITのままで、これは3つ目のLGPLの例外ではありません。

**唯一同梱された例外。** `ssmp.ts`は`IPL_ROM`をエクスポートします。CONTROLのビット7が立っているときにRAMの上に重なる、$FFC0-$FFFFの実機の起動用64バイトです。`.spc`スナップショットは起動状態ではなく曲の途中の凍結状態ですが、スナップショット自身のコードが起動ベクタへ戻ることや、ROMビットを立てたまま$FFC0-$FFFFをデータとして読むことを止めるものは何もありません。この64バイトはAnomieの資料とfullsnesの両方が、ハードウェアを記録する一部として一バイトずつ公開しているもので、このチケットのほかのすべてのオペコードの周期やレジスタのビットと同じやり方で出典を得ており、snes_spcや他のどのエミュレーターのソースから取ったものでもありません。`spc700.ts`/`ssmp.ts`の中で、chipvoice自身の書き下ろしのコードでない唯一のバイト列がこれです。周りのすべて(CPU、タイマー、レジスタの振り分け、スナップショットの読み込み)は書かれたもので、コピーされたものではありません。

**同梱を選び、要求にしなかった理由。** 呼び出し側にROMを渡させ、既定はなしにする案も検討しましたが、このチケットに限っては見送りました。知られているどの`.spc`ファイルも、この同じ64バイトがそこにあることを前提にしているためです。ROMなしでそれを読む、あるいは実行するスナップショットは、作り話のファイルだけでなく、実在するすべてのファイルで失敗します。サンプル集やフォントとは違い、このROMは省略可能な部類のものではありません。よく公開されているこのバイト列をそのまま同梱することは、出典をごまかす近道ではなく、正しく実装できる最小のものです。

**必要になった場合の外し方。** `IPL_ROM`が参照されるのは`loadSnapshot()`と`read()`の2箇所だけです。この定数を外すなら: (1) `Ssmp`のコンストラクタか`loadSnapshot()`が、モジュール定数の代わりにインスタンスへ保持する、任意の`iplRom?: Uint8Array`（64バイト)を受け取れるようにする。(2) $FFC0-$FFFFがROMビットつきで読まれ、ROMが渡されていないとき、`read()`が`IPL_ROM`を素通しで返す代わりに、名前つきのエラー(例えば`SpcIplRomRequiredError`)を投げる - 黙って0やRAMを返すのではなく。(3) `importSpc`自身が任意の`iplRom?: Uint8Array`を受け取り、`Ssmp`へそのまま渡す。いまと同じ動きを保ちたい呼び出し側は、パッケージがもはやこの64バイトを同梱しないため、自分でその64バイトを渡すことでだけ動き続ける。何も渡さない呼び出し側は、スナップショットがROMビットつきで$FFC0-$FFFFを読むか実行した瞬間、黙った代替ではなく、(2)と同じ名前つきのエラーを受け取る。これは書き下ろしただけで実装はしません。今日それらを外すことを求めるものは何もなく、Sony製でないROMのSPC700を求めた呼び出し側もありません。

**変わらないこと。** `packages/chipvoice`のライセンス欄は`(MIT AND LGPL-2.1-or-later)`のままで、このファイルによって変わりません。LGPLの側が名指すのはこれまでどおり`ym2612.ts`と`sdsp.ts`だけです。パッケージのREADMEは、`importSpc`の隣に`IPL_ROM`の出典を記します。

<a id="46-the-exported-spc-carries-its-own-tiny-spc700-player-assembled-from-ts-source-in-the-repo-2026-09-28"></a>
## 46. 書き出した.spcは、リポジトリのTSソースから組み立てた自前の小さなSPC700プレイヤーを同梱する（2026-09-28）

P6-9は`exportSpc`（`packages/chipvoice/src/spc-export.ts`）を加えます。SNES曲のレジスタ書き込みキャプチャを、標準的な`.spc`スナップショットへ凍結するものです。`.spc`ファイルを開く実機やプレイヤーの上ではchipvoice自身は何も動かないため、書き込みを実機のSPC700自身の上で再生する何かが必要です。スナップショット自身のARAMが、その役目を担う小さなプレイヤープログラム(`chips/snes/spc-player.ts`)を同梱します。次のtickデルタを読み、ハードウェアタイマーでその分だけ待ち、次の`$F2`/`$F3`ペアを発行し、繰り返し、曲のループ点へ永遠に戻ります。

**外部で組み立てず、自分で書いた理由。** このチケットは、プレイヤーのソースがリポジトリの中で読める状態のままであること、TS側のバイト列がコミット済みソースからCIが走らせられるスクリプトで再現できること、不透明なブロブではないことを求めていました。`spc-player.ts`の`buildPlayerProgram`は小さなTSエミッタです。SPC700のオペコードとオペランドを注釈つきのバイト列として書き出し、書き出し時にchipvoice自身が組み立てます。サードパーティのアセンブラの出力をそのまま同梱したり信用したりする必要はありません。これは決定45のIPL ROMの例外の繰り返しではありません。ここには他のエミュレーターやSony自身のドライバコードからコピーしたものは何もなく、記録すべきライセンス上の論点はありません。あるのはただ、TypeScriptが作り出した(MITの)組み立て済みSPC700マシンコードという、将来の読み手がバイナリのブロブと見誤らないよう名前をつけておく価値のある、少し変わった成果物です。

**タイマー、tickの速さ、量子化。** プレイヤーは自分自身をS-SMPのTimer 0で計時します。`TIMER_TARGET = 8`を8000Hzの入力に対して使い、毎秒1000tick(`chips/snes/spc-player.ts`の`TICKS_PER_SECOND`)になります(`SPC_HZ / TICKS_PER_SECOND`はちょうど1tickあたり1024サイクルです)。キャプチャした各書き込みのサイクルの刻みは、再シミュレートする前に最も近いtickへ丸められます。`exportSpc`は、書き出し中に組み立てたプレイヤープログラムの上で、このパッケージ自身のSPC700のもう一つの使い捨てインスタンスを実際に走らせます。そのため出荷されるtickデルタの列は、実機のSPC700が待ちループとディスパッチを実行したときに各書き込みの目標tickを実際に再現するものであり、プレイヤー自身の命令コストを無視した見積もりではありません。

**書き込みが自身の丸められたtickへどれだけ近く着地するか。** 丸めだけが約束するのは半tickですが、実際のプレイヤーは書き込みが本当にDSPへ届くまでに自前のディスパッチループを歩く実サイクルを費やし、密な同一tickのバースト(和音や、多くのボイスのレジスタを一度に触る楽器の再トリガー)は、共有できるDMAのない単一の実CPUの後ろに多くの書き込みを並ばせます。合成ユニットテストと実際の曲の両方で計測すると(`packages/chipvoice/test/spc-export.mjs`、marioとzeldaは独立に同じ値へ収束します)、最悪ケースは約1993〜1998サイクル、2tickをわずかに下回る程度で、曲の長さに応じて増えません。これは、曲がどれだけ長く続くかではなく、1つの本来同時だったグループが触れるレジスタの数に境界づけられています。バーストループ自身の概算境界(レジスタ1本あたり約12サイクル、1tickは1024サイクル)を見ると、1tickに収めるには丸めの余裕を一切残さずに1グループあたり約85レジスタ未満である必要があり、このドライバー自身のディスパッチコストが実際のコンテンツで到達できる目標ではなく、これ以上追いかけるべきバグでもありません。テスト自身の境界は3tickに設定しています。実測された約2tickの上限に対する実質的な余裕であり、このチケットの当初望まれていたより厳しい値ではありませんが、無理に合わせるのではなく正直に設定したものです。

**符号化。** 書き込みの列はtickデルタと`{reg, value}`ペア、同一tickのレジスタ群向けの`$FE count (reg value)*count`バースト、そして(このチケットの最初のパス以降に加わった)`$FD`後方参照からなります。貪欲なLZ77式のマッチ(`MATCH_MIN_GROUPS = 2`個の連続するグループ)により、繰り返されるグループの並び(同じ和音の再トリガー、同じ楽器のエンベロープの再生)は、繰り返す代わりにすでに書き出し済みのストリームバイトを指し示せます。これはプレイヤー自身の`L_COPY_START`区間でデコードされ、曲ごとのロジックでアセンブル済みプログラムを太らせません。これにより、最初のパスの単純な符号化が残していたギャップの大半が埋まりました。`mario`(52991/65472バイト)と`zelda`(29623/65472バイト)はどちらも収まるようになり、`sonic`は依然として収まりません(自身のメモリレイアウトに対し57344バイトしか使えないところ82896バイト必要)。これは切り詰めるのではなく、`SpcExportSizeError { measured, limit }`で実際のサイズを示して大きな声で失敗します - `validateSong`が他所ですでに容量を報告するやり方に合わせたものです。より密な符号化(値の辞書、曲をまたいだマッチ)も検討しましたが、除外したのではなく先送りにしました。今日残る唯一の失敗は、黙ってではなく名前つきで測って報告される、というのがこのチケットの基準でした。

**オラクル比較が見つけ、両方とも修正した2つのバグ。** 1つ目は、生きているS-DSPのエコーバッファ(`ESA`/`EDL`)が、書き出し用の第二の使い捨てSPC700がプレイヤープログラムを再シミュレートしている間にDSP自身の判断でこの同じスクラッチARAMへ書き込むというもので、後方参照パスが同じRAMからストリームバイトを読み戻すと、エコーハードウェアがすでに上書きしたバイトを読んでしまうことがありました。修正は、キャプチャ自身の`ESA`/`EDL`/`FLG`書き込みがエコーを送り得るすべてのフットプリントを追跡し(`inEchoFootprint`)、`pokeStream`の中でそのフットプリント内のどのバイトも信用・再利用しないようにすることです。単純なオーバーフローと同じ`SpcExportSizeError`の経路であり、黙った誤読にはなりません。2つ目は、ループ前の最後の待ち(最後の書き込みからループ点までの間隔)が自身のtick数を`Math.round`で丸めていたため、切り捨て方向に丸まってシミュレートしたプレイヤーが到達すべきループ点にわずかに届かず待ちを終えてしまうことがあった点です。`Math.ceil`に変更し、「ループ点に少なくとも到達するまで待つ」という本来の要求に合わせました。

**エンベロープ相関のウィンドウ幅。** `check-export.mjs`は、音声の忠実度を生のサイクル完全一致比較ではなく音声ごとのRMSエンベロープ相関で採点します。自身のtickに正しく丸められた書き込みでも、量子化されていないレンダーに対してDSPのオーディオレートの波形は位相がずれ、位相だけで同一の音を比べると、ほぼ完全に異なるものとして採点されてしまうためです。ウィンドウ幅は重要で、実際の両曲で1・2・4tickにおいて計測すると(`ENVELOPE_WINDOWS_TICKS`、これは過去の記録としてではなく毎回の実行で報告されます)、正しい書き出しは1tickでの約0.72〜0.85から4tickでの0.91〜0.96まで上昇し、リスナーが別々のタイミングと知覚できるものよりはるかに下にありながら、なお上昇し続けます - これは実際の不一致ではなく、解像度不足の位相効果の兆候です(実際の不一致であれば逆にウィンドウが広がるにつれて相関は下がるか横ばいになります)。4tickをゲートとして採用しているのは、上記の理由により細かいウィンドウでは`ENVELOPE_MATCH_THRESHOLD = 0.95`が厳しすぎるためであり、1tickや2tickで書き出しが誤っているからではありません。

**オラクル比較：書き込みはサイクル完全一致、そしてサンプルも今はサイクル完全一致になった。** 同じレビューの2巡目で、オラクルの書き込み比較を内容だけでなくサイクルも検査すること、そしてオラクルのサンプル側のギャップ（生のサイクル完全一致で17-31%）を、修正するか、根拠のない「位相」という主張のままにせず数値つきで説明することが求められました。3巡目では、そのサンプル側のギャップ自体を、これ以上特徴づけるだけでなく、別の原因が見つかるなら実際に埋めることが求められました。3つとも今は満たしています。

blarggが蓄積したsnes_spcを直接読むと（`SNES_SPC.cpp`の`run_timer_`）、その遅延タイマーモデルに一度だけ生じる本物のクセが見つかりました：`elapsed = TIMER_DIV(t, time - t->next_time) + 1`という式と、`reset_time_regs()`がスナップショット読み込みのたびに各タイマーの`next_time`を1にリセットすることの組み合わせにより、読み込み直後最初の呼び出しは、実際に経過したサイクル数がどれほど少なくても、プリスケーラの1周期が丸ごと経過したことに必ずなってしまいます。下の回帰用フィクスチャ（`timer-phase.spc`、タイマー0を周期1、つまり通常テンポで128サイクルの1プリスケーラ周期に設定）で確認済みです：修正前は、blarggのCPUはタイマー0のカウンタをすでに非ゼロだと見なし、スナップショットからわずか15サイクルでその唯一の書き込みを行ってしまい、1周期が実際にかかる128サイクルにはまったく届きません。本実装自身のサイクル単位モデルは、同じファイルからその同じ書き込みにサイクル140でようやく到達します。3巡目はこれを、名前を付けるだけでなく発生源で修正しました：蓄積済みオラクルに載せた読み込み時のシム`fix_snapshot_timer_phase()`を、スナップショット読み込み直後に一度だけ走らせることで、blargg自身のタイマーが実機と同じ位相で始まるようにし、プリスケーラ1周期分先行した状態から始まらないようにします - この修正により、オラクルの書き込みはサイクル141に現れ、本実装自身の140より1サイクル遅れます（`check.mjs`自身のドキュメントコメントが既に名指ししている、同じプリチャージ由来のラベリングの違いであり、別の問題ではありません）。この最小限の回帰用フィクスチャ（1回の書き込み、1つのタイマーターゲット）が、既存のコーパスと並べて`check:spc`にこの修正を固定し、将来蓄積済みオラクルへの変更がこの一度きりの跳躍を静かに再発させないようにしています。`check:spc`は今、2ファイルとも100.0000%（3072000/3072000サイクル）です。

この修正により、残っていた書き込みサイクルのオフセットは、今回新たに見つかったもう一つの、より狭い境界の現象一本に絞られました：書き出したプレイヤーはタイマー0自身の出力レジスタをタイトなループでポーリングしており、blarggの遅延タイマー追いつき式と本実装自身のサイクル単位のタイマーモデルは、「この境界サイクルはもう経過したか」という判定を、ポーリング自身のディスパッチオーバーヘッドによる位相ドリフト（決して積み重ならず、次の待機のたびに再同期します）がタイマー0のプリスケーラ境界を誤ったタイミングでまたいだときに限り、1サイクルだけ食い違って判定します。その結果、blargg側のポーリングは7サイクルの「まだ待機中」という反復を丸ごと1回分早く抜けます。構成によって証明済みです（孤立した待機を1回だけでは絶対に再現せず、待機と書き込みを繰り返すループでは決定的に再現します）し、このコーパスで網羅的に確認済みです（`mario`と`zelda`のどちらでも、全ての書き込みがこの2つの値のどちらか一方しか取りません）。`check-export.mjs`の`compareOracleWrites`は今、両方の値に名前を付け（`WRITE_CYCLE_OFFSETS = [1, -6]`、前回の巡目が名付けた単一オフセットのゲート`T0_STAGE1_PERIOD`を、この厳密な二値のゲートへ一般化したもの）、それらに厳密に合否判定します - 余裕も累積カウントもありません。

本実装自身のDSPを、本実装自身のCPUが独立に導出した書き込みサイクルではなく、blargg自身の実際の書き込みサイクル（`oracleWrites`、上で既に厳密だと示したもの）で駆動することで、このサンプル比較を本来問うべきただ一つの問い - *同じ*刺激が与えられたとき、S-DSPコアは*同じ*出力を計算するか - に絞り込み、CPUタイミングという変数を完全に取り除きます。それでもなお、一つの狭い現象が残っていました：blarggの`SNES_SPC.cpp`はDSPを遅延的に追いつかせており（`RUN_DSP`マクロは`dsp_write`/`dsp_read`/`end_frame`自身の最後の追いつき呼び出しからしか実際には走りません）、そのため`play-spc`のワンショットのレンダリングは、カットオフちょうどでの内部の位相の揃い方次第で、本実装自身の末尾の`SAMPLE_OUTPUT_CYCLES`ぶんの出力サンプルを書き出し切ることも切らないこともあり得る一方、本実装自身のサイクル単位のDSPモデルは常にそれを計算して含めます。`zelda`（カットオフまでにテールがまだ無音に減衰していなかった唯一の曲）で直接確認しました：本実装自身の最後の記録済みサンプルは、blargg自身の最後の記録済みサンプルからちょうど`SAMPLE_OUTPUT_CYCLES`ぶん先、つまりレンダリングの文字通り最後のサイクルにあり、それ以外のどこにもありません。`ORACLE_TAIL_TRIM_CYCLES`は、この末尾の1周期分だけをオラクルのサンプル比較から除外します。これにより、`mario`と`zelda`のどちらも参照実装側でちょうど100.0000%のサイクル完全一致（`identical === cycles`）に達し、`check:spc`が自身の比較に既に使っている基準と同じになります。エンベロープ相関と音符タイミングの一致度は、参照実装側でも引き続き報告されますが合否判定には使いません - これらは今回の巡目より前にこのファイル自身が使っていた合否基準であり、書き込み比較が名指ししたCPUタイミングの差が、これらが既に許容していたものとちょうど同じであって、別の未発見の問題ではないことを示す証拠として残しています。

`check-export.mjs`は今も、ラウンドトリップ自身のタイミングを直接合否判定します（各書き込みの実際のサイクルと`exportSpc`が丸めた先のティックとの最大のずれを、ユニットテストが導出するのと同じ3tickの上限で、`mario`と`zelda`で直接測定：それぞれ1998サイクルと1993サイクル、約1.95tick、今回の巡目でも変更なし）。また`--self-test`モード（CIには`check:spc-export:self-test`として、これまでCIで一度も走っていなかった`check:spc`自身と並べて組み込み済み）は、各ゲートについて肯定的なテストと否定的なテストの両方を行います：書き込みサイクルのゲートは名前を付けた2つの値のどちらも（素の`+1`だけでなく`-6`のケースも）そのまま受け入れ、どちらの値からも1サイクルずれたものは棄却します。新しい厳密なサンプルのゲートは同一の2つのストリームを受け入れ、1つのサイクルの1つのサンプルだけをずらしたものは棄却します。ラウンドトリップのタイミングとエンベロープ相関のゲートは、既存の否定的なテスト（ラウンドトリップのタイミング上限を外れた書き込み、脱落したボイス）を今回の巡目でも変更せずそのまま保っています。

**変わること。** `packages/chipvoice/src/spc-export.ts`と`chips/snes/spc-player.ts`が新規に加わります。`exportSpc`と`SpcExportSizeError`がパッケージの索引からエクスポートされます。`projectCapabilities()`は、SNESの`registerExportFormats`のエントリとして`spc`を報告します。`apps/web/src/studio/exports.ts`は`spc`書き出し種別を得ます。これらはどれも、決定45の`spc-import.ts`、`spc700.ts`、`ssmp.ts`には触れません。`packages/conform/src/spc/check-export.mjs`のCIチェックは、`importSpc`を通した往復と、書き出したファイルそのものに対する`play-spc`自身の再生との直接比較の両方で、プレイヤーの書き込みがキャプチャの置いた場所へ実際に届くことを証明します。3巡目は、蓄積済みオラクル自体（`packages/conform/oracles/snes-spc/`）にも触れています：`fix_snapshot_timer_phase()`という読み込み時のシムと、`play-spc.cpp`の`g_sample_cycle`出力フック修正、そして新しい`timer-phase.spc`回帰用フィクスチャと、それに対する`check.mjs`の`checkTimerPhase`アサーションです。`.github/workflows/ci.yml`は`conformance`ジョブに2つのステップを追加します：`check:spc`(これまで書かれてはいたもののCIでは一度も走っていませんでした)と、新しい`check:spc-export:self-test`です。

<a id="47-server-code-shared-between-the-apps-moves-into-web-kit-2026-09-28"></a>
## 47. アプリ間で共有するサーバーコードをweb-kitへ移す（2026-09-28）

新しいプライベートなワークスペースパッケージ`packages/web-kit`は、chipvoice.dev（`apps/web`）とこのモノレポの2つ目のアプリの両方が必要とするサーバーコードを保持します: 暗号（`hashKey`/`newId`/`secret`）、HTTPルートのエンベロープ、インメモリのレートリミッター、SSEのパース、データベースファクトリー（接続、マイグレーション、ウィンドウ制の受け入れ）、デバイスフローのエージェント認可（RFC 8628、およびRFC 8414/9728のディスカバリー）、MP3/ID3の音声エンコードとバイト範囲ストリーミング、OpenAPI仕様から組み立てるエージェントツールマニフェスト、そしてロケール/翻訳のコアです。`apps/web`は他のワークスペースパッケージと同様にこれへ依存し、決定37に従い、そのユニットテストは`node --test`の下で走ります。

**理由。** 2つ目のアプリは自分自身のアカウント、レート制限、エージェント認可、音声書き出しを必要とし、chipvoice版をそのままコピーして進めれば、どちらかがテーブル名やトークンのプレフィックスを変えた瞬間にドリフトしてしまいます。上記のすべては、chipvoiceがたまたまハードコードしていた具体的な値 - テーブル名、クッキー名、トークンのプレフィックス、既定の階層別予算 - を除けば、重要なあらゆる点ですでにアプリに依存しないものだったため、各モジュールはそれらの値を引数として受け取るファクトリーまたは設定オブジェクト（`createDb`、`createAgentAuth`、`createRoute`、`createLocaleHelpers`/`createI18nReact`、`agentManifest`）になりました。

**変わること。** `apps/web/src/lib/db.ts`、`migrations.ts`、`limit.ts`、`project-http.ts`、`agents.ts`、`auth.ts`、`oauth.ts`、`agent-tools.ts`、そして`apps/web/src/i18n/core.ts`/`react.tsx`は、いまや`web-kit/*`の上に乗る薄い設定用のシムであり、どの呼び出し側もすでに使っていた形のまま変わりません。`apps/web/src/lib/crypto.ts`と`sse.ts`は完全に不要になったため削除され、呼び出し元は`web-kit/crypto`と`web-kit/sse`を直接指すようになりました。`web-kit/agent-auth`の汎用的な戻り値のうち2つは、所有リソースを`ownerId`という名前で表します。chipvoiceの外部エージェントAPIはこれらのレスポンスボディで一貫して`profileId`（デバイスフローのポーリングでは`profileUrl`も）を返してきたため、`apps/web/src/lib/agents.ts`は汎用の形をそのまま再エクスポートするのではなく、この2つのフィールドを読み替えます。これにより、すでに依存しているすべてのエージェントクライアントに対して、ワイヤーフォーマットはバイト単位で変わりません。テーブル名、マイグレーション名とその順序、`cv_agent_`/`cv_live_`/`cv_session_`のトークンプレフィックス、そしてchipvoice自身のルートからスコープへの認可ポリシー（`authorizeAgent`）はすべて以前のまま保たれ、一般化して失われるのではなく、設定として共有ファクトリーへ渡されます。`turbo.json`の既存の`dependsOn: ["^build"]`は、turboを通る`pnpm build`/`pnpm typecheck`であれば`apps/web`より先に`web-kit`をビルドしますが、turboの依存グラフを完全に迂回する`pnpm --filter`でパッケージのスクリプトを直接呼び出すわずかな箇所ではそうなりません: `.github/workflows/ci.yml`の`unit`ジョブは、`apps/web`のレンダーワーカーをバンドルする前に`web-kit`を明示的にビルドするようになり、`test-generation.mjs`/`scripts/eval-composition.mjs`は、置き換えられた相対パスではなく、パッケージ名で`web-kit/sse`を参照します。`.github/workflows/e2e.yml`の`deployment_status`トリガーは、`environment_url`ではなく`deployment.environment`をchipvoice自身の既知の値と比較してチェックします。実際のGitHubのデプロイメントでは、`environment_url`はこのリポジトリに紐づくどのプロジェクトも同じように持つ、デプロイのたびに変わるVercelのエイリアスであり、プロジェクトを見分けられる固定値では決してないため、2つ目のアプリ自身の本番デプロイがchipvoiceのエンドツーエンドスイートを一緒に起動させないようにする役目は、`environment_url`には担えません。

**変わること。** `apps/web/src/lib/db.ts`、`migrations.ts`、`limit.ts`、`project-http.ts`、`agents.ts`、`auth.ts`、`oauth.ts`、`agent-tools.ts`、そして`apps/web/src/i18n/core.ts`/`react.tsx`は、いまや`web-kit/*`の上に立つ薄い設定シムとなり、どの呼び出し元もすでに使っていた形のまま変わりません。`apps/web/src/lib/crypto.ts`と`sse.ts`は完全に冗長になったため削除され、その呼び出し元は`web-kit/crypto`と`web-kit/sse`を直接指すようになりました。`web-kit/agent-auth`の汎用的な戻り値のうち2つは、所有するリソースを`ownerId`と呼びますが、chipvoiceの外部向けエージェントAPIは、この正確なレスポンス本文において常に`profileId`（デバイスフローのポーリングについては`profileUrl`も）を返してきたため、`apps/web/src/lib/agents.ts`は汎用の形をそのまま再エクスポートするのではなく、この2つのフィールドを付け替え、すでに依存しているすべてのエージェントクライアントに対してワイヤーフォーマットをバイト単位で変えないようにしています。テーブル名、マイグレーションの名前と順序、`cv_agent_`/`cv_live_`/`cv_session_`のトークンプレフィックス、そしてchipvoice自身のルートからスコープへの認可ポリシー（`authorizeAgent`）は、すべて共有ファクトリーへ設定として渡すことで、一般化されずにそのまま残っています。`turbo.json`の既存の`dependsOn: ["^build"]`が、追加の配線なしに`apps/web`より先に`web-kit`をビルドします。`.github/workflows/e2e.yml`の`deployment_status`トリガーは、`environment_url`が`https://chipvoice.dev`で始まることも確認するようになったため、2つ目のアプリ自身の本番デプロイが、共有された既定の"Production"環境名の下でchipvoiceのエンドツーエンドスイートを誤って起動することはありません。

<a id="48-a-hardware-verified-source-outranks-a-second-undocumented-oracle-that-merely-agrees-2026-09-28"></a>
## 48. ハードウェア検証済みの情報源は、それに同意するだけの、裏付けのない第二のオラクルに優越する（2026-09-28）

NEXT-15のAY-3-8910/YM2149コアには17ビットノイズLFSRのフィードバックタップが必要でしたが、nesdevのSunsoft 5Bページは「ビット16と13にタップを持つ17ビット線形帰還シフトレジスタ」という一文しか与えておらず、擬似コードはありません。この決定は、裏付けのある答えにたどり着くまでに2つの誤った道を通っており、最後の状態だけでなく3つの状態すべてを正直な経緯として記録します。

**1つ目の誤り。** このチケットの初期のバージョンの作業は、Ayumiの`update_noise`（`oracles/ayumi/ayumi.c`、`bit0 ^ bit3`という1つの新しいビットを計算しビット16に挿入する - フィボナッチ形式の構成）を、nesdevの「ビット16と13にタップ」（16-13=3）の等価な言い換えだと読み、その2つが実際に同じ漸化式であるかを確認せずに`Ay8910`自身のジェネレータを同じ式で書きました。

**2つ目の誤り。** このチケットの後の巡目でその前提を確認し、誤りだと判明しました：徹底的な探索（挿入ビット13〜16のすべて、XORタップ1〜16のすべて、出力ビット0〜16のすべて）を行っても、Ayumiのフィボナッチ形式をどう並べ替えても「ビット16と13にタップ」という文字通りの読み方 - シフトアウトされたビットを2つの絶対ビット位置に直接XORで供給する、ガロア形式の構成（`(uMinus(lfsr & 1) & 0x12000) ^ (lfsr >> 1)`、最大長であることを確認済み：シード1から周期131071）- のビット0系列を再現できませんでした。Game_Music_Emuの`Ay_Apu`は偶然にもこの同一のガロア式を実装しており、独立に書かれたものであったため、このチケットはこれを文字通りの読み方への裏付けと受け取り、`Ay8910`をそれに合わせて書き直しました。その裏付けは見た目ほど強くありませんでした：文字通りの読み方にせよGame_Music_Emu自身の式にせよ、実機のAY-3-8910/YM2149で検証されたことがあるという根拠は、当時見つかったものの中にはありませんでした - これは事実の独立した確認ではなく、曖昧な一文についての1つの(裏付けのない)文字通りの読み方に、1つの裏付けのないエミュレータが同意していただけだったのです。

**裏付けのある答え。** MAMEの`noise_rng_tick()`（`src/devices/sound/ay8910.h`、ライセンスBSD-3-Clause、Couriersud）ははっきりと述べています：「8910の乱数生成器は17ビットのシフトレジスタである。シフトレジスタへの入力はbit0 XOR bit3（bit0が出力）である。これはAY-3-8910とYM2149の実チップで検証済みである」。コードでは：`m_rng = (m_rng >> 1) | ((BIT(m_rng, 0) ^ BIT(m_rng, 3)) << 16)`、出力は`m_rng & 1` - フィボナッチ形式で、まさにAyumiの構成そのものであり、この調査でこの特定のジェネレータについてハードウェア検証を主張する唯一の情報源です。「タップ」という語自体がフィボナッチ型シフトレジスタの語彙です（ガロア型LFSRは通常、帰還多項式やXORマスクで説明され、「タップ」とは呼ばれません）。そのため、nesdev自身の文言は実際にはガロア方向にこの問いを決着させておらず - むしろその逆に傾いています - これは2つ目の誤りが前提としていたことでした。MAMEの引用と比べると、Game_Music_Emuがガロアの読み方に同意していることはもはや何の裏付けにもなりません：これは正真正銘のタイでの2つの独立した参照実装ではなく、1つのハードウェア検証済みの情報源に対する1つの裏付けのないエミュレータでしかなかったのです。`packages/chipvoice/src/chips/ay8910.ts`の`tick()`は現在フィボナッチ形式を実装しており、Ayumiと正確に一致しています。`ay8910`の`core`/`edge`コーパス全体が、ノイズを含む全スクリプトを含めてAyumiに対して厳密一致でゲートされています（`docs/chips/sunsoft5b.md`の「オラクルが不一致の箇所」、`oracles/ayumi`自身の「既知の限界」 - 今は空です）。

Game_Music_Emu自身のノイズとトーンのタイミングは、LFSRの問いとは無関係に、別の、これも実測済みの理由で厳密一致にはゲートできません。その自身のソースは「エンベロープとノイズの周期への変更は次のリロードまで遅延する」を既知の不正確さとして挙げており、`Ay_Apu`のトーン周期書き込みは、書き込み時点でディバイダの位相をきれいに再始動するのではなく、リセット時のデフォルト（`period_factor`、クリーンなゼロではない）から位相のデルタを持ち越します - この決定が記録する調査の中で`run_until`を直接計装し、サイクル番号込みで確認済みです。本物の書き込みの前にセトル用の書き込みを1つ挟むと、結果のオフセットはトーン単独、ノイズ単独では一定かつ周期に依存しなくなります（両方同時では成立せず、後からのストリーム途中での周期の書き換えをまたいでも成立しません - GME自身の「次のリロードまで遅延」という注記がその理由を説明します）が、決定41のsawtooth補正がしているようにセトル依存の補正をオラクルのラッパーに焼き込むことは、たまたまその特定の慣習に従っていないコーパススクリプトに対しては黙って誤りになるため、このチケットはそれをしません: `game-music-emu-ay`の「core」役は、発振器のタイミング依存が一切ないログ（トーンとノイズの両方を止め、チャンネルがボリュームレジスタだけを通じた単純な4ビットDACとして振る舞う、両オラクルに対してセトルなしで厳密一致が確認されたもの）に限定され、それ以外のすべての場所では`--report`のみです。ノイズを含むログについては、タイミングに加えてLFSRの構成そのものについても一致しない、という理由が今は重なっています。

**理由。** ある第二の実装がある読み方に同意していることは、その第二の実装自身の主張そのものに裏付けがある場合に限って裏付けとなります。裏付けのない2つのエミュレータが互いに同意していることは、1つのハードウェア検証済みの言明と同じ強さの証拠ではなく、このチケットはそのことを直接のやり方で学ぶのに2つの誤った道を費やしてから、それを決着させる一次資料を探しました。1つ目の未確認の思い込み、2つ目のより良いが依然として誤っていた推論、そして裏付けのある訂正という3つの状態すべてを記録しておくことが、後続のチケット（MSXのAY-3-8910ホスト、YM2203/2608のSSG半分 - どちらも`ay8910.ts`自身のクラスdocコメントで将来のホストとしてすでに名前が挙がっている）が、この決定がすでに集めた情報より少ない情報で同じ問いを蒸し返したり、どちらかの誤りを繰り返したりせずに済むようにします。

**変わること。** `packages/chipvoice/src/chips/ay8910.ts`のノイズLFSRフィードバック式（MAMEを引用したフィボナッチ形式、Ayumiと一致 - このチケットの前回のレビュー時点でのガロア形式ではありません）。`packages/conform`の`check:ay8910-edge`は、`--exclude`をもう必要とせず、`edge`コーパス全体をAyumiに対して厳密一致でゲートします。`check:ay8910-edge-gme-report`（Game_Music_Emu、報告専用）は変わらず報告専用のままですが、今や理由が1つではなく2つになっています。決定41自身のsawtoothの場合と異なり、トーンやノイズのタイミングに対する自動的なオラクル間補正は導入しません。根底にあるオフセットがオラクル自身の固定された性質ではなく、慣習依存だからです。

<a id="49-gamesoundsai-ships-phase-1-an-agent-first-sound-effects-bank-the-monorepos-second-app-2026-09-28"></a>
## 49. gamesounds.aiがフェーズ1を出荷：エージェント優先の効果音バンク、モノレポの2つ目のアプリ（2026-09-28）

`apps/sounds`（gamesounds.ai）と`packages/gamesounds`は、パックではなくイベント単位でファイルされたゲーム効果音バンクを出荷する：52カテゴリ（タクソノミー全85のうち - 最上位9ブランチは純粋なハブで、すべての音はリーフに登録される）にわたる220音、10あるスタイルの側面のうち2、すべて`CC0-1.0`、ループフラグは1つもない。gamesoundsは私たち自身のサウンドバンクである：すべての音はchipvoice自身の`renderSfx`によって生成され - 第三者の音は無く、外部の生成APIも使わない - そのため、すべての音のライセンスは実行時のフィルターではなく構造によって成立する。タクソノミーの他のスタイルの側面（`realistic`や`fantasy`のようにどのチップもレンダーしないもの）とタクソノミーの残りの部分は、今日は音が0のまま定義され、`docs/BACKLOG.md`でGS-02として追跡されている手続き的合成エンジンのために予約されている - 厳選された第三者パックのためではない。人はサイトを閲覧し、エージェントはREST APIを直接呼ぶか、`npx gamesounds add <event...>`を実行して、アカウントも鍵も無しに`sounds.json`と音声ファイルを自分のプロジェクトへ取り込む。

**理由。** このブランチを開いたブリーフが求めていたのは、エージェントが無人で使えるSFXバンクだった：人がまず候補を試聴することなく、ゲームイベントをライセンス済みでラウドネスの揃った音に解決し、そのまま再生できること。これはchipvoice.dev（1つのエンジンで一度に1曲）とは異なる形の製品であり、異なるデータモデル（作曲ではなく、イベントでインデックスされたカタログ）でもある。そのため、最初のアプリに追加したページではなく、2つ目のアプリであり、2つ目の公開可能なパッケージ（`gamesounds`、自身のCLIとランタイムのため）である。`packages/gamesounds`はワークスペース内の他の何にも依存しないため、これをインストールするエージェントがchipvoice自身のエンジンやデータベースのコードを引き込むことは決してなく、`apps/sounds`はこのパッケージ自身のビルドに依存するのではなく相対パスでその型をインポートするため、このアプリのCIジョブは`packages/gamesounds`を先にビルドする必要が一切ない。

**変更内容。** カタログビルド（`apps/sounds/scripts/build-catalog.mjs`）は、チェックイン済みのタクソノミー（`catalog/taxonomy.json`）とイベント/チップごとのレシピ（`catalog/chipvoice-recipes.mjs`）に対して`renderSfx`（chipvoice自身のオフライン単一エフェクトレンダー、`b649b54`）を呼び出し、各テイクをゼロ交差でトリムして文書化されたフェードを付け、ラウドネスを測定し（モーメンタリー最大-18 LUFS、トゥルーピーク <= -1 dBTP）、先頭無音10ms超やクリッピングのあるものを拒否する。否定的テストが、各チェックが実際に不良ファイルを落とすことを証明する。すべてのバリアントは`.ogg`/`.mp3`/`.wav`にエンコードされ、`/f/<sha256>.<ext>`としてコンテンツアドレスで配信される - 1テイクの3形式は1つのファイル名ハッシュを共有し、それは正準WAV自身のSHA-256（`apps/sounds/scripts/lib/audio.mjs`の`encodeVariant`）であり、グループキーとして使われる。つまりそのアドレスに文字通りハッシュが一致するのは`.wav`だけであり、CLI自身のSHA-256検証（後述）はファイル名を信用するのではなく、そのWAVをメモリ上でのみ取得して主張を検証する。`sounds.json`（スキーマ`packages/gamesounds/schema/manifest-1.json`、draft 2020-12）は、マニフェストのすべての生産者と消費者が共有する唯一の契約である：`POST /api/v1/resolve`、`GET /packs/{id}`、そしてCLI自身が書き出すファイルは、すべて`buildManifest`の出力であり、`apps/sounds/test/manifest.test.mjs`は「見た目が正しそう」というだけでなく、実際のものを公開済みスキーマに対して検証する（加えてスキーマが拒否すべき3つのケースも検証する）。ランタイム（`packages/gamesounds/src/runtime.ts`）が独立したパッケージなのは、まさにエージェントが生成したゲームがサーバーを介さずに`import "gamesounds"`して音を鳴らせるようにするためだ：ラウンドロビンのバリアント選択、ピッチジッター、クールダウン、イベント単位とグローバルのボイス上限と優先度スティーリング、バスのダッキング、iOSのアンロックジェスチャー、そのすべてがブラウザではなく`packages/gamesounds/test/runtime.test.mjs`の偽`AudioContext`に対して駆動される。このスイートはこの決定で新規に追加され、何も出荷する前に本物のバグを発見した：`reserve()`のボイススティーリング処理は、奪われたボイスについて*トリガーした側*のイベント自身の`active`配列をフィルタしていたが、グローバル上限がトリガーされたのとは*別のイベント*から奪う場合これは何もしない操作になり、`PlayHandle.playing`がすでに停止済みのボイスに対して`true`を報告し続ける結果になっていた。奪われたボイス自身が属するイベントを先に調べてからフィルタする新しい`steal()`メソッドで修正した。`bin/gamesounds.mjs`はコンテンツハッシュでダウンロードし（ディスク上に既にあるファイルは決して再取得しない）、対象ディレクトリに既にある`sounds.json`を上書きせずマージし、サーバーのルート相対パスをマニフェスト自身の`"./"`ベースへ書き換えるため、書き出されたファイルは単体で持ち運べる。Playwrightを使わない統合テスト（`packages/gamesounds/test-cli.mjs`、`apps/sounds/test-smoke.mjs`のフラットスクリプト方式を踏襲）が、実際のローカルサーバーに対してこれを2回実行し、両方の振る舞いを検証する。サイト（`apps/sounds/src/app/[locale]`）は`<audio>`ではなくWeb Audioの上に構築された、キーボード優先の結果リストである（`/`で検索、`j`/`k`で移動、`space`/`1`-`8`で再生、`r`でランダムバリアント、`d`でダウンロード）。`llms.txt`、`skill.md`、`openapi.json`、`.well-known/mcp.json`はすべて1つの`openApiSpec()`から導出されており、APIの説明は1か所にしか書かれていない。Three.jsは出荷しておらず、投票ボタンもない：フェーズ1にはアカウントが無く、裏に何もない投票ボタンは無い方がましだからだ。`i18n`のルーティング（`/en`、`/ja`）は存在するが、ページのコピーはまだ`useT`に配線されていない - これは壊れた機能ではなく、正直に記録された削減である。詳細は`docs/BACKLOG.md`を参照。

<a id="50-gamesoundsai-stays-single-origin-and-gets-a-pre-launch-review-pass-blob-storage-per-file-hashes-a-variant-floor-a-full-cli-an-exponential-detune-fix-and-a-network-free-ci-gate-2026-09-28"></a>
## 50. gamesounds.aiは単一出自のまま、公開前のレビューを一巡する：Blobストレージ、ファイル単位のハッシュ、バリアント数の下限、フルスコープのCLI、指数関数的なデチューン修正、ネットワーク不要のCIゲート（2026-09-28）

PR #119がマージされる前のレビューで、このブランチが混在したカタログ（Kenneyの CC0 パックから厳選した音とchipvoice自身がレンダーした音が混ざったもの）を出荷しようとしていること、そしてブリーフとコードの間にいくつもの隔たりがあることが見つかった：出荷する音声がオブジェクトストレージではなくgitにコミットされていた、1つのハッシュがバリアント全体を覆っていて各ファイルを覆っていなかった、1つの音が何バリアントまで少なくてよいかの下限が無かった、CLIは`add`しか実装していなかった、デチューンの計算が指数関数的であるべきところを線形近似で済ませていた、そしてCIジョブはネットワーク無しにカタログ全体をビルドできなかった。これらすべてを、`main`に何も到達する前の、この1回のレビュー対応で修正した。

**理由。** より大きな問題はカタログの厳選半分の方だった：gamesoundsは私たち自身のサウンドバンクであり、Kenneyの音がchipvoiceの音と同じAPIの下に並ぶことは、「ここにあるすべての音は私たちのものだ」という主張を、いつか破綻するものとしてではなく、出荷した初日から偽にしていた。マージ前の今それを取り除くということは、マージ済みの履歴が後で後戻りしなければならない設計を一切運ばないということでもある - 上の決定49はすでに、このブランチが最初に運んでいた混在カタログではなく、実際に出荷される単一出自のカタログを記述している。レビューの残りは、ブリーフと最初の実装との間によくある隔たりだった：`docs/GAMESOUNDS.md`はファイル単位のコンテンツアドレッシング、3から5のバリアント範囲、フルスコープのCLI、実測から導かれたラウドネスの下限を約束していたが、コードはまだその約束を果たしていなかった。

**変更内容。**

- **第三者の音は無く、外部の生成APIも使わない。** `catalog/sources/*.json`とそのファイルリスト、`catalog/mapping.mjs`とそのテスト、`scripts/build-catalog.mjs`内のすべてのフェッチ/展開ステップを削除した。`Origin`は`"curated" | "chipvoice" | "generated"`から`"chipvoice" | "generated"`に狭まった。`"generated"`は削除せず、未使用のまま型に残し、下記のGS-02のために予約する - 第二の出自が実現するときにスキーマ変更を伴わないようにするためだ。`checkChipvoiceVariantCount`（`scripts/lib/checks.mjs`）は今も`origin === "chipvoice"`でゲートしており、無条件にチェックするわけではない - そうすることで、下記のGS-02のエンジンが、このルールを偶然に継承するのではなく、自分自身のバリアント数ルールを定義できる。タクソノミーは今日、音が0のカテゴリ（まだどのチップもレンダーしないスタイルの側面、GS-02のために予約されている）を保持し続けるが、あるカテゴリを表示するものは、それがまだ空であるのに中身があるかのように提示してはならない：`GET /api/v1/categories`は今、各カテゴリ自身の正直な`count`（`listCategoriesWithCounts`、`apps/sounds/src/lib/catalog.ts`）を返す - リーフなら自身の音、ブランチなら子孫のすべてのリーフの音の合計だ。サイトのカテゴリグリッドとハブページはすでに、その行を隠すのではなく明示的に「0 sounds」/「No sounds filed here yet」と表示していた。
- **出荷する音声はオブジェクトストレージへ移る。** `apps/sounds/scripts/audio-store.mjs`は決定40のパターン（`apps/web/scripts/audio-store.mjs`）をgamesounds向けに移植したものである：`pnpm sounds:pull`は`audio-store.json`で名指しされたVercel Blobストアから`public/f/*`の検証済みローカルコピーを取得し、`pnpm sounds:check`はカタログが参照するすべてのファイルがすでにストアにあることを証明し、`pnpm sounds:push`は不足分をアップロードする（`GAMESOUNDS_BLOB_READ_WRITE_TOKEN`が必要）。`generated/catalog.json`はコミットされたままで、それが指すバイト列はコミットされない。
- **ファイル単位のコンテンツアドレッシング。** 各バリアントの`.ogg`/`.mp3`/`.wav`は、バリアント全体で1つと主張される1つのハッシュではなく、それぞれ自身のSHA-256とバイト数を持つ（`AudioFile`、`packages/gamesounds/src/types.ts`）。`encodeVariant`（`apps/sounds/scripts/lib/audio.mjs`）は各形式を`<自身のsha256>.<ext>`として書き出すため、ファイルのURLはすでにその中身を名乗っている。CLI自身のSHA-256検証は、ファイル名を信用するのではなく、その主張を検証するためにバイト列をメモリ上でのみ取得する。
- **3から5のバリアント数の下限を、否定的テスト付きでチェックする。** ブリーフ自身の範囲は、それを強制する`checkChipvoiceVariantCount`が存在するまでは願望に過ぎなかった。`apps/sounds/test/checks.test.mjs`は、下限未満のchipvoice由来の音がビルドを落とすことと、chipvoice以外の出自がこの下限に縛られないことの両方を証明する。
- **統計的にではなく厳密に壊れたゲイン段を捉える、バリアントごとのラウドネスゲートを、すべてのバリアントでチェックする。** 最初のレビューパスは、ビルド全体で観測された最も広いピーク・ラウドネス間の差から下限を導いていた（`peakCeilingDb - maxObservedGap - marginDb`）が、2回目のレビューで、壊れたバリアント自身の差が、たまたま別の正当なバリアントのより広い範囲に収まってしまうと見逃しうることが判明した - この下限はカタログ全体の最大クレストファクターが変わるたびに動いてしまい、単一のバリアントをそれ自身の条件で決して拘束できていなかった。`levelToConvention`（`scripts/lib/audio.mjs`）はレンダーごとに単一の線形ゲインのみを適用する：モーメンタリーLUFSを-18に持っていくゲインと、トゥルーピークを-1 dBTPに持っていくゲインのうち、より小さい方である。したがって正しくレベリングされたバリアントは常に、2つの上限の少なくとも一方に丸め誤差の範囲内まで到達する - `checkOneCeilingBinds`（`scripts/lib/checks.mjs`）は、バリアント間の統計を一切用いずに、バリアントごとにまさにそれを検証する：`lufs >= -18 - eps OR peakDb >= -1 - eps`、eps は0.2 dB。コミットされた880バリアントすべてがこれに合格する。合成した-30 LUFS / -10 dBTPのバリアント（古い導出下限方式なら通過していたはずの壊れたゲイン段）はこれに落ち、新しいゲートの方が厳密に強いことを証明する。
- **CLIのフルスコープ。** `packages/gamesounds/bin/gamesounds.mjs`は`add`に加えて`search`、`swap`、`list`、`sync`を獲得し、`--json`、`--dir`、`--formats`、`--api`はこの5つすべてにわたって尊重される。`packages/gamesounds/test-cli.mjs`は、`add`単体がこれまで行使していたダウンロード＆マージの経路だけでなく、各コマンドをカバーする。
- **デチューンの計算は線形ではなく指数関数的である。** 再生レートの乗数はピッチに対して指数関数的であるべきだ：`source.playbackRate.value = (1 + jitterOffset) * 2 ** (semitones / 12)`（`packages/gamesounds/src/runtime.ts`）。これにより`+12`半音でレートがちょうど2倍に、`-12`半音でちょうど半分になる。`1 + semitones * k`のような形にはならない。`packages/gamesounds/test/runtime.test.mjs`は両端（`2`と`0.5`）を厳密に検証し、さらにシードされたジッターとデチューンが組み合わさる1ケースも検証する - これにより、半音0以外のあらゆる場所で誤っていた旧来の線形近似を捕らえる。
- **プレーヤーの仕様どおりの機能は、想定ではなく証明される。** ビューポートに入ったときとホバー/キーボード選択時のプリロード（`SoundList.tsx`の`IntersectionObserver`と行ごとのホバー/選択ハンドラ、観測可能な証拠としての`data-preload-state`）、プレーヤー自身のクロックに駆動されるプレイヘッド（`Waveform.tsx`）、最後に再生したものを表示し続けるスティッキーなミニプレーヤー（`MiniPlayer.tsx`）、そしてある音を再トリガーする際にボイスを無制限に積み上げるのではなくその音自身の直前のボイスを先に止めるスパムガード（`data-active-voices`）は、すべて実際に稼働しているサーバーに対する`test-smoke.mjs`で行使されており、コンポーネントを読んで仮定しているだけではない。
- **CIはカタログ全体をビルドし、決定性をチェックする。ネットワークは不要。** フェッチのステップが無くなったため、`catalog:build`と`catalog:build:chipvoice`/`catalog:build:fetch-only`/`catalog:build:skip-fetch`は1つの`catalog:build`に統合された（`--out <path>`はスクラッチビルド用に別の場所へ書き出す機能として残る）。`sounds` CIジョブは、コミット済みのレシピからカタログ全体を新規に`.artifacts/ci-catalog.json`へビルドし、`check-determinism.mjs`がそれをコミット済みの`generated/catalog.json`と比較する - WAV/PCMのバイト列のみで、`.ogg`/`.mp3`のエンコードはffmpegのバージョンによって正当に異なりうるからだ - これはカタログ全体をカバーし、出自で切り出した一部だけではない。
- **`vercel.json`の`ignoreCommand`**は、このアプリの出力を実際に変えうるパス（`apps/sounds`、`packages/gamesounds`、`packages/web-kit`、ロックファイル、`vercel.json`自身）だけに絞ったままである。モノレポの無関係な場所へのコミットがgamesoundsのデプロイを引き起こすことはない。
- **`docs/BACKLOG.md`で追跡されるGS-02：** どのチップもレンダーできないスタイルの側面（`realistic`、`fantasy`、その他）のための手続き的合成エンジン - 私たち自身のDSPで、レシピとシードから決定的に生成する。すでに予約されている`"generated"`出自の下にファイルされる。このフェーズには含まれない。それが埋めるタクソノミーのブランチは、出荷されるまで音が0のまま定義され続ける。

<a id="51-the-ym2151-is-nuked-opm-ported-line-for-line-ymfm-is-its-second-report-only-oracle-the-ym2610-waits-for-its-own-ticket-2026-09-28"></a>
## 51. YM2151はNuked-OPMを1行ずつ移植したもの。ymfmは第二の、報告専用のオラクル。YM2610は別チケットに持ち越し（2026-09-28）

NEXT-16のチップ：ヤマハのYM2151（OPM）、1980年代半ばから後半のアーケード基板やコンピュータを支えた、8チャンネル・4オペレータのFM音源です。`packages/chipvoice/src/chips/ym2151.ts`はNuked-OPMの`opm.c`（Nuke.YKT、LGPL 2.1、John McMasterによるこのチップのダイ写真から書かれたもの）をTypeScriptへ1行ずつ移植したもので、YM2612とNuked-OPN2について決定17が下したのとまったく同じ選択です：Nuked自身のフィールド名と関数名をそのまま残し（snake_caseのフィールド、`OPM_`接頭辞を外したcamelCaseのメソッド）、ファイルはLGPL 2.1の表記を掲げ、パッケージのライセンスフィールドと`LICENSE`ファイルの両方が今や3つ目のファイルを名指しします。Nuked-OPM自身は`packages/conform/oracles/nuked-opm`でネイティブビルドされ、レジスターログのパイプ越しに駆動される、このコアの一次オラクルであり、厳密一致でゲートされます：同じレジスター書き込みストリームに対して、このチップ自身のネイティブレート（clock/64 - `OPM_Clock`内部のパイプラインは入力クロックの半分の速さで動作し、32スロットの完全な一巡を64入力クロックごとに終える。これはymfm自身の`sample_rate() = baseclock / (clock_prescale * OPERATORS)`、`2 * 32 = 64`という、まったく別のコードベースからの独立した裏付けを持つ）で、全サンプルが一致すること。`check:ym2151-core`と`check:ym2151-edge`（`packages/conform/package.json`）が`core`と`edge`をこのゲートに保持し、`packages/conform/test/ym2151-gate.mjs`は各ゲートが実際に回帰を検出できることを証明します。`ay8910-gate.mjs`が定めたのと同じ否定的テストの慣習です。

**第二のオラクルと、それが報告専用である理由。** Aaron Gilesのymfm（BSD-3-Clause）は`packages/conform/oracles/ymfm`に同梱される、このコアの第二の独立したクロスチェックです - ダイ写真からではなく公開文献や他のエミュレータの挙動から書かれ、ダイそのものからの導出ではなく実機キャプチャーに対して調整されています。その`generate()`は`OPM_Clock`のようなサイクル精密モデルではありません：その時点のレジスター状態から完成済みの1サンプルを1呼出しで生成し、サンプル内のどこで書き込みが起きたかという概念がないため、`oracles/ymfm/main.cpp`は書き込みをサイクル単位で差し込むのではなく該当するサンプル期間（ログの64サイクルごと）へまとめます。2つのオラクルが不一致な場合に何を意味するかは決定48自身の前例が決着させます：ハードウェア検証済み（ここではダイ写真由来）の情報源は、単に異なるだけの、ハードウェアに対して未検証の第二の情報源に優越する、というものです。そのためNuked-OPMとymfmが不一致の場合はNuked-OPMの読みが勝ち、その不一致は`docs/chips/ym2151.md`に明記され、黙って吸収したり平均を取ったりはしません。`check:ym2151-core-ymfm-report`と`check:ym2151-edge-ymfm-report`は`--report`のみで、厳密ゲートには決してしません。決定48がGame_Music_Emuの`Ay_Apu`にも適用したのとまったく同じ理由です：ここでの本物の差異は、どちらが正しくなぜかを見て言うための契機であり、それ自体が移植の不具合の証拠ではありません。

**MAMEの`ym2151.cpp`**は第三の参照として読み、レジスターの意味づけとCSM／タイマーの挙動を、独立に書かれた第三の実装と突き合わせました。しかしこれはGPLであり、ハーネスを含めどこにも同梱・コピーされません：決定41がGPLの参照material をharnessに許すのは、それが実際にオラクルとして動かされ、自身の無変更ソースツリーから自身のライセンスとともにビルドされる場合に限られ、2つのオラクルがすでに文書化・裏付けされた程度でしか不一致でない今、第三のビルド済みオラクルは必要ありません。`ym2151.ts`、`opm.c`、ymfmの同梱ファイルのいずれにもMAMEからコピーされたものはなく、すべてNuked-OPMかymfmに遡ります。

**対象範囲：YM2151のみ、YM2164でもYM2610でもない。** Nuked-OPMのソース自身はYM2164（OPP、レジスターマップが広くTLランプを持つ変種で、実行時フラグ`opm_flags_ym2164`で選択される）もモデル化していますが、元のCの`chip->opp`分岐すべて、そして`OPP_TLRamp`自体は単に移植していません - `ym2151.ts`が実装するのはYM2151専用（`opp = 0`）の経路そのままです。NEXT-16はYM2610（OPNB、Neo Geoほか複数のタイトー／SNK基板で使われた1チップ2音源）も後半として名指ししていましたが、このチップはYM2612系列とFM機構の一部を共有しつつ、YM2151にもYM2612にも一切ないADPCM-A/ADPCM-Bのサンプル再生を追加する、かなり異なるコアであり、独自のオラクル作業と独自のプローブコーパスを必要とします。これは本PRの対象外であり、`docs/BACKLOG.md`にそれ自身の別チケットとして記録され、「NEXT-16完了」に黙って畳み込まれることはありません。

**YM2612と異なりチャンネル単位のタップはなし。** `packages/chipvoice/src/chips/md/ym2612.ts`は`ch_out`配列を公開していますが、それは実機のYM2612が実際にそのピンを持つからです - セガのメガドライブの配線は6チャンネルを個別に読み、独自の外部ミキシングへ渡します。YM2151にはそのようなピンはありません：Nuked-OPMは内部で8チャンネルすべてを1つの共有ステレオアキュムレータへ合算し、ダイから出るのは左右2つのDAC出力だけです。この移植の初期の版はYM2612の形にならって`ch_dry`という計装用配列を持っていましたが、それに依存するオラクル側コードを書く前に取り除きました。それを支えるにはNuked-OPM内部の`fm_algorithm`ルーティング表をC側オラクルドライバの中にもう一度複製する必要があり、独立に保守される2つの実装間の同期リスクを、実機が持ってもいない出力のために背負うことになるからです。`packages/conform`のYM2151比較は8や10ではなく`l`と`r`の2ボイスです - このチップが実際に持つ出力はそれだけです。

**2ポートの書き込みラッチのセトリング窓、隠さず文書化。** Nuked-OPMのレジスター書き込みは即座には反映されません：アドレスポートへの書き込みとそれに続くデータポートへの書き込みは、内部の32サイクルパイプラインがそのレジスター自身のチャンネルまたはスロット番号へ一巡してくるまで（`OPM_Clock()`呼び出し最大32回、このチップのclock/2-per-tickレートで64ネイティブサイクル）適用されず、その前に新しいアドレスポート書き込みが来ると、ペンディング中のものは無条件に（同梱`opm.c`の`reg_data_ready = reg_data_ready && !write_a_en`）静かに破棄されます - これはエミュレータの癖ではなく、正真正銘の2ポートバスの挙動です。これはあるレジスター書き込みが何もしていないように見える形で直接発見され、デバッグビルドで書き込み間隔を`OPM_Clock()`呼び出し4回から40回へ広げることで判明しました。プローブコーパス自身の`SETTLE`定数（`packages/conform/src/corpus/generate-ym2151.mjs`、ネイティブ4000サイクル、64サイクルの窓を十分に超える）が、1本を除くすべてのスクリプトをこの窓から大きく離しています。`edge/write-clobber.log`だけはこれをわざと踏むスクリプトで、同一VGMサンプル上でサイクル差ゼロの2つのレジスター書き込みを行い、コメントで説明するだけでなくこの挙動自体を演習し厳密ゲートします。

**レジスターストリームの運び手。** VGMコマンド`0x54`（`aa dd`、1コマンドで1レジスター書き込み - このチップ自身の2ポートプロトコルを1つの論理的な書き込みへ折り畳んだもので、`packages/conform/src/vgm.mjs`に既にあるメモリマップ形式の`2a03`/`dmg`コマンドとは異なる）がこのチップの搬送手段で、`vgmToWrites`の新しい`ym2151`分岐が復号します：各コマンドは同一サイクルの2つのレジスターログ書き込み - アドレスポート書き込み、続いてデータポート書き込み - になり、`Ym2151.write`自身のポート番号付けと一致します。モデル化されていないVGMコマンドは名前付きで例外を投げます。決定44がNES/Game Boyのインポーターに定めたのと同じ慣習です。プローブコーパス自体は`.vgm`ファイルとしてコミットされ（`source/`配下、SHA-256を`manifest.json`に記録、CC0、外部素材なし）、同じインポーターを通じてハーネスが実際に走らせる`.log`ファイルへ復号されるため、インポーター自体のバグはオラクルに対するスコアとして現れ、自分自身と一致するだけには終わりません - 2A03とGame Boyのコーパスで`generate-vgm-import.mjs`がすでに使っているのと同じラウンドトリップです。実機のアーケードやコンピュータのVGMリップはローカルでの測定には有用ですが、決してコミットしません（`scores/nsf-corpus`自身の慣習が求める水準でCC0や他のクリアなライセンスであるリップは存在しません）。それらはgitignoreされた`.artifacts/`ディレクトリに留まります。他のチップの実世界キャプチャーについて`docs/CONFORMANCE.md`がすでに定めている「ローカル限定」という前例そのものです。

**ドライバなし、アレンジャーなし、公開ピッカーなし - 決定38の対象範囲を再び。** `Ay8910`や`Vrc6Apu`が実装するchipvoice自身の`DigitalChip`インターフェース（`schedule`、`cancel`、`outputs`、`load`、`step`）を`Ym2151`は実装しません。公開するのはNuked-OPMをそのまま映す最小限の面（`write`、`read`、`readIRQ`、`readCT1`、`readCT2`、`setIC`、`clock`、`reset`）だけです。適合性検証のためのサイクル駆動はすべて私設の`packages/conform/src/chips/ym2151.mjs`ラッパーの中にあり、`oracles/nuked-opm/main.cpp`がCの参照実装を駆動するのと同じやり方でクラスを直接駆動します。chipvoice側の共有スケジューラは一切通りません。これは見落としではなく意図的なものです：このチケット自身の対象範囲はコア・オラクル・プローブ・シートのみであり、AY-3-8910/Sunsoft 5BやVRC6より前に決定38がすでに切り出したのと同じ範囲です。ドライバ、アレンジャー役、スタジオピッカーへの登録は未着手で、`docs/BACKLOG.md`に記録されています。

**理由。** YM2612についての決定17の理由づけ - 「ダイ由来の参照実装こそがオラクルである以上、依然として権威である……移植はコードを検査可能なまま保ち、ハーネスのトレースをその内側に保つ」 - はYM2151にもそのまま当てはまり、再発見する必要はありません：Nuked-OPMはNuked-OPN2と同様にダイ写真から書かれ、それに対してサイクル精密であり、1行ずつの移植によってハーネスが見つけた不一致を1行まで追跡できます。決定41の境界線（GPLの参照materialはharnessに留まりパッケージには入らない）が、MAMEを読み引用はしても決して同梱・コピーしない理由です。決定48の境界線（ハードウェア検証済みの情報源は、単に不一致なだけの裏付けのない第二の情報源に優越する）が、ymfm - 注意深く独立に書かれ実機で調整されてはいるが、ダイの読み取りではないモデル - を第二の厳密ゲートではなく報告専用のクロスチェックにする理由です：それとNuked-OPMの一致は裏付けになりますが、不一致は移植に対する反証にはならず、決定48はすでにその非対称性がなぜ両方向には働かないかを整理しています。

**変わること。** `packages/chipvoice/src/chips/ym2151.ts`（新規、LGPL 2.1-or-later）、`packages/chipvoice/src/index.ts`から`Ym2151`としてエクスポート。`packages/chipvoice/LICENSE`とその`package.json`の`license`フィールドが3つ目のLGPLファイルを名指しします。`packages/conform/oracles/nuked-opm`と`packages/conform/oracles/ymfm`（いずれも同梱、それぞれ自身のライセンスとREADME付き）、`packages/conform/src/oracles/nuked-opm.mjs`と`ymfm.mjs`、`packages/conform/src/chips/ym2151.mjs`、`packages/conform/src/vgm.mjs`の`ym2151`分岐、プローブコーパス（`packages/conform/corpus/ym2151`）、`docs/chips/ym2151.md`、`packages/conform/package.json`の`check:ym2151-*`/`baseline:ym2151-*`/`corpus:ym2151`スクリプト。ドライバ・アレンジャー・スタジオピッカーの変更はなし。YM2610は明示的に本変更の対象外で、それ自身の別チケットとして記録されています。

<a id="52-gamesounds-makes-its-own-sounds-a-deterministic-procedural-engine-recipes-plus-seeds-no-third-party-audio-or-external-generator-2026-09-28"></a>
## 52. gamesoundsは自分自身の音を作る：決定論的なプロシージャルエンジン、レシピとシード、サードパーティの音声も外部ジェネレータも使わない（2026-09-28）

`packages/sfx-engine`は新しい、非公開の、ランタイム依存ゼロのワークスペー
スパッケージです：gamesounds.ai独自のオフライン効果音シンセサイザーです。
ここでの「音」とはレシピ（JSON：モデル、パラメータ、シード、サンプルレー
ト）とそのシードの組み合わせであり、このリポジトリ内でゼロから組み立てた
DSPによってPCMへレンダリングされます - オシレーター、ノイズ、エンベロー
プ、フィルタ、ディレイ、アルゴリズミックリバーブ、ウェーブシェイピング、
そして4つの物理モデルに基づくモデル（モーダル合成、PhISEM、
Karplus-Strong、バブルモデル）で、それぞれが公開されたアルゴリズムや論文
の独立した実装であり、既存のコードベースの移植ではありません。53個の名前
付きプリセットがUI、衝突、足音、振り、爆発、サイエンスフィクション、魔
法、拾い物の分類ファミリーをカバーしています。録音やサードパーティのもの
が一切入らないため、すべてのレンダリングはその構造上パブリックドメイン
（CC0-1.0）に捧げられます。詳細全体は
[GAMESOUNDS-ENGINE.md](GAMESOUNDS-ENGINE.md)にあります。

**理由。** gamesounds.aiの製品には、どの1つにもライセンス上の疑問が付き
まとわず、サードパーティの生成APIの可用性・価格・出力ライセンスにも依存
しない形で、出荷・改変・再生成できる効果音が必要です。レシピとシードの組
み合わせは、生成してキャッシュしただけの音声ファイルにはない形で再現可能
かつ検査可能でもあります：同じJSONがNode・Chromium・Firefox・WebKitでビ
ット単位で同一のPCMをレンダリングするため（`parity/`、ローカル限定、
chipvoice自身のrender-parityのパターンに合わせています）、ある音は作り方
の記録が一切ないバイナリのブロブではなく、わずか数百バイトのJSONで完全に
記述されます。

**強制の仕組み。** 決定論性は慣習ではなく構造的に強制されています：DSPの
コアが必要とするすべての超越関数は`dsp/math.ts`の中で`+`、`-`、`*`、`/`
だけから実装されています。ECMA-262は`Math.sin`/`cos`/`exp`/`log`/`pow`/
`tanh`をエンジンをまたいで実装依存の近似としているためです。コミット済み
のSHA-256ハッシュフィクスチャ（53プリセット x シード3個）とコミット済み
のレンダー時間ベースライン（3倍の回帰予算)はどちらも`sfx-engine`のCIジョ
ブで実行されます。クロスエンジンのパリティチェック、ffmpegとのラウドネ
ス突き合わせ、自己完結型のリスニングレポート、CLAPによるセマンティック評
価はローカル限定のツールであり、chipvoice自身のrender-parityですでに使
っているのと同じ分け方です。

**変わること。** `packages/sfx-engine`は追加のみです：`apps/sounds`、
`packages/gamesounds`、`packages/chipvoice`のいずれにも触れず、それ以外
のどこにもこれを採用することを求めません。gamesounds.aiのアプリが今後呼
び出せる、音声生成のもう1つの選択肢になります。既存のものと並んで使えま
す。

<a id="53-a-richer-snes-factory-bank-via-one-ensembledetune-synthesis-formula-and-echo-as-a-documented-space-choice-that-still-defaults-to-dry-2026-09-29"></a>
## 53. 1つのアンサンブル／デチューン合成式によるSNES標準バンクの強化と、既定はdryのままにしたエコーの`space`選択肢化（2026-09-29）

NEXT-24は、SNES標準楽器が薄く遠く聞こえるという実際の利用者（kami）の指
摘に応えます。変更は2つに分け、独立させています：バンクの作り直し
（`packages/chipvoice/scripts/snes-bank-source.ts`）と、S-DSPのエコーを
無効な定数から`ChipCreateOptions.space`という、公開・文書化・単体テスト
済みの選択肢（既定の`"dry"`、変更なし、または控えめなエコーを返す
`"room"`）へ変えることです。既存の全サンプル名と`baseHz`調律は変えず、
生波形楽器は設計上そのままです。

**バンク。** 依頼の弱点であるブラス、ストリングス、ピッキングベース、
キック、スネアを、1つの共有式へ移しました：複数のデチューンしたパーシャ
ルを`bin = (partial + 1) * loopCycles + offset * spreadBins`に配置し、
`loopCycles`周期分のループ内でどのユニゾン声部もデチューン量に関わらず
必ず周期境界で閉じるようにしています（フェーズ1パレットが単一パーシャ
ルで測定したのと同じ保証です）。`unison: 1, detuneCents: 0`ではこの式が
単一パーシャルへ正確に戻るため、マレット、ハープ、リードベース、シンセ
ベース（この依頼の主眼ではない軽微な更新対象）は前チケットのバンクと音
声がバイト一致でレンダリングされます。これは前チケットの原典との
`git diff`（合成に中立な`loopCycles`／`unison`／`detuneCents`／
`noiseMix`のフィールドが追加されるだけ）と、下記の実測指標（マレットを
使う全プローブでmainとdryが一致）の両方で確認しました。フルートだけは
小さな`noiseMix`のブレス成分を追加し、それ以外は同じ不変グループです。
この不均等な労力は見落としではなく意図的です：依頼が「主な工学的注力：
ブラス、ストリングス、ピッキングベース、キック、スネア……それ以外は軽
めで一貫した底上げ」を求めており、5つの軽微更新対象のうち4つが変わって
いないと証明できる式であることこそ、主眼ファミリーの新しいアンサンブ
ル／デチューン／ノイズのパラメータが実際に効いている証拠であり、何もか
もを少しずつ変える式の副産物ではないからです。

**実測。** `docs/SNES-PALETTE.md`のフェーズ3プロトコル（バンクやドライ
バーの変更前にコミット、`6e393bc`）とその測定結果が記録であり、ここは
要約です。アタックトランジェントエネルギー（最も一貫して方向性のある指
標）は書き直したブラスの両プローブで明確に分離します：overworldは1.25
dB（main）から6.93 dB（新dry）、bossは0.99 dBから5.26 dB、2A03対照は
1.27〜2.01 dB（単一サイクルの矩形波は独立したトランジェントをほぼ持ち
ません）。エコーテールエネルギーがもう1つの明確な分離です：`room`は持
続和音プローブで4.84e-4を測定し、dryの8.17e-12、mainの1.50e-11に対し4
〜5桁の差があります。ドラムループプローブはdryとroomが設計どおり同値
（8.24e-8）です。`EON`がキットボイス（v3）を除外するため、ワンショッ
トドラムはどのエコーテール中でもdryのまま聞こえるからです。スペクトル
フラットネスと重心移動は2A03対照に対して一貫した方向へ分離しませんでし
た（bossプローブでは対照よりフラット、overworld／midnight／和音では逆）
。これはこの3プローブが選ぶ特定の2A03パッチの性質であり、新バンクに不
利な証拠だとは読んでいません。受け入れ基準6のとおり、自動指標は音色を
認証するものではなく、うまく分離しない指標への対処はしきい値を緩めるの
ではなくここに記録することです。3曲のデモを丸ごと（分離せず）レンダー
した場合を含め、どのプローブでもdry／echo入力のクリッピングは見られま
せんでした：overworld／boss／midnightのピークはdryで0.2581／0.2796／
0.2211、roomで0.2557／0.2788／0.2155です。

**`space`の既定値。** `"room"`は明示的な選択のままとし、標準の既定は
`space`が存在する前のこのドライバーのレジスタ列とバイト一致する
`"dry"`のままにします。相反する方向を指す2つの証拠があり、どちらも本
物です。kamiの指摘はまさに、音響空間が一切ないためこれらの楽器が薄く聞
こえるというものであり、`"room"`はそれをクリッピングなしで、打楽器を
設計どおり明瞭に保ったまま、測定可能かつ聴感上も改善します。しかし
`a0e8691`（PR #44「Fix distant SNES sound and incorrect Sonic timbre
ports」）は逆方向の失敗の直接的な履歴です：エコーを既定で有効にすると、
実測した参照録音と比較する`apps/web/public/arrangement-data`のマリオや
ソニックといったSNESの**ネイティブ楽曲移植**（移植可能な生成コンテンツ
ではありません）が遠く聞こえるようになり、そのPRの修正はまさにこの依頼
が選択肢として復活させている暗黙のエコーを取り除くことでした。
`space`にはコンテンツ種別ごとの既定値がありません：ネイティブ移植も
kami生成の移植可能な編曲も、同じチップを生成し同じドライバーで再生しま
す。既定値を反転させれば、片方の指摘を直すために、もう片方の用途で
PR #44の回帰を静かに再現する危険があります。dryを既定に保ち、`"room"`
を文書化・検証済みで推奨される明示的な選択肢として提供することは両方に
資します：ネイティブ移植はspaceを求めない限りバイト一致のままであり、
kamiのような利用者はこの依頼より前にはできなかった選択を、今はできます。

**変わること。** `packages/chipvoice/src/chip.ts`
（`ChipCreateOptions.space`）、`src/chips/snes/driver.ts`（`SPACES`、
`spaceFor`、電源投入シーケンスの条件付き`EON`書き込み、そして`space`
とは独立に電源投入直後の復号済みガラクタ音声を取り除くMVOL／EVOLの先
行ミュート修正）、`src/driver.ts`と`src/render.ts`（`RenderOptions.space`
を`renderSong`と`recordSong`まで通す)、`test/snes-echo.mjs`（新規、14
件の検査：既定=dryのバイト一致、未知のspace名のdryへのフォールバック、
`room`の正確なレジスタ値、どちらのspaceでも電源投入バッファが折り返す
前に`EON`が有効化されないこと、実測できる可聴テールの差、エコー用ハー
ドウェアを持たないチップが未知のspaceを無視する場合を含む公開の
`renderSong`／`recordSong` API）。`docs/chips/snes.md`とその対応表、
およびロードマップのフェーズ6の記述を修正しました：エコーが既定で有
効だとする記述は、この依頼が触れていない0.12.0の移植当時は正しかった
ものの、0.16.3以降（この依頼より前の決定）は誤りで、今はさらに
`space`で条件づけられます。決定35（SNESエンジンは必要になるときだけ読
み込む）は変わりません：`space`はドライバー内部のレジスタ選択であり、
新しい読み込み対象ではないからです。

**外部レビュー（kamiのPunk Kartセッション、code-30）。** 自動の盲検判定器
（kamiの音声のみの音楽評価。人ではなくモデルで、どの機種か尋ねられる）は、どちらのspaceでも「NES」
から動きませんでした（トラックごとに1回の回答）：race - base
（0.19.0とkami自身の`snesEcho`パッチ）はNES、NEXT-24 dryはNES、
NEXT-24 roomはNES。final - baseはNES、dryはNES、roomは「Game Boy」。
results - 3つとも全てNES。並行して行ったスタイル適合スコア（審査員、
各トラック3回、合格には高得点が必要）も3ビルドでほぼ同じく不合格でし
た：race 3/3/3（base）、2/3/3（dry）、3/3/3（room）；final 3/3/3
（base）、3/3/3（dry）、3/4/3（room）；results 3つとも3/3/3。不合格
トラックについての審査員自身の言葉：「メロディに8-bitの矩形波、ベー
スに三角波、打楽器にホワイトノイズ」が聞こえ、「ブラスの一撃、スラッ
プベース、ストリングスが欠けている」と指摘し、roomは「特徴的な温かい
エコーに欠ける」と読みます（ループ音量はbaseより2.6dB低い）。ジング
ル（finalLap、win）は3ビルドとも8〜9で合格。loseはbaseで不安定
（5, 9, 5）、dry／roomでは安定（9, 9, 9／8, 8, 8）。2つの陰性対照
（ホワイトノイズ、バラードへの再プロンプト）はどちらも1点となり、審
査員が明らかな不一致は識別できることを示しますが、陽性対照（実機
SNES音声）はまだ実施しておらず、SNESそのものを認識できるかは未検証
のままです。後日code-30自身の連携コードを確認したところ、dry対base
の比較は交絡していたことが分かりました：code-30のローカルパッチは
`space`オプションが何であれ設定されているとkamiの`snesEcho`工程を
スキップしていたため、この盲検テストの「NEXT-24 dry」はエコーが一切
ない状態であり、常にkamiのechoパッチが掛かっていた「base」と比較され
ており、「NEXT-24 room」はこのドライバー自身のroomエコーを使いつつ
kamiのパッチは重ねていませんでした。dryが「温かいエコーに欠ける」と
いう審査員の指摘は、echoパッチ付きの音と並べたときに`EVOL`ゼロの
spaceがまさにそう聞こえるはずのものであって、新バンク固有の証拠では
ありません。この交絡を補正した上で率直に記録します：NEXT-24はどちら
のspaceでもこの外部審査員の判定を変えず、この指標では0.19.0より良く
も悪くもなく、まだ誰も人間の耳で聴いていません。これは「SNESらしく
聞こえる」よりも弱い、別の主張です。「SNESらしく聞こえる」という読み
は、上記の内部・事前宣言済みDSPレベルのプローブ（アタックトランジェ
ントとエコーテールのエネルギー）にのみ基づいており、外部あるいは盲検
の聴取には基づいていません。

**dry空間のリリースについて、率直に。** dryで保持された最終和音は
key-offまでフルレベルを保ちます。これはこの依頼より前と全く同じで
す。NEXT-24は`note()`も`noteOff()`も`renderPerformance`のレンダー幅
も変えていません。code-30自身の対照実験がそれを確認しています
（`chipvoice-0.19.0`をエコーなしのdryで、全く同じ処理連鎖でレンダー
した結果、`win`と`lose`はNEXT-24 dryとミリ秒単位で同じ長さになり、同
じように切れます。`finalLap`はどちらでも綺麗に減衰します。最後の音符
がプラック（弾き）で、楽譜自身の終端まで保持されず先に終わるためで
す)。`plan.seconds`には`compileSong`自身の2秒のリリーステールが最後
の`endTick`の後にすでに含まれており、最後のkey-offはレンダー終端の
2.15〜2.68秒前に来ます。レンダー幅は原因ではなく、さらに広げても何も
変わりません（幅を+1秒しても、トリム後の出力はバイト一致します)。聴
き手が唐突な停止として聞くものの正体は、key-off後のS-DSP自身の固定的
で高速（約8ms）なハードウェアリリースであり、それに続いて`trimRender`
がほぼ無音となった残りを切り詰めているだけです。これは正確なハードウ
ェア挙動であり、打ち切りのバグではありません。だからこそ`room`や、外
部echoパッチを通したdryは自然に減衰します（key-offとは独立に、エコー
された音の複製が返り続けるからです）。code-30自身の数値では、NEXT-24
のdryは0.19.0よりむしろわずかに良く保持しています（`win`は最後の
100msで-31.5dB対0.19.0の-24.8dB、`lose`は-33.0dB対-24.5dB）、悪化して
はいません。key-off前にsustain自体を（ADSR自身のSR＝sustain rateか、
N-SPCなど実機のドライバーがするようなスクリプト化したGAIN減少で）テ
ーパーさせるdriver側のリリースは、実際に望ましい作業であり、Backlog
P6-11（NEXT-25候補）として追跡していますが、意図的にこの依頼の対象外
です：dry空間のあらゆるレンダー音声を変え、`renderSfx`も含むため、そ
れ自身の音声無変化の証明が必要になるからです。

**gamesoundsへの影響（`apps/sounds`、GS-07／#126の後に再構築）。**
`catalog:check-determinism`は、`chord`以外の役割を持つ28件の
`*-16bit-snes`レシピ全てで音声が変わったことを検出します（112件の
WAV／PCM不一致、各4バリアント）。`harp`から作られる16件の`chord`役
の音は影響なし（バイト一致を確認済み）。作り直した5ファミリーが28件
中21件を直接説明します（`lead`：flute、`bass`：picked-bass、
`perc-kick`／`perc-snare`／`perc-noise-long`：kickまたはsnare。上記の
とおり、これらは自身のサンプルバイトが変わっています）。残る7件は全
て`perc-hat`（作り直していない`hat`／`ohat`サンプルから作られており、
ソース差分で不変を確認済み）で、別のドライバーレベルの理由で動きま
す：`powerOn()`の新しい、無条件のMVOL／EVOL先行ミュート書き込み（前
述）が、電源投入列の先頭に4回のレジスタ書き込みを追加し、それより後
の全レジスタイベントのタイムスタンプを一定の40 SPCサイクル単位（約
39マイクロ秒）だけ遅らせます。書き込まれる値とその順序は変わりません
（タイムスタンプを除けば、イベント列の残りは`cf23684`と同一だと確認
済み）、変わるのはタイミングだけです。旋律的でBRR復号されるボイス
（harp）はこのずれを通してもビット単位で同一の音声をレンダーします
が、復号済みサンプルデータではなくS-DSPの自走するハードウェアノイズ
生成器を経由する`hat`／`ohat`はそうなりません。同じずれが生成器のサ
ンプリング地点をその系列内の別の場所へ移すためです（生波形PCMはラグ
0ではなく+1サンプルのラグで最も強く相関します。差は一定のゲインでは
なく、単純なゲイン差という説明は成り立ちません）。`renderSfx`はミッ
クスキャリブレーションを一切参照しないため、それも原因から除外できま
す。再構築は、カタログ自身のoggエンコーダの修正を待ちました。この修
正は当初の予定どおりGS-03ではなく、GS-07（#126：全環境でsoxの
libvorbis、決定54のGS-07追記）として入りました。GS-07以前のエンコー
ダ（ネイティブのffmpeg vorbis、`3b40c16`上）に対するこのブランチの最
初の再構築は、この28件のうち1件でフォーマットエネルギーのゲートに失
敗しました：`combat-shoot-16bit-snes`のバリアント2のoggが両チャンネ
ルとも無音にデコードされ、一方でそのwav自身のエネルギーは161でした。
GS-07へリベースした後は`catalog:build`が全ゲートを通過し、再構築した
`generated/catalog.json`をGS-07のものとフィールド単位で比較すると、予
測どおりの集合だけが動き、他は何も動きません：同じ28件の
`*-16bit-snes`音声（`flute`16件、`hat`7件、`kick`2件、
`picked-bass`2件、`snare`1件）、その全112バリアントのwav・mp3・ogg
のバイト列が新しくなり（sha256、url、`peaks`。`measure`は一部で変
化）、音声の追加・削除はありません（前後とも270音声、1080バリアン
ト）。`harp`で作られる`chord`役の16件と、SNES以外の226件の音声は、
フィールド単位で不変です。ブラウザデコードのゲート（`check-decode`）
は再構築したファイルで通過し（各エンジンで2160件のデコード中0件の失
敗、`|browser - reference|`の最大値は両方で1.54e-5。GS-08のmp3のラ
グは1080/1080でChromium 0、Firefox 576のまま変わらず、情報のみの最小
相関は新しいSNESの音声によって0.888から0.883に動きます）、CIの
`catalog:check-determinism`がそれ
らを再レンダーし、新しいファイルはマージ前にBlobストアへ送られます
（`sounds:push`、その後`sounds:check`）。

<a id="54-gamesounds-generated-sounds-ship-mono-leveled-on-their-own-actual-shipped-bytes-sfx-engines-presets-are-filed-by-what-they-model-never-forced-to-fill-a-style-2026-09-29"></a>
## 54. gamesoundsの生成音声はモノラルで出荷され、自分自身が実際に出荷するバイト列そのものでレベル調整される。sfx-engineのプリセットは、それが実際に何をモデル化しているかでファイルされ、スタイルを埋めるために無理に当てはめられることはない（2026-09-29）

GS-03は`packages/sfx-engine`（決定52）をgamesounds.aiのカタログに組み込みます。`apps/sounds/catalog/generated-recipes.mjs`が53個の名前付きプリセットすべてを分類カテゴリ、スタイル、タグにマッピングし、chipvoice側と同じtrim/level/encode/measureパイプラインを通じてカタログ自身の44.1kHzでレンダリングし、プリセットごとに4つのシードラダーのバリアントを持ちます。決定52の出荷時には未決定だった（あるいは誤って仮定されていた）2つのことが、ここで決定されました。

**チャンネルレイアウト：wavとmp3はカタログ全体でモノラル。oggはビルドマシンのffmpeg次第 - 推奨されたデフォルトに従うのではなく、実測によって決定。** 決定52自身の記述と、`docs/BACKLOG.md`のGS-03追跡項目はどちらも、既存のカタログがステレオで出荷されていると仮定していました（「出荷済みのステレオ44.1kHzチャンネルレイアウト」）。`apps/sounds/scripts/lib/audio.mjs`の`toWavBytes`（`channels = right ? 2 : 1`）を直接調べると、これが一度も真ではなかったことがわかります。chipvoice自身の`renderSfx`はカタログのビルドのどこでも`stereo: true`で呼ばれておらず、既存のchipvoice出自の音声はすでにすべてwavとmp3でモノラルで出荷されています。生成音声も同じ理由 - 願望的に文書化されたものではなく実際の既存の慣習との一貫性 - でこの慣習に合わせます。カタログ初のステレオファイルという層を新たに導入するためではありません。

oggフォーマットだけは例外であり、しかも異なるマシンでビルドされたカタログ全体で一様ではありません。`vorbisEncoderArgs`（同じファイル）はビルドマシンごとに一度だけエンコーダーを選びます。ビルドマシンのffmpegがlibvorbisを持っていれば（CIでは真、Ubuntuのaptパッケージ）、モノラルのソースはモノラルのまま維持されます。そうでなければffmpeg自身のネイティブな「実験的」vorbisエンコーダーが使われ（このリポジトリ自身の開発用Homebrew ffmpegで確認済みの欠如）、これはモノラル入力を拒否するためデュアルモノのステレオへアップミックスせざるを得ません。CIでビルドされたカタログはモノラルのoggファイルを出荷しますが、libvorbisを持たないマシンでローカルにビルドされたカタログ（このチケットがコミットするカタログを実際にビルドしたもの）は、同じ、同等のラウドネスの音声のデュアルモノステレオのoggファイルを出荷します。どちらも正しく、ビルドはどちらを生成しているかを知っている必要があるだけで、「モノラルのまま一貫している」と決して仮定してはいけません - そのフォールバックのアップミックスがどのように正しくレベル調整され、バイト単位で再現可能に保たれているかは次の次の段落を参照してください。これは、この同じチケットの再ビルドに対するPRレビューがマージ前に発見した欠陥です。

これはまた、ラウドネスの罠が実際に効く方向を回避します。sfx-engineの`loudness/normalize.ts`は、`panToStereo`が走る前（`packages/sfx-engine/src/render/renderRecipe.ts`）にレンダーをモノラルとして計測・ゲイン調整するため、その自己申告の`RenderedSound.loudness`は呼び出し側が受け取るパン後のチャンネルではなく、パン前の信号を表しています。すべてのプリセットの`pan: 0`では、等パワーのパン則により`left = right = mono * cos(pi/4)`となり、エンジン自身の数値よりおよそ-3.0103dB静かになります。この数値を信用して実際に出荷されるバイト列を再計測しなければ、すべての生成バリアントが気づかれないままおよそ3dB過小にレベル調整されていたことになります。`build-catalog.mjs`の`renderGeneratedVariants`はこれを行いません。`RenderedSound.left`を出荷される信号としてそのまま使い（`pan: 0`では`left === right`なのでこれは正当です）、カタログ自身の`levelToConvention`（エンジンが何を主張しようと、実際に渡されたバイト列を再計測する）に通します。`apps/sounds/test/generated-loudness.test.mjs`は、実際に独立して計測されたバイト列の上で両方向を証明します。正しい経路は`checkOneCeilingBinds`に合格し、エンジン自身のパン前自己申告を記録済みの計測値として出荷すると失敗します。

**oggのフォールバックアップミックス：ビットイグザクトな決定性とユニティゲインのパン、`-ac 2`ではない。** libvorbisを持たないマシンのフォールバック経路（このチケットが実際にコミットするカタログをビルドしたまさにその経路）でビルドすると、2つの欠陥が明らかになりました。どちらもこの同じ再ビルドに対するPRレビューがマージ前に発見し、いまは`encodeVariant`（`apps/sounds/scripts/lib/audio.mjs`）で修正済みです。1つ目：明示的なビットイグザクトフラグがないと、ffmpegのogg/vorbisとmp3のマルチプレクサは、エンコードのたびにランダム化されたストリームのシリアル番号を埋め込みます。そのため信号に変更が一切なくても同じビルドを再実行すると異なるogg/mp3のバイト列が生成され、カタログ全体で毎回の再ビルドのたびに偽のリハッシュが発生していました。修正は、`-fflags +bitexact -flags:a +bitexact`をOUTPUTオプションとして（`-i`の後、出力パスの直前に）追加することです - 同じフラグを`-i`の前のINPUTオプションとして置いても修正されません - 両方のフォーマットに対して。2つ目、こちらのほうが深刻です：フォールバックのアップミックスは`-ac 2`、つまりffmpegの汎用チャンネル数変換器を使っていました。これは1チャンネルから2チャンネルへ変換する際にデフォルトの等パワー分割（-3.0103dB、`1/sqrt(2)`、チャンネルごと）を適用します。これはモノラルのソースをステレオの「ミックス」に広げる場合には正しいのですが、ブラウザがモノラルファイルを両チャンネルにコピーして再生する方法（ユニティゲインであり、減衰されない）には合いません。そのためこのフォールバック経路でビルドされたすべてのoggはおよそ3dB静かすぎる状態で出荷されていました。修正は`-ac 2`を明示的なユニティゲインのパンフィルター、`-af pan=stereo|c0=c0|c1=c0`（ソースチャンネルを両方の出力へそのままコピーするだけで、チャンネル数変換のゲイン計算は一切関与しない）に置き換えることです。ffmpeg自身の`volumedetect`で直接検証しました：-20.0dBFSのソースは、旧`-ac 2`経路では-22.9dBFS（期待される-3.01dBの損失にほぼ正確に一致）、新しいパンフィルター経路では-19.9dBFSと測定されました。

`encodeVariant`はいまや、出荷されるoggとmp3を実際にPCMへデコードし直し、チャンネルごとの総エネルギー（各サンプルの二乗の合計であり、平均でもピークでもありません - 理由は後述）を`formatEnergy`として記録します。`checkSound`（`scripts/lib/checks.mjs`）はこれをバリアントごとに直接ゲートします。`checkFormatEnergy`/`checkFormatEnergies`、単一のバリアントごと・チャンネルごと・フォーマットごとの許容値（`FORMAT_ENERGY_TOLERANCE_DB`、1.0dB）で、別の集計層は一切ありません。

これは、ラウンド2のPRレビューがマージ前に発見した、以前の誤った設計を置き換えるものです。以前の設計は、17dBまで緩められたバリアントごとのPEAK許容値を、すべてのピーク差分の平均に対する別のビルド全体の集計チェックでバックストップするというものでした。その許容値が受け入れるために緩められた外れ値 - `pickup-key`が最大16.23dBのピークを失う、`impact-glass-light`と`footstep-metal`がそれより小さいが依然として大きな量を失う - は、ロッシーコーデックのトランジェントスミアリング（ブロック変換コーデックが鋭いアタックのエネルギーをMDCTブロック全体に広げ、ピークを下げつつ総エネルギーをおおむね保持する。このカタログの他の場所では本物の、無害な現象です）だと仮定されていました。しかしそれは違いました。wavと出荷されたogg/mp3の両方をデコードし、実際のエネルギーを計測したところ、これら3つのプリセットはロッシーエンコードを通じて本物の、実質的なエネルギーを失っていることがわかりました - `pickup-key`はカタログ自身の出荷バリアントで13.2から16.5dB、`impact-glass-light`は最大6.6dB、`footstep-metal`は最大7.8dB - そして、それぞれのソースwav自身への16kHzの急峻なハイパスがその理由を示しています：それぞれのプリセット自身のエネルギーの97.4%、77.6%、31.0%が16kHzより上にあり、ffmpegのネイティブvorbisエンコーダーとlibmp3lameの両方が、このカタログの品質設定でまさにフィルタリングして除去してしまう範囲の内側にあります（影響を受けないプリセットである`impact-metal-heavy`は、そこにエネルギーの0.0%しか持ちません）。トランジェントスミアリングはエネルギーを保持しますが、コーデック自身のローパスがソースが持つ機会すら与えられなかったコンテンツを除去するのはそうではありません - この3つについては、wavと出荷されたロッシーファイルは計測上のアーティファクトではなく、実際に異なる音です。これらは除外されており（`build-catalog.mjs`の`EXCLUDED_PRESETS`）、sfx-engine自身のモーダル合成がなぜそこにエネルギーを置くのかを見つけ、根本原因を修正するためのフォローアップチケット（`docs/BACKLOG.md`、GS-05）があります - エンジン自体のチューニングはこのチケット（決定52、この決定）のスコープ外のままです。ビルド全体の集計平均チェックにも、この枠組みで見るとそれ自身の、別の問題がありました：ビルドの生成側の半分だけ（約1092バリアントの半分）にバグが仕込まれても、カタログ全体の平均はおよそ0.4dBしか動かず、厳しめの境界値の下でも余裕で通過してしまいます - 部分的な回帰が平均の中に隠れてしまう可能性がありました。ピーク自体もどちらの役目にとっても単に間違った信号でした。ロッシーコーデックの下では両方向に脆く、そのため以下では情報提供用のビルドログデータ（`collectFormatPeakDeltas`）としてのみ保持され、ゲートとしては使われません。

`FORMAT_ENERGY_TOLERANCE_DB`（1.0dB）は、上記の3つの除外の後の、実際の健全なカタログから導出されています：残りのすべてのフォーマット/チャンネルの読み取り値にわたる実測の最大|エネルギー差分|は0.56dB（`footstep-water-puddle`、残りの中で最悪のもの）です。このチェックが捕まえようとしているバグ（旧oggフォールバック経路の`-ac 2`アップミックス）は、影響を受けるすべてのチャンネルにおいて、正確な、コンテンツに依存しない-3.0103dBのシグネチャ（`10*log10((1/sqrt(2))**2)`、ピーク領域の`20*log10(1/sqrt(2))`と数値的に同じ値。一様な振幅スケールはどちらの領域でも同じdB差分を生むためです）を持ちます。1.0dBは両側に実質的な余裕を持って収まります：健全な最悪ケースの上に約0.44dBの余裕、バグ自体の大きさの下に2dB超の余裕です。これにより単一のバリアントが直接システマティックなバグを捕まえられるようになり、部分的な回帰はもはや平均の中に隠れられません - 生成側の半分だけにバグを仕込んだ場合、旧設計の平均はおよそ0.4dBしか動かず、通過してしまっていたでしょう。`apps/sounds/test/audio.test.mjs`と`apps/sounds/test/checks.test.mjs`は両方の修正とエネルギーゲートを証明しています。修正前のoggの引数が同じ入力を繰り返しエンコードすると実際に異なるバイト列を生成するという標準的な回帰記録、旧`-ac 2`の差分が集計なしで単一のバリアントで直接`checkFormatEnergy`を失敗させるという直接的な証明、HF優勢な信号のロッシーエンコードがエネルギーを失う場合も失敗するという証明、そして実際の`encodeVariant`本番経路を通した実フィクスチャの回帰（約20.5kHzのナイキスト近傍のトーン）が、アサートされた数値だけでなくコード上でHFエネルギー損失の知見を証明しています。

**ラウンド3：ENERGYの計測方法そのものが間違ったものを測っていました。** この設計自体を変えないままの、後日のローカルビルドが、`FORMAT_ENERGY_TOLERANCE_DB`に対して36個の音声で失敗しました - このチケットのスコープに一切含まれない、既存の`origin: "chipvoice"`の33個の音声に加え、すでに除外されている3つに加えてさらに3つの生成プリセット（`ui-hover`、`ui-toggle-off`、`ui-text-blip`、いずれも短い「minimal-ui」オシレーターブリップ）です。最初の解釈はさらなるコーデックのパスバンド損失だというものでしたが、そうではありませんでした。実際の原因はこうです：`energyPerChannel`が平均（二乗の合計をサンプル数で割ったもの）を計算していたこと、そしてこの開発マシンのffmpegがlibvorbisなしでビルドされているため、`scripts/lib/audio.mjs`のoggフォールバック経路（`vorbisEncoderArgs`）がffmpeg自身の「実験的」なネイティブvorbisエンコーダーを使うこと、そしてそのエンコーダーがoggの終端グラニュールをトリムしないことです。このマシンでデコードされたoggは、次の1024サンプルのブロック境界まで（最大1023サンプル、44.1kHzで約23ミリ秒）末尾に無音がパディングされた状態で戻ってきます。パディングはサンプル数を増やす一方で二乗の合計はほとんど変えないため、平均は人為的に低い値を示します。長さがわずか1000から3500サンプル程度のクリップ（まさに`ui-*`プリセットのサイズ）では、そのパディングが全長に占める割合が大きく、1.0dBのゲートを引っかけるほどの大きなバイアスになります。mp3は影響を受けません（ffmpegはすでにLAME自身のギャップレスパディングをトリムしています）し、CIのffmpeg（Ubuntu aptパッケージ）はlibvorbisを備えてビルドされておりこの経路を一切通りません - この欠陥はこのマシン特有のもので、出荷される音声そのものの欠陥ではありません。修正は、`energyPerChannel`が平均ではなく合計（総エネルギー、平均二乗パワーではない）を計算するようにしたことです。これは末尾のゼロ値パディングに対して不変である一方、本物の一様なゲインバグ（上記の`-ac 2`のケース）は依然として同じ`10*log10(k**2)`の差分を生みます。比率においては長さの項が打ち消し合うため、この修正はゲートが本来捕まえるべきバグへの感度を一切失っていません。修正済みの合計指標でローカルカタログ全体を再計測したところ（270音声、1080バリアント、3240件のogg/mp3フォーマット/チャンネルの読み取り値）：平均|差分|0.0327dB、p99|差分|0.3595dB、最大|差分|0.5556dB、これも`footstep-water-puddle`のままで - 元の（平均ベースの）計測がそのプリセットについてすでに見つけていた数値と0.005dB以内の差しかありませんでした。これは、その~10,500から11,500サンプルのバリアントが1024サンプルのブロック境界から十分離れており、バイアスがほとんど届かなかったためです。`FORMAT_ENERGY_TOLERANCE_DB`は、修正後の指標のもとでも1.0dBのままとし、両側に同じ実質的な余裕を持ちます。3つの`ui-*`プリセットは合計に切り替えると余裕をもって通過し（最悪の差分は-0.05、-0.10、-0.18dB）、本物の欠陥だったことは一度もなく、この計測アーティファクトにすぎませんでした。上記の3つの除外は同じ方法で再チェックされ、想定ではなく再計測のうえで、修正後の指標のもとでも成立することが確認されました：`pickup-key`はいまや13.2から18.2dB、`impact-glass-light`は6.1から6.9dB、`footstep-metal`は2.2から15.6dB - そして`footstep-metal`については特に、8つの候補シード全てが許容値を超えており、最悪のものだけではありません。これにより、その除外自体が部分的にパディングされた平均のアーティファクトだったのではないかという未解決の疑問に決着がつきました：そうではありませんでした。`apps/sounds/test/audio.test.mjs`は、実際の`combat-shoot-16bit-snes`の形状（2048にパディングされた1029個の実サンプル）を使い、これについて3つの回帰テストを追加しています：パディングされた無音の信号は修正後のゲートを通過すること、同じ信号を`1/sqrt(2)`倍したものは依然として正確に-3.0103dBで失敗すること、そして削除された平均二乗の計算式が、パディングされたケースだけで約-3dBを示していただろうことを、アサートされた数値だけでなくコード上で証明する純粋な回帰ガードです。パディングの欠陥自体は - いまやゲートにとっては無害ですが、開発者のローカルのoggバイト列をCIのものと一致させるためには修正する価値があります - このチケットで修正するのではなく、既知の、ブロッキングではない問題として追跡します（`docs/GAMESOUNDS.md`のoggフォールバック・アップミックスのセクション、`docs/BACKLOG.md`のGS-06）。

**スタイル：プリセットが実際に何をモデル化しているか、無理な当てはめは一切なし。** `impact`、`footstep`、`whoosh`、`explosion`の各プリセットは現実世界の物理（叩かれた素材、歩かれた地面、空気の動き、爆発）をモデル化しており、`realistic`に分類されます。`scifi`プリセットは合成的なサウンドデザインなので`scifi`のままです。`magic`プリセットは呪文・詠唱の内容なので`fantasy`に分類されます。`ui`プリセットは短いオシレーターのみのブリップなので`minimal-ui`に分類されます。`pickup`は、一括ルールではなくプリセットごとに判断された唯一のファミリーです。`pickup.ts`自身のヘッダーは、その温かみのある、チューニングされたオシレーターのアルペジオ（`coin`、`gem`、`powerup`、`level-up`）を意図的に「8ビットの矩形波の紋切り型ではない」と呼んでいるため、それらは`cartoon`に分類されます。一方`key`は、このファミリーの中で唯一物理に基づくプリセット（叩かれた金属のモーダルなジングル）なので、同じ合成技術を共有する物理的衝突ファミリーと並んで、正直に`realistic`に分類されます。空のスタイル区分に無理に音を当てはめて埋めることはしません。`cartoon`、`horror`、`cozy`のどれも、それだけの理由では埋められません。空の区分は誤ってラベル付けされるより、空のまま正直でいる方を選びます。`apps/sounds/catalog/generated-recipes.mjs`自身のヘッダーには、この同じ理由づけがマップの各行の隣に1行ずつ書かれています。`docs/GAMESOUNDS.md`の「生成された音」セクションがその正典的な要約です。

**保護機構。** すべての生成バリアントは、chipvoiceの全バリアントと同じ`checkSound`を通過し、新しい`checkGeneratedVariantCount`（`checkChipvoiceVariantCount`と同じ最低3本のフロア。`origin === "generated"`でゲートされているため、どちらのルールも相手の音声に誤って適用されることはない）も含みます。バリアントが失敗した、スタイルの判断が正直に下せない、あるいは単に音が間違っているプリセットは、`build-catalog.mjs`の`EXCLUDED_PRESETS`マップに理由付きで名指しされ除外されます。とにかく出荷したり、属さない区分に無理やり押し込めたりはしません。このチケット自身のビルドはこの方法で3つのプリセット（`pickup-key`、`impact-glass-light`、`footstep-metal` - それぞれが除外された実測上の理由は、ラウンド3の修正を含む上のフォーマットエネルギーの各段落を参照）を除外します。プリセット自身の音のチューニングはこのチケットのスコープから明確に除外されています。sfx-engineのコミット済みハッシュフィクスチャ（決定52）はこのチケットでは触れられておらず、チューニングが必要なプリセットは黙って質の低いまま出荷されるのではなく除外されます。`POST /api/v1/resolve`は、通常の、出自を問わないスタイル一致によって生成音声に到達します。正しくスコープされた保証は、`apps/sounds/test/resolve-generated.test.mjs`が実際にビルドされたカタログに対して、一部だけでなく網羅的に証明しています：カタログが実際に問い合わせられうるすべての（カテゴリ、タグまたはなし、スタイル）の組み合わせについて、chipvoiceのみの選択が存在する場合は常に、カタログ全体での選択はそのchipvoiceのみの選択と一致します - 生成音声はchipvoice音声が残した隙間を埋めることしかできず、既存のものを上書きすることは決してありません。これは`pickSoundForEvent`のスタイルのフォールバックとidのタイブレーク（生成音声のidはすべて文字で始まり、タイブレークの`localeCompare`の下でchipvoiceの数字始まりの`8bit`/`16bit`より後にソートされます）が、既存のchipvoiceの候補を決して飛び越えないためです。これは以前は何も解決しなかった組み合わせにとっての、実際の、意図された挙動の変化であり、無変化ではありません：チェックした405通りの組み合わせ（85カテゴリ、実際に使われているすべてのタグ、3種類のスタイル - なし、`8bit`、`16bit`）のうち、138通りが以前は何も解決しなかったものが、いまは生成音声に解決します - 46個のユニークな（カテゴリ、タグ）の隙間があり、それぞれが3種類のスタイルすべてで同じように埋まるため、138のうち92は、スタイルなしのデフォルトだけでなく、`8bit`/`16bit`のリクエストが新たに生成音声に到達したケースです。例：`movement/footstep/concrete`、`movement/footstep/wood`、`combat/explosion/small`、`combat/shield`、`ui/toggle/on`、`collect/coin/coin`、`magic/cast/shimmer`はいずれも、以前は明示的な`8bit`または`16bit`のリクエストでは何も解決しませんでした（どのスタイルでもそれらに対応するchipvoice音声は存在しません）が、いまは生成音声に解決します - これは正しい挙動です。gamesoundsの解決動作は、タグをまたいでフォールバックすることは決してありませんが、スタイルをまたいで検索を広げて何も返さないよりは広げることを常に行ってきました。chipvoiceのみのカタログが実際に持つ隙間を生成音声が埋めることは、より広い候補プールの上で同じフォールバックが仕事をしているだけであり、新しい種類の上書きではありません。

同じ不変条件は、EXCLUDE（交換）経路、つまり`pickSoundForEvent`の`exclude`パラメータ（CLIの`swap`）にも及びます：chipvoiceのみの選択が存在するすべての組み合わせについて、その選択自身のidを除外すると、chipvoiceのみのプールがその選択を除外した後も別の候補を持っている限り、chipvoiceのみのプールと全体のプールの両方で同じ次の選択が得られなければなりません。chipvoiceのみのプールに他の候補がない場合 - `pickSoundForEvent`自身の文書化されたフォールバックは、何も返さないのではなく除外された同じ音声を再び返します。「他に候補がない交換リクエストは、正直にそう言うべきである」 - 全体のプールで許される唯一の違いは、「同じ音声を再び返す」の代わりに生成音声がその隙間を埋めることであり、交換のケースに適用された同じ「隙間を埋めるのであって上書きしない」というルールです。これも`apps/sounds/test/resolve-generated.test.mjs`によって、同じ実際にビルドされたカタログと同じ本番の`pickSoundForEvent`関数に対して網羅的に証明されており、2つ目の手書きの選択ロジックを使うことは決してありません。

**変わること。** `apps/sounds/catalog/generated-recipes.mjs`（新規）、`scripts/build-catalog.mjs`（生成側をレンダーしてマージ）、`scripts/lib/checks.mjs`（`checkGeneratedVariantCount`）、`packages/gamesounds/src/types.ts`（`Origin`のドキュメントコメントはもう「このフェーズでは構築されない」と言わない。`Variant`は任意の`recipe`を得る。生成バリアントごとに1つ）、`src/lib/openapi.ts`（同様。そこから導出される`/openapi.json`/`/llms.txt`/`/skill.md`/`/.well-known/mcp.json`すべてに反映）、そして音声詳細ページ（その音声がチップエミュレーションとsfx-engineのどちらで作られたか、どのモデルかを明示する）。`packages/gamesounds`のCLIとランタイムはコード変更を必要としませんでした。音声の出自はどちらにとっても不透明であり、両者は解決済みの`Sound`/`Variant`しか扱わないからです。新しいテストカバレッジのみが追加されました。CIの`sounds`ジョブは、すでに`packages/chipvoice`と`packages/web-kit`を先にビルドしているのと同じ理由（`build-catalog.mjs`がビルド済みの`dist/`を直接importするため）で、いまは`catalog:build`の前に`packages/sfx-engine`もビルドします。`apps/sounds/vercel.json`の`ignoreCommand`は変更なしです。サイト自身の`src/`は`packages/sfx-engine`を一切importせず（importするのはビルド時の`scripts/build-catalog.mjs`だけ）、Vercelの`buildCommand`は`catalog:build`を一切実行しません（すでにコミット済みの`generated/catalog.json`をそのまま配信します）。そのため`packages/sfx-engine`への変更はVercelがビルド・配信するものに影響しません。

**追記、GS-07 v1（2026-09-29、同日のうちに下記で置き換え）：ラウンド3の「パディング」という説明は不完全だった - ネイティブフォールバックのoggの経路は音声を単にパディングするだけでなく、実際にドロップする。** 上記のラウンド3（および`docs/GAMESOUNDS.md`の「既知の、ブロッキングではない問題」セクション）は、ffmpegのネイティブvorbisエンコーダーが、デコードされたoggを次の1024サンプルのブロック境界まで無害な無音でパディングして返す、と説明していた。それはほとんどの入力長については真だが、すべてではない。このマシン（ffmpeg 8.0.1、libvorbisなし）で、880Hz、振幅0.4（リニア）のモノラルトーンを使い、`vorbisEncoderArgs("native")`と`BITEXACT_ARGS`を正確に組み合わせてエンコードし、デコードし直したところ直接測定できた：`n mod 1024`がおおよそ[962, 1023]に入る入力長、および剰余がちょうど0になる任意の長さは、最後の1024サンプルのブロック全体を欠落させたままデコードされる - パディングではなく、本物の、無音でない音声が失われている（`n=3071`、剰余1023は2048にデコードされる。`n=4096`、剰余0は3072にデコードされる）。`n=1023`/`n=1024`はゼロサンプルにデコードされ、音声全体が消える。`main`（コミット`3b40c16`）で実際に出荷されている1080個のoggすべてをデコードしたところ、そのうち56個（5.2%）が実際にこのドロップする帯域に入っており、平均999サンプルが失われていた。この追記が出荷した修正 - `encodeVariant`内部でのエンコード・検証・再試行、新しい`oggEncoder`テストオプションでネイティブ限定に強制したもの - はローカルでは通り、まさにその56個のoggの`files.ogg`フィールドだけを動かした。**しかしCIは一度も通過しなかった。** その結果できたPR（#126）に対するCI自身の`sounds`ジョブの失敗が、下記の再調査の引き金となり、この追記を全面的に置き換える。

**追記、GS-07 v2（2026-09-29）：v1は間違った層を非難していた - ファイル自身の末尾から本物の音声を切り詰めていたのは、どちらのvorbisエンコーダーでもなくDECODER（デコーダー）であり、CIのlibvorbisのoggも切り詰められている。** ネイティブエンコーダーの分岐だけを再試行するv1の修正は、libvorbisを備えたCIのffmpegの上では常にno-opにしかなり得ず、実際にCIの`sounds`ジョブはどのみち失敗した（1080個のバリアントのうち333個が長さゲートに失敗し、そのすべてがちょうど128フレーム短かった）- この欠陥がネイティブエンコーダーに固有のものでは一度もなかったことの証明である。直接の測定が、この欠陥が実際にどこにあるかを決着させる。oggの自身のグラニュール位置 - ストリームの最終ページが正確に何サンプルフレームを含むかを述べる、権威ある標準フィールド - はバイトストリームから直接読み取れ（デコーダーは一切介さない）、どちらのエンコーダーでも常にソースのフレーム数以上である：ネイティブエンコーダーのoggは`n=1023`でグラニュール`1024`を、`n=3071`でグラニュール`3072`を、`n=4096`でグラニュール`4096`を、`n=10035`でグラニュール`10048`を持つ。同じ`n=10035`のソースをlibvorbisでエンコードすると、グラニュールは`10035`となり、真のコンテンツ長と正確に一致する。参照用のlibvorbisデコーダーはこれらのファイルすべてを丸ごと再生する。エンコーダーは、どちらのエンコーダーも、一度も問題ではなかった - それが生成するすべてのファイルは、すでに自分自身の完全なコンテンツを宣言し、かつ含んでいる。

実際に音声を切り詰めているのはDECODER（デコーダー） - 複数形であり、互いに、そしてグラニュール位置が述べる真実と食い違っている：

- **ffmpeg自身のCLIデコーダー**（`apps/sounds/scripts/lib/audio.mjs`の`decodeToRender`が使うもの、つまり`checkFormatLengths`自身が読んでいたもの）は、libvorbisでエンコードされたものを含むあらゆるoggの末尾から最大128フレームを落とす。直接再現済み：グラニュールが完全な`n=1023`のネイティブエンコーダーoggは（グラニュール`1024`、証明可能に完全）、`ffmpeg -f f32le`でデコードすると**ゼロフレーム**になる - 音声全体が、自身のヘッダーが完全だと述べているストリームから、デコーダーによって消される。グラニュールが正確な`n=10035`のlibvorbis oggは（グラニュール`10035`、パディングは一切なし）9907フレームにデコードされ、128フレーム短い。最初の9907サンプルは参照デコードと1.5e-5以内で一致し、失われた末尾のピークは0.00024 - 本物のコンテンツだが、静かなだけだ。libvorbisで再エンコードされた1080個のライブバリアント全体で（下記のGS-06/GS-07 v2の修正、テールガード適用前）、この同じffmpeg CLIデコーダーで1080個中610個（56.5%）が、ソースよりちょうど128フレーム短くデコードされる - 短くなる場合は常にちょうど128であり、それより多くも少なくもない。
- **実際のブラウザ**（Playwright 1.62.1、`OfflineAudioContext(1, 44100, 44100)`への`decodeAudioData`、コンテンツ損失のしきい値として「絶対値が1e-3を超える最後のサンプル」）は、ffmpeg CLIとも互いとも食い違う。現行の（ネイティブエンコーダーの）ライブカタログでは、1080バリアント全体にわたって：Chromiumは5個を完全にデコードできず（いずれも`ui-typewriter-*`プリセットの最短テイク）、残り1075個のうち1013個を自身のwavより短くデコードし、Firefoxが再生する内容と比べて747個で可聴なコンテンツを失う（平均465.3サンプル、最大1024サンプル、44.1kHzで約10.5から23.2ミリ秒）。一方Firefoxは1080個すべてを丸ごとデコードする。ffmpeg CLI自身のデコード長がChromiumのものと一致するのは1080個中1004個（93.0%）だけであり、測定可能な程度に、同じバイト列に対してブラウザが行うことの忠実な代理ではない。

同じ1010個のユニークなライブwavを`sox -R in.wav -C 5 out.ogg`（libvorbis、モノラル、下記のGS-07 v2の修正）で再エンコードすると、Chromiumでの結果ははるかに良くなるが完璧ではない：デコードエラーはゼロ。1080個中686個（63.5%）は依然として自身のwavのフレーム数より短くデコードされるが、その差は最大128フレームにとどまる（上のffmpeg-CLIの数値とほぼ正確に一致 - その686個のうち610個は、まさに同じファイルを同じ方法で読むffmpegのCLIデコーダー由来）。最後の可聴サンプルはFirefoxと1080個中917個（84.9%）で正確に一致し、残り163個（15.1%）では1から179フレーム早い（平均74.4、p99はおよそ150）。最悪の単一ケースである`movement-swim-16bit-snes`のテイク3（ソース15888フレーム）：Chromiumは15760フレームをデコードし、最後の可聴サンプルは15675。Firefoxは15888フレームすべてをデコードし、最後の可聴サンプルは15854 - バッファ長の不足は128フレームだが、最後の可聴サンプルのギャップは179フレームであり、これはすでにほぼゼロに近いフェードテイルのデコーダー自身のレンダリングが、文字通り欠落していないバッファの内部でも変わりうるためだ。バッファ長とコンテンツ損失は関連しているが同じ計測ではなく、本物のコンテンツを守るためのガードにとって重要なのは大きい方（128ではなく179）である。Firefoxはここでも1080個すべてを丸ごとデコードする。

mp3にはこれと同等のコンテンツ損失問題はないが、これまで計測されていなかった別の問題がある：Chromiumは1080個のライブmp3すべてでギャップレスかつ正確である（1042個は正確にwav自身のフレーム数にデコードされ、残り38個は4から46サンプル長いだけで、平均23.4、短くなるものはない）。Firefoxもすべてのmp3を丸ごとデコードするが、LAMEエンコーダー自身のプライミング遅延をChromiumのギャップレス再生のようにはトリムしないため、同じファイルのデコードはChromiumのデコードよりちょうど576サンプル遅れる（44.1kHzで13.06ミリ秒、mp3のちょうど1グラニュール - 576サンプルはMPEG-1 Layer IIIの固定グラニュールサイズ）。これはwavに対する相互相関ラグ探索を1080個のライブバリアントすべてで実行して確認した値で、Chromiumは1080個すべてでラグ0、Firefoxは1080個すべてでラグ+576、最良ラグでの正規化相関の最小値は両エンジンとも0.888だった - 中央値でも範囲でもなく厳密な値だ（全手法と、それが置き換えたより不正確な計測については下記のこの決定のGS-07 v2.2追記を参照）。この先頭遅延の数値は、Firefox自身のデコード長がwavのフレーム数を623から1774サンプル（平均1172.0）上回る値より小さく、かつ異なる量である：この長さの超過は先頭遅延に加え、Firefoxがトリムし損ねている末尾のパディングも含んでおり、レイテンシーそのものではない（下記のこの決定のGS-07 v2.1追記を参照 - この段落の以前の版は623から1774の長さの超過全体を「14から40ミリ秒のレイテンシー」と呼んでおり、この2つを混同していた）。いずれにせよこれは本物の、別個の欠陥であり（追加された先頭の遅延であって、コンテンツの喪失ではない）、新しいバックログ項目GS-08として追跡され、このチケットでは修正されていない。このカタログにはループ音声が存在しないため（`docs/BACKLOG.md`）、末尾の無音処理 - パディング、ガード、あるいはどちらかのデコーダー自身の末尾トリム - がシームとして可聴になることは一度もない。

**修正は2つの部分からなり、どちらも`apps/sounds/scripts/lib/audio.mjs`にある。** 第一に、ffmpeg自身のvorbisエンコーダー - ネイティブもlibvorbisも - の使用を完全にやめる：どのマシンでも、開発機でもCIでも、すべてのoggはいまや`sox -R <wav> -C 5 <ogg>`でエンコードされる（`-R`：決定論的な疑似乱数状態で、同じ入力の2回のエンコードにわたってバイト単位で再現可能であることを証明済み。`-C 5`：ロッシーフォーマット向けのsox自身の文書化された品質ノブで、ffmpegの`-q:a 5`とまったく同じようにlibvorbis自身の品質APIへ直接渡される - 同じエンコーダー、同じスケール、同じ目標品質、異なるフロントエンド）。`sox`とそのvorbisフォーマットハンドラー（Ubuntu/Debianでは`libsox-fmt-base`/`libsox-fmt-all`）はいまやビルドの必須要件であり、`ensureSoxVorbis`が最初のエンコード前に両方を確認し、どちらかが欠けていれば何をインストールすべきか具体的に名指しする実行可能なエラーを投げる。黙ってスキップしたりフォールバックしたりすることは一切ない。これにより開発マシン固有のコードパスが完全に取り除かれ（もう分岐しうる「ネイティブ」の枝は存在しない）、副作用としてGS-06（どこでもlibvorbis）を実現する：soxはソース自身のモノラルのチャンネル数も維持するため、oggもいまやwavとmp3同様モノラルになる - 旧ネイティブフォールバック経路のデュアルモノステレオへのアップミックスと、その自前のユニティゲインのパンフィルターは、もうどのマシンにも存在しない。第二に、完全かつ正しくエンコードされたlibvorbisのoggであっても、ffmpegのCLIデコーダーとChromium自身の末尾トリムのうち悪い方によって、生のバッファ長で最大128フレーム、本物のコンテンツで最大179フレームを失うため、`encodeVariant`はいまやすべてのエンコードの前に、固定の`OGG_TAIL_GUARD_FRAMES = 256`ゼロサンプルパディングをoggエンコーダーの「入力」にのみ（出荷されるwavやmp3には一切）追加する - 見た目のきりが良い「128」という数字だけでなく、実測された2つの最悪ケース（128と179フレーム）の両方を実質的な余裕を持ってクリアするよう選ばれている。`checkFormatLengths`は真の、パディングされていないソースのフレーム数と比較し続ける。変わるのはoggエンコーダー自身の入力だけだ。

**CLIデコーダーに基づくゲートは構造的にブラウザの挙動を見ることができないため、新しい実ブラウザゲートが存在する。** `checkFormatLength`/`checkFormatLengths`（`apps/sounds/scripts/lib/checks.mjs`）はロジック上変わっていない - ffmpeg CLIのデコードがソースのフレーム数以上であること、短い側の許容値はゼロ - そして`checkFormatEnergies`と並んで`checkSound`に結線されたままであり、エネルギーでは見えないクラスの損失（すでに静かだった信号の一部から除去されたコンテンツ）をまさに捕まえる。しかし上の1004/1080というChromium一致率の数字は、そのゲートを通過することが実際のブラウザがファイルを丸ごと再生する証明では一度もなかったことを意味する。`apps/sounds/scripts/check-browser-decode.mjs`（新規）は、カタログのすべてのoggとmp3を実際のChromiumとFirefoxの両方でデコードする（エンジンごとに1回のブラウザ起動、1つのページを使い回し、プロセス全体で30分のハードタイムアウト、どちらのブラウザも`finally`で閉じる - ローカルでの実測ではフルの1080バリアントのカタログ全体を両エンジンで約38秒）。使うのは上の数値を計測したのと同じ`decodeAudioData`/`OfflineAudioContext`の方法論だ。ビルドを失敗させるのは：デコードエラー、デコード長がwav自身のフレーム数より短い場合、そしてogg限定で「同じファイル」の基準デコードとの不一致（soxが持つ基準デコーダー〈libvorbisfile〉が出荷される各oggの正確なバイト列をデコードし、ブラウザ自身のその同じバイト列のデコードと`[0, sourceFrames)`の範囲でサンプルごとに比較し、`DECODER_AGREEMENT_TOLERANCE` = 1e-3を超えた場合。この純粋な比較ロジックは`apps/sounds/scripts/lib/decode-judge.mjs`に切り出されており、ブラウザを起動せずに`node --test`で検証できる）。wavではなくファイル自身の基準デコードと比較することで、このゲートが本当に答えるべき問い - ブラウザ自身のデコーダーがファイルに実際に含まれているものを返したかどうか - に答えられ、コーデック自身のすでに別ゲート（`checkFormatEnergies`の仕事）で検査済みのロッシーな量子化を誤って捕まえることがない（なぜ以前のバージョンのこのゲートがwavと比較していたか、そしてそれがなぜ誤りだったかは下記のGS-07 v2.1追記を参照）。Firefoxのmp3の先頭遅延は報告されるだけで、失敗にはならない - それはこのゲートの関心事ではなくGS-08の関心事だ。実際のカタログを検証する前に、3つのネガティブフィクスチャがそれぞれ固有のルールで（「いずれかの失敗」ではなく）失敗することを、両エンジンで要求する：長さフィクスチャ（テールガードなしで、宣言された長さより本当に1024フレーム早く終わるよう作られたogg、長さのルールのみで失敗しなければならない）、コンテンツフィクスチャ（8192フレームの0.4のトーンの末尾1024フレームをエンコード前にゼロにしたもの、本番と同じ長さ・同じ`OGG_TAIL_GUARD_FRAMES`ガード付きで、ゼロにする前のトーンの別エンコードの基準デコードと比較し、一致のルールのみで失敗しなければならず、長さのルールには通らなければならない）、そして同じ構成を2e-3〈-54dBFS〉の振幅で作ったもの（述べられた許容誤差より上に隠れたレベルの床がないことを証明する）。この3つのいずれかが両エンジンでそれぞれ固有の期待される失敗を示さなければ、チェッカー自身が信用できないと証明されたことになり、実際のカタログの実行を丸ごと拒否する。`sounds`のCIジョブに結線されており（いまやFirefoxもインストールするようになった。Chromiumだけではない）、プッシュ前のローカル実行用に`pnpm sounds:check-decode`として公開されている。

**再構築されたカタログに対して計測すると、この基準デコードゲートは十分な余裕を持ってクリーンに通過する。** 1080個のライブoggすべてにわたって、`|browser - reference|`の最大不一致はChromiumとFirefoxの両方で1.54e-5であり、`DECODER_AGREEMENT_TOLERANCE`（1e-3）を約65倍下回る - このゲートが出荷前に要求する10倍のマージンを十分に超えている（全容の方法論と、なぜ許容値自体を変える必要が一度もなかったかについては下記のGS-07 v2.1追記を参照）。`check-browser-decode.mjs`は再構築されたカタログに対してクリーンに通過する：Chromiumで0件の失敗、Firefoxで0件の失敗、両エンジンそれぞれ2160件のogg・mp3デコード全体にわたって。

**新しいエンコーダーのもとでカタログを再構築すると、すべてのバリアントのoggだけが動き、他は何も動かない。** 1080バリアントすべての`files.ogg`エントリー（sha256、バイト数、url）が変化した。`files.wav`と`files.mp3`は1件のバリアントたりとも変化しなかった（バイト単位で同一、同じsha256 - 再構築後の`generated/catalog.json`を再構築前のコミット済みバージョンとフィールドごとに突き合わせて確認済み）。音声もバリアントも1件も追加・削除されなかった（270音声、1080バリアント、前後とも同じ）。他のいかなるフィールドも - `measure`、`peaks`、`duration`、`recipe`、`category`、`tags`、あるいはトップレベルの`categories`リストも - どの音声・バリアントでも変化しなかった。`public/f`はコンテンツアドレス方式で追加専用のため、修正前の旧oggファイルはいまも物理的にそこに残っており、前後比較をやり直したい人のために使える。

**新しいエンコーダーのもとで`FORMAT_ENERGY_TOLERANCE_DB`と3つの`EXCLUDED_PRESETS`を再計測した。** 再構築は、新しいエンコーダーのもとでの実際の分布を、2160件すべてのogg/mp3エネルギー読み取り値にわたってログに記録した：平均|差分|0.0474dB、p99|差分|0.2985dB、最大|差分|0.4789dB（最悪の単一の読み取り値：`movement-footstep-realistic-footstep-water-puddle`で-0.48dB）- `FORMAT_ENERGY_TOLERANCE_DB`の1.0dBの内側に実質的な余裕を持って収まっており、許容値自体を変える必要はない。3つの`EXCLUDED_PRESETS`（`pickup-key`、`impact-glass-light`、`footstep-metal`）それぞれを独立に再レンダリングし（採用されたテイクだけでなく8個の`SEED_LADDER`シードすべて）、新しいsox/libvorbisのoggと（バイト単位で同一の、変化していない）mp3に対して再計測した：損失はエンコーダーの切り替え前と実質的に変わっていない - `impact-glass-light`（6.05から6.86dB）と`footstep-metal`（2.17から15.59dB）は既存の記録範囲と数百分の1dBの差しかなく、`pickup-key`の最悪シードの範囲は13.2-18.2dBから12.64-18.17dBへ動いた（依然として許容値をはるかに超えている）。3つの除外はすべて依然として発動し、除外されたままである。`build-catalog.mjs`の理由の文字列は、再計測された数値に更新した。

**残っている未解決事項。** GS-06（どこでもlibvorbis）とこのGS-07 v2の修正は同じPR（#126）で共に出荷される - 開発者のローカルのoggの再構築は、同じ入力に対していまやCIとバイト単位で一致するようになり、旧来の乖離を単に許容するのではなく副作用としてGS-06を解決する。GS-08（Firefoxのmp3先頭遅延・エンコーダープライミングの欠陥、`docs/BACKLOG.md`）は未解決かつ未修正のままである - それは追加された遅延であって失われたコンテンツではなく、ここではスコープ外である。

**追記、GS-07 v2.1（2026-09-29）：コンテンツ損失ゲート自身の基準（オラクル）が間違っており、GS-08の数値も誤ってラベル付けされていた。** v2のレビューで、ブラウザゲート自身に2つの欠陥が見つかり、どちらも同じPR（#126）内で修正済みである。上記のエンコーダーの修正（sox/libvorbisをどこでも使う、`OGG_TAIL_GUARD_FRAMES = 256`）は影響を受けておらず、再検討されていない。

コンテンツ損失ルールは、ブラウザのoggデコードを、瞬時の1e-3のしきい値交差でソースのwavと比較していた。これは2つの異なるものを混同している：すでに静かな減衰テイルに対するロッシーコーデック自身の量子化（`checkFormatEnergies`がエネルギーレベルですでにゲートしている）と、本物のDECODERによる切り詰め（ブラウザがファイル自身に含まれているものより少なく返すこと）だ。証拠はレビュー担当者自身の再構築カタログの計測にあった：v2の再構築カタログに対する最初の実走は1080個中96個のバリアントにフラグを立て、その96個すべてがChromiumとFirefoxの両方で同一のギャップサイズを示していた（96個と96個 - 片方のエンジンだけがフラグを立てたものはゼロ）- そしてFirefoxは、この決定の前段のグラニュール位置の証明により、これら1080個のファイルすべてを丸ごとデコードすることが独立に証明されている。2つの独立したデコーダー実装が互いに正確に一致し、ロッシーコーデックがすでに正当に再量子化したwavとだけ食い違うことは、デコーダーによる切り詰めの証拠ではない。それはコーデック自身のエンコードがwavとわずかに異なるという証拠であり、それは予想通りで、すでに別の場所でゲートされている。`REAL_CONTENT_THRESHOLD` = 4e-3は、この96件を見た後で選ばれた（観測された最大1.68e-3のおよそ2.4倍）- つまり、それが判定すべきデータに事後的に当てはめられたしきい値であり、たとえ結果的に本物の切り詰めを一件も隠さなかったとしても、それは事後的な閾値だ。`CONTENT_LOSS_MARGIN_FRAMES`のコメントはさらに、ガード適用前のギャップの分布が「二峰性：正確に一致するか、100フレーム以上異なるかのどちらかで、その中間がない」と主張していたが、それは誤りだった。実際の、ガード適用前に測定された分布（Chromium：<=0フレーム691、1-16フレーム226、17-64フレーム114、65-128フレーム46、>128フレーム3。Firefox、丸ごとのデコーダー：<=0フレーム765、1-16フレーム217、17-64フレーム80、65-128フレーム15、>128フレーム3）は連続的である。さらに、再構築されたファイルのうち45件でChromiumとFirefoxが最後の可聴サンプルについて食い違っていた件を調べたところ（すべてChromiumの方が早く、最大165フレーム）、両エンジンの最後の可聴サンプルは、すべてのケースでwav自身の最後の可聴サンプルより後にあり、その間のwavは正確にゼロだった - これはガードゾーン内のコーデックの残響であり、Chromiumがより積極的にトリムしているだけで、失われたコンテンツではない。96件についての以前の「手作業で確認した」という記述も、確立されたことを誇張していた。実際に決定的だった証拠は、96/96というエンジン間の一致とFirefoxが丸ごとであることの独立した証明であって、耳で聞いて確認したことではなかった。

この修正は、wavベースのルールを基準デコード比較に置き換える：出荷される各oggについて、sox自身の基準デコーダー（`sox <ogg> -t f32 -`、内部はlibvorbisfile - GS-06/GS-07がエンコードに使うのと同じデコーダーを、ここでは純粋にデコーダーとして使う）がその正確なバイト列をデコードし、各ブラウザ自身の同じバイト列のデコードが、`[0, sourceFrames)`の範囲でサンプルごとにそれと比較され、`DECODER_AGREEMENT_TOLERANCE` = 1e-3（以前の誤ったルールが使っていたのと同じ-60dBFSの可聴限界 - この床自体が問題だったことは一度もないため変更なし）で判定される。この比較はラグを探索したり補正したりすることは一切ない：オフセット0は、リサンプリングのない一致した44.1kHzのサンプルレートでの正しいデコードが生成すると期待される値であり、系統的なオフセットがあればそれは覆い隠すのではなく報告すべきバグだ - そのようなものは見つからなかった。`REAL_CONTENT_THRESHOLD`、`CONTENT_LOSS_MARGIN_FRAMES`、そして誤った「二峰性」のコメントは、wavベースの`lastAboveThreshold`の仕組みとともに完全に削除された。純粋な比較・判定ロジックは`apps/sounds/scripts/lib/decode-judge.mjs`へ移動し、ブラウザを一切起動せずに直接ユニットテストされている（`apps/sounds/test/decode-judge.test.mjs`、8ケース：等しい配列は一致する。1.5e-5のノイズを加えた基準は依然として一致する（これはレビュー担当者自身が実測した、実ファイルに対するffmpegとsoxの基準デコーダー間の不一致の値だ）。末尾1024フレームをゼロにしたものと中間のブロックをゼロにしたものはそれぞれ正確な最初・最後の食い違いインデックスを名指しして失敗する。`judge()`の長さ・コンテンツ・デコードエラー・健全なデコードの各経路がそれぞれ独立に振る舞う）。しきい値は計測する前に固定された。計測した数値に合わせてしきい値を調整しないという、このプロジェクト自身の標準的なルールに従っている：再構築された1080個のoggすべてにわたって実測された最大`|browser - reference|`は、ChromiumとFirefoxの両方で1.54e-5であり、1e-3のしきい値のおよそ65倍下であり、出荷前に要求される10倍のマージンを十分に超えていたため、しきい値を広げることは一度も必要にも検討にもならなかった。単一の長さのみのネガティブフィクスチャはいまや3つになり、それぞれが「いずれかの失敗」ではなく自身の固有のルールで失敗することを、実際のカタログの実行が許可される前に両エンジンで検証される：既存の長さフィクスチャ。コンテンツフィクスチャ（8192フレームの0.4のトーンの末尾1024フレームをエンコード前にゼロにしたもの、本番と同じ長さ・同じ`OGG_TAIL_GUARD_FRAMES`ガード付きで、ゼロにする前のトーンの別の独立したエンコードの基準デコードと比較する - 意図的に別ファイルにしている。ゼロにしたファイルをそれ自身の基準デコードと比較しても、そもそも一度もエンコードされなかった欠落コンテンツを捉えることは決してできないからだ）。そして同じ構成を2e-3（-54dBFS）で作ったもの、述べられた許容誤差より上に隠れたレベルの床がないことを証明する。3つすべてが、両エンジンで、常にそれぞれ固有の期待される失敗を示す。

GS-08自身の数値も誤りだった。上記の「623から1774サンプル、平均1172、14から40ミリ秒のレイテンシー」という数値は、Firefoxのデコードしたmp3の長さからwav自身のフレーム数を引いたものであり、その超過は先頭遅延に加えてFirefoxがトリムし損ねている末尾のパディングを含んでおり、レイテンシーそのものではない。実際の先頭遅延 - 同じデコードされたバイト列における、Firefoxの最後の可聴サンプルからChromium自身のそれを引いたもの（両エンジンが同一のビットストリームをデコードするためエンコーダー自身のプリエコーを打ち消し合う比較）- は中央値578サンプル（最小531）であり、44.1kHzで約13.1ミリ秒、mp3の1グラニュール576サンプルに近い。`docs/BACKLOG.md`のGS-08の項目、`docs/GAMESOUNDS.md`、そしてこの決定自身の上記のmp3の段落は、両方の数値とどちらがどちらかを述べるよう修正されている。別に、`check-browser-decode.mjs`自身のファイルごとの情報行は、同じ欠陥に対する、より単純でスクリプトが計算しやすい代理指標を報告する - 各エンジンのデコードされたmp3の最初の1e-3を超えるサンプルから、wav自身の最初の1e-3を超えるサンプルを引いたもの、1080個のバリアント全体にわたる中央値・最小・最大 - なぜならこの前方視的な、エンジンごとのバージョンは、上記のエンジン間の最後のサンプルの数値よりも著しくノイズが多いからだ（Chromium：最小-219、中央値-10、最大37。Firefox：最小-142、中央値-4、最大580）。このカタログの短く打楽器的なチップチューンのアタックの多くは、デコードされたストリームの両方のエンジンの先頭に、それ自身のロッシーエンコーディングのプリエコーを抱えており、このより単純なエンジンごとの指標は、それを本物の遅延と区別できない。一方、同じビットストリームの2つのエンジンのデコードを互いに比較することは、その共有されたプリエコーを打ち消す。このスクリプトはこの情報行を診断としてのみ報告し、決して失敗とはしない。「GS-08とは何か」として引用すべきなのは上記の578サンプル/13.1ミリ秒の数値である。

カタログ自身はこの回で変化していない：`apps/sounds/generated/catalog.json`は、この決定自身のGS-07 v2の修正が生成したバージョン（コミット`6308ea5`）に対して、変化したフィールドがゼロで一致する - この回で変更されたのは、ゲートのスクリプト、その新しいユニットテスト済みのlibモジュール、そしてドキュメントだけである。

**追記、GS-07 v2.2（2026-09-29）：GS-08の先頭遅延の指標は単にノイズが多いのではなく誤っていたため、厳密な値を与える相互相関ラグ探索に置き換えた。** v2.1で`check-browser-decode.mjs`に加わったmp3先頭遅延の情報行は、「デコードしたmp3で最初に1e-3を超えるサンプルから、wavで最初に1e-3を超えるサンプルを引いた値」をエンジンごとに報告していた。カタログ全体でこの値はChromiumで最小-219/中央値-10/最大+37、Firefoxで最小-142/中央値-4/最大+580となり、実際の遅延をまったく示していなかった：デコードされた出力は本当の立ち上がりより前に1e-3を超える（トランジェントの手前に広がるmp3のプリエコーと整合する）ため、単一の瞬時のしきい値交差では本物の遅延と区別できない。

修正は相互相関ラグ探索である（`apps/sounds/scripts/lib/decode-judge.mjs`の`crossCorrelationLag`、ブラウザを起動せずにユニットテスト済み）：wav自身の立ち上がりは探索窓の位置決めにだけ使い、測定そのものには使わない。そのうえで最大4096フレームの窓に対して、デコードしたmp3を`[-1300, +1300]`のすべてのラグでずらし、正規化相互相関が最大となるラグを返す。3つのユニットテスト（`apps/sounds/test/decode-judge.test.mjs`）が、固定周波数のトーンではなく合成チャープで純粋関数を検証する（トーンの自己相関は周期の倍数ごとにピークを持ち、もっともらしいが誤ったラグを返しうるため）：それ自身に対してはラグ0、ちょうど576サンプル遅らせた信号はラグ576、逆方向に早めた信号は正しく符号付きの負のラグを返すこと。

まずカタログの5分の1（7個おきのバリアント、1080個中155個、両エンジン）で計測した：Chromiumは155/155でラグ0、Firefoxは155/155でラグ+576、最良ラグでの正規化相関の最小値は両エンジンとも0.89。次に同じ手法を`check-browser-decode.mjs`の情報行に組み込み（`ONSET_THRESHOLD`/`firstAboveThreshold`は削除）、1080個すべてで計測した：Chromiumは1080/1080でラグ0、Firefoxは1080/1080でラグ+576、最良ラグでの正規化相関の最小値は両エンジンとも0.888。**GS-08はちょうど576サンプル、44.1kHzで13.06ミリ秒、mp3の1グラニュールであり、中央値578/最小531という以前の数値と、この追記が置き換えた指標の両方に取って代わる。**

ラグ探索のCPUコストにより、`check-browser-decode.mjs`のローカル実行時間はv2.1単独の約38秒から、マシンの負荷に応じて65秒から約4分に増えた。`sounds` CIジョブの35分のタイムアウトには十分収まり、変更していない。カタログはこの回も変化していない：コミット`6308ea5`のカタログに対して変化したフィールドはゼロであり、この回で変更されたのはゲートのスクリプト、そのlibモジュールとユニットテスト、そしてドキュメントだけである。

<a id="55-project_jobs-becomes-a-durable-queue-attempts-a-reclaimable-lease-and-a-cron-sweep-no-new-service-2026-09-29"></a>
## 55. project_jobsは永続的なキューになる：attempts、再取得可能なリース、cronスイープ。新しいサービスは追加しない（2026-09-29）

決定27は公開レンダリングを`project_jobs`の1行（`project_id`、`kind`ごと）の背後に置いた（AUD-2：workerの上限、時間／同時実行／頻度／cacheの上限、バージョン付きキー、重複排除、条件付きGET）。しかし永続性は無かった：行はライブなリクエスト自身の`after()`からしか進まず、レンダー中にインスタンスが死ぬと、その行は永遠に`rendering`のまま取り残された。NEXT-19は新しいベンダーや有料のキューサービスを追加せずにこれを解決する：`project_jobs`自身が、`db.ts`がすでに所有する同じSQLite/libsqlデータベース内で、永続的なキューになる。

**状態機械。** 3つの追加専用カラム（`apps/web/src/lib/migrations.ts`、マイグレーション`durable-render-queue`）：`attempts`（整数、デフォルト0）、`lease_expires_at`（null許容のタイムスタンプ）、`dead_letter_at`（null許容のタイムスタンプ）。claimは単一の原子的な`update ... where status='queued' and (同時実行数) < ? returning *`であり、SQLiteは単一ライターなのでこれは古い`not exists(...)`ガードと同様に直列化される。返された`attempts`の値はフェンシングトークンになる：この実行のその後のすべての書き込み（進捗更新、キャンセルのポーリング、保存トランザクション自身の生存確認、終端の`ready`/`failed`/`cancelled`更新）は、この捕捉された値で`and attempts=?`により条件付けられる。リースが再取得されたrunは、新しいclaimが`attempts`を再び増やした瞬間にフェンスを失うので、更新対象が見つからずロールバックし、実際のレンダーがどこまで進んでいようと音声チャンクを一切書き込まない - これにより完了は「少なくとも一度」ではなく「厳密に一度」になる。

`reclaimExpiredLeases(client, now)`が再取得そのものである：リースが期限切れまたは`null`（このマイグレーション以前の行、またはリースが無かったコードがclaimした行は、すでに期限切れとして読まれるので、これ以前のどの行も永遠に詰まったままにはならない）の`rendering`行は、`attempts < RENDER_MAX_ATTEMPTS`（デフォルト3、env `RENDER_MAX_ATTEMPTS`、1-10で検証）なら`queued`に戻り、attemptsを使い切っていれば`dead_letter_at`と可視な`error`を伴って`failed`になる。リースが期限切れになった`cancelling`行は、`queued`には戻らず直接`cancelled`になる - 停止を求めたオーナーのジョブが、死んだインスタンスのリースのタイムアウトによって黙って再開されてはならない。`LEASE_TIMEOUT_MS`は270秒である：レンダーworker自身の240秒のハードデッドライン（`WORKER_DEADLINE_MS`、`runProjectMp3`の`utilityWorker`タイムアウトも同じ）に、終了と最終書き込みのための30秒の余裕を足したもので、リクエストのタイムアウトとは無関係である。

**駆動するもの。** インフラ層では何も新しくない：リクエスト時の処理（インラインのclaimは変わらない）と、5分ごとに呼ばれる新しい`GET /api/cron/sweep-jobs`（`apps/web/vercel.json`の新しい`crons`エントリ経由）。このルートは、`songs/[id]/route.ts`がすでに使っているのと同じ`timingSafeEqual`によるSHA-256ダイジェスト比較で`Authorization: Bearer $CRON_SECRET`を検証し、`CRON_SECRET`が未設定なら常に拒否する（何とも比較しない）。各ティックで`sweepProjectJobs()`は期限切れリースを再取得し、`queued`なものと`mp3_status='queued'`なもの（既存のWAVをアップグレードする、`runProjectMp3`の別の古い経路。これはすでに`mp3_status='queued'`のチェックだけで自然にべき等なのでフェンシング不要）をclaimして実行する。これが実際の永続性のバックストップである：ジョブの進行は、元のリクエストを受け付けたインスタンスが生き続けることにはもはや依存しない。

**スイープルート自身の関数予算は、それが開始するレンダーより長くなければならない。** レビューにより、スイープルートがVercelの`maxDuration = 60`のまま出荷されようとしていたことが判明した - `sweepProjectJobs`はclaimしたレンダーやmp3エンコードをインラインで実行し、どちらも`WORKER_DEADLINE_MS`（240秒）までかかりうる。最初の1分を過ぎてスイープが開始したレンダーは、リースを保持したままVercelに強制終了され、`LEASE_TIMEOUT_MS`（270秒）に加えてさらにもう1回のcron間隔が経過するまで再取得されない - 死んだインスタンスがすでに失ったジョブのバックストップであるはずのスイープ自身が、それを失う側になってしまう。2つの修正を行った：ルートの`maxDuration`をjobs/render/generationsルート自身の予算（このプランで許可されている証拠）に合わせて300にしたこと。そして`sweepProjectJobs`が各`runProjectJob`/`runProjectMp3`呼び出しの前に`sweepHasBudget(start)`をチェックするようにしたこと - これは経過時間を`SWEEP_START_CUTOFF_MS = 300000 - 240000 - 20000 = 40000`（ルートの予算からレンダー自身の最悪ケースを引き、スイープ自身の最終書き込みとテアダウンのための20秒の余裕をさらに引いたもの）と比較する純粋関数である。スイープは自身の実行の最初の40秒間しか新しい処理を開始しない。`apps/web/test-render-queue.mjs`は、データベースも実際のレンダーも不要なため、注入したクロックで`sweepHasBudget`を直接ピン留めする。

**同時実行数の上限は、いまや設定である。** `renderConcurrency()`が`RENDER_CONCURRENCY`（デフォルト1、1-8で検証）を読み、claimの同時実行数チェックに使う。決定27/33の単一スロットのセマンティクスはデフォルトのまま変わらない。

**なぜデータベース内で、新しいサービスではないのか。** どの代替案（マネージドキュー、独自ストレージを持つ第二のworkerフリート）も、新しいベンダー、新しい障害ドメイン、新しいレイテンシーを追加する。このコードベースがすでに所有する行を、SQLiteの単一ライターのセマンティクスが無料で原子的にする`WHERE`句でclaimすることで、キューに必要なすべての性質（可視性タイムアウト、リトライ回数、dead-lettering、べき等なclaim）が、アカウントも請求も新しいネットワークホップも追加せずに得られる。重複排除は変わらない：既存の`unique(project_id, kind)`制約とバージョン付きengineキー（AUD-2、決定43）が、2つの同一リクエストが1行を共有する理由のままである。

**計測（ローカルスタック、使い捨てのSQLiteファイル、このマシンは他の複数のClaudeセッションと共有されているため、下記の各数値は3-5回繰り返し、ばらつきを報告する）：**

- 同一の同時リクエスト（dedup経路）、同じ`(project, kind)`への3並列`createProjectJob`、3回繰り返し：admissionチェック自体（`render:user`、3/分）がdedupとは独立に同時リクエスト数の実際の上限になる - 呼び出し自体は9サンプルでp50 6.0ms/p95 6.2ms（最小3.8ms、最大6.2ms）。3回とも行は1つだけだった。作成からレンダー完了までの往復は2470-8765msで、ばらつきは負荷の高いマシンでのレンダー時間に支配され、キュー自体には起因しない。
- 異なる同時リクエスト、N=5、`RENDER_CONCURRENCY=1`（出荷時デフォルト）：5件すべてが`ready`になるまで2927-7901ms（平均5010ms、スループット約1.0job/s - 決定27の意図通り直列）。
- 同じ5件、`RENDER_CONCURRENCY=3`：7652-14527ms（平均10071ms、スループット約0.5job/s）- このマシンでは改善どころか悪化した。すでに負荷の高いこのラップトップのコアを3つのレンダーが奪い合うためであり、この設定が真に並列実行の利益を生むのは、別々のclaimが別々の計算資源（別々のサーバーレスインスタンス）に着地する場合だけである。この数値は隠さず報告する：`RENDER_CONCURRENCY`を上げることは無料ではなく、その効果は実際のフリートで検証されるべきであり、このベンチマークから想定すべきではない。
- kill test、5回繰り返し：実際のレンダーを開始し、`rendering`になるまでポーリングし、リースを過去に強制し（インスタンスの死をシミュレート）、`reclaimExpiredLeases`を直接呼び、2回目の`runProjectJob`にclaimさせて完了させ、その後に元の（ゾンビの）呼び出しも最後まで走らせる。`reclaimExpiredLeases`自体はレンダーサイズに関わらず0.8-1.9ms - スイープ自体のコストは無視できる。完全な復旧（強制期限切れからリトライしたジョブが`ready`になるまで）は12046-22946ms（p50 14132ms、p95 22946ms）で、これは単に同じフィクスチャを最初からレンダーし直すコストである。すべての繰り返しで`attempts=2`、`dead_letter_at=null`、ゾンビの書き込みはフェンスされて消え（`project_audio`の重複行なし、`bytes`は勝った試行のものとのみ一致）、厳密に一度の完了が確認された。本番環境での検出時間の最悪ケースは`LEASE_TIMEOUT_MS`（270秒）に、cron間隔（5分）を足したもので、ライブなリクエストが先に同じclaimを競う場合はそのリースチェックの時点で即座に復旧する。

**マージ時に本番で変わること。** `apps/web/vercel.json`に、5分ごとに`/api/cron/sweep-jobs`を呼ぶ`crons`エントリが追加される。これはデプロイ時までに本番環境に`CRON_SECRET`が設定されている必要がある - 未設定だとVercel自身のcron呼び出しを含むすべてのリクエストが拒否されるためである。このルート自身の`maxDuration`は既存のjobs/render/generationsルートと同じ300秒であり、プランがすでに他の場所で許可している以上の予算を新たに追加するものではない。他の本番の挙動は変わらない：`RENDER_CONCURRENCY`のデフォルトは1のまま、`RENDER_MAX_ATTEMPTS`のデフォルトは3のまま、マイグレーションは既存の`project_jobs`テーブルに対して追加専用である。

**変更点。** `apps/web/src/lib/migrations.ts`が`durable-render-queue`を追加。`apps/web/src/lib/project-jobs.ts`が`reclaimExpiredLeases`、`sweepProjectJobs`、`renderConcurrency`、`renderMaxAttempts`、`sweepHasBudget`を追加し、`runProjectJob`のすべての書き込みをclaim自身の`attempts`でフェンスする。`apps/web/src/app/api/cron/sweep-jobs/route.ts`が新規、`maxDuration = 300`。`apps/web/test-render-queue.mjs`が、dedup、kill/リース期限切れテスト、cancelling中のリース期限切れがcancelledになる境界ケース、`RENDER_MAX_ATTEMPTS`後のdead-lettering、実際に効く設定としての`RENDER_CONCURRENCY`、cronルート自身の認証と効果を、`test-projects.mjs`と同じパターン（使い捨てのSQLiteファイル、ネットワークなし）でピン留めする。

<a id="56-prompt-moderation-and-a-melodic-similarity-gate-refuse-a-known-work-on-the-input-and-the-output-2026-09-29"></a>
## 56. プロンプトのモデレーションと旋律類似度によるゲートが、入力と出力の両方で既知の作品を拒否する（2026-09-29）

決定39は、生成が「既知のテーマの再現を求めるリクエストを断る」こと、MarioとZeldaとSonicの素材がそのあいだ無料でありつづけることを約束していた。実際のリクエストではこれを何も強制していなかった：既知のフランチャイズや作曲家名の検査は、生成ベンチマーク自身のプロンプトにだけ適用されていた（`bench.ts`の`KNOWN_WORK_DENYLIST`、`validatePromptSet`）。NEXT-21は2つの検査を追加する - 1つは安価でプロンプト側、もう1つはモデルが実際に書いたものを計測する側だ。

- **プロンプト側、有料呼び出しの前。** 禁止フランチャイズまたは作曲家名を含むプロンプト（ベンチマークが自分のプロンプトに対してすでに検査していたのと同じリストを、複製せず再利用する）は、ネットワーク呼び出しなしで無料で拒否される（`422 prompt_known_work`）。残ったすべてのプロンプトは、生成のステータスが`composing`に達する前に、OpenAIの無料モデレーションAPI（`omni-moderation-latest` - 有料モデルと同じプロバイダーと資格情報を使う、別の無料エンドポイント）に送られる。フラグが立てられたプロンプトは拒否され（`422 prompt_flagged`）、フラグの立ったカテゴリ名だけが生成レコードに記録される（スコアは記録しない）。モデレーション呼び出し自体が失敗した場合 - ネットワークエラー、非2xxレスポンス、不正な形式のボディ - これはクローズド（安全側）に倒れ、再試行可能な`503 moderation_unavailable`を返す。プロンプトが未検査のまま生成に進むことは決してない。3つの呼び出し前拒否はいずれも、`usage`をnullのままにするのではなく、明示的にゼロの利用量を記録する（`jobs.ts`の`ZERO_USAGE`、対象は`PRE_CALL_REFUSAL_CODES`のコード）。これにより`admission.ts`の`monthSpend`は、`usage`がnullの行に対してフォールバックする最悪値の予約額ではなく、その行の本当のコストであるゼロで単価をつける。`test-generation.mjs`は、3つの拒否コードそれぞれの前後で`monthSpend`が変化しないことを検証する。
- **出力側、本当のゲート。** プロンプトがどのフランチャイズも名指ししていなくても、再現された旋律が返ってくることはありうるし、名指ししていてもモデルが何も再現しないこともありうる。決定39の約束は本当は何が求められたかではなく、何が作られたかについてのものだ。生成のスコアができた時点で（`jobs.ts`、モデル呼び出し直後、スコアが保存される前）、すべての旋律パートは移調不変な音程差分列とテンポ不変な長さ比列に還元され（`similarity.ts`）、小さな参照セット（`known-melodies.ts`）とウィンドウ付きアラインメントで比較される - DTWと同じ整列のファミリーで、装飾音の挿入や音の変更を許容する。`KNOWN_MELODY_THRESHOLD`以上の一致は生成を拒否し（`422 known_melody`）、一致した割合を報告する。ウィンドウは、退化した情報量の乏しい一致を防ぐ2つの独立したガードを通過して初めてスコアされる：`MIN_DISTINCT_INTERVALS`（ウィンドウ内に少なくとも2種類の異なる音程差分があること - 安価な事前フィルター）と`MIN_MATCHED_MOTION`（ウィンドウが、音高だけで、参照自身のゼロでない音程差分トークンの少なくとも半分に一致すること。編集距離のコストではなく本物の旋律的な動きを数える、2つ目の独立したアラインメント処理による）。この2つ目のガードが存在するのは、`{interval:0, rhythm:0}`（保持音や同音の連打）があまりにありふれているため、保持音主体の候補ウィンドウが、繰り返し音を含む参照に対して本物の旋律的類似なしに「タダ乗り」の一致を積み上げてしまいかねないからだ。これがどう見つかり、どう塞がれたかは後述の「実コーパスによる検証」を参照。

**参照セット。** 8つの冒頭句 - 短い出だしだけで、曲全体ではない - を、音程差分と長さ比の列としてのみ保存する：絶対的な音高も、絶対的なタイミングも、音声も、楽譜も保存しない。3つはサイト自身の親しみある素材で、リポジトリにすでにある検証済みトランスクリプションの最初の16音（`scores/references/{mario,zelda,sonic}.json`、決定29） - `scores/classics.json`がすでにスタジオの親しみある旋律と呼んでいるのと同じ3曲だ。残り5つは、記憶から手で符号化した、有名でパブリックドメインの冒頭句：きらきら星、ベートーヴェンの「歓喜の歌」、「エリーゼのために」の冒頭、ベートーヴェン第5交響曲冒頭の動機、そしてロシア民謡でテトリスの「Type A」テーマでもある「コロブチカ」 - つまりこのセットはゲームのテーマだけではない。

**較正。** 陽性例：各参照を移調し（±12半音）、テンポを変え（0.5倍から2.5倍）、軽く変奏し - 1つか2つの音を変え、たいていは装飾音を1つ挿入する、決定3自身の「装飾、1つか2つ変えた音」そのままだ - 無関係なランダムな素材の中に埋め込む。参照8個×バリアント6個で計48個。陰性例：リポジトリ自身のオリジナルなフィクスチャ（スターター・プロジェクトの主旋律、生成ベンチマークのモック譜面、コンポジション・テストサーバーのフィクスチャ譜面）に、シード付きランダムな曲20個を加えた計23個。閾値はこの較正セットだけから選ばれ、2つ目の互いに素なセット（異なる乱数シード、同じ形）が作られたり見られたりするより前に決められた。

| | 較正（陽性48／陰性23） | ホールドアウト（陽性48／陰性23） |
| --- | --- | --- |
| 閾値 | 0.40 | 0.40（変更なし） |
| 真陽性 | 43（90%） | 45（94%） |
| 偽陰性 | 5 | 3 |
| 偽陽性 | 0 | 0 |
| 真陰性 | 23 | 23 |
| 陰性最大値からの余裕 | 0.15（0.40 対 0.250） | 0.15（0.40 対 0.250） |

見逃した陽性例はすべて、2つの最も短く反復的な参照（`fur-elise`、`beethoven-5th-motif` - どちらも6〜7トークン）を大きく変奏したものだ：「1つか2つ変えた音」は、16音の冒頭句よりも7トークンの冒頭句のほうがはるかに大きな割合を占める。だからこの2つの参照が、意図的な言い換えをもっとも通しやすい。どちらのセットでも偽陽性がゼロであること - リポジトリ自身の3つのオリジナルなフィクスチャと40曲のシード付きランダム曲を合わせても - が、ここでもっとも重要な性質だ。これは拒否ゲートであり、通常のオリジナル作品への偽陽性はユーザーに対して不親切になる。`apps/web/test-known-melody-similarity.mjs`が両方の混同行列をCIで決定的に再現する。

**実コーパスによる検証。** 上記の陰性セットはすべてオリジナルまたはシード付きランダムな素材であり、ゲートが一度も見たことのない実在の音楽にどう振る舞うかについては何も語らない。`scripts/melody-negative-corpus.mjs`は、`scores/nsf-corpus/files`に収録された8つの非プローブ曲すべてを抽出し（執筆時点で動作する抽出器を持つのはこのコーパスだけだった）、各曲のすべての参照に対する最良一致をスコアする。出荷時点の閾値では、これによって最初に偽陽性率100%（8曲すべてがちょうど0.500でスコア）が明らかになった - 上記の較正セットでは何に対しても偽陽性ゼロだったにもかかわらずだ。原因は上述の退化ウィンドウの悪用にあった：保持音主体の候補ウィンドウが、参照自身の繰り返し音に対して本物の旋律的類似なしに「タダ乗り」の一致を積み上げていた。`MIN_MATCHED_MOTION`ガードはこれを塞ぐために追加された。修正後、同じ8曲は次のようにスコアされる：

| | 実コーパス（8曲） |
| --- | --- |
| p50最大類似度 | 0.000 |
| p95最大類似度 | 0.000 |
| 最大類似度 | 0.000 |
| 0.40での偽陽性数 | 0 |

0.40への余裕は満額残り、合成陽性セットでの再現率も修正前の値から2ポイント以内にとどまった（修正前は48件中44件と45件、修正後は48件中43件と45件）。つまりこの悪用を塞いでも、実際の言い換えに対するゲートの実効性を大きく損なうことはなかった。

8曲はまだ薄い陰性セットであり、8つとも厳密に0.000というスコアは「0.40より明らかに下」という以上の余裕の情報を何も持たない - より大きな実コーパスであれば、ゼロでない最大値とより狭い真の余裕が明らかになる可能性がある。この閾値はこのエビデンスに基づいて暫定的に受け入れられているのであって、最終確定として扱ってはいない：次の「再較正のためのエビデンス」を参照。

**再較正のためのエビデンス。** すべての生成 - ゲートが拒否したものだけでなく - は、今やその既知旋律への最良一致をその場で記録する：`jobs.ts`は（ゲートの判定だけでなく）`knownMelodySimilarity`を呼び出し、既存の`generations.moderation`のJSON列（`ModerationOutcome`の新しい、意図的に文書化された`melody`フィールド）に`{similarity, referenceId, part}`を書き込んでから、拒否するかどうかを決める。新しい列やマイグレーションは不要で、拒否の判定は依然として同じ類似度を`KNOWN_MELODY_THRESHOLD`と直後に比較して決まる。これにより、将来の再較正は、上記の合成セットとNSFコーパスのセットだけでなく、実際の生成における本物のスコア分布を材料にできるようになる。オーナーは、このエビデンスが十分に蓄積された後に、生成ベンチマークをおよそ250サンプル分実行して真の将来の陰性セットとすることをすでに承認している。そのベンチマーク実行自体は、このチケットの一部としては行っていない。

**予算面で変わったこと。** プロンプトのモデレーションは有料利用量を一切消費しない - モデルを呼び出さない - が、拒否された生成もやはり`runGeneration`に到達し、`started_at`はセットされる。このチケット以前は、決定42自身の最悪値による予約会計（モデルが応答する前に失敗する生成のためのもので、たとえば呼び出し中の権限失効を想定していた）が、この種の拒否も同じように捕まえていた。`usage`がnullであるという見た目がどちらのケースでも同じだったからだ。それはモデルを一度も呼び出していない拒否にとっては誤りだった：`jobs.ts`は今や3つの呼び出し前拒否コード（`prompt_known_work`、`prompt_flagged`、`moderation_unavailable`）すべてについて明示的にゼロの利用量を記録するので、`monthSpend`はそれらに本当のコストであるゼロの単価をつける。予約単価はつかない。`test-generation.mjs`は、3つの拒否タイプそれぞれの前後で`monthSpend`が変化しないことを検証する。モデルに実際に到達した拒否 - `known_melody`、あるいは`model.generate`が返ってから生成が`validating`に達するまでのあいだのその他の失敗 - も、理由は逆だが同じ`usage`がnullになる問題を抱えていた：`jobs.ts`は今や、`compositionProject`や既知旋律のゲートが失敗する前、`model.generate`が返った瞬間に`usage`と`model`を記録するので、呼び出し後の拒否はその呼び出しの本当のコストで単価がつき、予約単価にはならない。`test-generation.mjs`の既知旋律のケースは、その月の支出がモックされた呼び出しの単価分だけ増え、予約単価分は増えないことを検証する。

**理由。** 両方の検査は純粋で、依存を持たず、ネットワークも鍵も使わずにユニットテスト済みだ - モデレーションのエンドポイントはモックされ、呼び出されない - ので、`pnpm test`と生成ベンチマークの`--mock`経路は以前とまったく同じ速さと無料さを保つ。プロンプト側の検査だけでは求められていない引用を捕まえられず、較正されていない出力側の検査では本物の引用を見逃すか通常のオリジナルな旋律にフラグを立てるかのどちらかになる。両方をそろえ、誠実に計測した閾値を持つことこそ、決定39の約束が実際に必要としているものだ。

**変わること。** `apps/web/src/lib/composition/moderation.ts`（新規）、`similarity.ts`（新規)、`known-melodies.ts`（新規）。`jobs.ts`は作曲前とモデル応答後の両方でこれらを呼び出し、今やすべての生成についてその最良の既知旋律一致をエビデンスとして記録する。マイグレーション`prompt-moderation`（決定55の`durable-render-queue`の後に順序付けられる）が`generations.moderation`を追加する。`model.ts`の`compositionConfig`は`openAICredentials`を切り出し、有料アダプターと無料モデレーション呼び出しの両方がそれを共有する。`scripts/melody-negative-corpus.mjs`（新規）は、上述の実コーパスによる検証を手動で実行するレポートだ。

<a id="57-chipvoice-publishes-terms-of-use-and-a-privacy-policy-no-ownership-claim-on-your-songs-prompts-stay-owner-only-and-are-erased-when-their-song-is-withdrawn-2026-09-29"></a>
## 57. chipvoiceが利用規約とプライバシーポリシーを公開：あなたの曲の所有権は主張せず、プロンプトは本人限定のまま保持され、曲を取り下げると消去される（2026-09-29）

NEXT-22。chipvoiceにはこれまで規約ページもプライバシーページも存在しなかった。今回、`/terms`と`/privacy`（およびその`ja`版）を新設し、サイトフッターとサインイン画面、コンポーザーからリンクし、日付は2026-09-29とした。両ページは決定39・42を記憶から書き直すのではなく、`songs.ts`、`projects.ts`、`composition/`、`auth.ts`、`migrations.ts`を1行ずつ照合し、コードが実際に行っていることだけを記述している。想定されていた内容と実際のコードとの間にあった2つの乖離は、約束だけを残すのではなく、このチケットの中で解消した。

- **所有権。** 曲を作曲・生成した本人が、chipvoiceが生成したものを所有する。chipvoiceはその所有権を主張しない。曲を公開すると、公開されている間、chipvoiceがそれをホスティング・配信・レンダリング・表示するための非独占的なライセンスをchipvoiceに許諾したことになる。これはまさに`projects.ts`の`publishProject`／`withdrawProject`がすでに行っていることであり、公開物はこのライセンスの下で公開されているか、取り下げられて（ソフト削除されて）そこから外れているかのいずれかで、第三の状態はない。既存のリミックス機能（公開曲のフォークと、そのページでの出所表示）もこのライセンスの一部として明示した。chipvoiceは生成された出力が第三者の権利を侵害していないことを保証せず、公開する内容についてはその人自身の責任となる。
- **既存のメロディーではなく、オリジナルの音楽 - 実際に指示されるようになった。** 決定39は「生成は既知のテーマの再現要求を拒否する」としていたが、`composition/score.ts`の`compositionInstructions()`はモデルにそのような指示を一切送っていなかった。存在していたのは`composition/bench.ts`の`KNOWN_WORK_DENYLIST`だけで、これはベンチマーク自身が用意したプロンプトを検証するものであり、「安全網であって、強制ではない」と明記されていた。`compositionInstructions()`は今回、プロンプトが特定の既存曲をどれほど名指し、あるいは酷似する内容を求めていても、オリジナルの楽曲のみを書き、その曲のメロディー、リフ、歌詞の再現は拒否するようモデルに指示するようになり、その指示文自体に決定39を引用している。規約ページはこれをモデルへの指示であって保証ではないと明記しており、実際の測定はNEXT-21が担う。
- **プロンプトのプライバシー - コードが実際に持つ強さのまま記述。** 生成のプロンプト（`projects.ts`の`Publication.generation.prompt`）は、`getProject`のレスポンスに`if (publication.owned)`の場合にのみ付与される。曲が公開・限定公開・非公開のいずれであっても、それを書いた本人以外の誰にも、いかなるAPIレスポンスにおいても返されることはない。コンパクトな`/api/songs`形式には、そもそもプロンプトのフィールド自体が存在しない（`songs.ts`）。プライバシーページはこれを、「公開しない限り表示されない」という弱い表現ではなく、この事実どおりの強い表現で記述している。プロンプトは曲を生成する目的のみでOpenAIに送信される（`composition/model.ts`のアダプターは`store: false`でResponses APIを呼び出す）。chipvoiceはプロンプトをモデルの学習には使用しない。ページは数値を創作するのではなく、OpenAI自身によるAPIデータの扱いについての説明にリンクしている。
- **プロンプトの保持期間：曲と共に保持され、曲を取り下げると消去される。** このチケット以前、`withdrawProject`はプロジェクトをソフト削除しても、その`generations.request.prompt`には一切触れておらず、永久に残っていた。これでは削除の約束が偽りになってしまう。`projects.ts`には新たに`scrubGenerationPrompt`が追加され、`withdrawProject`から呼び出される。そのプロジェクトに属する`generations`の全行について、`request.prompt`を固定のプレースホルダーで上書きする。行自体、そして`composition/admission.ts`の`monthSpend`が共有予算のために読む`model`／`usage`／タイムスタンプの各項目は残る。`monthSpend`は`request`を一切読まないため、プロンプトの消去が課金に影響することはない。一度も取り下げられていない曲のプロンプトは無期限に保持され、プライバシーページはこれも、存在しない保持期間の上限をほのめかすことなく、そのまま明記している。`test-generation.mjs`は取り下げ時にこの消去が実際に起きることを検証する。
- **セルフサービスでのアカウント削除はできない。** スキーマにもAPIにも、アカウント削除の機能はどこにも存在しない（`migrations.ts`を全文確認済み）。プライバシーページはその旨を明記し、存在しない削除ボタンを約束する代わりに、手動での削除依頼先として`hello@chipvoice.dev`を案内している。
- **アカウントとベータ版。** 規約ページは、決定42のサーバー側での招待制・予算管理と、決定39の無料クローズドベータを平易な言葉で言い換えている。金額や招待の仕組みそのものは繰り返さず、決定39・42に残す。

**弁護士レビュー未了。** この文章はコードが実際に行っていることに忠実で、平易な言葉で書かれ、ダークパターンもない。しかし弁護士によるレビューは受けていない。有料版のローンチ、あるいはクローズドベータの外へのローンチの前には、必ずレビューを受けるべきである。この注記は意図的に内部限定であり、公開の`/terms`や`/privacy`ページ自体には掲載していない。

**理由。** プロンプトを保存し曲を生成する製品は、利用する前に人が読める場所でその扱いを説明する必要があり、コードが追いつかない約束は、約束がないより悪い。決定の箇条書きからではなく、コードから両ページを書き起こしたことで、NEXT-22が語ろうとしていた内容にコードがまだ追いついていなかった2箇所（メロディーの指示、取り下げ時のプロンプト保持）が明らかになった。どちらも、ページの記述をその乖離に合わせて弱めるのではなく、コードの側を直した。

**変化。** `/terms`と`/privacy`が英語・日本語で公開された。`compositionInstructions()`に、再現を明示的に拒否する指示が加わった。`withdrawProject`は取り下げられたプロジェクトのプロンプトを消去する。これらは決定39・42・43のいずれも変更しない。それらの決定がすでに決めていた内容を、公開向けの文章に一致させ、上記2箇所の乖離を解消するものである。

**追補：他にどの事業者があなたのデータを扱うか、そしてブラウザが何を保持しているか - このチケット自身のPRレビューがマージ前に発見。** `/privacy`の初稿は「chipvoiceが現在保存している内容を正確に説明する」と冒頭で宣言しておきながら、第三者としてOpenAIしか名指ししておらず、クッキーやブラウザストレージについても一切触れていなかった。この冒頭の宣言がある以上、これは単なる詳細の欠落ではなく、実際の乖離だった。ページは今回、他の記述すべてと同じくコードを確認したうえで、次を追記した。Vercelがchipvoice.devをホスティングし、自身の標準的なリクエストログ（IPアドレスを含む）を保持していること。Tursoがデータベースをホスティングしていること（`apps/web/src/lib/db.ts`、`TURSO_*`というプレフィックス）。domaniがサインイン用メールを送信するため、その送信先としてメールアドレスを受け取ること（`apps/web/src/lib/mail.ts`、`DOMANI_API_KEY`）。OpenAIがプロンプトを受け取ること（既述のとおり）。`@vercel/blob`（決定40）は確認のうえ、このリストから除外した。これはスタジオ自身のリスニング・ラボやアレンジメントの録音を保存するためのものであり、ユーザーの曲の音声やその他のユーザーデータを保存することは一切なく、曲の音声は保存済みのスコアからその都度レンダリングされる（`apps/web/src/app/api/audio/[id]/[format]/route.ts`）。ページはさらに、セッションクッキーの有効期間が30日であること（`SESSION_TTL_MS`、`apps/web/src/lib/auth.ts`）、ブラウザがローカルに保持するもの（作成中の曲・プロンプトの下書き、および本人のサインイン済みアカウントの表示情報の短期間のキャッシュ）を明記し、chipvoiceがアナリティクスや広告トラッキングを一切使用していないことも、`apps/web/src`とその依存関係を確認したうえで明記した。

<a id="58-importspc-restores-s-dsps-hidden-per-sample-state-on-snapshot-load-play-spcs-clear_echo-demo-convention-stays-out-of-it-2026-09-29"></a>
## 58. importSpcはスナップショット読み込み時にS-DSPの隠れた1サンプルごとの状態を復元する。play-spcのclear_echo()というデモ用の慣習はそこに含めない（2026-09-29）

NEXT-26は、`importSpc`を実際の市販ゲームのSPC吸い出しの集合に対してテストした。これはこのチケット専用のローカル保持であり（決定44がVGMについて定めた規則がそのまま当てはまる：決してコミットしない、本人の`--corpus <dir>`、CIはそれに依存しない）、他のどのチップのオラクルとも同じやり方で、`play-spc`をブラックボックスとしてバイセクションした。実際のバグが2つ見つかり、どちらも、インポート済みプランの`events`／`memory`から新しいチップがスナップショットの状態を再構築する部分にあった - ハーネスだけの現象ではない：`packages/chipvoice/src/performance.ts`と`progressive-renderer.ts`は、`packages/conform`自身のハーネスとまったく同じ方法でプランを再生するため、両方とも実際の再生バグであり、単なる`check:spc`の失敗ではなかった。

**2つの修正。** DSPADDR（`$F2`）はS-SMPのラッチ状態であり、スナップショットのレジスタブロックが復元する128個のDSPレジスタの一つではない。スナップショットは、ほぼ必ずCPUの次の命令がDSPDATAにそのまま書き込むところから再開する。選択する側の書き込みはスナップショットが取られる前にすでに済んでいるからだ。`importSpc`は今回、レジスタ復元の書き込みの直後に、スナップショット自身の値からこれを明示的にシードするようになった。もう一つ別に、S-DSPのいくつかのフィールド - エコーアドレスラッチ、ディレクションページラッチ、KONエッジラッチ、エコー履歴とそのリング位置 - は、実チップが通常のレジスタ書き込みではなく1サンプルにつき一度だけ再導出する隠れた内部状態である。スナップショットのレジスタファイルは連続して動作していたチップが書き出したものなので、その瞬間もこれらは同期していたが、スナップショット形式自体はそれらを運ばず、通常の`$F2`／`$F3`書き込みだけを再生する新しいチップはこの再同期を一度もトリガーしない。`SDsp.load()`はレジスタのコピーと新設の`restoreInternalState()`（`packages/chipvoice/src/chips/snes/sdsp.ts`）に分割され、`importSpc`は予約済みの番兵アドレス`DSP_SNAPSHOT_RESTORE_ADDR`（`$F9`、実ハードウェアでは未実装で、実際のS-SMPトラフィックから到達することは決してない。`chips/snes/dsp.ts`）宛ての合成イベントをもう一つ発行するようになった。`SnesChip.write`はこれを「今持っているレジスタファイルはスナップショットのものだ」という合図として認識し、それらのラッチを即座に再同期する - `SDsp.load()`が生のレジスタブロックを直接受け取った呼び出し元に対してすでに行っていたことと同じである。どちらの修正にも、自作で再配布可能な回帰テストファイル（`dspaddr-select.spc`、`echo-snapshot-restore.spc`、`packages/conform/corpus/snes/spc`、詳細は同ディレクトリ自身のREADMEを参照）が同梱されており、修正前のコードでは失敗し、修正後には通過し、他のすべてのファイルと同じく`check:spc`／CIでゲートされる。

**clear_echo()の疑問への、明示的な決着。** `play-spc.cpp`（`check:spc`が実行する、ベンダリング済みのオラクルバイナリ、blargg自身のリファレンスSPC700プレイヤー）は、スナップショットを読み込んだ直後、1サイクルも再生する前に、無条件で`SNES_SPC::clear_echo()`を呼び出す：スナップショットのFLGレジスタでエコー書き込みが有効になっているときは常に、エコーバッファ領域（`ESA*0x100`から`+EDL*0x800`まで）全体をRAM上で`0xFF`（一定の`-1`サンプル）に`memset`してから、初めて何かを再生する。これはハードウェアの挙動ではない - 実ハードウェアが読み込み時に自発的にRAMを上書きすることはない。これはblargg自身が汎用の.spc*プレイヤー*のために用意した便宜であり、ユーザーがダンプした大半のスナップショットのエコーバッファは意味のない残留物（ゲームがそのメモリを最後に何に使っていたか、あるいは何も使っていなかったか）を保持しているため、これがなければ、多くの実世界のファイルの冒頭で、DSP自身のエコー書き込みが自然に上書きするまでの間、エコーバッファ1本分の長さの再生がランダムなゴミの上でポップノイズを立ててしまう。このチケット自身のローカルコーパスに対して直接確認した：3本のスーパーマリオカートの吸い出し（`smk-s06`、`smk-07`、`smk-08`）はいずれもFLGでエコー書き込みが有効、ESA=$dfで、エコーバッファ自身のアドレスのRAMに本物の`0x00`バイトが - `0xFF`ではなく - 置かれている。`check:spc`はこれらそれぞれについて、サイクル251（エコーの影響を受ける最初のサンプル）で「ours 0, oracle -1」とまさにその通りに相違を報告する。3本のF-Zeroの吸い出し（`fz-02`、`fz-07`、`fz-09`）はFLG／ESAの形はまったく同じだが、そのスナップショット自身のエコーバッファRAMはすでにすべて`0xFF`になっているため、そこでは`clear_echo()`が何もしない - これこそが、上記の隠れラッチの修正でこれらのサイクル251の相違が消え去った一方、スーパーマリオカートのファイルには相違が一部残った理由である。

`importSpc`は`clear_echo()`を複製しない。これはblargg自身のデモプレイヤーに属するものであり、どのSNESチップにも属さない。ハードウェアに忠実なエミュレータにこれを取り込むということは、実際のスナップショット自身の真のRAM内容を、捏造したパターンのために意図的に捨てることを意味し、ここで言う「実際の市販SPC700吸い出しをそのまま再生する」ことの正反対になる。あるスーパーマリオカートのスナップショットにあるまさにそのRAMを実機に渡せば、実機はそこに実際にある`0`のサンプルを再生するのであって、blarggの`-1`を再生するのではない。したがって、そのようなファイルで`check:spc`が`play-spc`に対して報告する相違は、想定内であり、オラクルのバイナリに存在する、文書化されたプレイヤー側の便宜に起因するものであって、chipvoiceのバグではない。これをクリーンルームの規則（決定41・48）に従ってここに明記し、無言のまま説明のつかない不一致として残したり、どちらかの方向へこっそり移植したりすることを避けた。

**まだ残っている課題。** NEXT-26が当初報告した4つの相違系統のうち、いくつかは完全には閉じていない：F-Zero／スーパーマリオワールドのコーパスでは、数万件の、それ以外はすべて一致する書き込みの後になお現れる書き込み列の相違がいくつか残っている（かなり下流のタイミングのずれで、まだ根本原因を特定できていない）。上記のclear_echo()の説明が当てはまらない場合（エコー書き込みが無効か、スナップショット自身のバッファがすでに一致している場合）でも、スーパーマリオカートの一部のファイルには、せいぜい数単位程度の小さなサンプル相違が残る - おそらくボイス／エンベロープ／BRRデコード／ガウス補間の丸め方によるもので、`SPC_DSP.cpp`と1行ずつまだ突き合わせていない。この理由により、NEXT-26は`docs/BACKLOG.md`で（`done`ではなく）`doing`のまま開いたままにする。上記の2つの修正とclear_echo()の決着そのものは、それ自体で完結し証明済みである。

<a id="60-firefoxs-576-sample-mp3-leading-delay-is-a-missing-lame-gapless-tag-not-a-decoder-bug-the-real-lame-cli-replaces-ffmpegs-mp3-muxer-and-the-browser-decode-gate-now-enforces-lag-0-2026-09-29"></a>
## 60. Firefoxの576サンプルmp3先頭遅延はデコーダーのバグではなく、LAMEギャップレスタグの欠落だった。本物の`lame` CLIがffmpegのmp3マルチプレクサを置き換え、browser-decodeゲートは今やラグ0を強制する（2026-09-29）

GS-08。GS-07 v2.2は、1080個のライブカタログmp3すべてで、Firefoxが固定+576サンプルのデコードラグ（44.1kHzで13.06ミリ秒、mp3の1グラニュール - MPEG-1 Layer IIIの固定グラニュールサイズであり、LAME自身の固定エンコーダープライミング遅延でもある）でChromiumに対して遅れることを、wavに対する相互相関ラグ探索（`crossCorrelationLag`、`scripts/lib/decode-judge.mjs`）によって計測していた：Chromiumは1080個すべてでラグ0、Firefoxは1080個すべてでラグ+576、両エンジンとも最小正規化相関0.888。これは修正されていないバックログ項目（GS-08）として追跡され、`check-browser-decode.mjs`によって報告のみされ、ゲートはされていなかった。このチケットはこれを修正した。

**原因。** ライブカタログmp3のLAME/XingギャップレスタグをHexダンプして、直接答えが見つかった：ffmpegのmp3マルチプレクサ（`libavformat/mp3enc.c`）はXing/Infoヘッダー（フレーム数、バイト数、TOC、品質 - `write_xing`、既定で有効）を書き込むが、それに続くLAME固有のinfo-tag拡張 - リプレイゲイン、エンコーダー遅延、エンコーダーパディング - には実際の値を一切書き込まない。試したすべてのffmpegバージョン/ビルドで、bitexactフラグ（`-fflags +bitexact -flags:a +bitexact`）の有無にかかわらず、その正確なバイト位置に固定の`0xAA`プレースホルダーを詰めていた：「LAME3.100」のバージョン文字列の後、バイト9から24 - エンコーダー遅延/パディングのフィールドが存在する位置 - を読み返すと`0xAA`の繰り返しになっており、本物のエンコーダーなら決して生成しない「delay 2730, padding 2730」という内部的にありえない値になっていた。`ffmpeg -h muxer=mp3`や`-h encoder=libmp3lame`のどこにも、これらのフィールドを正しく埋めるオプションは公開されていない - これはたまたま未設定だったフラグではなく、ffmpeg自身のmp3マルチプレクサの本物のギャップである。Chromiumはそのタグをどちらにせよ信頼していないようだ（タグの中身にかかわらずギャップレスかつ正確にデコードした）が、Firefoxは信頼する：実際の遅延/パディング情報を持たないタグを渡されると、LAME自身の固定576サンプルのエンコーダープライミング遅延を一切トリムしない - これが実測されたラグそのものだ。本物の`lame` CLI（マルチプレクサが後付けしたものではなく、リファレンス実装自身のタグライター）は同じタグを正しく書き込む - 同じ方法で検証済み：delay 576、実際の出力長から計算されたpadding、どちらも内部的に妥当かつ正しい。

**修正、ビルドパイプラインに触れる前にまず実測で検証した。** 実際のChromiumとFirefoxの両方、Playwright、`decodeAudioData`、`check-browser-decode.mjs`自身が使うのと同じ相互相関ラグ探索を、カタログのすべてのcategory/styleファミリーにまたがる60バリアントのサンプルで使った（モノラル44.1kHzはこの過程を通じてそのまま維持され、サンプルレートもチャンネル数もここでは一切変更していない）。`lame -V 3`（ffmpeg自身の`-q:a 3`と同じVBR品質スケール - libmp3lameは両方を同一に解釈する）により、Firefoxは60/60でラグ0になった（以前は60/60で+576）。Chromiumは60/60でラグ0のまま変化せず、修正前後で両エンジンとも最小正規化相関が完全に同一（chromium 0.9534010956664087、firefox 0.953400869444321） - これは回帰していないだけでなく、コンテンツや品質の変化が一切ないことを証明する - であり、修正後のFirefoxのmp3長さ超過はゼロになった（以前はwav自身のフレーム数に対して626から1718サンプル超過。この長さ超過は常に、先頭遅延にFirefoxがトリムし損ねている末尾のパディングを加えたものであり、レイテンシーそのものではない。GS-07 v2.1自身の訂正による）。コンテンツの同等性は、ラグ探索とは独立に直接も確認した：同じ入力wavに対する`lame`-CLI版mp3とffmpegエンコード版mp3のffmpeg自身のCLIデコードはサンプル単位で完全に一致（合成880Hzトーンで最大絶対差0.0）、実カタログwavに対するffmpeg自身の`ebur128`フィルターで測定した真のピークも0.1dB一致 - この変更が触れるのはmp3コンテナとそのギャップレスタグを書き込むツールだけであり、音声そのものは一切変わらない。`lame`は同じ入力の反復エンコードにわたって決定的である（合成トーンと実カタログwavの両方で、独立した2回の実行にわたってバイト完全一致のsha256。既存の`encodeVariant is deterministic`ユニットテスト、`apps/sounds/test/audio.test.mjs`、が同じ経路を通り、通過した） - そのためbitexact的なフラグは不要だ：`lame`はそもそもマシン依存・実行依存の値を埋め込まない。`BITEXACT_ARGS`は`scripts/lib/audio.mjs`から完全に削除された：この修正が削除するffmpegのmp3経路のためだけに存在しており、oggの経路（`sox -R`、GS-06/GS-07）ではそもそも使われていなかった。

**出荷。** `scripts/lib/audio.mjs`の`encodeVariant`は、このカタログがエンコードするすべてのmp3について、ffmpegの代わりに（既存の`ensureSoxVorbis`パターンを模した新しい`ensureLameCli`を介して）`lame --silent -V 3 <wav> <mp3>`を呼び出すようになった。CI（`.github/workflows/ci.yml`）は、`sounds`ジョブが実行される前に`sox`と並んで`lame`をインストールするようになった。カタログ全体をローカルで再ビルドした：wavとoggは変更なし（1080個中0個が変化。記録されたハッシュだけでなく、すべてのファイルの直接sha256比較でディスク上のバイト完全一致を確認）。1080個のmp3すべてが変化した（1080バリアントは1010個のユニークな元音源に重複排除されるため、1010個のユニークな新規ハッシュ）。ラウドネスゲートとformat-energyゲート（実際のフォーマットごとの受け入れ基準、`FORMAT_ENERGY_TOLERANCE_DB`）は影響を受けない：修正前後で統計値が完全に一致する（2160回のogg/mp3フォーマット/チャンネル読み取りにわたって平均0.0477dB、p99 0.2747dB、最大0.4789dB）。`check-determinism.mjs`は、新規に再ビルドしたwavハッシュがコミット済みの`generated/catalog.json`と完全に一致することを確認した。

**ゲート。** `check-browser-decode.mjs`のmp3先頭遅延チェック（自身のヘッダーコメントの4番目の項目）は、以前は情報提供のみだった（`MP3_LAG_TOLERANCE_FRAMES`は存在しなかった）。今や実際のゲートになった：ラグは両エンジンでちょうど0でなければならず、そうでなければビルドはこの決定を指すメッセージとともに失敗する。修正後、再ビルドしたカタログ全体（1080個のライブバリアント、両エンジン）に対して実行した結果：各エンジンで2160回のデコード中0件の失敗、mp3ラグはChromium・Firefoxともに1080/1080でちょうど0（両方ともモーダルラグ0、範囲[0, 0]）、mp3の長さ超過は両エンジンとも+0/+0/+0（最小/中央値/最大）で、修正前の+576ラグと未トリムの末尾パディングから減少、両エンジンとも最小正規化相関0.883で修正前のベースライン（0.888）にほぼ一致し、60バリアントのサンプルだけでなくカタログ全体でも品質の後退がないことを裏付けた。oggの自身の一致チェックはこれによって一切影響を受けない（GS-06/GS-07/決定54自身の機構、変更なし）：両エンジンとも|browser - reference|の最大値は1.54e-5、`DECODER_AGREEMENT_TOLERANCE`の65分の1。

**不要だったこと。** ogg自身のエンコード経路（`sox -R`、`OGG_TAIL_GUARD_FRAMES`）への変更は一切なかった - このチケットの欠陥と修正はmp3のみに関するものだ。GS-08が最初に開かれた際にフォールバックの方向性として挙げられていた、レイテンシーに敏感な利用者向けにoggを推奨することは、不要だと判明した：mp3の欠陥は発生源で修正されたため、両フォーマットとも今や両エンジンでギャップレスかつ正確であり、`docs/GAMESOUNDS.md`はタイミングの観点でどちらのフォーマットも他方より推奨していない。
<a id="61-a-driver-side-release-taper-precedes-the-dry-space-snes-voices-fast-key-off-release-p6-11-2026-09-29"></a>
## 61. dry空間のSNESボイスでは、key-offの高速リリースの前にdriver側のリリーステーパーが入る（P6-11）（2026-09-29）

決定53が記録し、NEXT-24が再現した通り、保持されたdry空間のSNESの音符はkey-offまでフルサステインのままである - ファクトリー楽器のADSR2サステインレートは全て0（「decrease never」）である - その後、S-DSP自身の固定的で高速（約8ms）な指数関数的GAINリリースに切り替わる。これはハードウェアとして正確な挙動だが、それに先立つものが何もないため、`trimRender`がほぼ無音の残りを切り詰めた時点で、急に止まったように聞こえる。`room`や外部echoパッチはどちらも自らのテールで減衰するのとは対照的である。実機のN-SPC系ドライバーはkey-off前にsustain自体を、ADSR自身のSR（サステインレート）かスクリプト化したGAIN減少でテーパーさせる - <https://snes.nesdev.org/wiki/DSP_envelopes>：「（通常または指数関数的減少のGAINモードは）ノートの途中でトリガーする必要がある……カスタムのリリースレートを実装するために……リリースエンベロープを模倣するために。」このドライバーはそのどちらも行っていなかった。P6-11はこの差を埋める。

**メカニズムと、GAINではなくADSRを選んだ理由。** `SnesDriver.noteOff`（`packages/chipvoice/src/chips/snes/driver.ts`）は今回、既存のkey-off書き込みより前のある時点で、ボイス自身のADSR2レジスタ（`$x6`）に一度だけ書き込み、SRフィールド（下位5ビット）だけを置き換えて、楽器自身のサステインレベル（上位3ビット）はそのまま保つようになった。ボイスは`noteOff`自身の既存の高速GAIN減少の書き込みが行われるまでADSRモードから外れることはなく、これはこのチケット以前とまったく同じである。GAINモード5（指数関数的減少）がもう一つの候補だった。両方のモードは同一のエンベロープステップ（`env--; env -= env >> 8`、このリポジトリ自身の適合性オラクル`packages/conform/oracles/snes-spc/snes_spc/SPC_DSP.cpp`の`run_envelope`、`v->env_mode >= env_decay`の非decay側の分岐）を、`noteOff`の既存のリリースがすでにその最速エントリで読んでいるのと同じ32エントリの`counter_rates`テーブルから刻む。ADSRが2点で勝った：レジスタ書き込みがGAINの2回に対して1回で済むこと、そして各楽器自身のサステイン*レベル*（レートだけでなく）がフェードの開始点を支配し続け、別途GAINの目標レベルを選ぶ必要がないことである。

**数値は、耳で調整したのではなく導出したもの。** `TAPER_FLOOR_MS`（40ms、`2 * TAPER_MIN_MS`）より短い音符は変更されない - このチケット以前とバイト単位で同一のレジスタ列のままである - なぜなら`TAPER_FRACTION`（0.5）と`TAPER_MIN_MS`（20ms）という下限の下では、それより短い音符は自分自身の長さより長くテーパーに費やすことになってしまうからだ。40msは、各エントリの実際のADSR1ディケイレートとADSR2サステインレベルからオラクル自身の式に基づいて計算した、ファクトリー楽器自身のディケイからサステインまでの時間もすべてクリアする。最も遅い`mallet`でも224msであり、ボイスがまだディケイフェーズにあってサステインに達していない段階での早すぎるADSR2書き込みも無害である（ハードウェアが SRフィールドを読むのは`env_mode`が`env_sustain`になってから初めてであり、それまでこの書き込みは無効であって誤りではない）。それ以外の場合、テーパーは`clamp(duration * TAPER_FRACTION, TAPER_MIN_MS, TAPER_MAX_MS)`の間だけ走る：せいぜい音符の半分であり、フェードする分と同じかそれ以上がフルの、変更されないサステインのまま鳴る - これは上記のwikiページにある通り、N-SPC自身の量子化／ゲートテーブルがすでにリリースのタイミングを表現しているのと同じ比例的な考え方である - 上限は`TAPER_MAX_MS`（100ms）で、これはこのチケット自身の前後測定ウィンドウ（key-off前の最後の100ms）に一致するよう選んだので、テーパーが変える可聴サンプルはすべてその証明が調べるウィンドウの内側に収まる。SRレート番号自体も勝手に選んだのではない：`stepsToReach`はオラクルの正確な`env--; env -= env >> 8`ループを実行し、この楽器自身のサステインエンベロープが自分自身の`TAPER_TARGET_RATIO`（1/8、約-18dB）まで落ちるのに何ステップかかるかを求める。そして、その実時間（`counter_rates`をDSPの固定32000Hzで変換したもの）がテーパー自身の導出された長さに最も近くなるレートが選ばれ書き込まれる。`noteOff`の既存の、変更されない高速リリースが、いつもと同じ数ミリ秒で残りの約-18dBを仕上げる。

**スコープ：`room`は今まで通り。** `room`のechoはkey-off後にすでに減衰するテールを返している。このテーパーを`room`にも重ねると、すでにその役目を果たしているechoのリターンの下でdryボイスをさらにフェードさせることになり、測定上の利益はない。決定53は`room`のテールがdry自身より4〜5桁大きいと測定している。テーパーは空間で分岐する（`this.taper = this.space === SPACES.dry`）ため、`room`自身のレジスタ列は変更されないことが証明できる - 専用のテスト（`packages/chipvoice/test/snes-taper.mjs`）が、長い`room`の音符を、`noteOff`が常に出していたのと同じ2回書き込みのリリースに対してピン留めしている。

**音声への影響の証明。** 900ms保持したdryのリード音符（`flute`、ADSR2 `0xc0`）、key-offは900ms時点：この変更前は、key-off前の最後の100msは一定の-23.46dBFS（フルサステインでフェードなし）であり、key-off後の最初の100msは平均-36.46dBFSになる。これはウィンドウがほぼフルの信号と高速リリースのほぼ無音のテールを混ぜてしまうためで、急停止そのものの兆候である。変更後：key-off前の最後の100msは約-24dBFSから滑らかにテーパーを通って約-41dBFSまで下がり、key-off後の100msは平均-53.78dBFSとなり、以前のウィンドウの混合をはるかに下回る。key-offから最初に（かつ持続的に）-60dBFSを下回るまでの時間：変更前は22ms、変更後は9ms - こちらのほうが速いのは、固定ハードウェアリリースだけに落差の全部を任せるのではなく、テーパーがkey-off前にすでにレベルを下げているからである。同じレンダーの1.4秒全体（オンセットからテールまで）のミリ秒単位のラウドネス・トレースは、804msまでは変更前後で同一であり - これはテーパー自身が導出した開始点800ms（key-off 900msからテーパー100msを引いた点）から4ms後にすぎず、その差はレジスタ書き込みのスタガーによるものである - テーパーのウィンドウより前は何も動いていないことを裏付け、その後はどちらのテールもレンダー自身のノイズフロアである-60dBFSをはるかに下回るところまで収束する。A/B用のWAVとその元になったJSON測定値は、このチケット専用にローカルにのみ保持している（スクラッチパッド、コミットしない）。決定44のコーパスと同じ慣習である。

**gamesoundsへの影響、測定済み、何もpushしていない。** gamesoundsの`16bit`系カタログは、SNES半分を`chip.driver()`経由でそのまま使っている - `renderSfx`（`packages/chipvoice/src/render-sfx.ts`）は`renderSong`と同じく`SnesDriver`を使う - ので、保持時間が`TAPER_FLOOR_MS`以上あるすべてのSNES効果音がこのテーパーを通ってレンダーされる。`apps/sounds/catalog/chipvoice-recipes.mjs`自身のグループ／バリアント選択ロジック（`scripts/build-catalog.mjs`が使う「先頭から`VARIANTS_PER_GROUP`件の、可聴かつバイト単位で異なるテイクを採用する」という同じ規則）を、コミット済みカタログの44件のSNESイベントグループに対して再実行し、このドライバーの変更前後を比較した：現在出荷されている176件のSNESバリアントのうち105件（44グループ中29グループ）が異なるPCMバイトをレンダーする。残る71件（15グループにわたる）は40msの下限を下回る短い、あるいは打楽器的なテイクであり、バイト単位で変更されないことが証明できる。変更されたバリアントのトリム後の長さは平均10ms短くなる（テーパー自身がトリムの下限に早く近づくため）。ほぼ下限に近い音符では-1msから、最も長く保持される音符（`combat/death`、`game/game-over`）では最大-19msまでの幅がある。このチケットによって、gamesoundsのアセット、`apps/sounds/generated/catalog.json`、`public/f/*`のいずれのファイルも再生成・アップロード・pushされていない - `sounds:push`は一度も実行していない - これはローカルの使い捨ての再レンダーに対する測定にすぎず、上記のbefore/after WAVとまったく同じ扱いである。

**適合性とフィクスチャ。** `check:snes`（`snes_spc`に対して100.0000%）、`check:spc`（100.0000%）、`check:spc-export`（PASS、`mario`と`zelda`。`sonic`はARAMに収まらないが、これはこのチケットと無関係）はいずれも影響を受けていない - このチケットは`noteOff`がすでに順不同でスケジュールできていたレジスタ書き込みを追加するだけであり（`RegisterTransactions`が`at`でソートする）、レジスタ書き込みの意味を変えることは一切ない。`render-parity:check chromium`は、SNESの影響を受けるものも含む22件の固定入力すべて（`mario-snes`、`zelda-snes`、`sonic-snes`、`snes-lead-0`、`snes-perc-k`）でパスした。FirefoxとWebKitはこの作業マシン上では最後まで実行できなかった（Firefox Nightlyがハーネス自身の1エンジンあたり90秒の予算の下でクラッシュしたこと、およびWebKitのバイナリがこのマシンのPlaywrightがもう解決できないバージョンでキャッシュされていたこと）- どちらもこの変更が引き起こしたものではない、既存のローカル環境の問題であり、CIは3つとも新規にインストールする。エンジンハッシュで固定された4件のフィクスチャを再生成した：`packages/chipvoice/src/mix-profiles.ts`と`scores/mixing/calibration-manifest.json`（90件のmix-profileエントリのうち52件が変更、すべて`chip: 'snes'`、残る38件はバイト単位で同一）、`apps/web/src/data/instrument-catalogue.json`（89件のプリセットのうち16件が変更、すべて`snes-*`、残る73件はバイト単位で同一）、`apps/web/public/render-parity-data/inputs.json`（22件の入力のうち5件が変更、上記と同じ5件、残る17件はバイト単位で同一）。`apps/web/public/arrangement-data/report.json`は**再生成していない**：`scores/arrangements/evaluate.mjs`は独立したGMEオラクルの参照データ（`.artifacts/arrangements/native-reference.json`、`.artifacts/native-songs/*`）を必要とするが、これは新規チェックアウトには存在せず、`pnpm audio:pull`でも取得できない - このチケットが持ち込んだものではなく、既存の環境上のギャップであり、ローカルにGMEツールチェーンを構築しない限り閉じられない。コミット済みのファイル自体は変更していない（`git status`で未変更であることを確認済み）ので、古いものがCIに届くことはない：上記の3件のフィクスチャとは異なり、`report.json`自身の`engineSha256`を現在のビルドに対して検証するチェックはこのリポジトリには存在せず、`browser`のCIジョブの`audio:pull`／`audio:check`は、コミット済みファイルが名指しする*すでに公開済みの*録音を検証するだけであり、それらは誰かがそのオラクルを使って`evaluate.mjs`と`audio:push`を実行するまで変わらない。実行が失敗する前に得られた部分的な証拠：4曲のデモすべてのコンソール出力は、`sonic`に近い箇所のネイティブ参照読み込みが失敗する前に完了しており、`mario/snes`は現在コミットされているレポートの-28.86dBFSに対して-30.0dBFS RMSを示した（約1.1dB静かで、テーパーが保持された音符の末尾からわずかなサステインエネルギーを削ることと整合する）。一方`mario/2a03`、`mario/dmg`、`mario/md`（このSNES専用の変更の影響を受けない他のチップ）はコミット済みレポート自身の値と一致していた。GMEオラクルにアクセスできるフォローアップで、このフィクスチャを正しく再生成すべきである。このチケットはこのギャップを回避したり黙って残したりするのではなく、記録することを選んだ。

**テスト。** `packages/chipvoice/test/snes-taper.mjs`は、正確なレジスタ書き込みをピン留めしている：長いdryの音符のテーパーADSR2書き込み（引用した式から独立に再導出したものであり、ドライバーからインポートしたものではない）、それが既存の高速GAIN減少のペアより厳密に前に位置すること、下限を下回る短い音符が以前と同じ2回書き込みのリリースをバイト単位で保つこと、`room`空間の音符が長さに関わらず同様であること、そして再利用されたボイス上の2つ目の音符が最初の音符ではなく自分自身の開始からテーパーすることである。
