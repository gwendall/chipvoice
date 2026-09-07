<a id="automatic-mixing-foundations--2026-09-07"></a>
# 自動ミックスの基礎 — 2026-09-07

<p align="center"><a href="AUTOMATIC-MIXING-FOUNDATIONS-2026-09-07.md">English</a> &bull; <a href="AUTOMATIC-MIXING-FOUNDATIONS-2026-09-07_ja.md">日本語</a></p>

<a id="reproduced-failures"></a>
## 再現した不具合

`scores/mixing/diagnose.mjs` は Zelda の最初の 12 秒を NES ネイティブと Mega Drive 移植で、
同じゲインの全体／分離録音として記録します。NES のベースは旋律より 5.50 dB 小さい一方、
移植では 6.42 dB 大きく、差は 11.92 dB です。`check-baseline.mjs` は実録音で失敗します。
Mega Drive の打楽器単独は -63.27 dBFS RMS と小さく、この区間の支配的な低音は主にベースです。
非線形ミックスでは分離音の和が原音にならないため、分離は診断として扱います。

別の回帰では、空き FM 声部があるのに明示的な FM 和音パッチを PSG に割り当てています。
PSG はそのパッチを再生できません。出力修正に続き、割り当てと校正を修正します。

<a id="output-correction"></a>
## 出力修正

Mega Drive のローパスはサンプルレート削減後に動いており、超音波の多重化ピン成分が先に可聴域へ
折り返していました。既存の 2,840 Hz プロファイルを保持し、平均化前の YM 内部クロックでローパスを適用します。
ネイティブ命令、デジタル状態機械、声部レベル、プロファイル周波数は変更しません。
結合ハイパスは出力サンプルレートで処理します。

`test/md-output.mjs` は独立した正弦波ピン入力で検証します。44.1 kHz 時の 53.1 kHz 入力の
折り返し成分は 0.05098 から 0.00847 に減り、440 Hz ゲインは約 0.988 のままです。
解析的な RC と矩形平均窓の上限を用い、48 kHz でも検証します。修正前は失敗しました。

Sonic の最初の 12 秒では、全パワーに対する 8〜10 kHz 成分は 0.004038 から 0.000342 に減ります。
独立 GME は 0.000875 です。原因を特定した折り返しを除去した結果であり、PCM や実機音の完全一致ではありません。

独立 GME の分離音は固定リビジョンの公開ミュート機能（FM1〜5、PCM、PSG）を使います。
修正版の PSG 対 FM は -5.42 dB、GME は -5.33 dB です。この区間からは Zelda のベース問題のために
FM/PSG 比を変更する理由は得られません。DAC 対 FM は約 2.32 dB 異なり、GME は DAC を別経路で合成します。
ハードウェアモデルの誤りと断定するには追加の実機収録が必要です。

<a id="evidence-and-scope"></a>
## 証拠と範囲

`.artifacts/automatic-mixing/before/` と `sonic-output/` に WAV、リファレンス PCM、JSON、確認済み
スペクトログラムがあります。`gme-stems.cpp` は固定 GME ビルドを使い、`compare-sonic.py` は NumPy、
SciPy、Matplotlib で記述的な図を作ります。実行形式の原典とオラクルはローカルに残します。
コーパスの分割と上限は `scores/mixing/contract.json` にあり、未使用の検証曲で修正を調整していません。

SDK の全単体テストは成功しました。意図した Mega Drive PCM 変更のみ golden を更新し、NES、Game Boy、
SNES、C64 は変わりません。公開物全体とブラウザの検証は汎用移植ポリシー統合後に実施します。
このローカル測定は実機の性能や人の好みの認証ではありません。
