// Harness only: independent Nuked-OPN2 driven from GME's decoded VGM trace.
// Emits six channel outputs and both DAC pins after EVERY internal chip clock,
// little-endian int16, for a streaming SHA-256 comparison (no lossy PCM metric).
#include "ym3438.h"
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <vector>
#include <cstdint>
struct Write { long long at; unsigned port, value; };
int main(int argc,char** argv) {
 if(argc!=3)return 2;
 const long long samples=std::atoll(argv[2]);
 FILE* source=std::fopen(argv[1],"r");if(!source)return 2;
 std::vector<Write> writes;long long free=42*15,at;unsigned op,reg,value;
 while(std::fscanf(source,"%lld %u %u %u",&at,&op,&reg,&value)==4){
  if(at>=samples)break;
  if(op==0x52||op==0x53){const long long earliest=std::ceil(at*53693175.0/44100/42)*42;const long long cycle=earliest>free?earliest:free;free=cycle+42*30;const unsigned port=(op-0x52)*2;writes.push_back({cycle,port,reg});writes.push_back({cycle+42*15,port+1,value});}
 }
 std::fclose(source);OPN2_SetChipType(ym3438_mode_ym2612);ym3438_t chip;OPN2_Reset(&chip);
 const long long end=std::llround(samples*53693175.0/44100);size_t next=0,used=0;unsigned char bytes[65536];Bit16s pins[2];
 for(long long cycle=0;cycle+42<=end;cycle+=42){
  if(next<writes.size()&&writes[next].at<=cycle){auto w=writes[next++];OPN2_Write(&chip,w.port,w.value);}
  OPN2_Clock(&chip,pins);
  for(int i=0;i<8;i++){const uint16_t v=i<6?chip.ch_out[i]:pins[i-6];bytes[used++]=v&255;bytes[used++]=v>>8;}
  if(used==sizeof(bytes)){if(std::fwrite(bytes,1,used,stdout)!=used)return 1;used=0;}
 }
 if(used&&std::fwrite(bytes,1,used,stdout)!=used)return 1;
}
