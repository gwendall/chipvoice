import { arrange, INTENTS, DEFAULT_KIT, renderSong, validateSong, instrumentsFor } from '../dist/index.js';

/**
 * The score, arranged: the same four lines and an intent per role, and each
 * chip's arranger gives it that chip's instruments. No intent is what every
 * song has had so far, to the number; every word in the catalogue plays on
 * both chips; a word that is not in it is named by the validator.
 */
let failures = 0;
const check = (n, ok, extra = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SCORE = {
  bpm: 152, order: [0],
  patterns: [{
    bass: 'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
    lead: 'E4 . . . G4 . A4 . . . B4 . C5 . . .',
    chord: 'A3 . . . . . . . . . . . . . . .',
    chordShape: [[0, 3, 7]],
    perc: 'K . H . S . H . K . H K S . H .',
  }],
};

// ---- no intent is what every song has had

{
  const song = arrange(SCORE);
  check('no intent on the 2A03 is the instruments every published song has had', same(song.lead, {
    duty: 1, volume: [15, 15, 14, 13, 12, 12, 11, 11, 10, 10, 10, 9, 9, 9, 8], sustain: true, vibrato: { depth: 0.18, rate: 8, delay: 12 },
  }) && same(song.chord, { duty: 0, volume: [9, 8, 7, 7, 6], sustain: true }) && same(song.bass, { volume: [15], sustain: true }) && song.perc === DEFAULT_KIT);
  check('and carries the lines, the tempo and the order through', song.bpm === 152 && song.patterns === SCORE.patterns && song.order === SCORE.order && song.gain === 1);
  check('with an id from the content', song.id === arrange(SCORE).id && song.id !== arrange({ ...SCORE, bpm: 150 }).id, song.id);
}

{
  const gb = arrange(SCORE, 'dmg');
  check('on the Game Boy the bass is a triangle in wave RAM', Array.isArray(gb.bass.wave) && gb.bass.wave.length === 32 && gb.bass.wave[15] === 15 && gb.bass.wave[31] === 0);
  check('and the pulses take the same tables', same(gb.lead, arrange(SCORE).lead) && same(gb.chord, arrange(SCORE).chord));
}

// ---- every word plays on both chips

for (const chip of ['2a03', 'dmg']) {
  for (const [role, words] of Object.entries(INTENTS)) {
    for (const word of Object.keys(words)) {
      const song = arrange({ ...SCORE, intent: { [role]: word } }, chip);
      const result = renderSong(song, { seconds: 1.5, chip });
      let rms = 0;
      for (let i = 0; i < result.left.length; i++) rms += result.left[i] * result.left[i];
      rms = Math.sqrt(rms / result.left.length);
      check(`${chip}: ${role} "${word}" plays`, rms > 0.02 && result.peak <= 1, `rms ${rms.toFixed(3)}`);
    }
  }
}

{
  const a = instrumentsFor('2a03', { lead: 'bright' });
  const b = instrumentsFor('2a03', { lead: 'round' });
  check('bright and round leads differ by duty on the 2A03', a.lead.duty === 0 && b.lead.duty === 2);
  const hollow = instrumentsFor('dmg', { bass: 'hollow' });
  check('a hollow bass on the Game Boy is a square wave at half level', hollow.bass.wave[0] === 15 && hollow.bass.wave[16] === 0 && hollow.bass.volume[0] === 8);
  const nes = instrumentsFor('2a03', { bass: 'hollow' });
  check('and on the NES it is still the triangle', nes.bass.wave === undefined && same(nes.bass, { volume: [15], sustain: true }));
}

// ---- the validator names a word that is not in the catalogue

{
  const ok = validateSong({ ...SCORE, intent: { lead: 'bright', perc: 'soft' } });
  check('the validator takes an intent from the catalogue', ok.ok, ok.issues.map((i) => i.message).join('; '));
  const bad = validateSong({ ...SCORE, intent: { lead: 'screaming' } });
  check('and names one that is not, with the words it knows', !bad.ok && /"screaming" is not a lead intent.*soft, bright, round/.test(bad.issues[0].message), bad.issues[0]?.message);
  const role = validateSong({ ...SCORE, intent: { drums: 'tight' } });
  check('and a role that does not exist', !role.ok && /no such role/.test(role.issues[0].message), role.issues[0]?.message);
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
