<a id="japanese-console-playground-evaluation"></a>
# 日本版コンソールのプレイグラウンド評価

<p align="center">
  <a href="JAPANESE-PLAYGROUND-2026-09-06.md">English</a> &bull;
  <a href="JAPANESE-PLAYGROUND-2026-09-06_ja.md">日本語</a>
</p>


<a id="scope"></a>
## 範囲

初回マリオ、作曲ツールより前の親しみのある曲、日本版ロゴの原色保持、共通選択部でのC64非表示、JavaScriptエミュレーションの説明とAbout、初回操作での発音が対象です。音符、DSP、SDKリリース、公開試聴コーパスは変更していません。

<a id="method"></a>
## 方法

`apps/web/test-arrival.mjs`は新規ブラウザで7操作を独立に試します。曲選択、機種選択、Play、キーボード、タッチ、テンポ入力、ミュートです。初期楽譜、画像、アクセシブルなロゴだけの4ボタン、表示／Tab時の無音、選択機種、実RMS、Stop後の曲／機種／テンポ変更でも無音を維持することを確認します。保存済みC64の復元再生とAbout移動も確認します。最初がミュートなら、解除するまで無音で開始します。ChromiumとWebKitでローカル成功。

既存作曲検査は公開12組み合わせを測定します。5チップの楽譜／コンパイラー検査は415参照音符を保持し、非表示C64も含みます。持続音の音声時計検査はテンポ／機種変更中の**移行無音0 ms**と、同じ小数音楽位相での引き継ぎを確認しました。

デスクトップと390pxタッチ画面を撮影して確認しました。最初の画面に説明、曲、Playがあり、携帯のロゴは2列でファミコンの文字を読みやすくします。横はみ出しはなく、ナビゲーション、出典、Aboutへアクセスできます。

混雑ホストでは音声ブラウザ検査を順番に実行してください。Chromium／WebKitの同時実行でソニックの瞬間振幅が1度失敗し、単独では成功しました。ホスト競合や楽譜の休符をエミュレーションの回帰と誤判定しません。ロスレスラボ検査も1.3秒で取得できると仮定せず、読み込み状態を待ちます。

<a id="reproduce-and-evidence"></a>
## 再現と証拠

- `pnpm --filter chipvoice-web build`
- `pnpm --filter chipvoice-web test`：本番サーバーと一時DBを所有。
- `apps/web`から`BROWSER=webkit SITE=http://127.0.0.1:<port> node test-arrival.mjs`。
- `.artifacts/japanese-playground/{chromium,webkit}/`：初期／停止／About画像、操作動画、実測`result.json`。
- `.artifacts/composition/`：12組の測定とラボ画像。
- `.artifacts/continuity/live-audio.json`：サンプル時計の連続性。
- `.artifacts/demo/`と`.artifacts/lab/`：全操作回帰。

CIで到着証拠もアップロードします。SVGの出典は`apps/web/public/machines/README.md`。4ファイルとも実行ノードや外部資源参照なしのSVGとして解析できました。

Spec／Standardsの独立レビューは最終の初回操作状態差分を含めブロッカーなしでした。自動開始は音楽コンソール内に限定し、表示だけとナビゲーションは無音です。ラボは比較制御のため明示的Playと遅延ロスレス取得を維持します。
