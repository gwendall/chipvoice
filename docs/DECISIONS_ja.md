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
