import assert from 'node:assert/strict';
import {importSpc} from '../dist/index.js';

/**
 * Builds a minimal, valid .spc file: the fixed 0x10180-byte layout, a tiny
 * hand-assembled SPC700 program at the saved PC (select DSP register $6C,
 * write $20 to it, then loop in place), and an optional ID666 tag.
 */
function makeSpc({pc = 0x0200, a = 0, x = 0, y = 0, psw = 0x02, sp = 0xef, id666, ramPatches, dspPatches} = {}) {
  const bytes = new Uint8Array(0x10180);
  const sig = 'SNES-SPC700 Sound File Data v0.30';
  for (let i = 0; i < sig.length; i++) bytes[i] = sig.charCodeAt(i);
  bytes[33] = 0x1a;
  bytes[34] = 0x1a;
  bytes[0x23] = id666 ? 0x1a : 0x1b;
  bytes[0x24] = 0x1e;
  bytes[0x25] = pc & 0xff;
  bytes[0x26] = (pc >> 8) & 0xff;
  bytes[0x27] = a;
  bytes[0x28] = x;
  bytes[0x29] = y;
  bytes[0x2a] = psw;
  bytes[0x2b] = sp;
  const text = (at, s, len) => { for (let i = 0; i < len; i++) bytes[at + i] = i < s.length ? s.charCodeAt(i) : 0; };
  if (id666) {
    if (id666.title) text(0x2e, id666.title, 32);
    if (id666.gameTitle) text(0x4e, id666.gameTitle, 32);
    if (id666.artist) text(0xb1, id666.artist, 32);
    if (id666.secondsToPlay !== undefined) text(0xa9, String(id666.secondsToPlay).padStart(3, '0').slice(-3), 3);
    if (id666.fadeMillis !== undefined) text(0xac, String(id666.fadeMillis).padStart(5, '0').slice(-5), 5);
  }
  // A tiny program: MOV A,#$6C; MOV $F2,A; MOV A,#$20; MOV $F3,A; BRA -2 (self loop).
  const program = [0xe8, 0x6c, 0xc4, 0xf2, 0xe8, 0x20, 0xc4, 0xf3, 0x2f, 0xfe];
  for (let i = 0; i < program.length; i++) bytes[0x100 + pc + i] = program[i];
  for (const [addr, value] of Object.entries(ramPatches ?? {})) bytes[0x100 + Number(addr)] = value;
  for (const [reg, value] of Object.entries(dspPatches ?? {})) bytes[0x10100 + Number(reg)] = value;
  return bytes;
}

let failures = 0;
const check = (name, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};

// Malformed input is rejected explicitly, never silently truncated or padded.
{
  const good = makeSpc();
  assert.throws(() => importSpc(good.slice(0, 0x1017f)), /Truncated/, 'a file short of the minimum size is rejected');
  const badSig = good.slice(); badSig[0] = 0x00;
  assert.throws(() => importSpc(badSig), /signature/, 'a bad signature is rejected');
  assert.throws(() => importSpc(good), /duration/, 'no ID666 length and no options.seconds is rejected rather than guessed');
  console.log('PASS malformed .spc files are rejected explicitly');
}

