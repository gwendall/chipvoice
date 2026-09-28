import type { DigitalChip, RegisterEvent } from "../../chip.js";
import { EventQueue } from "../../event-queue.js";
import { Ay8910, AY8910_VOICES } from "../ay8910.js";

/**
 * Sunsoft's 5B expansion audio: the FME-7 mapper's own AY-3-8910-compatible
 * PSG - a YM2149F, per nesdev's "Sunsoft 5B audio" page - wrapped in the two
 * CPU-mapped ports the mapper puts it behind.
 *
 * All tone/noise/envelope generation is `Ay8910` (`../ay8910.ts`),
 * unmodified: this class decodes only the two addresses nesdev documents -
 * $C000-$DFFF selects one of the sixteen internal registers, $E000-$FFFF
 * writes the selected register, each an 8KB mirrored range (`addr & 0xE000`,
 * the same decode Game_Music_Emu's `Nes_Fme7_Apu` and Mesen's
 * `Sunsoft5bAudio` both use) - and forwards. Nothing here is specific to
 * sound generation; it is the same two-port shim any AY-3-8910-family chip
 * wired this way would need.
 *
 * This is the standalone chip - CPU register writes in, three voice values
 * out, cycle by cycle - the same split `Vrc6Apu` (`vrc6.ts`) makes for the
 * VRC6: what a harness compares with an oracle, mixing with the 2A03 being a
 * separate, analog-stage concern in `sunsoft5b-core.ts`.
 *
 * Owns its own cycle-ordered event queue, unlike `Ay8910`'s: a $C000 select
 * and a following $E000 write only produce the right register write if they
 * are applied in the order they actually landed, which needs this class to
 * be the one draining the queue - forwarding into `Ay8910` with plain
 * `write()`/`clock()` calls, never through `Ay8910`'s own `schedule()`. That
 * queue stays independently useful: a harness or another host can still
 * address `Ay8910` directly by register index (0-15) rather than by CPU
 * port, exactly the way `packages/conform`'s `chipVrc6` drives `Vrc6Apu`
 * directly instead of only reachable via a cartridge's address decode.
 */
export class Sunsoft5bAudio implements DigitalChip {
  readonly voices = AY8910_VOICES;
  readonly ay = new Ay8910({ prescale: 16 });

  /**
   * The selected register, 0-15, from the last $C000 write's low nibble.
   * Nesdev's own bitfield for $C000-$DFFF:
   * ```
   * DDDD RRRR
   * |||| ++++- The 4-bit internal register to select for use with $E000
   * ++++------ Disable writes to $E000 if nonzero (like the original YM2149F)
   * ```
   * The high nibble (`D`) is not a don't-care: `writeEnabled` below tracks
   * it, since a nonzero `D` is documented to disable the data port until
   * the next $C000 write clears it again - this is the real YM2149F's own
   * BDIR/BC1/BC2-style device-select bus (multiple chips can share it,
   * addressed by these bits), not a 5B-specific quirk, per nesdev's own
   * "(like the original YM2149F)".
   */
  private selected = 0;
  private writeEnabled = true;

  /** The absolute cycle about to be clocked, same convention as `Vrc6Apu.cycle`. */
  cycle = 0;

  private readonly events = new EventQueue();

  /** A register write to one of the 5B's two sound ports, $C000-$DFFF or
   * $E000-$FFFF. Any other address is not decoded and does nothing - this
   * core only ever sees the addresses `packages/conform` and the NSF player
   * route to it. */
  write(addr: number, value: number) {
    const page = addr & 0xe000;
    const v = value & 0xff;
    if (page === 0xc000) {
      this.selected = v & 0x0f;
      this.writeEnabled = (v & 0xf0) === 0;
    } else if (page === 0xe000) {
      if (this.writeEnabled) this.ay.write(this.selected, v);
    }
  }

  applyEvent(ev: RegisterEvent) {
    this.write(ev.addr, ev.value);
  }

  step() {
    while (this.events.nextAt <= this.cycle) {
      const ev = this.events.take();
      this.applyEvent(ev);
    }
    this.ay.clock();
    this.cycle++;
  }

  outputs(into: number[]) {
    this.ay.outputs(into);
  }

  /** No memory-mapped voice on the 5B's audio side. */
  load(_address: number, _bytes: Uint8Array) {}

  schedule(events: RegisterEvent[]) {
    this.events.schedule(events);
  }
  cancel(owner: string, from: number) {
    this.events.cancel(owner, from);
  }

  trace(cycles: number, onChange: (cycle: number, voice: number, value: number) => void) {
    const last = [0, 0, 0];
    const now = [0, 0, 0];
    for (let i = 0; i < cycles; i++) {
      const cycle = this.cycle;
      this.step();
      this.outputs(now);
      for (let v = 0; v < 3; v++) {
        if (now[v] !== last[v]) {
          last[v] = now[v];
          onChange(cycle, v, now[v]);
        }
      }
    }
  }

  reset() {
    this.events.clear();
    this.selected = 0;
    this.writeEnabled = true;
    this.ay.reset();
    this.cycle = 0;
  }
}
