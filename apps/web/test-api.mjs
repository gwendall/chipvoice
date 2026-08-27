/**
 * The API, driven the way an agent would drive it.
 *
 * Every assertion is something a caller depends on: that validate refuses
 * before songs does, that the refusal says which token and whether it was
 * silent, that a fork inherits what it did not send, and that the MP3 is a real
 * file rather than a 200 with nothing in it.
 */
const BASE = process.env.API_URL || 'http://localhost:3010';
const guard = setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 120000);
guard.unref();

let failures = 0;
const check = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); };

const post = (path, body) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const SONG = {
  title: 'end to end',
  author: 'test',
  bpm: 152,
  order: [0, 0, 1, 0],
  patterns: [
    {
      lead:  'E4 . . . G4 . A4 . . . B4 . C5 . . .',
      chord: 'A3 . . . . . . . . . . . . . . .',
      bass:  'A1 . A1 . A1 . A1 . A1 . A1 . A1 . G1 .',
      perc:  'K . H . S . H . K . H K S . H .',
      chordShape: [[0, 3, 7]],
    },
    {
      lead:  'C5 . . . E5 . D5 . . . B4 . A4 . = .',
      chord: 'F3 . . . . . . . G3 . . . . . . .',
      bass:  'F1 . F1 . F1 . F1 . G1 . G1 . G1 . G1 .',
      perc:  'K . H . S . H H K K S . S . H O',
      chordShape: [[0, 4, 7], [0, 4, 7]],
    },
  ],
};

// ---- validation teaches
const typo = structuredClone(SONG);
typo.patterns[0].lead = typo.patterns[0].lead.replace('E4', 'H4');
const bad = await post('/api/validate', typo);
const badBody = await bad.json();
check('a mistyped note is refused', bad.status === 422, String(bad.status));
const issue = badBody.issues?.find((i) => i.token === 'H4');
check('and named exactly', issue?.track === 'lead' && issue?.step === 0, JSON.stringify(issue));
check('and flagged as silent', issue?.silent === true, JSON.stringify(issue));

/*
 * The two routes have to agree.
 *
 * They did not: notes were checked by validate and the title only by songs, so
 * a caller could be told its song was fine and refused at the moment it
 * committed. That is worse than having no validate route, because it teaches a
 * caller to trust an incomplete answer.
 */
const badTitle = { ...SONG, title: '🎵 emoji title' };
const titleCheck = await post('/api/validate', badTitle);
const titleStore = await post('/api/songs', badTitle);
check(
  'validate and songs agree about titles',
  titleCheck.status === titleStore.status,
  `validate ${titleCheck.status}, songs ${titleStore.status}`,
);
const titleIssue = (await titleCheck.json()).issues?.find((i) => i.track === 'title');
check('and validate names the title', !!titleIssue, titleIssue?.message);

const okCheck = await post('/api/validate', SONG);
const okBody = await okCheck.json();
check('a good song validates', okCheck.status === 200 && okBody.ok, JSON.stringify(okBody.issues));
check('and comes back measured', typeof okBody.measured?.loopSeconds === 'number', JSON.stringify(okBody.measured));

// ---- storing
const created = await post('/api/songs', SONG);
const song = await created.json();
check('storing returns 201', created.status === 201, String(created.status));
check('with an eight-character id', /^[0-9A-Za-z]{8}$/.test(song.id ?? ''), song.id);
check('and the three links', !!song.url && !!song.mp3 && !!song.wav, JSON.stringify({ url: song.url }));

// A song the API refused to validate must not be storable either.
const refused = await post('/api/songs', typo);
check('a bad song cannot be stored', refused.status === 422, String(refused.status));

// ---- reading
const read = await fetch(`${BASE}/api/songs/${song.id}`);
const readBody = await read.json();
check('a song can be read back', read.status === 200 && readBody.id === song.id);
check('and starts with no forks', readBody.forks === 0, String(readBody.forks));
check('an unknown id is 404', (await fetch(`${BASE}/api/songs/aaaaaaaa`)).status === 404);
check('a malformed id is 400', (await fetch(`${BASE}/api/songs/nope`)).status === 400);

