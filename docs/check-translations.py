#!/usr/bin/env python3
"""Check repository translations; --sync-generated copies localized measurement blocks.

Uses only the Python standard library. Run from any working directory. Unknown
README generator wording fails closed so it receives a reviewed translation.
ROM stdout, identifiers and commands intentionally retain their source spelling.
"""
import argparse
import html
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
EXCLUDED = {'AGENTS.md', 'CLAUDE.md', 'upstream-README.md'}
NUMBERS = re.compile(r'\d+(?:\.\d+)*')
BLOCK = re.compile(r'<!-- (status|parity(?:-[\w-]+)?|roms|cpu-instrs|mixer|hwcombined|nsf-corpus|gbs-corpus|nsf-export|gbs-export|cpu6510|psid-corpus):begin -->(.*?)<!-- \1:end -->', re.S)


def source_files():
    tracked = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '*.md'], cwd=ROOT, text=True)
    return sorted({ROOT / p for p in tracked.splitlines() if Path(p).name not in EXCLUDED and not p.endswith('_ja.md')})


def japanese(path):
    return path.with_name(path.stem + '_ja.md')


def headings(text):
    result, fence = [], False
    for line in text.splitlines():
        if re.match(r'^\s*```', line):
            fence = not fence
        if not fence and re.match(r'^#{1,6} ', line):
            result.append(line)
    return result


def slug(text):
    text = re.sub(r'^#+\s+', '', text).lower()
    text = re.sub(r'<[^>]*>', '', text)
    # GitHub retains word characters, spaces and hyphens, but strips punctuation.
    text = re.sub(r'[^\w\- ]', '', text)
    return text.replace(' ', '-')


def heading_ids(text):
    seen, result = {}, []
    for line in headings(text):
        key = slug(line)
        count = seen.get(key, 0)
        seen[key] = count + 1
        result.append(key + (f'-{count}' if count else ''))
    return result


def numeric_template(line):
    count = iter(range(10000))
    return NUMBERS.sub(lambda m: '{n' + str(next(count)) + '}', line)


