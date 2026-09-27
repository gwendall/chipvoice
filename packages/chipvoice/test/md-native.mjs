import {
  compileMdVoices, arrangeMdTracker, renderMdEvents, mdDrumStream, mdDrumSample, mdPatchWithRelease,
  MD_PATCHES, MD_PSG_INSTRUMENTS, MD_NOISE_INSTRUMENTS, MD_BANK, MD_CARRIERS, MD_DAC_CYCLES, MD_DAC_HZ, MD_MASTER_HZ, MD_BRIGHT_PROFILE,
} from '../dist/index.js';

/**
 * The native Mega Drive driver, its bank and its tracker: the writes a 1992
 * sound driver made, byte for byte. Power-on, a patch written once and then
 * only what changes, the busy flag's spacing, legato without a key-on, the
 * noise clocked by tone 3, the DAC streaming at its own pace, hard pan; and
 * the tracker's text laid out to those voices, loop points included.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const YM = 0xa04000;
const PSG = 0xc00011;

/** Register pairs on a YM port, [register, value, at], in time order. */
function pairs(events, port) {
  const out = [];
  let reg = -1;
  let at = 0;
  for (const e of events) {
    if (e.addr === YM + port * 2) { reg = e.value; at = e.at; }
    else if (e.addr === YM + port * 2 + 1) out.push([reg, e.value, at]);
  }
  return out;
}
const psgBytes = (events) => events.filter((e) => e.addr === PSG).map((e) => e.value);
const note = (at, until, pitch, o = {}) => ({ at, until, pitch, patch: MD_PATCHES.lead, ...o });

// ---- power-on and one FM note

{
  const { events, lateCycles } = compileMdVoices([{ voice: 'fm1', notes: [note(0.1, 0.3, 69)] }]);
  const p0 = pairs(events, 0);
  check('power-on: LFO off, channel 3 normal, DAC off, six key-offs', JSON.stringify(p0.slice(0, 9).map(([r, v]) => [r, v])) === JSON.stringify([[0x22, 0], [0x27, 0], [0x2b, 0], [0x28, 0], [0x28, 1], [0x28, 2], [0x28, 4], [0x28, 5], [0x28, 6]]));
  check('power-on: the four PSG channels silenced', JSON.stringify(psgBytes(events).slice(0, 4)) === JSON.stringify([0x9f, 0xbf, 0xdf, 0xff]));
  const inOrder = events.every((e, i) => i === 0 || events[i - 1].at <= e.at);
  check('events come out in time order', inOrder);
  const gaps = p0.slice(0, 9).map(([, , at], i, a) => (i ? at - a[i - 1][2] : 0)).slice(1);
  check('writes to the YM2612 wait for its busy flag: 32 internal cycles apart', gaps.every((g) => g === 42 * 32), gaps.join(','));
  const noteWrites = p0.filter(([, , at]) => at >= Math.round(0.1 * MD_MASTER_HZ) && at < Math.round(0.11 * MD_MASTER_HZ));
  const regs = noteWrites.map(([r]) => r);
  check('a note: key-off, the patch, carriers, frequency high then low, key-on', regs[0] === 0x28 && regs.includes(0xb0) && regs.includes(0xb4) && regs.indexOf(0xa4) + 1 === regs.indexOf(0xa0) && regs.at(-1) === 0x28 && noteWrites.at(-1)[1] === 0xf0);
  const b4 = noteWrites.find(([r]) => r === 0xb4);
  check('centre pan sets both output bits', b4[1] === 0xc0);
  const tl = noteWrites.filter(([r]) => r >= 0x40 && r < 0x50);
  check('every operator level written once: three modulators, one carrier (algorithm 3)', tl.length === 4 && MD_CARRIERS[3].length === 1);
  const keyOff = p0.filter(([r, v, at]) => r === 0x28 && v === 0 && at >= Math.round(0.3 * MD_MASTER_HZ));
  check('key-off at the note\'s end', keyOff.length === 1 && keyOff[0][2] === Math.round(0.3 * MD_MASTER_HZ));
  check('one channel does not crowd the bus', lateCycles < 42 * 32 * 12, `${lateCycles} cycles late at most`);
}

// ---- a patch is written once, then only what differs

