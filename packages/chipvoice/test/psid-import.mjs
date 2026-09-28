import {importPsid, renderPsid, PsidFormatError} from '../dist/index.js';

/**
 * `psid-import.ts`: header parsing, the named rejections for what this
 * environment does not model, PAL/NTSC and 6581/8580 flag selection, and an
 * end-to-end render through the real 6510 + minimal C64 environment.
 */
let failures = 0;
const check = (name, ok, extra = '') => { if (!ok) { failures++; console.log(`FAIL  ${name}  ${extra}`); } };
const throws = (name, fn, match) => {
  try { fn(); check(name, false, 'did not throw'); }
  catch (e) {
    const ok = e instanceof PsidFormatError && (!match || match.test(e.message));
    check(name, ok, `threw: ${e?.constructor?.name}: ${e?.message}`);
  }
};

const PAL_CLOCK_HZ = 985248;
const NTSC_CLOCK_HZ = 1022727;

/**
 * A minimal, well-formed PSID/RSID file: a v2-or-later header (124 bytes)
 * followed by `prg`, a byte image starting at `loadAddress`. `prg` is placed
 * verbatim - callers are responsible for not overlapping their own INIT/PLAY
 * spans within it.
 */
function buildPsid({
  format = 'PSID', version = 2, loadAddress, initAddress, playAddress = 0,
  songs = 1, startSong = 1, speed = 0, flags = 0,
  secondSidAddress = 0, thirdSidAddress = 0,
  name = 'Test Tune', author = 'Test Author', released = '2026 Test',
  prg, embedLoadAddress = false,
} = {}) {
  const headerSize = version === 1 ? 0x76 : 0x7c;
  const header = new Uint8Array(headerSize);
  const view = new DataView(header.buffer);
  header.set(Array.from(format).map((c) => c.charCodeAt(0)), 0);
  view.setUint16(0x04, version, false);
  view.setUint16(0x06, headerSize, false);
  view.setUint16(0x08, embedLoadAddress ? 0 : loadAddress, false);
  view.setUint16(0x0a, initAddress, false);
  view.setUint16(0x0c, playAddress, false);
  view.setUint16(0x0e, songs, false);
  view.setUint16(0x10, startSong, false);
  view.setUint32(0x12, speed, false);
  const putString = (at, s) => header.set(Uint8Array.from(Array.from(s.slice(0, 31)).map((c) => c.charCodeAt(0))), at);
  putString(0x16, name); putString(0x36, author); putString(0x56, released);
  if (headerSize >= 0x7c) {
    view.setUint16(0x76, flags, false);
    header[0x7a] = secondSidAddress;
    header[0x7b] = thirdSidAddress;
  }
  const body = embedLoadAddress
    ? Uint8Array.from([loadAddress & 0xff, loadAddress >> 8, ...prg])
    : prg;
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0); out.set(body, header.length);
  return out;
}

const NOP = 0xea;
/** RTS-only INIT: valid, minimal, does nothing to the SID. */
const INIT_RTS = Uint8Array.from([0x60]);