// ---- forking
const forked = await post(`/api/songs/${song.id}/fork`, { bpm: 168, title: 'faster' });
const fork = await forked.json();
check('forking returns 201', forked.status === 201, String(forked.status));
check('the fork points at its parent', fork.parentId === song.id, fork.parentId);
check('and inherits what it did not send', fork.patterns?.[0]?.lead === SONG.patterns[0].lead, fork.patterns?.[0]?.lead);
check('and takes what it did', fork.bpm === 168 && fork.title === 'faster', `${fork.bpm} ${fork.title}`);

const after = await (await fetch(`${BASE}/api/songs/${song.id}`)).json();
check('the parent counts it', after.forks === 1, String(after.forks));

// ---- audio, which is the point
for (const [format, type] of [['mp3', 'audio/mpeg'], ['wav', 'audio/wav']]) {
  const audio = await fetch(`${BASE}/s/${song.id}.${format}`);
  const bytes = new Uint8Array(await audio.arrayBuffer());
  check(`the ${format} is served`, audio.status === 200, String(audio.status));
  check(`as ${type}`, audio.headers.get('content-type') === type, audio.headers.get('content-type'));
  check(`and is a real file`, bytes.length > 20000, `${bytes.length} bytes`);
  check(
    `cached immutably`,
    (audio.headers.get('cache-control') ?? '').includes('immutable'),
    audio.headers.get('cache-control'),
  );
}

// The renders have to differ: a fork that sounds like its parent is not a fork.
const parentAudio = new Uint8Array(await (await fetch(`${BASE}/s/${song.id}.mp3`)).arrayBuffer());
const forkAudio = new Uint8Array(await (await fetch(`${BASE}/s/${fork.id}.mp3`)).arrayBuffer());
check(
  'a fork renders differently from its parent',
  parentAudio.length !== forkAudio.length,
  `${parentAudio.length} vs ${forkAudio.length} bytes`,
);

// Determinism is what makes caching forever safe.
const again = new Uint8Array(await (await fetch(`${BASE}/s/${song.id}.mp3`)).arrayBuffer());
check(
  'the same song renders identically twice',
  parentAudio.length === again.length && parentAudio[1000] === again[1000],
  `${parentAudio.length} vs ${again.length}`,
);

// ---- the agent surface
for (const [path, type] of [
  ['/skill.md', 'text/markdown'],
  ['/llms.txt', 'text/plain'],
  ['/.well-known/openapi.json', 'application/json'],
  ['/.well-known/mcp.json', 'application/json'],
  ['/.well-known/skills/chipvoice/skill.md', 'text/markdown'],
]) {
  const res = await fetch(BASE + path);
  check(`${path} is served`, res.status === 200 && (res.headers.get('content-type') ?? '').startsWith(type), `${res.status} ${res.headers.get('content-type')}`);
}

const skill = await (await fetch(`${BASE}/skill.md`)).text();
check('the skill lists every endpoint', (skill.match(/^\| `(GET|POST)`/gm) ?? []).length >= 6, String((skill.match(/^\| `(GET|POST)`/gm) ?? []).length));
check('and warns about the silent failure', /mistyped note is silent/i.test(skill));

const mcp = await (await fetch(`${BASE}/.well-known/mcp.json`)).json();
check('the MCP manifest has tools', (mcp.tools ?? []).length >= 6, String(mcp.tools?.length));
check('each with an input schema', mcp.tools.every((t) => t.inputSchema?.type === 'object'));

// ---- the page a link lands on
const page = await fetch(`${BASE}/s/${song.id}`);
const html = await page.text();
check('the share page renders', page.status === 200);
// It is the editor now rather than a separate read-only view, so what has to
// be there is the metadata a chat client reads and the app that plays it.
check('carrying og:audio for chat clients', /og:audio/.test(html));
check('and the editor itself', /transport|__next/.test(html));
check('and a card image', (await fetch(`${BASE}/s/${song.id}/card`)).status === 200);

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