{
  const { events } = compileMdVoices([{ voice: 'fm4', pan: 'L', notes: [note(0, 0.1, 60), note(0.2, 0.3, 62), note(0.4, 0.5, 64, { patch: MD_PATCHES.twin })] }]);
  const p1 = pairs(events, 1);
  const count = (reg, from, to) => p1.filter(([r, , at]) => r === reg && at >= from * MD_MASTER_HZ && at < to * MD_MASTER_HZ).length;
  check('channel 4 writes on port 1', p1.some(([r]) => r === 0xb0) && !pairs(events, 0).some(([r]) => r === 0xb0));
  check('the second note with the same patch writes no patch register', count(0xb0, 0.19, 0.21) === 0 && count(0x30, 0.19, 0.21) === 0);
  const detunes = p1.filter(([r, , at]) => r >= 0x30 && r < 0x40 && at >= 0.39 * MD_MASTER_HZ && at < 0.41 * MD_MASTER_HZ).length;
  check('a new patch writes only the registers that differ', detunes > 0 && detunes < 4, `${detunes} of 4 detune/multiple registers`);
  check('hard left: only the left output bit', p1.find(([r]) => r === 0xb4)[1] === 0x80);
}

// ---- legato, bends and levels

{
  const { events } = compileMdVoices([{ voice: 'fm1', notes: [note(0, 0.2, 69), note(0.2, 0.4, 71, { glide: 4 })] }]);
  const p0 = pairs(events, 0);
  const keyOns = p0.filter(([r, v]) => r === 0x28 && v === 0xf0).length;
  // key-offs: power-on, the one before the first key-on, the end; none at 0.2
  const keyOffs = p0.filter(([r, v]) => r === 0x28 && v === 0).map(([, , at]) => at);
  check('a glide onto a touching note keeps the note sounding: one key-on, no key-off between', keyOns === 1 && keyOffs.length === 3 && keyOffs.at(-1) === Math.round(0.4 * MD_MASTER_HZ), keyOffs.join(','));
  const freqs = p0.filter(([r, , at]) => r === 0xa0 && at >= 0.2 * MD_MASTER_HZ).length;
  check('the glide moves the frequency a frame at a time', freqs >= 4, `${freqs} frequency writes`);
}
{
  const { events } = compileMdVoices([{ voice: 'fm1', notes: [note(0, 0.5, 69, { patch: MD_PATCHES.sine, levels: [1, 0.5, 0.25] })] }]);
  const carrier = pairs(events, 0).filter(([r]) => r === 0x4c).map(([, v]) => v);
  check('per-frame levels: the carrier\'s attenuation steps 6 dB (8 steps of 0.75) a frame, then holds', JSON.stringify(carrier) === JSON.stringify([0, 8, 16]), carrier.join(','));
}
{
  const { events } = compileMdVoices([{ voice: 'fm1', notes: [note(0, 0.5, 69, { vibrato: { delay: 4, hz: 6, depth: 0.5 } })] }]);
  const early = pairs(events, 0).filter(([r, , at]) => r === 0xa0 && at > 0 && at < (4 / 60) * MD_MASTER_HZ - 1).length;
  const late = pairs(events, 0).filter(([r, , at]) => r === 0xa0 && at > (5 / 60) * MD_MASTER_HZ).length;
  check('a delayed vibrato leaves the note still, then moves it', early === 1 && late > 10, `${early} writes before, ${late} after`);
}

// ---- PSG and noise

{
  const { events } = compileMdVoices([{ voice: 'psg2', notes: [{ at: 0, until: 0.1, pitch: 69, ...MD_PSG_INSTRUMENTS.pluck }] }]);
  const b = psgBytes(events).slice(4);
  const period = Math.round(3579545 / (32 * 440));
  check('PSG tone 2: period in two bytes, then attenuation 0', b[0] === (0xa0 | (period & 15)) && b[1] === period >> 4 && b[2] === 0xb0, b.slice(0, 3).map((x) => x.toString(16)).join(' '));
  check('the envelope steps down 2 dB a step, then the note ends silent', b.includes(0xb1) && b.at(-1) === 0xbf);
}
{
  const { events } = compileMdVoices([{ voice: 'noise', hits: [{ at: 0, until: 0.2, ...MD_NOISE_INSTRUMENTS.hat }] }]);
  const b = psgBytes(events).slice(4);
  check('a noise rate is tone 3\'s period, then white noise clocked by tone 3', b[0] === 0xc2 && b[1] === 0 && b[2] === 0xe7, b.slice(0, 3).map((x) => x.toString(16)).join(' '));
  check('the hit decays to silence and stops writing', b.at(-1) === 0xff && b.filter((x) => (x & 0xf0) === 0xf0).length <= 7);
  const fixed = psgBytes(compileMdVoices([{ voice: 'noise', hits: [{ at: 0, until: 0.1, envelope: [0], fixed: 2, white: false }] }]).events).slice(4);
  check('without a rate, a fixed rate and the periodic buzz', fixed[0] === 0xe2);
}

