import assert from 'node:assert/strict';
import {importVgm, isolateNativePerformance, nesChip} from '../dist/index.js';

const NES_HZ = 1789773, GB_HZ = 4194304, HEADER = 0xc0;

// A header big enough to hold the 1.61 NES/Game Boy clock fields (0x84/0x80),
// unlike the Mega Drive fixture below, whose short header is the point.
const fixture = (chip, body, {rawClock, total, otherClock = 0} = {}) => {
  const b = new Uint8Array(HEADER + body.length);
  const v = new DataView(b.buffer);
  b.set([86, 103, 109, 32]);
  v.setUint32(4, b.length - 4, true);
  v.setUint32(8, 0x161, true);
  v.setUint32(0x34, HEADER - 0x34, true);
  v.setUint32(0x18, total, true);
  v.setUint32(chip === '2a03' ? 0x84 : 0x80, rawClock, true);
  if (otherClock) v.setUint32(0x0c, otherClock, true);
  b.set(body, HEADER);
  return b;
};

{
  const bytes = fixture('2a03', [0xb4, 0x00, 0x0f, 0x61, 0x0a, 0x00, 0x66], {rawClock: NES_HZ, total: 10});
  const p = importVgm(bytes);
  assert.equal(p.chip, '2a03');
  assert.equal(p.seconds, 10 / 44100);
  assert.deepEqual(p.events, [{at: 0, addr: 0x4000, value: 0x0f}]);
  console.log('PASS NES VGM basic register write and timing');
}

{
  // VGMPlay and most real NES rips write 1789772 (21.477272 MHz / 12,
  // truncated), not our own NES_HZ (1789773, rounded); both must import,
  // scheduled on our own clock either way, so this is not just the fixture's
  // own round-trip passing.
  const bytes = fixture('2a03', [0xb4, 0x00, 0x0f, 0x70, 0x66], {rawClock: 1789772, total: 1});
  const p = importVgm(bytes);
  assert.equal(p.chip, '2a03');
  assert.deepEqual(p.events, [{at: 0, addr: 0x4000, value: 0x0f}]);
  console.log('PASS NES VGM accepts the 1789772 Hz clock real rips write, not only our own 1789773');
}

