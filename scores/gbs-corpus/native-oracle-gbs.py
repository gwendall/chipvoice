"""Build the pinned independent GBS oracle in local artifacts, then capture.
Usage: python3 scores/gbs-corpus/native-oracle-gbs.py source.gbs output-dir [seconds] [zero-based-track]
Requires git, cmake, a C++ compiler and zlib; never downloads a game asset.

The same pinned Game_Music_Emu revision `scores/arrangements/native-oracle.py`
already builds for the NSF/2A03 oracle, with the same one-line patch applied
to `Gb_Apu.cpp` instead of `Nes_Apu.cpp`: log every register write, cumulative
across `end_frame`, before the DAC ever sees it. `gme-render.cpp` is reused
unmodified; `gme_open_file` already dispatches a `.gbs` to `Gbs_Emu` on its
own, so nothing GBS-specific belongs in that driver.
"""
import sys, subprocess, json, hashlib
from pathlib import Path

revision = 'fe8da4b6d3876d7542c2fb69d94487e19836d678'
source = Path(sys.argv[1]).resolve(); out = Path(sys.argv[2]).resolve(); out.mkdir(parents=True, exist_ok=True)
seconds = int(sys.argv[3]) if len(sys.argv) > 3 else 92
track = int(sys.argv[4]) if len(sys.argv) > 4 else 0
if not 1 <= seconds <= 600 or not 0 <= track <= 255: raise ValueError('Invalid capture bounds')
repo = out / 'gme'


def run(args, **kw): subprocess.run([str(a) for a in args], check=True, **kw)


if not repo.exists():
    run(['git', 'clone', 'https://github.com/libgme/game-music-emu.git', repo])
    run(['git', '-C', repo, 'checkout', revision])
if subprocess.check_output(['git', '-C', repo, 'rev-parse', 'HEAD'], text=True).strip() != revision: raise ValueError('Oracle revision differs')
p = repo / 'gme/Gb_Apu.cpp'
text = subprocess.check_output(['git', '-C', repo, 'show', f'{revision}:gme/Gb_Apu.cpp'], text=True)
original = text
text = '#include <cstdio>\nstatic long long capture_origin = 0;\n' + text
text = text.replace('void Gb_Apu::end_frame( blip_time_t end_time )\n{', 'void Gb_Apu::end_frame( blip_time_t end_time )\n{\n capture_origin += end_time;')
text = text.replace('void Gb_Apu::write_register( blip_time_t time, unsigned addr, int data )\n{', 'void Gb_Apu::write_register( blip_time_t time, unsigned addr, int data )\n{\n std::printf("%lld %u %d\\n", capture_origin + time, addr, data);')
if p.read_text() not in (original, text): raise ValueError('Unexpected changes in oracle logging source')
changes = subprocess.check_output(['git', '-C', repo, 'diff', '--name-only'], text=True).splitlines()
if any(name != 'gme/Gb_Apu.cpp' for name in changes): raise ValueError('Unexpected changes in oracle sources')
p.write_text(text)
# Every other optional format stays off; GBS is the one this oracle needs.
run(['cmake', '-S', repo, '-B', repo / 'build', '-DGME_BUILD_SHARED=OFF', '-DGME_BUILD_EXAMPLES=OFF', *[f'-DUSE_GME_{kind}=OFF' for kind in ['AY', 'GYM', 'HES', 'KSS', 'NSF', 'SAP', 'SPC', 'VGM']]])
run(['cmake', '--build', repo / 'build', '-j', '1'])
run(['c++', '-O2', '-I', repo / 'gme', Path(__file__).parent.parent / 'arrangements/gme-render.cpp', repo / 'build/gme/libgme.a', '-lz', '-o', out / 'gme-render'])
with (out / 'gme-writes.txt').open('w') as trace: run([out / 'gme-render', source, out / 'gbs-gme.pcm', seconds, track], stdout=trace)
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = dict(sourceSha256=digest(source), oracleRevision=revision, track=track, seconds=seconds, sampleRate=44100, channels=2, encoding='s16le', pcmSha256=digest(out / 'gbs-gme.pcm'), traceSha256=digest(out / 'gme-writes.txt'), loggingSourceSha256=digest(p), rendererSourceSha256=digest(Path(__file__).parent.parent / 'arrangements/gme-render.cpp'))
(out / 'native-reference.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('Reference captured.')
