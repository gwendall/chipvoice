import { validateSong, arrange } from '../dist/index.js';

/**
 * AUD-4's modulation and voice-budget diagnostics.
 *
 * `validate.mjs` covers the mistakes a mistyped song makes. These are the
 * ones a well-formed song makes anyway, because the hardware cannot do
 * exactly what was asked: a vibrato that quantizes to nothing on a period
 * table, a slide that leaves a voice's range, a volume step a register
 * rounds, two roles asking for one physical voice. Every case here is
 * something the driver used to do silently - clamp it, round it, cut it -
 * with nothing in the response saying so.
 */
let failures = 0;
const check = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); };

const song = (chip, patch = {}) => ({
  chip, bpm: 120, order: [0],
  patterns: [{
    bass: 'C2 . . .', lead: 'C4 . . .', chord: 'C3 . . .', perc: 'K . H .',
    chordShape: [[0, 4, 7]],
  }],
  lead: { volume: [15] }, chord: { volume: [15] }, bass: { volume: [15] },
  ...patch,
});

// The two existing diagnostics now carry measured/limit alongside their message.
{
  const s = song('c64', { patterns: [{ ...song('c64').patterns[0], lead: 'C8 . . .' }] });
  const issue = validateSong(s).issues.find(i => i.code === 'pitch_range');
  check('pitch_range carries measured and limit', typeof issue?.measured === 'number' && typeof issue?.limit === 'number', JSON.stringify(issue));
}
{
  const s = song('snes', {
    lead: { volume: [15], sample: 'flute' },
    patterns: [{ ...song('snes').patterns[0], chordShape: [[0, 2, 4, 7, 9, 12]] }],
  });
  const issue = validateSong(s).issues.find(i => i.code === 'chord_capacity');
  check('chord_capacity carries the shape length and voice count', issue?.measured === 6 && issue?.limit === 5, JSON.stringify(issue));
}

// vibrato_range: a lead held near the 2A03 pulse ceiling, vibrato big enough to swing past it.
{
  const s = song('2a03', { patterns: [{ ...song('2a03').patterns[0], lead: 'E9 . . .' }], lead: { volume: [15], vibrato: { depth: 4, rate: 8 } } });
  const r = validateSong(s);
  const issue = r.issues.find(i => i.code === 'vibrato_range');
  check('vibrato_range fires when a swing leaves the range', !!issue, JSON.stringify(r.issues));
  check('and carries measured/limit', typeof issue?.measured === 'number' && typeof issue?.limit === 'number', JSON.stringify(issue));
  check('base pitch_range does not also fire', !r.issues.some(i => i.code === 'pitch_range'), JSON.stringify(r.issues));
}

// vibrato_resolution: same chip, a pitch whose register step is coarser than the depth.
{
  const s = song('2a03', { patterns: [{ ...song('2a03').patterns[0], lead: 'D9 . . .' }], lead: { volume: [15], vibrato: { depth: 0.1, rate: 8 } } });
  const r = validateSong(s);
  const issue = r.issues.find(i => i.code === 'vibrato_resolution');
  check('vibrato_resolution fires when the depth quantizes to nothing', !!issue, JSON.stringify(r.issues));
  check('and names the depth as measured', issue?.measured === 0.1, JSON.stringify(issue));
}

// vibrato_rate: a rate the 60Hz frame clock cannot resolve.
{
  const s = song('dmg', { lead: { volume: [15], vibrato: { depth: 0.2, rate: 1 } } });
  const r = validateSong(s);
  const issue = r.issues.find(i => i.code === 'vibrato_rate');
  check('vibrato_rate fires under two frames a cycle', !!issue, JSON.stringify(r.issues));
}

// slide_range: a held note whose slide carries it past the ceiling.
{
  const s = song('2a03', {
    patterns: [{ ...song('2a03').patterns[0], lead: 'E9 . . . . . . .', bass: 'C2 . . . . . . .', chord: 'C3 . . . . . . .', perc: 'K . . . . . . .' }],
    lead: { volume: [15], slide: 0.06 },
  });
  const r = validateSong(s);
  const issue = r.issues.find(i => i.code === 'slide_range');
  check('slide_range fires when a slide leaves the range', !!issue, JSON.stringify(r.issues));
}