{
  const cases = [
    [{rawClock: NES_HZ | 0x80000000, total: 1}, [0x66], /Disk System/],
    [{rawClock: NES_HZ | 0x40000000, total: 1}, [0x66], /second NES APU chip \(dual-chip/],
    [{rawClock: 1662607, total: 1}, [0x66], /NTSC NES APU clock/],
    [{rawClock: 1773448, total: 1}, [0x66], /NTSC NES APU clock/],
    [{rawClock: NES_HZ, total: 1}, [0xb4, 0x80, 0x0f, 0x66], /second NES APU chip register/],
    [{rawClock: NES_HZ, total: 1}, [0xb4, 0x20, 0x00, 0x66], /Disk System expansion audio registers/],
    [{rawClock: NES_HZ, total: 1}, [0x67, 0x66, 0x07, 2, 0, 0, 0, 0xaa, 0xbb, 0x66], /data block type/],
    [{rawClock: NES_HZ, total: 1}, [0x90], /DAC-stream/],
    [{rawClock: NES_HZ, total: 1, otherClock: 3579545}, [0x66], /another sound chip/],
    [{rawClock: NES_HZ, total: 1}, [0xb4, 0x00], /Truncated/],
  ];
  for (const [opts, body, message] of cases) assert.throws(() => importVgm(fixture('2a03', body, opts)), message);
  console.log('PASS NES VGM header/command rejections are named');
}

{
  const nesAndGb = fixture('2a03', [0x66], {rawClock: NES_HZ, total: 1});
  new DataView(nesAndGb.buffer).setUint32(0x80, GB_HZ, true);
  assert.throws(() => importVgm(nesAndGb), /NES APU and the Game Boy DMG/);
  console.log('PASS a header naming both the NES APU and the Game Boy DMG is rejected');
}

{
  // DPCM samples travel as data-block type 0xC2 ("NES APU RAM write"): a
  // 16-bit address plus raw bytes, straight into the DMC's own memory.
  const sample = new Uint8Array([0x55, 0xaa, 0x01, 0xfe]);
  const body = [
    0x67, 0x66, 0xc2, sample.length + 2, 0, 0, 0, 0x00, 0xc0, ...sample,
    0xb4, 0x12, 0x00, 0xb4, 0x13, 0x00, 0x70, 0x66,
  ];
  const bytes = fixture('2a03', body, {rawClock: NES_HZ, total: 1});
  const p = importVgm(bytes);
  assert.equal(p.memory.length, 1);
  assert.equal(p.memory[0].address, 0xc000);
  assert.deepEqual([...p.memory[0].bytes], [...sample]);
  const core = nesChip.digital();
  for (const block of p.memory) core.load(block.address, block.bytes);
  assert.deepEqual([...core.memory.subarray(0xc000, 0xc000 + sample.length)], [...sample]);
  console.log('PASS NES VGM extracts DPCM/RAM-write memory blocks and they reach the real core');
}

{
  const bytes = fixture('dmg', [0xb3, 0x00, 0x80, 0x61, 0x0a, 0x00, 0x66], {rawClock: GB_HZ, total: 10});
  const p = importVgm(bytes);
  assert.equal(p.chip, 'dmg');
  assert.equal(p.seconds, 10 / 44100);
  assert.deepEqual(p.events, [{at: 0, addr: 0xff10, value: 0x80}]);
  console.log('PASS Game Boy VGM basic register write and timing');
}

{
  const cases = [
    [{rawClock: GB_HZ | 0x80000000, total: 1}, [0x66], /Unsupported Game Boy DMG clock flag/],
    [{rawClock: GB_HZ | 0x40000000, total: 1}, [0x66], /second Game Boy DMG chip \(dual-chip/],
    [{rawClock: GB_HZ, total: 1}, [0xb3, 0x80, 0x00, 0x66], /second Game Boy DMG chip register/],
    [{rawClock: GB_HZ, total: 1}, [0xb3, 0x30, 0x00, 0x66], /Unsupported Game Boy DMG register/],
    [{rawClock: GB_HZ, total: 1}, [0x90], /DAC-stream/],
    [{rawClock: GB_HZ, total: 1, otherClock: 3579545}, [0x66], /another sound chip/],
  ];
  for (const [opts, body, message] of cases) assert.throws(() => importVgm(fixture('dmg', body, opts)), message);
  console.log('PASS Game Boy VGM header/command rejections are named');
}

{
  // NR51 ($FF25) gates each channel into left/right independently of its own
  // trigger/length/envelope, so masking it is a pure output mask: unlike the
  // NES's $4015, the unselected channel keeps running unheard.
  const plan = {chip: 'dmg', seconds: 0, loopStartSeconds: 0, notes: [], losses: [], memory: [], events: [
    {at: 0, addr: 0xff25, value: 0xff},
    {at: 1, addr: 0xff12, value: 0x77},
  ]};
  const solo = isolateNativePerformance(plan, ['ch1']);
  assert.equal(solo.events[0].value, 0x11);
  assert.equal(solo.events[1].value, 0x77);
  assert.equal(plan.events[0].value, 0xff, 'solo never mutates the native source');
  assert.throws(() => isolateNativePerformance(plan, ['typo']));
  console.log('PASS Game Boy native solo masks NR51 without side effects');
}

{
  // The Mega Drive path must stay byte-identical: a header short enough that
  // it never reaches offset 0x80/0x84 has to fall through exactly as before.
  const mdFixture = (body) => {
    const b = new Uint8Array(64 + body.length);
    const v = new DataView(b.buffer);
    b.set([86, 103, 109, 32]);
    v.setUint32(4, b.length - 4, true);
    v.setUint32(8, 0x150, true);
    v.setUint32(12, 3579545, true);
    v.setUint32(0x2c, 7670453, true);
    v.setUint16(0x28, 9, true);
    b[0x2a] = 16;
    v.setUint32(0x34, 12, true);
    v.setUint32(0x18, 1, true);
    b.set(body, 64);
    return b;
  };
  const p = importVgm(mdFixture([0x70, 0x66]));
  assert.equal(p.chip, 'md');
  console.log('PASS Mega Drive dispatch is unaffected by the new NES/Game Boy header checks');
}