def localized_block(kind, body, templates):
    if kind == 'status':
        lines = []
        for line in body.splitlines():
            key = numeric_template(line)
            if key not in templates:
                raise ValueError(f'New README generator wording needs translation: {line}')
            values = {f'n{i}': value for i, value in enumerate(NUMBERS.findall(line))}
            # Replace only numeric placeholders; literal braces are not formatting syntax.
            lines.append(re.sub(r'\{(n\d+)\}', lambda m: values[m[1]], templates[key]))
        return '\n'.join(lines) + '\n'
    lines = []
    for line in body.splitlines():
        if not line.strip() or re.fullmatch(r'\|(?:\s*:?-+:?\s*\|)+', line):
            lines.append(line)
            continue
        if kind == 'parity' or kind.startswith('parity-'):
            match = re.fullmatch(r'Written by `conform` on (.+), against (.+), on (.+)\.', line)
            if match:
                lines.append(f'`conform`による生成：{match[1]}。参照：{match[2]}。比較対象：{match[3]}。')
                continue
            replacements = {
                'Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own': 'ボイス別：一致率、エッジの完全一致／近似／不一致、最良の一定シフト、区間ごとのシフト整合',
                'Logs with a divergence': '相違のあるログ', 'Identical cycles': '一致サイクル',
                'First divergence': '最初の相違', '| Oracle |': '| 参照 |', '| Corpus |': '| コーパス |',
                '| Log |': '| ログ |', '| Identical |': '| 一致率 |', 'none': 'なし',
                ' logs, ': 'ログ、', ' cycles': 'サイクル', 'cycle ': 'サイクル ',
                'ours ': '本実装 ', 'oracle ': '参照 ', '; runs ': '; 区間 ',
                ' on times': ' 時刻一致', ' on values': ' 値一致', 'shift <=': 'シフト <=',
                ' at ': ' シフト ',
            }
            headers = {'| | |', '| Log | Identical | First divergence | Per voice: identical; edges exact / near / unmatched; best constant shift; runs aligned under a shift of their own |'}
            metric = re.fullmatch(r'\| (?:Oracle|Corpus|Identical cycles|Logs with a divergence) \| .+ \|', line)
            data = re.fullmatch(r'\| [\w.-]+ \| \d+(?:\.\d+)? % \| .+ \| .+ \|', line)
            if line not in headers and not metric and not data:
                raise ValueError(f'Unknown parity line: {line}')
            for before, after in replacements.items():
                line = line.replace(before, after)
        elif kind == 'roms':
            match = re.fullmatch(r"Run by `conform`'s (.+) fixture on (.+): (\d+) of (\d+) pass\.", line)
            if match:
                line = f'`conform`の{match[1]} fixtureで{match[2]}に実行：{match[3]} / {match[4]}成功。'
            elif line == '| ROM | Result | What it said |':
                line = '| ROM | 結果 | 実際の出力（原文） |'
            elif re.fullmatch(r'\| `[^`]+` \| (?:pass|fail) \| .* \|', line):
                # The third cell is exact ROM stdout; never translate or rewrite it.
                line = line.replace('| pass |', '| 成功 |').replace('| fail |', '| 失敗 |')
            else:
                raise ValueError(f'Unknown ROM line: {line}')
        elif kind == 'cpu-instrs':
            match = re.fullmatch(r"Run by `conform`'s SM83 fixture on (.+), against the package's own `chips/gb/cpu\.ts`: (\d+) of (\d+) pass\.", line)
            if match:
                line = f'`conform`のSM83 fixtureで{match[1]}に実行（対象：本パッケージ自身の`chips/gb/cpu.ts`）：{match[2]} / {match[3]}成功。'
            elif line == '| ROM | Result | What it said |':
                line = '| ROM | 結果 | 実際の出力（原文） |'
            elif re.fullmatch(r'\| `[^`]+` \| (?:pass|fail|hung) \| .* \|', line):
                # The third cell is exact ROM stdout; never translate or rewrite it.
                line = line.replace('| pass |', '| 成功 |').replace('| fail |', '| 失敗 |').replace('| hung |', '| 停止 |')
            else:
                raise ValueError(f'Unknown cpu-instrs line: {line}')
        elif kind == 'mixer':
            match = re.fullmatch(r"Written by `conform` on (.+)\. The middle's level relative to the tone's; lower is a better cancellation\.", line)
            if match:
                line = f'`conform`が{match[1]}に生成。基準音に対する中央区間のレベル。低いほど相殺が良好です。'
            elif line == "| Test | This core | Blargg's NES, his recording |":
                line = '| テスト | 本コア | blarggのNES録音 |'
            elif not re.fullmatch(r'\| `apu_mixer/[\w-]+` \| -?\d+(?:\.\d+)? dB \| -?\d+(?:\.\d+)? dB \|', line):
                raise ValueError(f'Unknown mixer line: {line}')
        elif kind == 'hwcombined':
            match = re.fullmatch(r"Written by `conform` on (.+), against libsidplayfp/combined-waveforms' sampling of (.+) \(OSC3, the top eight of the twelve bits\), on (.+)\.", line)
            if match:
                line = f'`conform`による生成：{match[1]}。libsidplayfp/combined-waveformsによる{match[2]}のサンプリング（OSC3、12ビット中上位8ビット）との比較。対象：{match[3]}。'
            elif line == '| Combination | Bytes matching | Wrong bits |':
                line = '| 組み合わせ | 一致バイト数 | 誤りビット数 |'
            elif not re.fullmatch(r'\| `[\w+]+` \| \d+(?:\.\d+)? % \(\d+/4096\) \| \d+/32768 \|', line):
                raise ValueError(f'Unknown hwcombined line: {line}')
        elif kind == 'nsf-corpus':
            match = re.fullmatch(r'Written by `nsf-corpus:sheet` on (.+), against Game_Music_Emu revision `(.+)`\.', line)
            if match:
                line = f'`nsf-corpus:sheet`による生成：{match[1]}。参照：Game_Music_Emu revision `{match[2]}`。'
            elif line == '| Song | Driver | Commands | Matched | First divergence |':
                line = '| 曲 | ドライバー | コマンド数 | 一致 | 最初の相違 |'
            elif re.fullmatch(r'\| \[.+\]\(.+\) \| .+ \| \d+ \| (?:\d+/\d+|not compared) \| .+ \|', line):
                # The title, driver name and URL are proper nouns; only the
                # fixed divergence vocabulary (corpus.mjs's formatDivergence)
                # is translated.
                for before, after in {'not compared': '未比較', 'none': 'なし', ' vs ': ' 対 ', 'cycle ': 'サイクル ', ': one side has no more commands': '：一方にそれ以上のコマンドがありません'}.items():
                    line = line.replace(before, after)
            else:
                raise ValueError(f'Unknown nsf-corpus line: {line}')
        elif kind == 'gbs-corpus':
            match = re.fullmatch(r'Written by `gbs-corpus:sheet` on (.+), against Game_Music_Emu revision `(.+)`\.', line)
            if match:
                line = f'`gbs-corpus:sheet`による生成：{match[1]}。参照：Game_Music_Emu revision `{match[2]}`。'
            elif line == '| Song | Driver | Commands | Cycle-exact | Same value+order | First divergence |':
                line = '| 曲 | ドライバー | コマンド数 | サイクル一致 | 値・順序一致 | 最初の相違 |'
            elif re.fullmatch(r'\| \[.+\]\(.+\) \| .+ \| \d+ \| (?:\d+/\d+|not compared) \| (?:\d+/\d+|not compared) \| .+ \|', line):
                # The title, driver name and URL are proper nouns; only the
                # fixed divergence vocabulary (corpus.mjs's formatDivergence)
                # is translated.
                for before, after in {'not compared': '未比較', 'none': 'なし', ' vs ': ' 対 ', 'cycle ': 'サイクル ', ': one side has no more commands': '：一方にそれ以上のコマンドがありません'}.items():
                    line = line.replace(before, after)
            else:
                raise ValueError(f'Unknown gbs-corpus line: {line}')
        elif kind == 'nsf-export':
            match = re.fullmatch(
                r"Written by `nsf-export:sheet` on (.+), against Game_Music_Emu revision `(.+)`\. "
                r"Commands and frame writes both gate CI exactly \(matched must equal total, not just be nonzero or \"close\"\)\. "
                r"Commands: the export, replayed by GME, against this project's own offline replay of the same export - "
                r"identical bytes on both sides, so anything short of an exact match is a player bug\. "
                r"Frame writes: the source capture's own register writes against GME's trace of the export, bucketed into "
                r"60 Hz frames and compared for exact address/value/order equality after one constant frame offset "
                r"\(an expected, fixed PLAY-call latency - every NSF player's own INIT-to-first-PLAY overhead differs\) - "
                r"a deterministic command-content proof, not an audio measurement; a source frame stops counting once its "
                r"own real-time slot passes the point where the exported player wraps back to its loop frame, reported as "
                r"\"excluding N frame\(s\) past the loop wrap\" when that applies\. "
                r"Export loss: relative RMS error, after peak-normalizing and offset-aligning \(searched, not assumed\), "
                r"between two same-DSP renders \(GME's trace of the export, replayed; the untouched source\) - "
                r"the coarse secondary gate, threshold (\d+)%\. "
                r"GME mixer: the same metric between GME's own PCM of the export and this project's render of the source - "
                r"two independent emulators, reported for visibility, not gated\.", line)
            if match:
                line = (f'`nsf-export:sheet`による生成：{match[1]}。参照：Game_Music_Emu revision `{match[2]}`。'
                         f'コマンドとフレーム書き込みはどちらもCIを完全一致でゲートします'
                         f'（一致数が総数と等しくなければならず、非ゼロや「近い」では足りません）。'
                         f'コマンド：エクスポートをGMEで再生したものと、本プロジェクト自身によるオフライン再生とを比較したもの - '
                         f'両者は同一のバイト列なので、完全一致に届かなければプレイヤーのバグです。'
                         f'フレーム書き込み：元キャプチャ自身のレジスター書き込みとGMEによるエクスポートのトレースを、'
                         f'それぞれ60Hzフレーム単位でバケット化し、一定のフレームオフセット1つを挟んでアドレス・値・順序の'
                         f'完全一致を比較したもの（これは想定内の固定PLAY呼び出し遅延です - NSFプレイヤーごとにINITから'
                         f'最初のPLAYまでのオーバーヘッドが異なります） - 音声測定ではなく決定的なコマンド内容の証明です。'
                         f'元のフレームは、自身の実時間上の位置がエクスポートしたプレイヤーの折り返し地点（ループフレームへ戻る地点）'
                         f'を過ぎた時点で比較対象から外れ、該当する場合はシートに「ループ折り返し後のNフレームを除外」と表記されます。'
                         f'エクスポート損失：ピーク正規化と（決め打ちではなく探索した）オフセット位置合わせを行った後の、'
                         f'同一DSPによる2つのレンダー'
                         f'（GMEによるエクスポートの再生トレースをレンダーしたものと、手つかずの元ソースをレンダーしたもの）'
                         f'間の相対RMS誤差 - 粗い二次ゲートで、しきい値{match[3]}%。'
                         f'GMEミキサー：GME自身によるエクスポートのPCMと本プロジェクトによる元ソースのレンダーとの間で同じ指標を'
                         f'取ったもの - 独立した2つのエミュレーターの比較であり、可視化のために報告するだけでゲートにはなりません。')
                lines.append(line)
                continue
            if line == '| Song | Commands | Frame writes | Export loss | GME mixer | First divergence |':
                lines.append('| 曲 | コマンド | フレーム書き込み | エクスポート損失 | GMEミキサー | 最初の相違 |')
                continue
            row = re.fullmatch(r'\| (.+) \| (.+) \| (.+) \| (.+) \| (.+) \| (.+) \|', line)
            if not row:
                raise ValueError(f'Unknown nsf-export line: {line}')
            title, commands, frame_writes, loss, mixer, note = row.groups()
            # Title (a proper noun, plain or a Markdown link) and any
            # matched/total, byte or percentage counts pass through
            # unchanged; only the small fixed vocabulary `corpus.mjs`'s
            # `formatResult` produces is translated. Unrecognized shapes
            # fail closed.
            if not re.fullmatch(r'\d+/\d+|not exportable: \w+|not rendered|\d+ bytes', commands):
                raise ValueError(f'Unknown nsf-export commands cell: {commands}')
            frame_writes_match = re.fullmatch(
                r'-|not compared|(\d+)/(\d+) \(offset ([+-]\d+)\)'
                r'(?:, excluding (\d+) frames? past the loop wrap)?'
                r'(?:, frames ((?:\d+, )*\d+(?:, \.\.\.)?) differ)?',
                frame_writes)
            if not frame_writes_match:
                raise ValueError(f'Unknown nsf-export frame-writes cell: {frame_writes}')
            if not re.fullmatch(r'-|not compared|\d+(?:\.\d+)?%(?: \(over threshold\))?', loss):
                raise ValueError(f'Unknown nsf-export loss cell: {loss}')
            mixer_match = re.fullmatch(r"-|not compared|GME's mixer differs from ours by (\d+(?:\.\d+)?)%", mixer)
            if not mixer_match:
                raise ValueError(f'Unknown nsf-export mixer cell: {mixer}')
            if frame_writes in ('-', 'not compared'):
                translated_frame_writes = {'-': '-', 'not compared': '未比較'}[frame_writes]
            else:
                matched, total, offset, excluded, mismatched = frame_writes_match.groups()[0:5]
                translated_frame_writes = f'{matched}/{total}（オフセット{offset}）'
                if excluded:
                    translated_frame_writes += f'、ループ折り返し後の{excluded}フレームを除外'
                if mismatched:
                    translated_frame_writes += f'、フレーム{mismatched}が不一致'
            # Error messages that carry a measured number (dacWritesPerFrame,
            # a memory block's address/length) are translated with a regex so
            # the number passes through unchanged; everything else is a
            # small fixed vocabulary translated by substring replacement.
            note_regex_replacements = [
                (r"This capture writes \$4011 \(the DMC's direct-load DAC\) up to (\d+) times within a single 60 Hz frame - "
                 r"raw PCM streamed straight through the DAC, not DMA sample playback\. That needs each write timed to a "
                 r"fraction of a frame, which this player's once-per-frame PLAY call cannot carry\.",
                 lambda m: f'このキャプチャは$4011（DMCの直接ロードDAC）を単一の60Hzフレーム内で最大{m[1]}回書き込んでいます - '
                           'DMAサンプル再生ではなく、DACへ直接ストリーミングされる生のPCMです。各書き込みをフレームの端数'
                           'タイミングに合わせる必要があり、このプレイヤーの1フレームに1回のPLAY呼び出しでは表現できません。'),
                (r"This capture enables DMC/DPCM sample playback \(\$4015 written with bit 4 set\) but carries no sample memory "
                 r"\(RecordedSong\.memory / PerformancePlan\.memory\); the export needs the sample bytes physically present at "
                 r"the addresses \$4012/\$4013 point to, and this capture has none to place there\.",
                 lambda m: 'このキャプチャはDMC/DPCMサンプル再生を有効にしています（$4015のビット4が立っています）が、'
                           'サンプルメモリ（RecordedSong.memory / PerformancePlan.memory）を運んでいません。エクスポートには'
                           '$4012/$4013が指すアドレスにサンプルバイトが物理的に存在している必要がありますが、このキャプチャ'
                           'には配置するものがありません。'),
                (r"A DMC sample memory block at \$([0-9a-f]+) \((\d+) bytes\) falls outside \$C000-\$FFFF, the only range the "
                 r"DMC's hardware DMA can read from; this player can only place sample bytes there\.",
                 lambda m: f'アドレス${m[1]}のDMCサンプルメモリブロック（{m[2]}バイト）は、DMCのハードウェアDMAが読み出せる'
                           f'唯一の範囲である$C000-$FFFF外にあります。このプレイヤーはその範囲にしかサンプルバイトを配置'
                           'できません。'),
            ]
            translated_note = note
            for pattern, template in note_regex_replacements:
                regex_match = re.fullmatch(pattern, note)
                if regex_match:
                    translated_note = template(regex_match)
                    break
            note_replacements = {
                'not exportable: dmc_unsupported': 'エクスポート不可: dmc_unsupported',
                'not exportable: dmc_sample_missing': 'エクスポート不可: dmc_sample_missing',
                'not rendered': '未レンダリング',
                'not compared': '未比較',
                ' (over threshold)': '（しきい値超過）',
                'none': 'なし', ' vs ': ' 対 ', 'cycle ': 'サイクル ',
                ': one side has no more commands': '：一方にそれ以上のコマンドがありません',
            }
            translated_commands, translated_loss = commands, loss
            for before, after in note_replacements.items():
                translated_commands = translated_commands.replace(before, after)
                translated_loss = translated_loss.replace(before, after)
                if translated_note == note:
                    translated_note = translated_note.replace(before, after)
            if mixer_match[1] is not None:
                translated_mixer = f'GMEのミキサーは本プロジェクトと{mixer_match[1]}%異なる'
            else:
                translated_mixer = note_replacements.get(mixer, mixer)
            if translated_note == note and note not in ('none',) and not re.fullmatch(r'サイクル \d+ 対 \d+, \$[0-9a-f]+: \d+ 対 \d+|サイクル \d+：一方にそれ以上のコマンドがありません', translated_note):
                raise ValueError(f'Unknown nsf-export note: {note}')
            lines.append(f'| {title} | {translated_commands} | {translated_frame_writes} | {translated_loss} | {translated_mixer} | {translated_note} |')
            continue
        elif kind == 'gbs-export':
            match = re.fullmatch(
                r"Written by `gbs-export:sheet` on (.+), against Game_Music_Emu revision `(.+)`\. "
                r"Frame writes gates CI exactly \(matched must equal total, not just be nonzero or \"close\"\); "
                r"commands gates on value\+order \(address and value, in order - see the module comment for why "
                r"not cycle-exact, citing gbs-corpus/compare\.mjs's own finding about GME's SM83 timing model\)\. "
                r"Commands: the export, replayed by GME, against this project's own SM83 \(`importGbs`\) replaying "
                r"the same export - identical bytes on both sides\. "
                r"Frame writes: the source capture's own register writes against GME's trace of the export, "
                r"bucketed into VBlank frames and compared for exact address/value/order equality after one "
                r"constant frame offset \(an expected, fixed PLAY-call latency\); a source frame stops counting "
                r"once its own real-time slot passes the point where the exported player wraps back to its loop "
                r"frame, reported as \"excluding N frame\(s\) past the loop wrap\" when that applies\. "
                r"Export loss: relative RMS error, after peak-normalizing and offset-aligning \(searched, not "
                r"assumed\), between two same-DSP renders \(GME's trace of the export, replayed; the untouched "
                r"source\) - the coarse secondary gate, threshold (\d+)%\. "
                r"GME mixer: the same metric between GME's own PCM of the export and this project's render of the "
                r"source - two independent emulators, reported for visibility, not gated\.", line)
            if match:
                line = (f'`gbs-export:sheet`による生成：{match[1]}。参照：Game_Music_Emu revision `{match[2]}`。'
                         f'フレーム書き込みはCIを完全一致でゲートします（一致数が総数と等しくなければならず、'
                         f'非ゼロや「近い」では足りません）。コマンドは値・順序（アドレスと値、順序）の一致でゲートします'
                         f'（サイクル一致でゲートしない理由はモジュールのコメントを参照してください。'
                         f'gbs-corpus/compare.mjsが見出した、GMEのSM83タイミングモデルに関する知見を引いています）。'
                         f'コマンド：エクスポートをGMEで再生したものと、本プロジェクト自身のSM83（`importGbs`）が'
                         f'同じエクスポートを再生したものとを比較したもの - 両者は同一のバイト列です。'
                         f'フレーム書き込み：元キャプチャ自身のレジスター書き込みとGMEによるエクスポートのトレースを、'
                         f'それぞれVBlankフレーム単位でバケット化し、一定のフレームオフセット1つを挟んでアドレス・値・'
                         f'順序の完全一致を比較したもの（これは想定内の固定PLAY呼び出し遅延です）。元のフレームは、'
                         f'自身の実時間上の位置がエクスポートしたプレイヤーの折り返し地点（ループフレームへ戻る地点）'
                         f'を過ぎた時点で比較対象から外れ、該当する場合はシートに「ループ折り返し後のNフレームを除外」'
                         f'と表記されます。エクスポート損失：ピーク正規化と（決め打ちではなく探索した）オフセット'
                         f'位置合わせを行った後の、同一DSPによる2つのレンダー（GMEによるエクスポートの再生トレースを'
                         f'レンダーしたものと、手つかずの元ソースをレンダーしたもの）間の相対RMS誤差 - 粗い二次ゲートで、'
                         f'しきい値{match[3]}%。GMEミキサー：GME自身によるエクスポートのPCMと本プロジェクトによる'
                         f'元ソースのレンダーとの間で同じ指標を取ったもの - 独立した2つのエミュレーターの比較であり、'
                         f'可視化のために報告するだけでゲートにはなりません。')
                lines.append(line)
                continue
            if line == '| Song | Commands (value+order, cycle-exact) | Frame writes | Export loss | GME mixer | First divergence |':
                lines.append('| 曲 | コマンド（値・順序一致、サイクル一致） | フレーム書き込み | エクスポート損失 | GMEミキサー | 最初の相違 |')
                continue
            row = re.fullmatch(r'\| (.+) \| (.+) \| (.+) \| (.+) \| (.+) \| (.+) \|', line)
            if not row:
                raise ValueError(f'Unknown gbs-export line: {line}')
            title, commands, frame_writes, loss, mixer, note = row.groups()
            if not re.fullmatch(r'\d+/\d+ \(\d+/\d+ cycle-exact\)|not exportable: \w+|not rendered|\d+ bytes', commands):
                raise ValueError(f'Unknown gbs-export commands cell: {commands}')
            frame_writes_match = re.fullmatch(
                r'-|not compared|(\d+)/(\d+) \(offset ([+-]\d+)\)'
                r'(?:, excluding (\d+) frames? past the loop wrap)?'
                r'(?:, frames ((?:\d+, )*\d+(?:, \.\.\.)?) differ)?',
                frame_writes)
            if not frame_writes_match:
                raise ValueError(f'Unknown gbs-export frame-writes cell: {frame_writes}')
            if not re.fullmatch(r'-|not compared|\d+(?:\.\d+)?%(?: \(over threshold\))?', loss):
                raise ValueError(f'Unknown gbs-export loss cell: {loss}')
            mixer_match = re.fullmatch(r"-|not compared|GME's mixer differs from ours by (\d+(?:\.\d+)?)%", mixer)
            if not mixer_match:
                raise ValueError(f'Unknown gbs-export mixer cell: {mixer}')
            if frame_writes in ('-', 'not compared'):
                translated_frame_writes = {'-': '-', 'not compared': '未比較'}[frame_writes]
            else:
                matched, total, offset, excluded, mismatched = frame_writes_match.groups()[0:5]
                translated_frame_writes = f'{matched}/{total}（オフセット{offset}）'
                if excluded:
                    translated_frame_writes += f'、ループ折り返し後の{excluded}フレームを除外'
                if mismatched:
                    translated_frame_writes += f'、フレーム{mismatched}が不一致'
            translated_commands = re.sub(r'^(\d+)/(\d+) \((\d+)/(\d+) cycle-exact\)$', r'\1/\2（\3/\4サイクル一致）', commands)
            note_replacements = {
                'not exportable: frame_overflow': 'エクスポート不可: frame_overflow',
                'not exportable: rom_too_large': 'エクスポート不可: rom_too_large',
                'not exportable: invalid_loop_point': 'エクスポート不可: invalid_loop_point',
                'not exportable: metadata_too_long': 'エクスポート不可: metadata_too_long',
                'not exportable: metadata_not_ascii': 'エクスポート不可: metadata_not_ascii',
                'not rendered': '未レンダリング',
                'not compared': '未比較',
                ' (over threshold)': '（しきい値超過）',
                'none': 'なし', ' vs ': ' 対 ', 'cycle ': 'サイクル ',
                ': one side has no more commands': '：一方にそれ以上のコマンドがありません',
            }
            for before, after in note_replacements.items():
                translated_commands = translated_commands.replace(before, after)
            translated_loss = loss
            for before, after in note_replacements.items():
                translated_loss = translated_loss.replace(before, after)
            translated_note = note
            for before, after in note_replacements.items():
                translated_note = translated_note.replace(before, after)
            if mixer_match[1] is not None:
                translated_mixer = f'GMEのミキサーは本プロジェクトと{mixer_match[1]}%異なる'
            else:
                translated_mixer = note_replacements.get(mixer, mixer)
            if translated_note == note and note not in ('none',) and not re.fullmatch(r'サイクル \d+ 対 \d+, \$[0-9a-f]+: \d+ 対 \d+|サイクル \d+：一方にそれ以上のコマンドがありません', translated_note):
                raise ValueError(f'Unknown gbs-export note: {note}')
            lines.append(f'| {title} | {translated_commands} | {translated_frame_writes} | {translated_loss} | {translated_mixer} | {translated_note} |')
            continue
        elif kind == 'cpu6510':
            match = re.fullmatch(r"Run by `conform`'s `check:6510` on (.+): (\d+) of (\d+) pass\.", line)
            if match:
                line = f'`conform`の`check:6510`で{match[1]}に実行：{match[2]} / {match[3]}成功。'
            elif line == '| Test | Result | What it said |':
                line = '| テスト | 結果 | 実際の出力（原文） |'
            elif re.fullmatch(r'\| `[\w]+` \| (?:pass|fail) \| .* \|', line):
                # The third cell is the program's own stdout/verdict text, exact; never translate or rewrite it (`roms`' own precedent).
                line = line.replace('| pass |', '| 成功 |').replace('| fail |', '| 失敗 |')
            else:
                raise ValueError(f'Unknown cpu6510 line: {line}')
        elif kind == 'psid-corpus':
            match = re.fullmatch(r'Written by `psid-corpus:sheet` on (.+), against libsidplayfp revision `(.+)`\.', line)
            if match:
                line = f'`psid-corpus:sheet`による生成：{match[1]}。参照：libsidplayfp revision `{match[2]}`。'
            elif line == '| Fixture | Events | Matched | PLAY cycle deviation | First divergence | INIT registers |':
                line = '| フィクスチャ | イベント数 | 一致 | PLAYサイクル偏差 | 最初の相違 | INITレジスタ |'
            elif re.fullmatch(r'\| \[.+\]\(.+\) \| \d+ \| (?:\d+/\d+|not compared) \| (?:not compared|-|0 cycles|max \d+ cycles \(\d+/\d+ events off\)) \| .+ \| (?:-|(?:[A-Z]=(?:\d+(?:/\d+)?|undefined by spec))(?:, [A-Z]=(?:\d+(?:/\d+)?|undefined by spec))*) \|', line):
                # The title and URL are proper nouns; the INIT-registers cell
                # is plain `register=value` data (corpus.mjs's own
                # `formatRegisters`), never translated, except its own one
                # fixed phrase for a register `sources.json`'s own
                # `undefinedRegisters` names (never scored against the
                # oracle at all - see `compare.mjs`'s own `ignoreAddrs`).
                # The divergence column's and the PLAY-cycle-deviation
                # column's fixed vocabulary (corpus.mjs's `formatDivergence`
                # and `formatCycleDeviation`) are translated the same way.
                for before, after in {'not compared': '未比較', 'none': 'なし', 'init phase': 'INITフェーズ', 'play phase': 'PLAYフェーズ', ': one side has no more writes': '：それ以上の書き込みがありません', ' vs ': ' 対 ', 'cycle ': 'サイクル ', 'undefined by spec': '仕様上未定義', '0 cycles': '0サイクル', 'max ': '最大', ' cycles (': 'サイクル（', ' events off)': '件がずれ）'}.items():
                    line = line.replace(before, after)
            else:
                raise ValueError(f'Unknown psid-corpus line: {line}')
        lines.append(line)
    return '\n'.join(lines) + '\n'


