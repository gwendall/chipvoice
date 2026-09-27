// The MAME sn76496 oracle: a register log in, a change stream out.
//
// Reads a chipvoice register log on stdin - `# cycles: N` in the header,
// then one write per line as `<cycle> <addr hex> <value hex>` in cycle
// order, the cycle counted on the Mega Drive's master clock - drives MAME's
// `segapsg_device` (the Sega VDP PSG; see README.md for the exact
// constructor parameters and their file:line citations) with the writes to
// $C00011, and prints every change of the four PSG voices as
// `<cycle> <voice> <value>`, using the harness's own voice numbers: 6
// (psg1), 7 (psg2), 8 (psg3), 9 (noise). Writes to the YM2612 are not this
// chip's and are skipped. The corpus never writes the port's mirrors
// ($C00013/15/17), so only the exact address is matched.
//
// Voice value mapping: `output[c] ? (15 - register[2c+1]) : 0`, reading
// MAME's raw attenuation register directly, not `m_volume[]` (a dB-table
// audio amplitude meant for the mixer). This is the same quantity our own
// digital trace reports: `packages/chipvoice/src/chips/md/sn76489.ts`'s
// `outputs()` computes `output[i] ? 15 - attenuation[i] : 0`.
//
// Timebase: the PSG's own input clock is the master clock divided by 15
// (MAME's `DERIVED_CLOCK(1, 15)` off the VDP, see README.md), so
// `PSG_CLOCK_HZ = 53693175 / 15 = 3579545` exactly. `segapsg_device` runs
// its stream at `clock() / 2` and further divides by 8 internally (its
// fixed `clockdivider`), so one real internal step - one decrement of every
// channel's period counter - happens once every 16 raw PSG clock cycles,
// matching this core's own `/16` divider in `sn76489.ts`. To reproduce that
// unchanged, `sound_stream_update()` is called once per 2 raw PSG clock
// cycles (30 master cycles): calling it more or less often would change the
// pitch MAME's own, unmodified code produces.
//
// Every standard header main.cpp needs is included above emu.h, because
// emu.h maps `private`/`protected` to `public` for the rest of the
// translation unit so this file can read `m_register[]` and `m_output[]`
// straight off the device (see emu.h's own comment).

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "emu.h"
#include "sn76496.h"

namespace {

constexpr unsigned kPsgPort = 0xc00011;
constexpr long kMasterHz = 53693175;
constexpr long kPsgClockHz = kMasterHz / 15;  // 3579545, exact
constexpr long kWindow = 30;                  // master cycles per sound_stream_update() call: 2 raw PSG clock cycles

struct Write {
  long cycle;
  unsigned value;
};

struct Change {
  long cycle;
  int voice;
  int value;
};

bool before(const Change &a, const Change &b) {
  if (a.cycle != b.cycle) return a.cycle < b.cycle;
  return a.voice < b.voice;
}

}  // namespace

int main() {
  std::vector<Write> writes;
  long cycles = -1;
  char line[1024];
  long last = 0;
  while (std::fgets(line, sizeof line, stdin)) {
    if (line[0] == '#') {
      if (std::strncmp(line, "# cycles:", 9) == 0) cycles = std::strtol(line + 9, nullptr, 10);
      continue;
    }
    long cycle;
    unsigned addr, value;
    if (std::sscanf(line, "%ld %x %x", &cycle, &addr, &value) != 3) continue;
    if (cycle < last) {
      std::fprintf(stderr, "writes out of order at cycle %ld\n", cycle);
      return 1;
    }
    last = cycle;
    if (cycles >= 0 && cycle >= cycles) continue;
    if (addr != kPsgPort) continue;
    writes.push_back({cycle, value & 0xffu});
  }
  if (cycles < 0) {
    std::fprintf(stderr, "no `# cycles:` header before the first write\n");
    return 1;
  }

  machine_config mconfig;
  segapsg_device psg(mconfig, "segapsg", nullptr, static_cast<std::uint32_t>(kPsgClockHz));
  psg.device_start();
  sound_stream stream;

  // device_start() resets every attenuation register to 0xf (silent) and
  // every output flag to 0 (m_output[3] takes m_RNG & 1, and m_RNG resets
  // to the feedback mask 0x8000, so it too is 0), so all four voices start
  // at value 0; last_value's initialiser matches that without needing a
  // synthetic change at cycle 0.
  //
  // Stamping: `sn76489.ts`'s own clock() only does its "once in sixteen"
  // work on the sixteenth call, its divider having started at 0 and counted
  // up; MAME's segapsg starts `m_current_clock` pre-loaded at
  // `clockdivider - 1` and counts down, so its first real step lands one
  // call earlier. One call here is one window, kWindow master cycles wide,
  // but one call there is one raw PSG clock, PSG_STEP (15) master cycles
  // wide, so the phase difference this pre-load costs is exactly one raw
  // PSG clock: `kWindow / 2` master cycles. Adding it back here lines this
  // oracle's window-start stamps up with `dsp.ts`'s own `psgAt`, for every
  // step this device ever takes, not only its first.
  constexpr long kPhase = kWindow / 2;
  std::vector<Change> changes;
  int last_value[4] = {0, 0, 0, 0};
  std::size_t next = 0;
  for (long cycle = 0; cycle < cycles; cycle += kWindow) {
    while (next < writes.size() && writes[next].cycle <= cycle) {
      psg.write(static_cast<u8>(writes[next].value));
      next++;
    }
    psg.sound_stream_update(stream);
    for (int c = 0; c < 4; c++) {
      int value = psg.m_output[c] ? (15 - psg.m_register[2 * c + 1]) : 0;
      if (value != last_value[c]) {
        last_value[c] = value;
        changes.push_back({cycle + kPhase, 6 + c, value});
      }
    }
  }
  std::stable_sort(changes.begin(), changes.end(), before);
  for (const auto &c : changes) std::printf("%ld %d %d\n", c.cycle, c.voice, c.value);
  return 0;
}
