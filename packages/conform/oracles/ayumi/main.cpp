// The Ayumi oracle: a register log in, a change stream out.
//
// Reads a chipvoice register log on stdin - `# cycles: N` in the header,
// then one write per line as `<cycle> <reg hex> <value hex>` in cycle order,
// where `cycle` is the chip's own input clock (the Sunsoft 5B's CPU clock,
// per nesdev - "the chip is driven directly by the CPU clock") and `reg` is
// the AY-3-8910/YM2149's own 0-15 register index, not a CPU address
// (`Ay8910.write`'s own addressing, `chips/ay8910.ts`) - drives Ayumi
// (`ayumi.c`/`.h`, vendored unchanged) with it, and prints every change of
// every channel's raw 0-31 output index as `<cycle> <voice> <value>`, in
// cycle order. Voices are 0 to 2: channels A, B, C, the same order
// `Ay8910.trace` produces.
//
// Two clock layers, matched one for one against `Ay8910.clock()`/`tick()`:
//
// 1. Input clock to internal generator tick, 16:1 (`PRESCALE` below). Nesdev
//    states the tone/noise counters count up "every 16th clock cycle";
//    Ayumi's own `update_tone`/`update_noise`/`update_envelope` (ayumi.c)
//    compare their counters directly against the raw register period with
//    no such division built in - they assume whatever calls them already
//    ticks at the generator's own rate, not the input clock's. `PRESCALE`
//    reproduces the missing factor here, the same role `Ay8910.clock()`'s
//    own `prescaleCounter` plays: this driver's outer loop runs once per
//    input-clock cycle (matching the log's own cycle numbers and
//    `Ay8910.step()`'s), and only calls into Ayumi's generator tick on
//    every 16th one, at the same phase (`Ay8910.clock()`'s counter starts
//    at 0 and fires when it reaches `prescale`, so the first tick lands on
//    the log's cycle 15, not 0 or 16 - reproduced here identically) so a
//    change this driver reports at a given cycle lands on the exact same
//    cycle chipvoice's own `Ay8910.trace()` would report it at.
//
// 2. Generator tick to Ayumi's own `ayumi_process()` call, 8:1
//    (`DECIMATE_FACTOR`, from ayumi.h). `ayumi_process` is built to run at
//    an audio sample rate: it advances a fractional accumulator (`ay->step`)
//    by `DECIMATE_FACTOR` sub-steps per call and only actually clocks the
//    chip (`update_mixer`, which calls the tone/noise/envelope generators)
//    on the sub-steps where that accumulator crosses 1. Setting `ay->step`
//    to exactly `1.0 / DECIMATE_FACTOR` after `ayumi_configure` (instead of
//    the sample-rate formula `ayumi_configure` itself computes, which this
//    driver never uses - there is no audio output here, only a
//    register-and-index trace) makes the accumulator cross 1 on exactly the
//    8th of each call's 8 sub-steps, every time: one `ayumi_process()` call,
//    one generator tick, no more and no fewer.
//
// `update_mixer` and the tone/noise/envelope generators it calls
// (`update_tone`, `update_noise`, `update_envelope`) are `static` in
// ayumi.c, not part of its public API, and are never called directly from
// here - only the public setters (`ayumi_set_tone`, `ayumi_set_noise`,
// `ayumi_set_mixer`, `ayumi_set_volume`, `ayumi_set_envelope`,
// `ayumi_set_envelope_shape`) and `ayumi_process` itself are. What this
// driver reads back is the public struct fields those static functions
// write into as a side effect of `ayumi_process` - `ay.channels[i].tone`,
// `ay.noise`, `ay.envelope` - and recomputes the same gate-and-index formula
// `update_mixer` uses (`(tone | t_off) & (noise | n_off)`, then that gate
// times the envelope-or-volume index) itself, in this file, from those
// public fields plus the mixer/volume bits this driver already tracks from
// the log's own writes. `update_mixer` never exposes that per-channel index
// itself (only the DAC-transformed, already-summed `ay->left`/`ay->right`
// are public), so reading it straight through the DAC and back out is not
// an option - recomputing the same integer arithmetic from public state is
// the only way to compare chipvoice's own raw index against Ayumi's,
// bit-exactly, without patching Ayumi to expose anything it does not
// already (see the README's "never patch an oracle" rule).
//
// is_ym is passed 1 (YM2149 DAC table) to `ayumi_configure`: the digital
// index this driver reads back does not go through either DAC table at all
// (see above), so this choice only affects fields this driver never reads;
// it is set anyway so a future extension that does read `ay->left`/`right`
// defaults to the 5B's own chip, not the plain AY-3-8910. Nothing in
// `update_tone`/`update_noise`/`update_envelope`/`update_mixer` itself reads
// `is_ym` at all (only `ay->dac_table`'s initial assignment does) - matching
// `chips/ay8910.ts`'s own module doc comment on why the digital core this
// ticket writes has no AY/YM distinction of its own.

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "ayumi.h"

