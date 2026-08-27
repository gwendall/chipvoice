import { validateSong } from '../dist/index.js';

/**
 * The validator's job is not to say no. It is to say what to change.
 *
 * Every case here is a mistake somebody writing songs without ears will make,
 * and the assertion is on the message, not just on the rejection - a 422 that
 * says "invalid" teaches nothing and costs a whole round trip.
 */
let failures = 0;
const check = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); };

const good = {
  bpm: 152, order: [0, 0, 0, 0],
  patterns: [{
    bass:  'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
    lead:  'E4 . . . G4 . A4 . . . B4 . C5 . . .',
    chord: 'A3 . . . . . . . . . . . . . . .',
    chordShape: [[0, 3, 7]],
    perc:  'K . H . S . H . K . H K S . H .',
  }],
};

const clone = (fn) => { const c = structuredClone(good); fn(c); return c; };

// ---- it accepts a valid song and measures it
const ok = validateSong(good);
check('a valid song passes', ok.ok, JSON.stringify(ok.issues));
check('and is measured', ok.measured?.steps === 64, JSON.stringify(ok.measured));

// ---- the silent ones, which are the whole point
const typo = validateSong(clone((c) => { c.patterns[0].lead = c.patterns[0].lead.replace('E4', 'H4'); }));
const typoIssue = typo.issues.find((i) => i.token === 'H4');
check('a mistyped note is rejected', !typo.ok && !!typoIssue, JSON.stringify(typo.issues[0]));
check('and marked silent', typoIssue?.silent === true, JSON.stringify(typoIssue));
check('with a message that says the shape', /letter A-G/.test(typoIssue?.message ?? ''), typoIssue?.message);

const drum = validateSong(clone((c) => { c.patterns[0].perc = c.patterns[0].perc.replace('K', 'X'); }));
const drumIssue = drum.issues.find((i) => i.token === 'X');
check('a bad drum token is rejected', !drum.ok && drumIssue?.silent === true, drumIssue?.message);
check('and lists the four', /K kick, S snare, H hat, O open hat/.test(drumIssue?.message ?? ''), drumIssue?.message);

const ragged = validateSong(clone((c) => { c.patterns[0].lead += ' A4'; }));
const raggedIssue = ragged.issues.find((i) => i.track === 'lead');
check('a longer channel is rejected', !ragged.ok && raggedIssue?.silent === true, raggedIssue?.message);
check('and says what gets dropped', /dropped every loop/.test(raggedIssue?.message ?? ''), raggedIssue?.message);

// ---- the loud ones
const tempo = validateSong(clone((c) => { c.bpm = 900; }));
check('an impossible tempo is rejected', !tempo.ok, tempo.issues[0]?.message);

const missing = validateSong(clone((c) => { delete c.patterns[0].chord; }));
check('a missing channel is rejected', !missing.ok, missing.issues[0]?.message);
check('and says all four are required', /All four channels are required/.test(missing.issues[0]?.message ?? ''));

const noShape = validateSong(clone((c) => { delete c.patterns[0].chordShape; }));
check('a missing chordShape is rejected', !noShape.ok, noShape.issues[0]?.message);
check('and explains what one is', /minor/.test(noShape.issues[0]?.message ?? ''), noShape.issues[0]?.message);

const badOrder = validateSong(clone((c) => { c.order = [0, 7]; }));
check('an order pointing nowhere is rejected', !badOrder.ok, badOrder.issues[0]?.message);

// ---- a warning, not an error: short loops play, they just wear out
const short = validateSong(clone((c) => { c.order = [0]; }));
const warn = short.issues.find((i) => i.level === 'warning');
check('a short loop warns but passes', short.ok && !!warn, warn?.message);
check('and says why it matters', /repeat rather than as a piece/.test(warn?.message ?? ''), warn?.message);

// ---- rubbish in
check('a non-object is rejected', !validateSong(null).ok);
check('an unknown chip is rejected', !validateSong({ ...good, chip: 'ym2612' }).ok);

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