// slide_resolution: a slide that lands where one register step is already coarse -
// the ticket's own example, the low end of the 2A03 and Game Boy period tables.
for (const chip of ['2a03', 'dmg']) {
  const s = song(chip, { lead: { volume: [15], slide: 0.01 }, patterns: [{ ...song(chip).patterns[0], lead: 'C8 . . .' }] });
  const r = validateSong(s);
  const issue = r.issues.find(i => i.code === 'slide_resolution');
  check(`slide_resolution fires on ${chip} at the coarse end of its table`, !!issue, JSON.stringify(r.issues));
  check('and does not also report slide_range', !r.issues.some(i => i.code === 'slide_range'));
}

// volume_step: a fractional volume the chip's register rounds; SNES escapes it.
{
  const s = song('dmg', { lead: { volume: [15, 10.5, 8] } });
  const r = validateSong(s);
  const issue = r.issues.find(i => i.code === 'volume_step');
  check('volume_step fires on a fractional volume', !!issue, JSON.stringify(r.issues));
  check('and names the fraction and its rounding', issue?.measured === 10.5 && issue?.limit === 11, JSON.stringify(issue));

  const snes = song('snes', { lead: { volume: [15, 10.5, 8], sample: 'flute' } });
  check('SNES is exempt: it keeps fractional volume in its register', !validateSong(snes).issues.some(i => i.code === 'volume_step'));
}

// voice_share: the SID's chord and percussion role both land on v3.
{
  const s = song('c64', { patterns: [{ ...song('c64').patterns[0], chord: 'C3 . . .', perc: '. K . .' }] });
  const r = validateSong(s);
  const issue = r.issues.find(i => i.code === 'voice_share');
  check('voice_share fires when a drum lands under a sounding chord on the SID', !!issue, JSON.stringify(r.issues));
  check('naming the shared voice', issue?.voice === 'v3', JSON.stringify(issue));
}

// perc_voice: two drums closer together than the first one's own decay - the
// ticket's own example, the 2A03's single noise channel.
{
  const s = song('2a03', { patterns: [{ ...song('2a03').patterns[0], perc: 'O K . .' }] });
  const r = validateSong(s);
  const issue = r.issues.find(i => i.code === 'perc_voice');
  check('perc_voice fires when a hit cuts the previous one short', !!issue, JSON.stringify(r.issues));
  check('with measured and limit in seconds', typeof issue?.measured === 'number' && typeof issue?.limit === 'number', JSON.stringify(issue));
}

// No false positives on an ordinary, well-inside-range song, on any chip.
// The SID is its own case: its chord and percussion roles share v3 by
// construction, so a chord under a drum correctly raises voice_share there -
// that is the diagnostic working, not a false one, and is asserted on its own.
for (const chip of ['2a03', 'dmg', 'md', 'snes', 'c64']) {
  const arranged = arrange({ bpm: 140, order: [0], patterns: [{ bass: 'C2 . . .', lead: 'C4 . E4 .', chord: 'C3 . . .', perc: 'K . H .', chordShape: [[0, 4, 7]] }] }, chip);
  const r = validateSong(arranged);
  const codes = ['vibrato_range', 'vibrato_resolution', 'vibrato_rate', 'slide_range', 'slide_resolution', 'volume_step', 'perc_voice', ...(chip === 'c64' ? [] : ['voice_share'])];
  const spurious = r.issues.filter(i => codes.includes(i.code));
  check(`${chip}'s default instruments raise no new diagnostics on an ordinary song`, spurious.length === 0, JSON.stringify(spurious));
}

// The SID case named above, made explicit.
{
  const arranged = arrange({ bpm: 140, order: [0], patterns: [{ bass: 'C2 . . .', lead: 'C4 . E4 .', chord: 'C3 . . .', perc: 'K . H .', chordShape: [[0, 4, 7]] }] }, 'c64');
  const shared = validateSong(arranged).issues.filter(i => i.code === 'voice_share');
  check("the SID's shared chord/percussion voice is named, not silently resolved", shared.length === 2, JSON.stringify(shared));
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