// ---- the DAC

{
  const stream = mdDrumStream([{ at: 0, drum: 'kick' }], MD_DAC_HZ, 0.1);
  const { events } = compileMdVoices([{ voice: 'dac', pan: 'R', stream }]);
  const p0 = pairs(events, 0);
  check('the DAC switched on at power-on', p0.find(([r]) => r === 0x2b)[1] === 0x80);
  check('FM 6\'s pan is the DAC\'s', pairs(events, 1).find(([r]) => r === 0xb6)[1] === 0x40);
  const dac = p0.filter(([r]) => r === 0x2a);
  check('samples written on $2A', dac.length > stream.length / 2, `${dac.length} writes for ${stream.length} samples`);
  check('each at the DAC\'s pace (or behind the busy flag)', dac.every(([, , at]) => at % MD_DAC_CYCLES === 0 || at - Math.floor(at / MD_DAC_CYCLES) * MD_DAC_CYCLES < 42 * 32 * 4));
  check('the DAC runs at about 13.3 kHz', Math.abs(MD_DAC_HZ - 13300) < 50, MD_DAC_HZ.toFixed(1));
}

// ---- refusals

{
  const throws = (f) => { try { f(); return false; } catch { return true; } };
  check('an unknown voice is refused', throws(() => compileMdVoices([{ voice: 'fm7', notes: [] }])));
  check('a voice given twice is refused', throws(() => compileMdVoices([{ voice: 'fm1', notes: [] }, { voice: 'fm1', notes: [] }])));
  check('the DAC and FM 6 together are refused', throws(() => compileMdVoices([{ voice: 'fm6', notes: [] }, { voice: 'dac', stream: new Float32Array(1) }])));
  check('tone 3 and a noise rate together are refused', throws(() => compileMdVoices([{ voice: 'psg3', notes: [] }, { voice: 'noise', hits: [{ at: 0, until: 1, envelope: [0], rate: 4 }] }])));
  check('tone 3 beside a fixed-rate noise is allowed', !throws(() => compileMdVoices([{ voice: 'psg3', notes: [] }, { voice: 'noise', hits: [{ at: 0, until: 1, envelope: [0], fixed: 1 }] }])));
  const note = (at, until) => ({ at, until, pitch: 69, patch: MD_PATCHES.lead });
  check('overlapping notes on one channel are refused', throws(() => compileMdVoices([{ voice: 'fm1', notes: [note(0, 2), note(0.1, 0.2)] }])));
  check('notes out of time order are refused', throws(() => compileMdVoices([{ voice: 'psg1', notes: [{ ...note(1, 2), envelope: [0] }, { ...note(0, 0.5), envelope: [0] }] }])));
  check('a note that ends before it starts is refused', throws(() => compileMdVoices([{ voice: 'fm1', notes: [note(1, 1)] }])));
  check('touching notes are allowed (legato)', !throws(() => compileMdVoices([{ voice: 'fm1', notes: [note(0, 0.5), { ...note(0.5, 1), glide: 4 }] }])));
  check('ch3 on a channel other than fm3 is refused: channel 3\'s special mode is fm3\'s alone', throws(() => compileMdVoices([{ voice: 'fm1', notes: [{ ...note(0, 0.5), ch3: [60, 64, 67] }] }])));
}

// ---- the LFO: decided once for the whole compile, from the first patch (in voice and note order) that asks for it

