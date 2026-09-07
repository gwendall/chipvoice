#include "gme.h"
#include <cstdio>
#include <cstdlib>
// Independent GME mixer isolation through its public voice-mute interface.
// VGM voice names: FM1..6, PCM, PSG. No changes to synthesis or resampling.
int main(int argc,char** argv) {
  if(argc!=5)return 2;
  Music_Emu* emu=nullptr;
  const char* error=gme_open_file(argv[1],&emu,44100);
  if(error){std::fprintf(stderr,"%s\n",error);return 1;}
  gme_ignore_silence(emu,1);
  if((error=gme_start_track(emu,0))){std::fprintf(stderr,"%s\n",error);return 1;}
  if(gme_voice_count(emu)!=8)return 2;
  gme_mute_voices(emu,std::atoi(argv[4]));
  FILE* out=std::fopen(argv[2],"wb");if(!out)return 1;
  int remaining=std::atoi(argv[3])*44100*2;short samples[8192];
  while(remaining>0){const int count=remaining<8192?remaining:8192;
    if((error=gme_play(emu,count,samples))){std::fprintf(stderr,"%s\n",error);return 1;}
    for(int i=0;i<count;i++){std::fputc(samples[i]&255,out);std::fputc((samples[i]>>8)&255,out);}remaining-=count;
  }
  std::fclose(out);gme_delete(emu);
}
