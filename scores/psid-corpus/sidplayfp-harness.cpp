// Original code (not derived from libsidplayfp's own sources): a minimal
// write-logging "sidemu", installed into libsidplayfp's own CPU + CIA + VIC
// + tune-loading engine through its public SidConfig::sidEmulation hook. No
// SID audio is emulated; this only observes every write a PSID/RSID's INIT
// and PLAY code makes, with the exact clock cycle it landed on, the same
// {cycle, addr, value} shape `psid-import.ts`'s own PsidEnvironment records.
//
// libsidplayfp is GPL-2.0-or-later and is never vendored: `native-oracle.mjs`
// clones and builds it from a pinned revision into a gitignored .artifacts/
// directory at build time, the same way scores/arrangements/native-oracle.py
// does for Game_Music_Emu (decision 41).
//
// Usage: sidplayfp-harness <file.sid> <cycles> [song]
// Prints one line per SID write: "<cycle> <addr> <value>", decimal, in the
// order they happened - the same format native-oracle.py's gme-render
// prints, so scores/psid-corpus/compare.mjs reuses nsf-corpus's own trace
// parser.
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "EventScheduler.h"
#include "sidemu.h"
#include "sidplayfp/SidConfig.h"
#include "sidplayfp/SidTune.h"
#include "sidplayfp/sidbuilder.h"
#include "sidplayfp/sidplayfp.h"

using libsidplayfp::EventScheduler;
using libsidplayfp::sidemu;

namespace {

class TraceSid final : public sidemu {
public:
  explicit TraceSid(sidbuilder* builder) : sidemu(builder) { std::memset(shadow, 0, sizeof(shadow)); }

  void model(SidConfig::sid_model_t, bool) override {}
  void clock() override {} // No audio is produced; nothing to advance here.

protected:
  uint8_t read(uint_least8_t addr) override { return shadow[addr & 0x1f]; }

  void reset(uint8_t volume) override {
    std::memset(shadow, 0, sizeof(shadow));
    shadow[0x18] = volume;
  }

  void write(uint_least8_t addr, uint8_t data) override {
    shadow[addr & 0x1f] = data;
    const libsidplayfp::event_clock_t cycle = eventScheduler ? eventScheduler->getTime(libsidplayfp::EVENT_CLOCK_PHI1) : 0;
    std::printf("%lld %u %u\n", static_cast<long long>(cycle), static_cast<unsigned>(addr), static_cast<unsigned>(data));
  }

private:
  uint8_t shadow[0x20];
};

class TraceBuilder final : public sidbuilder {
public:
  TraceBuilder() : sidbuilder("trace") {}

protected:
  libsidplayfp::sidemu* create() override { return new TraceSid(this); }
  const char* getCredits() const override { return "trace builder (chipvoice conformance harness)\n"; }
};

} // namespace

int main(int argc, char** argv) {
  if (argc < 3) {
    std::fprintf(stderr, "usage: sidplayfp-harness <file.sid> <cycles> [song]\n");
    return 2;
  }
  const char* path = argv[1];
  const long long totalCycles = std::atoll(argv[2]);
  const unsigned song = argc > 3 ? static_cast<unsigned>(std::atoi(argv[3])) : 0;
  if (totalCycles <= 0) {
    std::fprintf(stderr, "cycles must be positive\n");
    return 2;
  }

  SidTune tune(path);
  if (!tune.getStatus()) {
    std::fprintf(stderr, "%s\n", tune.statusString());
    return 1;
  }
  // Always called, even for song 0 ("the file's own default song"):
  // SidTuneBase::selectSong resolves 0 to the header's own startSong and,
  // critically, is the ONLY place `currentSong()` is ever assigned - it
  // default-constructs to 0 otherwise. psiddrv.cpp's own INIT dispatch
  // computes A as `currentSong() - 1`, so skipping this call left A
  // underflowing to 255 (0 - 1) instead of the intended song number.
  tune.selectSong(song);

  TraceBuilder builder;
  sidplayfp player;
  SidConfig cfg = player.config();
  cfg.sidEmulation = &builder;
  cfg.powerOnDelay = 0; // Deterministic: SidConfig::MAX_POWER_ON_DELAY is the
                         // largest value that "produces constant results";
                         // anything past it, including the library's own
                         // default, is randomized per run.
  cfg.frequency = 44100;
  if (!player.config(cfg)) {
    std::fprintf(stderr, "%s\n", player.error());
    return 1;
  }
  if (!player.load(&tune)) {
    std::fprintf(stderr, "%s\n", player.error());
    return 1;
  }

  long long done = 0;
  const long long chunk = 10000;
  while (done < totalCycles) {
    const unsigned step = static_cast<unsigned>(std::min<long long>(chunk, totalCycles - done));
    const int result = player.play(step);
    if (result < 0) {
      std::fprintf(stderr, "%s\n", player.error());
      return 1;
    }
    done += step;
  }
  return 0;
}