def check(sync=False):
    files = source_files()
    templates = json.loads((ROOT / 'docs/translations/generated-ja.json').read_text())
    errors = []
    for source in files:
        target = japanese(source)
        if not target.exists():
            errors.append(f'{source.relative_to(ROOT)}: missing Japanese sibling')
            continue
        original, translated = source.read_text(), target.read_text()
        for match in BLOCK.finditer(original):
            kind = match[1]
            try:
                body = localized_block(kind, match[2], templates)
            except ValueError as error:
                errors.append(str(error))
                continue
            expected = f'<!-- {kind}:begin -->{body}<!-- {kind}:end -->'
            pattern = re.compile(rf'<!-- {kind}:begin -->.*?<!-- {kind}:end -->', re.S)
            existing = pattern.search(translated)
            placeholder = '{{' + kind + '}}'
            if sync:
                if existing:
                    translated = translated[:existing.start()] + expected + translated[existing.end():]
                elif placeholder in translated:
                    translated = translated.replace(placeholder, expected)
                else:
                    errors.append(f'{target.relative_to(ROOT)}: missing {kind} markers')
            elif not existing or existing[0] != expected:
                errors.append(f'{target.relative_to(ROOT)}: stale {kind}; run --sync-generated')
        if sync:
            target.write_text(translated)
        label = str(target.relative_to(ROOT))
        if '\ufffd' in translated or re.search(r'\{\{(?:code\d+|parity(?:-[\w-]+)?|roms|mixer|hwcombined)\}\}', translated):
            errors.append(f'{label}: replacement character or unexpanded template')
        if [h.count('#', 0, h.index(' ')) for h in headings(original)] != [h.count('#', 0, h.index(' ')) for h in headings(translated)]:
            errors.append(f'{label}: heading structure differs')
        table_shape = lambda text: [len(re.split(r'(?<!\\)\|', line)) for line in text.splitlines() if line.startswith('|')]
        if table_shape(original) != table_shape(translated):
            errors.append(f'{label}: table structure differs')
        for anchor in heading_ids(original):
            if f'<a id="{anchor}"></a>' not in translated:
                errors.append(f'{label}: missing source anchor {anchor}')
        for doc, text in [(source, original), (target, translated)]:
            if text.count('<p align="center">') != 1 or '日本語</a>' not in text:
                errors.append(f'{doc.relative_to(ROOT)}: missing or duplicate language switch')
            # Exclude fenced examples when checking Markdown destinations.
            plain = re.sub(r'(?m)^([ \t]*)```[^\n]*\n.*?^\1```', '', text, flags=re.S)
            links = re.findall(r'\]\(([^\s)]+)(?:\s+"[^"]*")?\)', plain)
            links += re.findall(r'href="([^"]+)"', plain)
            for link in links:
                url = urlsplit(html.unescape(link))
                if url.scheme or url.netloc or url.path.startswith('/'):
                    continue
                path = (doc.parent / unquote(url.path)).resolve() if url.path else doc
                if not path.exists():
                    errors.append(f'{doc.relative_to(ROOT)}: missing link {link}')
                elif url.fragment and path.suffix == '.md':
                    content = path.read_text()
                    ids = set(heading_ids(content)) | set(re.findall(r'<a id="([^"]+)">', content))
                    if unquote(url.fragment) not in ids:
                        errors.append(f'{doc.relative_to(ROOT)}: missing anchor {link}')
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1
    print(f'{len(files)} bilingual documents: coverage, navigation, headings and generated measurements verified.')
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sync-generated', action='store_true')
    sys.exit(check(parser.parse_args().sync_generated))