// --- Header rejections.
throws('too small to be a header', () => importPsid(new Uint8Array(0x10)), /Too small/);
{
  const bytes = buildPsid({loadAddress: 0x1000, initAddress: 0x1000, prg: INIT_RTS});
  bytes.set([0x58, 0x58, 0x58, 0x58], 0); // corrupt the magic
  throws('bad magic is rejected by name', () => importPsid(bytes), /Not a PSID\/RSID file/);
}
throws('RSID version 1 is rejected', () => importPsid(buildPsid({format: 'RSID', version: 1, loadAddress: 0x1000, initAddress: 0x1000, prg: INIT_RTS})), /RSID requires header version/);
throws('unsupported version 5 is rejected', () => importPsid(buildPsid({version: 5, loadAddress: 0x1000, initAddress: 0x1000, prg: INIT_RTS})), /Unsupported PSID\/RSID version/);
throws('song count out of range is rejected', () => importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, songs: 0xffff, prg: INIT_RTS})), /Invalid song count/);
throws("Sidplayer MUS tunes are rejected by name", () => importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, flags: 0x01, prg: INIT_RTS})), /Sidplayer MUS/);
throws('RSID + C64 BASIC flag is rejected by name', () => importPsid(buildPsid({format: 'RSID', loadAddress: 0x1000, initAddress: 0x1000, flags: 0x02, prg: INIT_RTS})), /BASIC interpreter/);
throws('multi-SID v3 file is rejected by name', () => importPsid(buildPsid({version: 3, loadAddress: 0x1000, initAddress: 0x1000, secondSidAddress: 0x42, prg: INIT_RTS})), /Multi-SID/);
throws('multi-SID v4 file (third SID) is rejected by name', () => importPsid(buildPsid({version: 4, loadAddress: 0x1000, initAddress: 0x1000, thirdSidAddress: 0x42, prg: INIT_RTS})), /Multi-SID/);
throws('malformed RSID: load address below $07E8', () => importPsid(buildPsid({format: 'RSID', loadAddress: 0x0100, initAddress: 0x0100, prg: INIT_RTS})), /below \$07E8/);
throws('seconds out of range is rejected', () => importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, prg: INIT_RTS}), {seconds: 601}), /seconds must be between/);

// --- An embedded (in-data) load address, when the header's own field is zero.
{
  const p = importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, embedLoadAddress: true, prg: INIT_RTS}), {seconds: 0.01});
  check('embedded load address is honoured when the header field is 0', p.format === 'PSID', JSON.stringify(p.format));
}

// --- Header fields surface on the returned PsidPerformance.
{
  const p = importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, songs: 3, startSong: 2, name: 'My Song', author: 'Me', released: '2026 Me', prg: INIT_RTS}), {seconds: 0.01});
  check('name/author/released decode', p.title === 'My Song' && p.author === 'Me' && p.released === '2026 Me', JSON.stringify(p));
  check('songs/startSong surface, default song is startSong', p.songs === 3 && p.startSong === 2 && p.song === 2);
}
{
  const p = importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, songs: 3, startSong: 2, prg: INIT_RTS}), {seconds: 0.01, song: 3});
  check('options.song overrides the header start song', p.song === 3);
}
{
  const p = importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, songs: 2, prg: INIT_RTS}), {seconds: 0.01, song: 99});
  check('options.song is clamped to the header song count', p.song === 2);
}

// --- PAL/NTSC and 6581/8580 flag selection (bits 2-3 clock, bits 4-5 model).
{
  const p = importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, flags: 0x00, prg: INIT_RTS}), {seconds: 0.01});
  check('flags 00: PAL/6581 (the documented default)', p.clockHz === PAL_CLOCK_HZ && p.model === '6581');
}
{
  const p = importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, flags: 0x08, prg: INIT_RTS}), {seconds: 0.01});
  check('flags bit3: NTSC', p.clockHz === NTSC_CLOCK_HZ);
}
{
  const p = importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, flags: 0x0c, prg: INIT_RTS}), {seconds: 0.01});
  check("flags bits2-3 = 11 ('both'): defaults to PAL", p.clockHz === PAL_CLOCK_HZ);
}
{
  const p = importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, flags: 0x20, prg: INIT_RTS}), {seconds: 0.01});
  check('flags bit5: 8580', p.model === '8580');
}
{
  const p = importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, flags: 0x30, prg: INIT_RTS}), {seconds: 0.01});
  check("flags bits4-5 = 11 ('both'): defaults to 6581", p.model === '6581');
}
{
  const p = importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, flags: 0x28, prg: INIT_RTS}), {seconds: 0.01});
  check('NTSC and 8580 combine independently', p.clockHz === NTSC_CLOCK_HZ && p.model === '8580');
}

