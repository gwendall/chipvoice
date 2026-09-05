import assert from 'node:assert/strict';
import { Sequencer } from '../dist/sequencer.js';
import { nesChip, gbChip, mdChip, snesChip, c64Chip, OfflineDriver, instrumentsFor, arrange, renderSong } from '../dist/index.js';

const rate = 44100;
{
  let now = 0;
  const core = nesChip.create(rate);
  const driver = new OfflineDriver(core, nesChip, () => now);
  const note = { note: 'A4', instrument: { volume: [12], sustain: true }, duration: .1 };
  driver.playNote('p2', note);
  driver.playEffect('p2', { ...note, at: .05 });
  driver.flush();
  // Inspect retained commands specifically: audio alone cannot detect a leak.
  assert.ok(driver.music.size > 0 && driver.interruptions.size > 0);
  now = .5;
  driver.flush();
  assert.equal(driver.music.size, 0, 'idle voices release expired music without another note');
  assert.equal(driver.interruptions.size, 0, 'expired effect history is released');
  driver.reset(); driver.playNote('p2', note); driver.flush();
  const control = nesChip.create(rate), explicit = new OfflineDriver(control, nesChip);
  explicit.playNote('p2', { ...note, at: now }); explicit.flush();
  const actual = new Float32Array(rate), expected = new Float32Array(rate);
  core.render(actual, null, 0); control.render(expected, null, 0);
  assert.deepEqual(actual, expected, 'implicit offline note time follows the host clock');
  console.log('PASS offline clock schedules implicit notes and releases expired command history');
}
{
  const calls = [];
  const core = snesChip.create(rate);
  for (const method of ['reset', 'load']) {
    const original = core[method].bind(core);
    core[method] = (...args) => { calls.push(method); return original(...args); };
  }
  const driver = new OfflineDriver(core, snesChip);
  const initialLoads = calls.filter(c => c === 'load').length;
  assert.ok(initialLoads > 0);
  calls.length = 0; driver.reset();
  assert.equal(calls[0], 'reset');
  assert.equal(calls.filter(c => c === 'reset').length, 1);
  assert.equal(calls.filter(c => c === 'load').length, initialLoads, 'sample memory initializes once after reset');
  console.log('PASS offline reset initializes sample memory exactly once');
}
// Observe the digital register state after real rendering, not an arbiter flag.
{
  const core = nesChip.create(rate);
  const driver = new OfflineDriver(core, nesChip);
  driver.playNote('p2', { note: 'A4', instrument: { volume: [15,14,13,12,11,10], sustain: true }, duration: 1, at: 0 });
  driver.flush();
  core.render(new Float32Array(1764), null, 0);
  driver.stop('p2', .04); driver.flush();
  core.render(new Float32Array(2646), null, 1764);
  assert.equal(core.chip.pulse2.env.volume, 0, 'Stop cannot be overwritten by pending envelope frames');
  console.log('PASS Stop remains silent after future envelope writes');
}
{
  const core = nesChip.create(rate); const driver = new OfflineDriver(core, nesChip);
  driver.playNote('p2', { note: 'A4', instrument: { volume: [12], sustain: true }, duration: 1, at: 0 }); driver.flush();
  core.render(new Float32Array(1764), null, 0);
  driver.playEffect('p2', { note: 'C6', instrument: { volume: [3], sustain: true }, duration: .1, at: .04 });
  core.render(new Float32Array(2205), null, 1764);
  assert.equal(core.chip.pulse2.env.volume, 3, 'effect retains the physical voice while music has future writes');
  driver.playEffect('p2', { note: 'E6', instrument: { volume: [5], sustain: true }, duration: .1, at: .09 });
  core.render(new Float32Array(3528), null, 3969);
  assert.equal(core.chip.pulse2.env.volume, 5, 'new effect survives old effect release');
  core.render(new Float32Array(2205), null, 7497);
  assert.equal(core.chip.pulse2.env.volume, 12, 'held music restores its full register state');
  console.log('PASS overlapping SFX own the physical voice and restore held music');
}
{
  const core = nesChip.create(rate); const driver = new OfflineDriver(core, nesChip);
  driver.playEffect('p2', { at: .1, duration: .1, instrument: { volume: [3], sustain: true }, note: 'C6' });
  driver.playNote('p2', { at: .05, duration: .3, instrument: { volume: [12], sustain: true }, note: 'A4' });
  driver.flush(); core.render(new Float32Array(Math.round(rate * .105)), null, 0);
  assert.equal(core.chip.pulse2.env.volume, 3, 'music queued later cannot silence a delayed effect at takeover');
  console.log('PASS delayed effect survives subsequently scheduled music');
}
for (const definition of [gbChip, mdChip]) {
  const output = canceled => {
    const core = definition.create(rate); const driver = new OfflineDriver(core, definition);
    const voice = definition.spec.id === 'dmg' ? definition.spec.roles.bass : definition.spec.roles.lead;
    const instrument = instrumentsFor(definition.spec.id)[definition.spec.id === 'dmg' ? 'bass' : 'lead'];
    if (canceled) { driver.playNote(voice, { note: 'E4', instrument, duration: .1, at: .1 }); driver.flush(); }
    driver.stop(voice, .05); driver.flush();
    driver.playNote(voice, { note: 'E4', instrument, duration: .2, at: .2 }); driver.flush();
    const out = new Float32Array(rate / 2); core.render(out, null, 0); return out;
  };
  const a = output(true), b = output(false);
  assert.equal(a.findIndex((v, i) => v !== b[i]), -1, `${definition.spec.id} next note restores canceled patch/sample initialization`);
  console.log(`PASS ${definition.spec.id} note after cancellation matches clean note`);
}
{
  const core = nesChip.create(rate); const driver = new OfflineDriver(core, nesChip);
  const fx = (at, volume) => driver.playEffect('p2', { at, duration: .2, instrument: { volume: [volume], sustain: true }, note: 'C6' });
  fx(0, 3); fx(.1, 5);
  driver.playNote('p2', { at: .05, duration: .4, instrument: { volume: [12], sustain: true }, note: 'A4' }); driver.flush();
  const first = Math.round(rate * .075); core.render(new Float32Array(first), null, 0);
  assert.equal(core.chip.pulse2.env.volume, 3, 'delayed replacement retains earlier effect ownership');
  const second = Math.round(rate * .15); core.render(new Float32Array(second - first), null, first);
  assert.equal(core.chip.pulse2.env.volume, 5, 'delayed replacement takes over at its scheduled boundary');
  const third = Math.round(rate * .35); core.render(new Float32Array(third - second), null, second);
  assert.equal(core.chip.pulse2.env.volume, 12, 'music resumes after both effects');
  console.log('PASS delayed replacement preserves both effect intervals');
}
// Every official core implements the cancellable transport while retaining
// the original raw-register digital core for the oracle harness.
for (const definition of [nesChip, gbChip, mdChip, snesChip, c64Chip]) {
  const core = definition.create(rate); const driver = new OfflineDriver(core, definition);
  const instrument = instrumentsFor(definition.spec.id).lead;
  driver.playNote(definition.spec.roles.lead, { note: 'E5', instrument, duration: .4, at: .05 });
  driver.flush(); driver.stop(definition.spec.roles.lead, .04); driver.flush();
  const out = new Float32Array(rate / 2); core.render(out, null, 0);
  assert.ok(out.every(Number.isFinite), `${definition.spec.id} cancellation output is finite`);
  // Compare against the same initialized chip with only the stop command.
  const control = definition.create(rate); const silent = new OfflineDriver(control, definition);
  silent.stop(definition.spec.roles.lead, .04); silent.flush();
  const expected = new Float32Array(rate / 2); control.render(expected, null, 0);
  assert.deepEqual(out, expected, `${definition.spec.id} no canceled music reaches the chip`);
  console.log(`PASS ${definition.spec.id} canceled note equals an unplayed note sample for sample`);
}
// Audio must be independent of the host's block size. In particular, adding
// a block must not replay consumed YM2612/S-DSP writes from preceding blocks.
for (const definition of [nesChip, gbChip, mdChip, snesChip, c64Chip]) {
  const output = size => {
    const core = definition.create(rate); const driver = new OfflineDriver(core, definition);
    driver.playNote(definition.spec.roles.lead, { note: 'E5', instrument: instrumentsFor(definition.spec.id).lead, duration: .3, at: .05 });
    driver.flush();
    const result = new Float32Array(22050);
    for (let start = 0; start < result.length; start += size) core.render(result.subarray(start, start + size), null, start);
    return result;
  };
  assert.deepEqual(output(128), output(4096), `${definition.spec.id} block size cannot change audio`);
  console.log(`PASS ${definition.spec.id} identical audio in 128 and 4096 sample blocks`);
}
console.log('PASS transport');

{
  const notes = [];
  const sink = { stop() {}, playNote(voice, options) { notes.push({ voice, ...options }); } };
  const seq = new Sequencer(sink, { canPlay: () => true }, () => 0, { live: false });
  const song = arrange({ bpm: 120, order: [0], patterns: [{ bass: 'C2 . . . D2 . . .', lead: '. . . . . . . .', chord: 'C3 . = . D3 . . .', perc: '. . . . . . . .', chordShape: [[0,4,7], [0,3,7]] }] });
  seq.play(song, { step: 3, orderIndex: 0 }); seq.pump(.3);
  assert.deepEqual(notes.find(n => n.voice === 'p2' && n.note === 'D3').instrument.arp, [0,3,7]);
  console.log('PASS seeking after a chord cut preserves the following chord shape');
}
