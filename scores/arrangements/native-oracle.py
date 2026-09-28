"""Build the pinned independent NSF oracle in local artifacts, then capture.
Usage: python3 scores/arrangements/native-oracle.py source.nsf output-dir [seconds] [zero-based-track]
Requires git, cmake, a C++ compiler and zlib; never downloads a game asset.
"""
import sys,subprocess,json,hashlib
from pathlib import Path

revision='fe8da4b6d3876d7542c2fb69d94487e19836d678'
source=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=True)
seconds=int(sys.argv[3]) if len(sys.argv)>3 else 92
track=int(sys.argv[4]) if len(sys.argv)>4 else 0
if not 1<=seconds<=600 or not 0<=track<=255:raise ValueError('Invalid capture bounds')
repo=out/'gme'
def run(args,**kw):subprocess.run([str(a)for a in args],check=True,**kw)
if not repo.exists():
    run(['git','clone','https://github.com/libgme/game-music-emu.git',repo])
    run(['git','-C',repo,'checkout',revision])
if subprocess.check_output(['git','-C',repo,'rev-parse','HEAD'],text=True).strip()!=revision:raise ValueError('Oracle revision differs')
p=repo/'gme/Nes_Apu.cpp'
text=subprocess.check_output(['git','-C',repo,'show',f'{revision}:gme/Nes_Apu.cpp'],text=True)
original=text
text='#include <cstdio>\nstatic long long capture_origin = 0;\n'+text
text=text.replace('void Nes_Apu::end_frame( nes_time_t end_time )\n{','void Nes_Apu::end_frame( nes_time_t end_time )\n{\n capture_origin += end_time;')
text=text.replace('void Nes_Apu::write_register( nes_time_t time, nes_addr_t addr, int data )\n{','void Nes_Apu::write_register( nes_time_t time, nes_addr_t addr, int data )\n{\n std::printf("%lld %d %d\\n", capture_origin + time, addr, data);')
if p.read_text() not in (original,text):raise ValueError('Unexpected changes in oracle logging source')
# NEXT-14: Nsf_Emu dispatches VRC6 writes to a second, separate class
# (Nes_Vrc6_Apu::write_osc/end_frame, wired up in Nsf_Emu.cpp's own
# HANDLE_CHIP_VRC6 macro), so it needs its own independent patch and its own
# free-running cycle accumulator; capture_origin above is static to
# Nes_Apu.cpp and invisible here. Nes_Vrc6_Apu::end_frame is driven with the
# exact same `duration` value, every frame, as Nes_Apu::end_frame (both
# called back-to-back from the player's frame loop), so the two
# accumulators stay numerically equal and a write logged through either
# patch lands on the same absolute cycle. write_osc's (osc_index, reg) pair
# is turned back into the $9000/$A000/$B000-range address main.cpp's own
# oracle already decodes, so gme-writes.txt reads identically regardless of
# which of the two patches produced a given line.
p2=repo/'gme/Nes_Vrc6_Apu.cpp'
text2=subprocess.check_output(['git','-C',repo,'show',f'{revision}:gme/Nes_Vrc6_Apu.cpp'],text=True)
original2=text2
text2='#include <cstdio>\nstatic long long vrc6_capture_origin = 0;\n'+text2
text2=text2.replace('void Nes_Vrc6_Apu::end_frame( blip_time_t time )\n{','void Nes_Vrc6_Apu::end_frame( blip_time_t time )\n{\n vrc6_capture_origin += time;')
text2=text2.replace('void Nes_Vrc6_Apu::write_osc( blip_time_t time, int osc_index, int reg, int data )\n{','void Nes_Vrc6_Apu::write_osc( blip_time_t time, int osc_index, int reg, int data )\n{\n std::printf("%lld %d %d\\n", vrc6_capture_origin + time, base_addr + osc_index * addr_step + reg, data);')
if p2.read_text() not in (original2,text2):raise ValueError('Unexpected changes in oracle logging source')
# NEXT-15: Nsf_Emu dispatches Sunsoft 5B (FME-7) writes to a third, separate
# class (Nes_Fme7_Apu), but unlike write_osc above, its own write_latch
# ($C000, the register-select write) takes no time parameter at all - only
# write_data ($E000) does - so a chip-class-level patch could only ever time
# one of the two writes accurately. Nsf_Emu.cpp's own dispatcher
# (cpu_write_misc) calls time() at both call sites regardless, so this patch
# logs there instead of inside Nes_Fme7_Apu.cpp, with its own free-running
# accumulator (fme7_capture_origin) kept in step with capture_origin and
# vrc6_capture_origin the same way: incremented by the exact `duration` every
# frame, at the same call site Nsf_Emu's own frame loop already drives
# apu.end_frame/vrc6->end_frame from. This logs both 5B ports as separate
# events, matching capture-nsf.mjs's own event shape for this chip, and is
# unaffected by Nes_Fme7_Apu's own incomplete noise/envelope audio synthesis
# (oracles/game-music-emu/README.md's "Known limits"): this patch captures
# the write stream at the dispatcher, before Nes_Fme7_Apu ever decides what
# to do with it.
p3=repo/'gme/Nsf_Emu.cpp'
text3=subprocess.check_output(['git','-C',repo,'show',f'{revision}:gme/Nsf_Emu.cpp'],text=True)
original3=text3
text3='#include <cstdio>\nstatic long long fme7_capture_origin = 0;\n'+text3
text3=text3.replace('\t\t\t\tfme7->write_latch( data );','\t\t\t\tstd::printf("%lld %d %d\\n", fme7_capture_origin + time(), (int) addr, data);\n\t\t\t\tfme7->write_latch( data );')
text3=text3.replace('\t\t\t\tfme7->write_data( time(), data );','\t\t\t\tstd::printf("%lld %d %d\\n", fme7_capture_origin + time(), (int) addr, data);\n\t\t\t\tfme7->write_data( time(), data );')
text3=text3.replace('\t\tif ( fme7  ) fme7 ->end_frame( duration );','\t\tif ( fme7  ) { fme7_capture_origin += duration; fme7 ->end_frame( duration ); }')
if p3.read_text() not in (original3,text3):raise ValueError('Unexpected changes in oracle logging source')
changes=subprocess.check_output(['git','-C',repo,'diff','--name-only'],text=True).splitlines()
if any(name not in('gme/Nes_Apu.cpp','gme/Nes_Vrc6_Apu.cpp','gme/Nsf_Emu.cpp')for name in changes):raise ValueError('Unexpected changes in oracle sources')
p.write_text(text)
p2.write_text(text2)
p3.write_text(text3)
run(['cmake','-S',repo,'-B',repo/'build','-DGME_BUILD_SHARED=OFF','-DGME_BUILD_EXAMPLES=OFF',*[f'-DUSE_GME_{kind}=OFF'for kind in ['AY','GBS','GYM','HES','KSS','SAP','SPC','VGM']]])
run(['cmake','--build',repo/'build','-j','1'])
run(['c++','-O2','-I',repo/'gme',Path(__file__).with_name('gme-render.cpp'),repo/'build/gme/libgme.a','-lz','-o',out/'gme-render'])
with (out/'gme-writes.txt').open('w')as trace:run([out/'gme-render',source,out/'mario-gme.pcm',seconds,track],stdout=trace)
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=dict(sourceSha256=digest(source),oracleRevision=revision,track=track,seconds=seconds,sampleRate=44100,channels=2,encoding='s16le',pcmSha256=digest(out/'mario-gme.pcm'),traceSha256=digest(out/'gme-writes.txt'),loggingSourceSha256=digest(p),vrc6LoggingSourceSha256=digest(p2),fme7LoggingSourceSha256=digest(p3),rendererSourceSha256=digest(Path(__file__).with_name('gme-render.cpp')))
(out/'native-reference.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Reference captured. Compare commands before publishing the audio.')
