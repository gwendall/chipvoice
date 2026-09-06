#include "gme.h"
#include <cstdio>
#include <cstdlib>

// Independent CPU + APU execution. A small source patch logs APU writes;
// the PCM is otherwise the library's own resampler and output stage.
int main(int argc, char** argv) {
  if (argc != 5) return 2;
  Music_Emu* emu = nullptr;
  auto error = gme_open_file(argv[1], &emu, 44100);
  if (error) { std::fprintf(stderr, "%s\n", error); return 1; }
  gme_ignore_silence(emu, 1);
  if ((error = gme_start_track(emu, std::atoi(argv[4])))) { std::fprintf(stderr, "%s\n", error); return 1; }
  FILE* output = std::fopen(argv[2], "wb");
  if (!output) return 1;
  short samples[8192];
  int remaining = std::atoi(argv[3]) * 44100 * 2;
  while (remaining > 0) {
    int count = remaining < 8192 ? remaining : 8192;
    if ((error = gme_play(emu, count, samples))) { std::fprintf(stderr, "%s\n", error); return 1; }
    // Explicit little-endian PCM, independent of the build host's byte order.
    for (int i=0; i<count; i++) { std::fputc(samples[i] & 255, output); std::fputc((samples[i] >> 8) & 255, output); }
    remaining -= count;
  }
  if (auto warning = gme_warning(emu)) { std::fprintf(stderr, "%s\n", warning); return 1; }
  std::fclose(output); gme_delete(emu);
}