// --- INIT actually runs: writes reach the SID as events.
{
  // LDA #$0F; STA $D418 (volume); LDA #$41; STA $D404 (voice1 ctrl); RTS
  const init = Uint8Array.from([0xa9, 0x0f, 0x8d, 0x18, 0xd4, 0xa9, 0x41, 0x8d, 0x04, 0xd4, 0x60]);
  const p = importPsid(buildPsid({loadAddress: 0x1000, initAddress: 0x1000, prg: init}), {seconds: 0.01});
  const addrs = p.events.map((e) => e.addr);
  check('INIT\'s own writes reach $D418 and $D404', addrs.includes(0xd418) && addrs.includes(0xd404), JSON.stringify(p.events));
  const vol = p.events.find((e) => e.addr === 0xd418);
  check('the volume write carries the value INIT stored', vol && vol.value === 0x0f);
}

// --- A PSID with a nonzero playAddress is called repeatedly by this
// environment's own trampoline, once per modeled IRQ.
{
  const loadAddress = 0x1000, initAddress = 0x1000, playAddress = 0x1020;
  const init = Uint8Array.from([0xa9, 0x0f, 0x8d, 0x18, 0xd4, 0x60]); // LDA #$0F; STA $D418; RTS
  const play = Uint8Array.from([0xee, 0x0e, 0xd4, 0x60]); // INC $D40E; RTS
  const prg = new Uint8Array(playAddress - loadAddress + play.length).fill(NOP);
  prg.set(init, 0);
  prg.set(play, playAddress - loadAddress);
  const p = importPsid(buildPsid({loadAddress, initAddress, playAddress, flags: 0x00, speed: 0, prg}), {seconds: 0.5});
  // INC is a read-modify-write: two bus writes per call (the unmodified
  // value, a real dummy write, then the incremented one) - halve the raw
  // event count back into PLAY calls.
  const plays = p.events.filter((e) => e.addr === 0xd40e).length / 2;
  // PAL VBI: ~50 Hz: half a second should give roughly 25 calls, generously bounded.
  check('a VBI-driven (speed=0) PSID calls PLAY repeatedly, near 50Hz PAL', plays > 15 && plays < 40, `plays=${plays}`);
}
{
  const loadAddress = 0x1000, initAddress = 0x1000, playAddress = 0x1020;
  const init = Uint8Array.from([0xa9, 0x0f, 0x8d, 0x18, 0xd4, 0x60]);
  const play = Uint8Array.from([0xee, 0x0e, 0xd4, 0x60]);
  const prg = new Uint8Array(playAddress - loadAddress + play.length).fill(NOP);
  prg.set(init, 0);
  prg.set(play, playAddress - loadAddress);
  const p = importPsid(buildPsid({loadAddress, initAddress, playAddress, flags: 0x00, speed: 1, prg}), {seconds: 0.5});
  // Same halving as the VBI-driven case above: INC writes twice per call.
  const plays = p.events.filter((e) => e.addr === 0xd40e).length / 2;
  // CIA-driven (speed=1): the file format's own 60Hz default CIA latch.
  check('a CIA-driven (speed=1) PSID calls PLAY repeatedly, near 60Hz', plays > 20 && plays < 45, `plays=${plays}`);
}