// A minimal valid file: CPU/RAM/DSP registers restored exactly, and the
// program's two writes captured with the values it actually sent.
{
  const bytes = makeSpc({dspPatches: {0x0c: 0x7f, 0x1c: 0x7f}}); // MVOLL/MVOLR, just to have a non-zero snapshot
  const plan = importSpc(bytes, {seconds: 200 / 1024000});
  check('chip id is snes', plan.chip === 'snes');
  check('seconds echoes the requested duration', plan.seconds === 200 / 1024000);
  check('loopStartSeconds defaults to the start', plan.loopStartSeconds === 0);
  check('memory carries the full 64K RAM dump at address 0', plan.memory.length === 1 && plan.memory[0].address === 0 && plan.memory[0].bytes.length === 0x10000);
  check('program bytes are in the restored RAM', plan.memory[0].bytes[0x200] === 0xe8 && plan.memory[0].bytes[0x201] === 0x6c);
  // 128 registers restored (256 synthetic events), then the two real writes.
  check('every DSP register is restored as a synthetic write pair', plan.events.length >= 256 + 2);
  check('restoreEvents reports exactly the 256 synthetic pairs', plan.restoreEvents === 256);
  check('snapshotEvents adds the DSPADDR seed and the restore sentinel', plan.snapshotEvents === plan.restoreEvents + 2);
  const restore = plan.events.slice(0, plan.restoreEvents);
  check('the restore pairs are all stamped at cycle 0', restore.every((e) => e.at === 0));
  check('MVOLL is restored via the same $F2/$F3 protocol', restore[0x0c * 2].addr === 0xf2 && restore[0x0c * 2].value === 0x0c && restore[0x0c * 2 + 1].addr === 0xf3 && restore[0x0c * 2 + 1].value === 0x7f);
  const real = plan.events.slice(plan.restoreEvents);
  // Two synthetic events precede the program's own writes here, both stamped
  // at cycle 0 like the restore loop itself, both placed after
  // `restoreEvents` (not inside it) so a caller that only skips the first
  // `restoreEvents` entries still sees them: the snapshot's own DSPADDR
  // (this fixture never patches RAM $F2, so it reads back as 0) and the
  // reserved sentinel `DSP_SNAPSHOT_RESTORE_ADDR` ($F9, chips/snes/dsp.ts)
  // that tells a fresh chip to re-sync the DSP's hidden per-sample latches
  // from the register file it was just handed (see spc-import.ts's own doc
  // comment on both events).
  check('DSPADDR is seeded from the snapshot right after the restore loop', real[0].addr === 0xf2 && real[0].value === 0 && real[0].at === 0);
  check('the snapshot-restore sentinel event follows it', real[1].addr === 0xf9 && real[1].at === 0);
  const cpuWrites = real.slice(2);
  check('the program\'s own writes are captured in order', cpuWrites.length === 2 && cpuWrites[0].addr === 0xf2 && cpuWrites[0].value === 0x6c && cpuWrites[1].addr === 0xf3 && cpuWrites[1].value === 0x20);
  check('the real writes land after the restore, on ascending cycles', cpuWrites[0].at >= 0 && cpuWrites[1].at >= cpuWrites[0].at);
  check('no ID666 tag is reported when the file has none', plan.id666 === undefined);
  console.log('PASS a minimal valid .spc restores CPU, RAM and DSP registers and captures the program\'s own writes');
}

// ID666: title/game/artist text, and length from "seconds to play" (+ fade).
{
  const bytes = makeSpc({id666: {title: 'Test Song', gameTitle: 'Test Game', artist: 'Someone', secondsToPlay: 2, fadeMillis: 500}});
  const plan = importSpc(bytes);
  check('title is read from the tag', plan.id666?.title === 'Test Song');
  check('game title is read from the tag', plan.id666?.gameTitle === 'Test Game');
  check('artist is read from the tag', plan.id666?.artist === 'Someone');
  check('seconds-to-play is read from the tag', plan.id666?.secondsToPlay === 2);
  check('fade length is read from the tag, in seconds', plan.id666?.fadeSeconds === 0.5);
  check('duration defaults to seconds-to-play plus the fade', plan.seconds === 2.5);
  console.log('PASS ID666 title, game title, artist and length are read when present');
}

// An implausible or blank tag field is left out rather than misread; an
// explicit options.seconds always wins over the tag.
{
  const blank = makeSpc({id666: {secondsToPlay: 3}});
  const overridden = importSpc(blank, {seconds: 10 / 1024000});
  check('an explicit options.seconds overrides the tag', overridden.seconds === 10 / 1024000);
  check('a tag with no title text reports none', overridden.id666?.title === undefined);
  console.log('PASS options.seconds overrides the tag, and blank fields are left out');
}

console.log(failures === 0 ? 'PASS  spc-import: parses, restores state and rejects malformed files' : `FAIL  spc-import: ${failures} check(s) failed`);
if (failures > 0) process.exitCode = 1;
