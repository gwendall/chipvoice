<a id="corpus-spc-files"></a>
# コーパス：.spcファイル

<p align="center">
  <a href="README.md">English</a> &bull;
  <a href="README_ja.md">日本語</a>
</p>

`check:spc`（`src/spc/check.mjs`）用の`.spc`スナップショット。各ファイルを`importSpc`と`../../../oracles/snes-spc/play-spc.cpp`（実際のSPC700、blarggの`SPC_CPU.h`）の両方に同じファイルとして通し、2つのトレースを比較します。市販ゲームの吸い出しは扱いません。再配布を許すライセンスのファイルのみをここに置き、自作か許諾済みのもので、それぞれの出典・ライセンス・SHA-256を以下に記録します。ローカルの、gitignore対象のディレクトリ（checkスクリプトの`--corpus <dir>`）に個人用の何かを置くこともでき、CIはそれに依存しません。

| ファイル | 出典 | ライセンス | SHA-256 |
| --- | --- | --- | --- |
| `selftest.spc` | 本リポジトリ用に自作（手書きのSPC700プログラム：FLG、続いてMVOLL、続いてMVOLRを選択して書き込み、その場でループする） | CC0 / MIT、本リポジトリと同条件 | `6b8d4837cb1fb0dc5c4daabe9a5555e1126ceeed3a5bf24f1213cd584023d3b0` |

<a id="why-so-small"></a>
## なぜこれだけ小さいか

CPU自体はここよりずっと厳密に検証済みです。256個の全オペコード、ドキュメント記載の全フラグ効果、全サイクル数を、Anomie's SPC700 docに照らして`packages/chipvoice/test/spc700.mjs`で確認しています。このコーパスは実物同士の突き合わせ - 実際のスナップショットを実際の参照CPUに、同じファイルとして通す - であり、主たる証拠ではありません。突き合わせる価値のある再配布可能なSPCが見つかれば増やしますが、それまで何も止まりません。
