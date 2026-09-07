"""Pinned independent VGM decoder + renderer; logging-only changes stay local.
Usage: python3 scores/arrangements/vgm-oracle.py source.vgm output-dir [seconds]
"""
import sys, subprocess, hashlib, json
from pathlib import Path
revision='fe8da4b6d3876d7542c2fb69d94487e19836d678'
source=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=True)
seconds=int(sys.argv[3]) if len(sys.argv)>3 else 54
if not 1<=seconds<=600:raise ValueError('Invalid capture duration')
def run(args,**kw):subprocess.run([str(a) for a in args],check=True,**kw)
repo=out/'gme'
if not repo.exists():
 run(['git','clone','https://github.com/libgme/game-music-emu.git',repo]);run(['git','-C',repo,'checkout',revision])
if subprocess.check_output(['git','-C',repo,'rev-parse','HEAD'],text=True).strip()!=revision:raise ValueError('Oracle revision differs')
p=repo/'gme/Vgm_Emu_Impl.cpp'
original=subprocess.check_output(['git','-C',repo,'show',f'{revision}:gme/Vgm_Emu_Impl.cpp'],text=True)
text='#include <cstdio>\nstatic long long capture_samples = 0;\n'+original
changes={
 'blip_time_t blip_time = to_blip_time( vgm_time );':'std::printf("%lld 82 42 %d\\n", capture_samples + vgm_time, amp);\n\tblip_time_t blip_time = to_blip_time( vgm_time );',
 'case cmd_psg:\n\t\t\tpsg[0]':'case cmd_psg:\n\t\t\tstd::printf("%lld 80 0 %d\\n", capture_samples + vgm_time, *pos);\n\t\t\tpsg[0]',
 'case cmd_ym2612_port0:\n\t\t\tif ( pos [0] == ym2612_dac_port )':'case cmd_ym2612_port0:\n\t\t\tif (pos[0] != ym2612_dac_port) std::printf("%lld 82 %d %d\\n", capture_samples + vgm_time, pos[0], pos[1]);\n\t\t\tif ( pos [0] == ym2612_dac_port )',
 'case cmd_ym2612_port1:\n\t\t\tif ( ym2612[0].run_until':'case cmd_ym2612_port1:\n\t\t\tstd::printf("%lld 83 %d %d\\n", capture_samples + vgm_time, pos[0], pos[1]);\n\t\t\tif ( ym2612[0].run_until',
 '\tvgm_time -= end_time;':'\tcapture_samples += end_time;\n\tvgm_time -= end_time;'}
for old,new in changes.items():
 if text.count(old)!=1:raise ValueError('Logging seam changed: '+old)
 text=text.replace(old,new)
if p.read_text() not in (original,text):raise ValueError('Unexpected oracle modifications')
if any(n!='gme/Vgm_Emu_Impl.cpp' for n in subprocess.check_output(['git','-C',repo,'diff','--name-only'],text=True).splitlines()):raise ValueError('Unexpected oracle modifications')
p.write_text(text)
run(['cmake','-S',repo,'-B',repo/'build','-DGME_BUILD_SHARED=OFF','-DGME_BUILD_EXAMPLES=OFF','-DGME_YM2612_EMU=Nuked',*[f'-DUSE_GME_{k}=OFF' for k in ['AY','GBS','GYM','HES','KSS','SAP','SPC','NSF','NSFE']]])
run(['cmake','--build',repo/'build','-j','1'])
renderer=Path(__file__).with_name('gme-render.cpp')
run(['c++','-O2','-I',repo/'gme',renderer,repo/'build/gme/libgme.a','-lz','-o',out/'gme-render'])
with (out/'gme-writes.txt').open('w') as log:run([out/'gme-render',source,out/'reference.pcm',seconds,0],stdout=log)
hash=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(out/'native-reference.json').write_text(json.dumps(dict(sourceSha256=hash(source),oracleRevision=revision,track=0,seconds=seconds,sampleRate=44100,channels=2,encoding='s16le',pcmSha256=hash(out/'reference.pcm'),traceSha256=hash(out/'gme-writes.txt'),loggingSourceSha256=hash(p),rendererSourceSha256=hash(renderer)),indent=2)+'\n')