// --- End-to-end render: renderPsid produces audible, finite samples.
{
  const loadAddress = 0x1000, initAddress = 0x1000, playAddress = 0x1020;
  // INIT: gate a triangle on voice 1 at a nonzero frequency and full volume.
  const init = Uint8Array.from([
    0xa9, 0x11, 0x8d, 0x00, 0xd4, // LDA #$11; STA $D400 (freq lo)
    0xa9, 0x04, 0x8d, 0x01, 0xd4, // LDA #$04; STA $D401 (freq hi)
    0xa9, 0x11, 0x8d, 0x04, 0xd4, // LDA #$11; STA $D404 (triangle + gate)
    0xa9, 0x0f, 0x8d, 0x18, 0xd4, // LDA #$0F; STA $D418 (full volume)
    0x60,
  ]);
  const play = Uint8Array.from([0x60]); // RTS: hold the note, no per-frame change needed for this check.
  const prg = new Uint8Array(playAddress - loadAddress + play.length).fill(NOP);
  prg.set(init, 0);
  prg.set(play, playAddress - loadAddress);
  const {peak, sampleRate, left, performance} = renderPsid(buildPsid({loadAddress, initAddress, playAddress, prg}), {seconds: 0.05});
  check('renderPsid produces audible output', peak > 0 && peak <= 1, `peak=${peak}`);
  check('renderPsid runs at the requested sample rate and length', sampleRate === 44100 && left.length === Math.round(0.05 * 44100));
  check('every sample is finite', left.every((s) => Number.isFinite(s)));
  check('renderPsid returns the decoded performance alongside the audio', performance.chip === 'c64' && performance.format === 'PSID');
}

// --- CIA 1 timer A: exact period and start phase. DEN is turned off first
// so VIC-II badline DMA (the next test below) cannot land in this probe's
// own dispatch windows and confuse the numbers - this test is about the
// CIA counter alone.
{
  const loadAddress = 0x1000, initAddress = 0x1000, playAddress = 0x1020;
  // LDA #$00; STA $D011 (DEN off); LDA #$0F; STA $D418; RTS
  const init = Uint8Array.from([0xa9, 0x00, 0x8d, 0x11, 0xd0, 0xa9, 0x0f, 0x8d, 0x18, 0xd4, 0x60]);
  const play = Uint8Array.from([0xa9, 0x01, 0x8d, 0x00, 0xd4, 0x60]); // LDA #$01; STA $D400; RTS
  const prg = new Uint8Array(playAddress - loadAddress + play.length).fill(NOP);
  prg.set(init, 0);
  prg.set(play, playAddress - loadAddress);
  const p = importPsid(buildPsid({loadAddress, initAddress, playAddress, flags: 0x00, speed: 1, prg}), {seconds: 0.3});
  const at = p.events.filter((e) => e.addr === 0xd400).map((e) => e.at);
  // CIA_DEFAULT_PAL ($4025 = 16421) means the counter underflows once
  // 16421 + 1 = 16422 cycles have elapsed - a 6526 counts N, N-1, ..., 0,
  // then underflows on the next cycle after that ("period = latch + 1",
  // not latch, the same "start phase" quirk `writeCia1`'s own high-byte
  // reload comment documents). The first PLAY call's own write then lands
  // 16422 (the CIA period) + 7 (the IRQ dispatch sequence itself,
  // `Cpu6510.irq`'s own return value) + 23 (the environment's own
  // trampoline, up to its own JSR PLAY: PHA, LDA $DC0D, LDA #1, STA $D019,
  // TXA, PHA, TYA, PHA = 3+4+2+4+2+3+2+3) + 6 (the JSR itself) + 2 (PLAY's
  // own LDA #$01, before the STA $D400 this test watches) cycles later:
  // 16422+7+23+6+2 = 16460.
  check('CIA 1: the first PLAY dispatch lands at the exact expected start phase', at[0] === 16460, `at[0]=${at[0]}`);
  // From there the CIA reloads and keeps counting at the same real rate:
  // every dispatch is 16422 cycles after the last, on average, with only
  // the same few cycles of instruction-boundary jitter any interrupt-driven
  // idle loop has (the idle loop's own JMP-to-self costs 3 cycles a step,
  // not a divisor of every dispatch-to-RTI span, so where in that 3-cycle
  // stride a dispatch lands wobbles a little without ever drifting) - the
  // sum of any 3 consecutive gaps is exactly 3 * 16422, always.
  let driftFree = true;
  for (let i = 3; i < at.length; i++) if (at[i] - at[i - 3] !== 3 * 16422) driftFree = false;
  check('CIA 1: the period never drifts, averaged over any 3 dispatches', driftFree && at.length > 3, JSON.stringify(at));
  const maxJitter = Math.max(...at.slice(1).map((v, i) => Math.abs(v - at[i] - 16422)));
  check('CIA 1: no single dispatch gap strays far from the period', maxJitter <= 4, `maxJitter=${maxJitter}`);
}