{
  const { events } = compileMdVoices([{ voice: 'fm1', notes: [note(0, 0.1, 69)] }]);
  check('without a patch asking for it, the LFO stays off at power-on', pairs(events, 0).find(([r]) => r === 0x22)[1] === 0);
}
{
  const { events } = compileMdVoices([{ voice: 'fm2', notes: [note(0, 0.1, 64, { patch: MD_PATCHES.shimmer })] }]);
  const lfo = pairs(events, 0).find(([r]) => r === 0x22);
  check('a patch that asks for ams, pms or an operator\'s own am turns it on at power-on, at its own rate', lfo && lfo[1] === (0x08 | (MD_PATCHES.shimmer.lfoFrequency ?? 3)), lfo && lfo[1].toString(16));
}
{
  const { events } = compileMdVoices([
    { voice: 'fm1', notes: [note(0, 0.1, 69)] },
    { voice: 'fm2', notes: [note(0, 0.1, 64, { patch: MD_PATCHES.shimmer })] },
  ]);
  const lfo = pairs(events, 0).find(([r]) => r === 0x22);
  check('the scan looks past a voice with no lfo-wanting patch to a later one that has', lfo[1] === (0x08 | (MD_PATCHES.shimmer.lfoFrequency ?? 3)));
}

// ---- channel 3's special mode: $27, and per-operator frequencies in $A8-$AE

{
  const { events } = compileMdVoices([{
    voice: 'fm3',
    notes: [
      note(0, 0.3, 48),
      { ...note(0.3, 0.6, 48), ch3: [48, 52, 55] },
      note(0.6, 0.9, 48),
    ],
  }]);
  const p0 = pairs(events, 0);
  const modeAt = (seconds) => p0.filter(([r, , at]) => r === 0x27 && at <= seconds * MD_MASTER_HZ).at(-1)[1];
  check('channel 3 plays normally until a note sets ch3', modeAt(0.1) === 0);
  check('ch3 switches channel 3 into its special mode ($27 bit 6)', modeAt(0.4) === 0x40);
  check('and the next note without it switches it back to normal', modeAt(0.7) === 0);
  const specialRegs = new Set(p0.filter(([r, , at]) => r >= 0xa8 && r <= 0xae && at >= 0.3 * MD_MASTER_HZ && at < 0.31 * MD_MASTER_HZ).map(([r]) => r));
  check('the ch3 note writes all three operators\' own frequencies, $A8 to $AE, once each', specialRegs.size === 6, [...specialRegs].map((r) => r.toString(16)).join(' '));
  const normalFreq = p0.filter(([r, , at]) => (r === 0xa2 || r === 0xa6) && at >= 0.3 * MD_MASTER_HZ && at < 0.31 * MD_MASTER_HZ);
  check('operator 4 keeps using the normal frequency registers, $A2/$A6, even in ch3\'s special mode', normalFreq.length === 2, normalFreq.map(([r]) => r.toString(16)).join(' '));
}

// ---- the bank

{
  const a = mdPatchWithRelease(MD_PATCHES.brass, 11);
  check('a patch with a faster release is the same object each time', a === mdPatchWithRelease(MD_PATCHES.brass, 11) && a !== MD_PATCHES.brass);
  check('only the carriers release faster', a.ops[1].rr === 11 && a.ops[3].rr === 11 && a.ops[0].rr === MD_PATCHES.brass.ops[0].rr);
  check('a drum is synthesized once per rate', mdDrumSample('snare', MD_DAC_HZ) === mdDrumSample('snare', MD_DAC_HZ));
  const s = mdDrumStream([{ at: 0, drum: 'kick' }, { at: 0, drum: 'snare' }], 8000, 0.5);
  check('drums sum and soft-clip under full scale', s.length === 4000 && s.every((x) => Math.abs(x) < 1) && s.some((x) => Math.abs(x) > 0.5));
  check('every letter in the bank names something in it', Object.values(MD_BANK.drumLetters).flat().every(([d]) => MD_BANK.drums[d]) && Object.values(MD_BANK.noiseLetters).every((n) => MD_BANK.noise[n]));
}

// ---- the tracker

