<a id="projects-creation-and-publication"></a>
# プロジェクト、制作、公開

<p align="center"><a href="CREATION.md">English</a> &bull; <a href="CREATION_ja.md">日本語</a></p>

**0.17.0** のプロジェクト API は、完全な演奏、コンパクトなスコア、ブラウザーの制作画面、公開機能を結びます。読み込んだ音楽を4行に縮小しません。[Create](https://chipvoice.dev/ja/create) はローカルで動作し、[Explore](https://chipvoice.dev/ja/explore) には明示的に公開したリビジョンだけが表示されます。従来の作曲画面、`/s/{id}`、SDK API も維持します。

<a id="one-authoritative-document"></a>
## 正本となるドキュメントは一つ

`MusicProject` バージョン **1** は、タイトル、任意の説明、出典 `author`、再利用 `licence`、タグ、一つのソース、レンダリング設定を保存します。`reserved`（既定）、`CC0-1.0`、`CC-BY-4.0` は音楽の利用条件であり、ソフトウェアのライセンスやアカウント名とは別です。

| ソース | 保存する情報 | 再生方針 |
| --- | --- | --- |
| `score` | 既存の `Score` パターン、順序、楽器の意図 | 作者指定のレベルを保存し、サンプル一致で検証。`mix: 'auto'` は拒否 |
| `performance` | 正確な tick、テンポ、音符、表現、楽器、移植音色、ミックス指定 | 決定論的割り当てと自動ミックス。`mix: 'authored'` で無効化 |
| `native` | シリアライズ可能なレジスタ計画と編集用演奏 | 元の機種・テンポ・音高で原コマンドを再生。変更やパート分離はアレンジ |

ネイティブのメモリは `storePlan(plan)` でバイト配列として保存し、ハッシュはデータと設定を含みます。音符を編集するとジェネレーターから独立します。公開ページは他人の JavaScript を実行せず、保存済みソースを再生します。

`parseProject(unknown)` は独立した JSON スナップショット、または `ProjectValidationError` を返します。`validateProject` は `{ok, issues}` を返し、問題にはパス・コード・説明・重要度があります。不明なバージョン、フィールド、機種は拒否します。JSON、SDK、HTTP は同じ `PROJECT_SCHEMA` と意味検証を使います。検証成功は音楽的な良さや原作との一致を保証しません。

<a id="create-and-recover"></a>
## 制作と復元

完全再生画面の **Remix this song** から、読み込んだ MIDI も制作画面に移せます。原コマンドの参照演奏は保持し、編集版はアレンジと表示します。従来の作曲画面からも、作者のミックスを変えずにスコアを開けます。

パート名、追加・削除・複製、音高・ドラムグリッド、長さ・ベロシティ、音域、セクション移動・反復、ループ開始、テンポ、移調、音色、トリム、ボイス優先度、ミックス重要度、ミュート・ソロ、Undo/Redo を提供します。音符と JSON は同じソースです。モバイルは1小節、デスクトップは2小節を表示し、シークと Play を楽器内に配置します。

名前付き下書きはライブラリのローカル欄にページ分割で表示し、リミックスは別の復元キーを使います。下書きはこのブラウザーの localStorage に保存され、端末間バックアップではありません。独立したコピーは JSON をダウンロードしてください。アカウントは公開・プロフィール管理に必要です。読み込みは4 MBまで、公開操作まではローカルです。新しい音声を準備中も直前の音を維持し、準備状態を表示します。完成・デコード後に短いクロスフェードで切り替え、曲内の相対位置を維持します。ゼロ遅延の編集ではありません。

JavaScript はサンドボックス化した不透明オリジンの iframe 内の使い捨て Worker で動き、CSP はネットワークを禁止します。`starter` と seed 付き `random()` を渡し、2秒・出力4 MBで制限します。構文エラー、タイムアウト、不正出力では直前のソースを残します。再現性には `random()` と決定論的な入力を使う必要があります。時刻や独自の乱数を使う任意コードまで保証しません。Worker は OS レベルのメモリ制限ではなく、意図的なメモリ枯渇を無害とは約束できません。

<a id="sdk-contracts"></a>
## SDK の契約

```js
import { importProjectMidi, validateProject, prepareProject,
  ProjectPlayer, renderProject, toWav } from 'chipvoice';
const abort = new AbortController();
const project = await importProjectMidi(midiBytes, {
  chip: 'snes', title: 'My song', signal: abort.signal,
});
project.settings.allowLoss = true;
console.log(validateProject(project));
const prepared = await prepareProject(project, {
  signal: abort.signal, onProgress: fraction => console.log(fraction),
});
const player = new ProjectPlayer();
await player.load(project);
playButton.onclick = () => player.play();
await player.update({ chip: 'md', tempoScale: 1.2 });
player.seek(12);
player.loop = true;
player.pause(); player.restart(); player.stop();
player.dispose();
const { audio, plan } = renderProject(project, { sampleRate: 44100 });
const wav = toWav(audio);
console.log(plan?.losses, plan?.mix);
```

| パラメーター・操作 | 契約 |
| --- | --- |
| `settings.chip` | `2a03`、`dmg`、`md`、`snes`、`c64`。公開デモでは C64 を非表示 |
| `tempoScale` | 0.1–10倍。コンパクトスコアは有効な BPM 範囲も必要 |
| `transpose` | 演奏は半音単位 −48〜+48。従来スコアは音域内の整数 |
| `gain` | 線形マスターゲイン 0–1。既定は各ソースの従来方針 |
| `allowLoss` | SDK の既定 false。対話プレビューは報告付き損失を明示許可 |
| `parts` | ソースのパート ID 配列。コンパクトでは `lead`、`chord`、`bass`、`perc` |
| `sampleRate` | 整数 Hz、8000–96000、既定44100 |
| `renderProject.seconds` | 任意の抜粋長、正数で最大600秒。元の長さは延長しない |
| `load` / `update` | 採用した選択だけ true、失敗・置換は false。`error` を確認 |
| `playing`, `position`, `duration`, `audibleProject` | 再生意図と実際に聞こえる状態。準備中の値に先走らない |
| `preparing`, `progress`, `prepared`, `onChange` | 準備状態、0–1進捗、直前の結果、通知。位置はアニメーションフレームで読む |
| `cancel` / `dispose` | 準備を中断。dispose は再生・Worker・URLも解放し、自身が所有する Context のみ閉じる |

`ProjectPlayer({context})` は既存 AudioContext を利用できます。`output` は出力観測、`setVolume` はプロジェクトを変えない試聴ゲインです。書き出しにはプロジェクトのゲインを使います。`PerformancePart.program` は新規音符の既定楽器で、音符ごとの指定を優先します。`muted` と `mix.gainDb` は自動ミックスなしでも有効です。ブラウザーとサーバーは同じ `renderProject` を使用します。`Chip`、SFX、生レジスタ、`recordSong`、`toVgm` も利用できます。`projectCapabilities()` は WAV と下位のレジスタ VGM 出力を区別し、声数・役割を示します。全機種が他機種の全楽器を再現するとは主張しません。

<a id="publication-and-identity"></a>
## 公開とアイデンティティ

[OpenAPI](https://chipvoice.dev/.well-known/openapi.json) と[エージェントガイド](https://chipvoice.dev/skill.md) は `/api/v1` と既存 `/api/songs` を公開します。ソーススキーマ、npm、HTTP API のバージョンは別の互換性境界です。

| エンドポイント | 動作 |
| --- | --- |
| `POST /api/v1/validate` | 保存せず検証。200 または問題付き422 |
| `POST /api/v1/projects` | 認証付き `{project, visibility?, parentId?}`。`Idempotency-Key` 必須、変更不能リビジョン |
| `GET /api/v1/projects/{id}` | 全ソースとメタデータ。非公開は所有者のみ |
| `DELETE /api/v1/projects/{id}` | 所有者による取り下げ。ソース・音声を隠し未完了ジョブを中断。既存リミックスは保持 |
| `GET /api/v1/projects` | `q`、`tag`、`chip`、`handle`、`sort=recent|popular`、不透明 `cursor` |
| `GET/PUT /api/v1/profile` | 大小文字を区別しない一意ハンドル、別の表示名、自己紹介 |
| `PUT/DELETE /api/v1/projects/{id}/favourite` | 1アカウント1件。自分の曲は除外 |
| `POST /api/v1/projects/{id}/report` | 認証付き理由3–500文字。アカウントと曲ごとに1件 |
| `POST /api/v1/projects/{id}/render` | 所有者が `{kind: 'preview'|'full'}` を開始。曲と種類で冪等 |
| `GET/DELETE /api/v1/jobs/{id}` | 進捗・状態、または所有者による中断 |
| `GET /api/v1/jobs/{id}/audio` | 完了済み固定 WAV。公開範囲を適用 |

既存 Bearer キーと HttpOnly セッションを再利用します。公開プロフィール ID は内部 ID と別で、メールは公開しません。ハンドルの予約はアトミックです。同じキーと本文の再送は同じ曲を返し、本文・親・公開範囲を変えた再送は409です。新リビジョンには新キー・IDを使います。

公開曲のみ Explore に表示し、限定公開はリンクで、非公開は所有者だけが閲覧できます。`mine=1` と `favourites=1` は認証が必要です。ページは最大24件です。カーソルは後から作成した曲を除外しますが、取り下げやお気に入り順位の変更は後続ページに影響し得ます。「今週の人気」は直近7日間の一意なお気に入りを数え、音質評価でも複数アカウント不正への完全対策でもありません。下書きは検索に含めず、空のコミュニティにはオリジナルのスターターを案内します。架空ユーザーや投票は作りません。

<a id="pinned-audio-and-operating-limits"></a>
## 固定音声と運用上限

ジョブは実際のバンドル済みレンダラーの SHA-256 を保存します。チップコード、音色パレット、校正も含みます。完了した WAV のチャンクとバイトハッシュを SQLite/Turso に保存し、新エンジンで勝手に再レンダリングしません。新エンジンでの公開は新リビジョンです。中断や古いエンジンのジョブは明示的に失敗し、新リビジョンで再試行できます。

プレビューは最大 **30秒**、ソース・ローカル全曲は最大 **10分**。サーバーは **240秒の Worker 期限**、**256 MB の JS ヒープ**、**40 MB 出力**、共有で1件の実行リースです。ヒープ制限はネイティブ・ArrayBuffer メモリを別途制限しません。受付上限は DB に保存します。Next `after` が開始を試み、所有者の状態ポーリングが待機ジョブを再試行します。これは小規模な協調キューで、外部の永続スケジューラーではありません。所有者が再度ポーリングするまで待つ場合があります。強制終了はリース期限後に失敗表示します。Node Worker、書き込み可能な DB、300秒のルート実行時間に対応する環境が必要です。

運用者は `project_reports` と `projects` を結合して通報を確認し、`deleted_at` を設定して取り下げ、未完了 `project_jobs` を中断できます。通報は自動削除しません。取り下げはアプリからのアクセスを止め、参照履歴の行は保持します。保管・消去は運用方針です。秘密情報をリポジトリに置かず、`.env.example` からローカル設定を作り、資格情報をサーバー側に保ち、検証には使い捨て DB を使ってください。

<a id="qualification"></a>
## 検証

`packages/chipvoice/test/project.mjs` は厳密な受付、従来音声一致、3つの完全な曲の往復、正確なセクション・表現反復を検証します。`apps/web/test-projects.mjs` は使い捨て DB で並行再送、公開範囲、リミックス、検索、プロフィール、お気に入り、実 Worker の WAV 永続化、中断を検証します。`apps/web/test-creation-browser.mjs` は音声出力、シーク・ライブテンポ、seed・分離・タイムアウト、Undo、公開と再読込、EN/JA モバイルを検証します。従来の音声時計・遷移・作曲画面テストも維持し、画像と動画を `.artifacts/creation/e2e` に生成します。

構造・信号の自動検証は、音楽的な試聴、実機モバイル、運用容量の監視を置き換えません。原作との忠実度は別のネイティブ参照適合テストで扱います。