static const int PRESCALE = 16;

int main() {
  struct ayumi ay;
  ayumi_configure(&ay, 1, 1000000.0, 44100);
  ay.step = 1.0 / DECIMATE_FACTOR;

  // Mirrors chipvoice's own `Ay8910.regs`: the mixer (R7) and the three
  // volume/envelope-enable registers (R8-R10) are read back whenever either
  // changes, exactly like `Ay8910.write`'s own comment on why those four
  // registers are not decoded eagerly.
  unsigned char regs[16] = {0};
  unsigned char tone_lo[3] = {0, 0, 0};
  unsigned char tone_hi[3] = {0, 0, 0};

  auto apply_mixer_and_volume = [&]() {
    for (int i = 0; i < 3; i++) {
      int t_off = (regs[7] >> i) & 1;
      int n_off = (regs[7] >> (3 + i)) & 1;
      int e_on = (regs[8 + i] >> 4) & 1;
      ayumi_set_mixer(&ay, i, t_off, n_off, e_on);
      ayumi_set_volume(&ay, i, regs[8 + i] & 0x0f);
    }
  };
  apply_mixer_and_volume();

  auto write_reg = [&](int reg, int value) {
    if (reg < 0 || reg > 15) return;
    regs[reg] = (unsigned char)value;
    if (reg <= 5) {
      int ch = reg >> 1;
      if (reg & 1) tone_hi[ch] = (unsigned char)value;
      else tone_lo[ch] = (unsigned char)value;
      int period = ((tone_hi[ch] & 0x0f) << 8) | tone_lo[ch];
      ayumi_set_tone(&ay, ch, period);
    } else if (reg == 6) {
      ayumi_set_noise(&ay, value & 0x1f);
    } else if (reg == 7 || (reg >= 8 && reg <= 10)) {
      apply_mixer_and_volume();
    } else if (reg == 11 || reg == 12) {
      int period = (regs[12] << 8) | regs[11];
      ayumi_set_envelope(&ay, period);
    } else if (reg == 13) {
      ayumi_set_envelope_shape(&ay, value & 0x0f);
    }
    // 14/15 (I/O ports): stored in `regs` above, otherwise unused - same as
    // `Ay8910.write`.
  };

  long cycles = -1;
  char line[1024];
  long last = 0;

  // One entry per pending write, applied in file order before the cycle it
  // is stamped with is clocked - same convention as chipvoice's own
  // EventQueue (`Ay8910.step`'s own `events.nextAt <= this.cycle` check).
  struct PendingWrite { long at; int reg; int value; };
  std::vector<PendingWrite> writes_buf;

  while (fgets(line, sizeof line, stdin)) {
    if (line[0] == '#') {
      if (strncmp(line, "# cycles:", 9) == 0) cycles = strtol(line + 9, NULL, 10);
      continue;
    }
    long cycle;
    unsigned reg, value;
    if (sscanf(line, "%ld %x %x", &cycle, &reg, &value) != 3) continue;
    if (cycle < last) {
      fprintf(stderr, "writes out of order at cycle %ld\n", cycle);
      return 1;
    }
    last = cycle;
    writes_buf.push_back({cycle, (int)reg, (int)value});
  }
  if (cycles < 0) {
    fprintf(stderr, "no `# cycles:` header before the first write\n");
    return 1;
  }

  int last_value[3] = {0, 0, 0};
  size_t wi = 0;
  int prescale_counter = 0;
  for (long cycle = 0; cycle < cycles; cycle++) {
    while (wi < writes_buf.size() && writes_buf[wi].at <= cycle) {
      write_reg(writes_buf[wi].reg, writes_buf[wi].value);
      wi++;
    }
    prescale_counter++;
    if (prescale_counter >= PRESCALE) {
      prescale_counter = 0;
      ayumi_process(&ay);
    }
    int noise_bit = ay.noise & 1;
    for (int i = 0; i < 3; i++) {
      int t_off = (regs[7] >> i) & 1;
      int n_off = (regs[7] >> (3 + i)) & 1;
      int e_on = (regs[8 + i] >> 4) & 1;
      int gate = (ay.channels[i].tone | t_off) & (noise_bit | n_off);
      int index = e_on ? ay.envelope : (regs[8 + i] & 0x0f) * 2 + 1;
      int value = gate ? index : 0;
      if (value != last_value[i]) {
        last_value[i] = value;
        printf("%ld %d %d\n", cycle, i, value);
      }
    }
  }
  return 0;
}
