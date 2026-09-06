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
BLOCK = re.compile(r'<!-- (status|parity|roms|mixer):begin -->(.*?)<!-- \1:end -->', re.S)


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
        if kind == 'parity':
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
        elif kind == 'mixer':
            match = re.fullmatch(r"Written by `conform` on (.+)\. The middle's level relative to the tone's; lower is a better cancellation\.", line)
            if match:
                line = f'`conform`が{match[1]}に生成。基準音に対する中央区間のレベル。低いほど相殺が良好です。'
            elif line == "| Test | This core | Blargg's NES, his recording |":
                line = '| テスト | 本コア | blarggのNES録音 |'
            elif not re.fullmatch(r'\| `apu_mixer/[\w-]+` \| -?\d+(?:\.\d+)? dB \| -?\d+(?:\.\d+)? dB \|', line):
                raise ValueError(f'Unknown mixer line: {line}')
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
        if '\ufffd' in translated or re.search(r'\{\{(?:code\d+|parity|roms|mixer)\}\}', translated):
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
