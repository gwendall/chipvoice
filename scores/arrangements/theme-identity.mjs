import assert from 'node:assert/strict';

// Reviewed Overworld phrase, starting at beat 16 of scores/references/zelda.json
// (Colletti's independent MIDI transcription). Repeated attacks are collapsed;
// pitch classes allow the same tune in another octave, but retain its key.
// In the pinned 37-track NSF this phrase occurs in music track 3 only.
export const zeldaOverworldPhrase = [10, 5, 10, 0, 2, 3, 5, 6, 8, 10, 8, 6];

export function assertZeldaOverworld(native) {
  assert.equal(native.chip, '2a03');
  const low = [0, 0], phrases = [[], []];
  for (const event of native.events) {
    const voice = event.addr >= 0x4004 ? 1 : 0;
    const register = event.addr - 0x4000 - voice * 4;
    if (register === 2) low[voice] = event.value;
    if (register !== 3 || event.at === 0) continue;
    const timer = low[voice] | ((event.value & 7) << 8);
    const pitch = Math.round(69 + 12 * Math.log2(1789773 / (16 * (timer + 1)) / 440));
    const pitchClass = ((pitch % 12) + 12) % 12;
    if (phrases[voice].at(-1) !== pitchClass) phrases[voice].push(pitchClass);
  }
  const found = phrases.some(notes => notes.some((_, index) =>
    zeldaOverworldPhrase.every((pitch, offset) => notes[index + offset] === pitch)));
  assert.ok(found, 'Zelda Overworld theme is absent: check the NSF subsong, not just emulator parity');
}
