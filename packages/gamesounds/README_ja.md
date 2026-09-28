<a id="gamesounds"></a>
# gamesounds

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

イベント単位でファイルされたゲーム効果音バンク：
[gamesounds.ai](https://gamesounds.ai)のCLIとランタイム。閲覧やダウンロードにアカウントは不要で、すべての音がそれぞれのライセンスをデータとして持つ（フェーズ1は`CC0-1.0`のみを出荷）。完全なデータモデル、タクソノミー、APIリファレンスはメインリポジトリの
[`docs/GAMESOUNDS.md`](https://github.com/gwendall/chipvoice/blob/main/docs/GAMESOUNDS.md)を、このパッケージが存在する理由は
[決定48](https://github.com/gwendall/chipvoice/blob/main/docs/DECISIONS.md)を参照。

<a id="the-cli"></a>
## CLI

```bash
npx gamesounds add jump coin hit/heavy ui/confirm --style 8bit
```

各イベント（カテゴリid、裸のリーフ名、または`leaf/tag` - `docs/GAMESOUNDS.md`参照）をgamesounds.aiに対して解決し、音声をダウンロードし、`sounds.json`と`SOUNDS-CREDITS.md`をカレントディレクトリに書き出す（`--out`で別のディレクトリを選べる）。ダウンロードした各ファイルのハッシュは、コマンドが終了する前にサーバー自身のコンテンツアドレス化されたストアに対して検証される。再実行しても安全：ディスク上に既にあるファイルは再ダウンロードされず、後続の実行は`sounds.json`を置き換えるのではなく追加する。`gamesounds add --help`で全フラグ（`--style`、`--api`、`--out`）の一覧が表示される。

<a id="the-runtime"></a>
## ランタイム

```ts
import { loadSounds } from "gamesounds";
import manifest from "./sounds.json";

const sounds = await loadSounds({ manifest });

document.addEventListener("pointerdown", () => sounds.unlock(), { once: true });

sounds.play("jump");                    // round-robin variant, jitter, cooldown
sounds.play("hit/heavy", { detune: 200 });
const music = sounds.bus("music");
music.duck(0.4);                        // ready for a one-shot on the sfx bus

const amb = sounds.loop("ambience/wind");
amb.stop();
```

`loadSounds()`は`{remote: true, events, style, api}`も受け付け、ローカルの`sounds.json`を一切持たずに、稼働中のgamesounds.ai互換APIから直接解決・ストリーミングできる。返される`GameSounds`は、ラウンドロビンのバリアント選択、ピッチジッター、イベントごとのクールダウン、優先度スティーリング付きのイベントごと・グローバルのボイス上限、`duck()`を持つ名前付きバス、iOSのアンロックジェスチャーを扱う - 各オプションの詳細は`src/runtime.ts`自身のドキュメントコメントを、`Manifest`/`ManifestEvent`の完全な形は`src/types.ts`を参照。

<a id="the-schema"></a>
## スキーマ

`schema/manifest-1.json`（JSON Schema、draft 2020-12）は`sounds.json`自身の公開された契約である - 自前のツールが書き出すマニフェストを検証するために、直接インポートできる（`gamesounds/schema/manifest-1.json`）。

<a id="licence"></a>
## ライセンス

このパッケージ自身のコードはMIT。gamesounds.aiが配信するすべての音は自身のライセンスをデータとして持つ（`sound.license`、`sound.attribution`）。フェーズ1のカタログは全体が`CC0-1.0`であり法的なクレジット表記は不要だが、`SOUNDS-CREDITS.md`は出所と作者を記載する。

<a id="build-typecheck-tests"></a>
## ビルド、型チェック、テスト

```bash
npm run build        # tsc -p tsconfig.build.json -> dist/
npm run typecheck
npm run test:unit    # node --test over test/*.mjs, a fake AudioContext
node test-cli.mjs    # the CLI against a real local gamesounds.ai server
```

`bin/gamesounds.mjs`はプレーンなESMのまま、ビルドせずに出荷される（`dist/`に依存しない）ため、ビルド不要で実行できる。`dist/`は、このパッケージをビルドするかnpmからインストールした場合に`import "gamesounds"`が解決する先でしかない。
