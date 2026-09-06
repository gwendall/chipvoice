import assert from 'node:assert/strict';
import { arrange, varyScore, validateSong } from '../dist/index.js';
const score = { id: 'source', title: 'Keep this', author: 'Composer', chip: 'dmg', bpm: 144, order: [0,1,0], patterns: [
  { lead: 'C4 . E4 . G4 . E4 =', bass: 'C2 . . . G2 . . .', chord: 'C3 . . . G3 . . .', perc: 'K . H . S . H .', chordShape: [[0,4,7],[0,7,12]] },
  { lead: 'D4 . F4 . A4 . G4 =', bass: 'D2 . . . G2 . . .', chord: 'D3 . . . G3 . . .', perc: 'K . H H S . H .', chordShape: [[0,3,7],[0,4,7]] },
] };
const original = JSON.stringify(score), locked = ['chord', 'bass'];
for (const kind of ['melody','drums','timbres']) {
  for (let seed = 0; seed < 100; seed++) {
    const next = varyScore(score, { kind, locked, seed });
    assert.deepEqual(next, varyScore(score, { kind, locked, seed }));
    assert.notEqual(next, score);
    assert.equal(next.id, undefined);
    assert.equal(next.title, score.title); assert.equal(next.author, score.author);
    assert.equal(next.order, score.order); assert.equal(next.chip, score.chip); assert.equal(next.bpm, score.bpm);
    for (let p = 0; p < score.patterns.length; p++) {
      for (const role of locked) assert.equal(next.patterns[p][role], score.patterns[p][role]);
      assert.equal(next.patterns[p].chordShape, score.patterns[p].chordShape);
      if (kind === 'melody') {
        assert.equal(next.patterns[p].perc, score.patterns[p].perc);
        const rhythm = line => line.split(' ').map(n => n === '.' || n === '=' ? n : 'note');
        assert.deepEqual(rhythm(next.patterns[p].lead), rhythm(score.patterns[p].lead));
      }
      if (kind === 'drums') assert.equal(next.patterns[p].lead, score.patterns[p].lead);
      if (kind === 'timbres') assert.equal(next.patterns[p], score.patterns[p]);
    }
    for (const chip of ['2a03','dmg','md','snes','c64']) assert.equal(validateSong(arrange(next, chip)).ok, true);
  }
  assert.equal(varyScore(score, { kind, locked: ['lead','chord','bass','perc'], seed: 1 }), score);
}
const silent = { ...score, patterns: [{ ...score.patterns[0], lead: '. . = . . . . .' }] };
assert.equal(varyScore(silent, { kind:'melody', seed:1 }), silent, 'authored rests and cuts remain unchanged');
assert.equal(JSON.stringify(score), original);
assert.notEqual(arrange(varyScore(score, { kind:'melody', seed:1 })).id, arrange(score).id);
console.log('PASS seeded variations preserve locked roles, full documents, rhythms, voicings and playback identity');
