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
### 5. 三角波を出力ゼロの位相から開始（2026-09-04）— 13で置換

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