// --- VIC-II badline DMA stealing: a real 43-cycle bus steal, once per
// qualifying raster line ($30-$F7, whose low 3 bits match $D011's own
// YSCROLL, with DEN set) - see `BADLINE_STEAL_CYCLES` in psid-import.ts.
// Isolated from CIA/IRQ timing entirely: INIT alone runs a fixed-cost delay
// long enough to cross exactly one qualifying line's own real trigger point,
// then writes once, with DEN left at the environment's own default
// ($D011=$1B, DEN on) in one run and turned off first in the other,
// otherwise byte-for-byte identical code.
//
// `setupVic()` starts `rasterCycle` at `PAL_INIT_RASTER_PHASE` (10750, not 0
// - see that constant's own comment in psid-import.ts), so the first
// qualifying line reachable from execution start is not line 51 any more:
// 10750 is line 170 (170*63=10710), 40 cycles into it, and the next line
// whose low 3 bits are 3 (this environment's own default YSCROLL) is line
// 171 (171 mod 8 = 3). That line's own `VICII_FETCH_CYCLE` offset - raster
// cycle 171*63+11 = 10784 - is only 10784-10750 = 34 cycles into execution;
// the one after that (line 179) is 538 cycles in, so 200 NOPs (400 cycles)
// before the write crosses line 171 alone, with a wide 138-cycle margin
// before line 179 would add a second steal.
{
  const loadAddress = 0x1000, initAddress = 0x1000;
  const nops = new Array(200).fill(NOP);
  const write = [0xa9, 0x2a, 0x8d, 0x00, 0xd4, 0x60]; // LDA #$2A; STA $D400; RTS
  const denOnPrg = Uint8Array.from([...nops, ...write]);
  const denOffPrg = Uint8Array.from([0xa9, 0x00, 0x8d, 0x11, 0xd0, ...nops, ...write]); // LDA #$00; STA $D011 first
  const on = importPsid(buildPsid({loadAddress, initAddress, prg: denOnPrg}), {seconds: 0.01});
  const off = importPsid(buildPsid({loadAddress, initAddress, prg: denOffPrg}), {seconds: 0.01});
  const onAt = on.events.find((e) => e.addr === 0xd400)?.at;
  const offAt = off.events.find((e) => e.addr === 0xd400)?.at;
  // DEN-off: the 5-byte disabling prefix (6 cycles) plus the same 400
  // cycles of NOPs plus LDA #$2A (2 cycles) before the write - no steal is
  // ever possible, so this is exactly 6 + 400 + 2 = 408.
  check('badline: DEN off never steals a cycle', offAt === 408, `offAt=${offAt}`);
  // DEN-on: no disabling prefix, so only 400 (NOPs) + 2 (LDA #$2A) = 402
  // cycles of real instruction work happen before the write - but line 171's
  // own fetch point (34 cycles in) falls within that span, so one
  // BADLINE_STEAL_CYCLES (43) steal happens along the way, landing the write
  // at 402 + 43 = 445.
  check('badline: DEN on loses exactly one steal (43 cycles) crossing line 171', onAt === 445, `onAt=${onAt}`);
}

if (failures) { console.log(`${failures} FAILURES`); process.exit(1); }
console.log('PASS PSID/RSID import: header parsing, named rejections, PAL/NTSC + 6581/8580 selection, end-to-end render, and CIA 1/VIC-II badline timing');