const SONG = {
  bpm: 120, order: ['intro', 'A', 'B'], loop: 'A',
  channels: {
    lead: { voice: 'fm1', patch: 'lead', vibrato: {}, volume: 0.5 },
    echo: { voice: 'fm2', pan: 'R', patch: 'lead', echo: { of: 'lead', delay: 3, volume: 0.3 } },
    gtr: { voice: 'fm4', pan: 'L', patch: 'mute', transpose: 0.08 },
    drums: { voice: 'dac' },
    hats: { voice: 'noise', snareWires: true },
    arp: { voice: 'psg1', patch: 'arp' },
  },
  sections: {
    intro: { bars: 1, drums: 'k...s...k.k.S...', hats: 'h.h.h.h.h.h.h.h.' },
    A: { bars: 1, lead: '^E5:4 G5:2 A5 B5:8 |', gtr: '@crunch E3:8 @mute E3:2! E3 E3 E3\'', drums: 'x...s...k...s...', arp: '%50 E6:1 G6 B6 G6 E6 G6 B6 G6 E6:8' },
    B: { bars: 2, lead: 'B5:8 ~C6:8 A5:8> -:8', echo: 'G5:16 E5:16', hats: 'o...............c...............' },
  },
};

{
  const throws = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };
  const bad = (sec) => () => arrangeMdTracker({ ...SONG, sections: { ...SONG.sections, A: { ...SONG.sections.A, ...sec } } });
  check('a line of the wrong length is refused', throws(bad({ lead: 'E5:4' }), /steps, want 16/));
  check('a bar line off the bar is refused', throws(bad({ lead: 'E5:4 | E5:12' }), /bar line at step 4/));
  check('an unknown patch is refused', throws(bad({ lead: '@nope E5:16' }), /no patch @nope/));
  check('an FM patch on a PSG channel is refused', throws(bad({ arp: '@bass E5:16' }), /no patch @bass/));
  check('an unknown drum letter is refused', throws(bad({ drums: 'z...............' }), /bad drum z/));
  check('a tie with nothing is refused', throws(bad({ lead: '-:16' }), /tie with nothing/));
  check('the loop section must be in the order', throws(() => arrangeMdTracker({ ...SONG, loop: 'C' }), /loop section/));
  check('a patch named like an Object member is still unknown', throws(bad({ lead: '@constructor E5:16' }), /no patch @constructor/));
  check('an instrument named like an Object member is still unknown', throws(() => arrangeMdTracker({ ...SONG, channels: { ...SONG.channels, arp: { voice: 'psg1', patch: 'hasOwnProperty' } } }), /no PSG instrument hasOwnProperty/));
  check('a section of zero bars is refused, even as the loop with a tail', throws(() => arrangeMdTracker({ ...SONG, sections: { ...SONG.sections, A: { ...SONG.sections.A, bars: 0 } } }, { tailBars: 1 }), /bars must be a whole number/));
  check('a section missing from the song is refused before the tail', throws(() => arrangeMdTracker({ ...SONG, order: ['intro', 'A', 'C'] }, { tailBars: 2 }), /no section C/));
}
{
  const a = arrangeMdTracker(SONG);
  const step = 60 / 120 / 4;
  check('a sixteenth at 120 BPM', a.step === step);
  check('loop points without a tail: A to the end', a.loopStart === 16 * step && a.loopEnd === 64 * step && a.totalSeconds === 64 * step);
  const t = arrangeMdTracker(SONG, { tailBars: 1 });
  check('a tail of one bar plays A again past the loop end', t.loopEnd === 64 * step && t.totalSeconds === 80 * step && t.loopStart === a.loopStart);
  const t2 = arrangeMdTracker(SONG, { tailBars: 2 });
  check('a longer tail wraps from the loop section on', t2.totalSeconds === 112 * step);
  const one = arrangeMdTracker({ ...SONG, loop: undefined, order: ['A'] });
  check('without a loop, the loop end is the end', one.loopStart === 0 && one.loopEnd === 16 * step);
  const v = Object.fromEntries(a.voices.map((x) => [x.voice, x]));
  check('voices come out in the channels\' order', a.voices.map((x) => x.voice).join() === 'fm1,fm2,fm4,dac,noise,psg1');
  const lead = v.fm1.notes;
  check('the length carries over, bar lines are checked', lead.length === 7 && lead[1].until - lead[1].at === 2 * step && lead[2].until - lead[2].at === 2 * step);
  check('^ scoops two semitones over four frames', lead[0].bend === 2 && lead[0].bendFrames === 4 && lead[1].bend === 0);
  check('~ glides for four frames', lead[5].glide === 4 && lead[4].glide === 0);
  check('> falls three semitones eight frames before the end', lead[6].fall === 3 && lead[6].fallAt === Math.max(0, Math.round((lead[6].until - lead[6].at) * 60) - 8));
  check('- holds the previous note longer', lead[6].until - lead[6].at === 16 * step);
  check('the channel\'s volume scales every note', lead[0].volume === 0.5);
  check('vibrato on notes a quarter or longer, with its defaults', lead[0].vibrato && lead[0].vibrato.delay === 8 && lead[0].vibrato.hz === 6.3 && lead[0].vibrato.depth === 0.3 && lead[1].vibrato === null);
  const gtr = v.fm4.notes;
  check('@ switches patch mid-line', gtr[0].patch === MD_PATCHES.crunch && gtr[1].patch === MD_PATCHES.mute);
  check('! accents by 1.26', gtr[1].volume === 1.26 && gtr[2].volume === 1);
  check('\' halves the length', gtr[4].until - gtr[4].at === step);
  check('a transpose detunes every note', gtr[0].pitch === 52 + 0.08);
  check('% sets the volume of the notes that follow', v.psg1.notes.every((n) => n.volume === 0.5) && v.psg1.notes[0].envelope === MD_PSG_INSTRUMENTS.arp.envelope);
  const echo = v.fm2.notes;
  check('the echo copies the lead\'s written notes three steps later at its own volume, where it has no line of its own', echo[0].at === 16 * step + 3 * step && echo[0].volume === 0.3 && echo.filter((n) => n.at < 32 * step).length === 4);
  check('where the echo channel writes its own line, it keeps it', echo.filter((n) => n.at >= 32 * step).map((n) => n.pitch).join() === '79,76');
  check('an echo is cut short where it would run into its next note', echo.every((n, i) => i + 1 >= echo.length || n.until <= echo[i + 1].at + 1e-9));
  const hats = v.noise.hits;
  const snares = [4, 12, 16, 20, 28].map((s) => s * step);
  check('snare wires: every DAC snare doubled on the noise, replacing the hat on that step', snares.every((t) => hats.some((h) => h.at === t && h.envelope === MD_NOISE_INSTRUMENTS.snr.envelope)) && !hats.some((h) => h.at === 4 * step && h.envelope === MD_NOISE_INSTRUMENTS.hat.envelope));
  check('a noise hit rings until the next', hats.every((h, i) => i + 1 >= hats.length || h.until === hats[i + 1].at));
  check('the drums become one DAC stream at the DAC\'s rate, a second past the end', v.dac.stream.length === Math.ceil((64 * step + 1) * MD_DAC_HZ));
  const { events, lateCycles } = compileMdVoices(t.voices);
  const r = renderMdEvents(events, { seconds: t.totalSeconds, profile: MD_BRIGHT_PROFILE, gain: 0.9, sampleRate: 22050 });
  let el = 0, er = 0;
  for (let i = 0; i < r.left.length; i++) { el += r.left[i] ** 2; er += r.right[i] ** 2; }
  check('the whole song compiles and renders, stereo, not silent, not clipping', r.right && el > 0 && er > 0 && r.peak < 1 && r.seconds === t.totalSeconds, `peak ${r.peak.toFixed(3)}, ${events.length} events, ${lateCycles} cycles late at most`);
}

// ---- pan and pitch on the real chip

{
  const tone = compileMdVoices([{ voice: 'fm1', pan: 'L', notes: [note(0, 1, 69, { patch: MD_PATCHES.sine })] }]);
  const r = renderMdEvents(tone.events, { seconds: 1, profile: MD_BRIGHT_PROFILE });
  let l = 0, rr = 0, crossings = 0;
  for (let i = 0; i < r.left.length; i++) { l += r.left[i] ** 2; rr += r.right[i] ** 2; }
  for (let i = 22050; i < 44100; i++) if (r.left[i - 1] < 0 && r.left[i] >= 0) crossings++;
  check('hard left is heard on the left only', l > 100 * rr, `left ${l.toFixed(1)}, right ${rr.toExponential(1)}`);
  check('A4 on FM 1 is 440 Hz', Math.abs(crossings * 2 - 440) <= 4, `${crossings * 2} Hz`);
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
