import assert from 'node:assert/strict';
import { build } from '../../packages/chipvoice/node_modules/esbuild/lib/main.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { arrange, renderSong, toWav, recordSong, toVgm } from '../../packages/chipvoice/dist/index.js';
async function module(path) {
  const result = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { readDocument } = await module('src/studio/document.ts');
const { SongInput } = await module('src/lib/schema.ts');
const longLine = 'C4 ' + '. '.repeat(2200);
const legacy = {chip:'2a03',bpm:144,order:[0],patterns:[{bass:longLine,lead:longLine,chord:longLine,perc:'K '+'. '.repeat(2200),chordShape:Array.from({length:257},()=>[0,4,7])}]};
assert.deepEqual(readDocument(legacy),legacy,'existing long publications and drafts remain loadable');
assert.equal(SongInput.safeParse(legacy).success,false,'new publication admission remains bounded');
const { publicationBody } = await module('src/studio/publication.ts');
assert.deepEqual(publicationBody({...legacy,stepsPerBeat:12},legacy),{stepsPerBeat:12});
assert.deepEqual(publicationBody(legacy,{...legacy,stepsPerBeat:12}),{stepsPerBeat:4});
assert.equal(readDocument({...legacy,stepsPerBeat:12}).stepsPerBeat,12);
assert.deepEqual(publicationBody({...legacy,title:'New title'},legacy),{title:'New title'});
assert.deepEqual(publicationBody(legacy,{...legacy,title:'Old title'}),{title:null});
assert.deepEqual(publicationBody({...legacy,title:'New',author:'Artist'},{...legacy,title:'Old',author:'Artist'}),{title:'New',author:'Artist'});
const { midiTap } = await module('src/studio/midi.ts');
assert.deepEqual(midiTap([0x90,60,90],'lead'), {role:'lead',note:'C4'});
assert.deepEqual(midiTap([0x93,61,1],'bass'), {role:'bass',note:'C#4'});
assert.deepEqual(midiTap([0x99,36,127],'lead'), {role:'perc',note:'K'});
assert.deepEqual(midiTap([0x90,46,100],'perc'), {role:'perc',note:'O'});
for (const data of [[0x80,60,127],[0x90,60,0],[0xf8],[0xf0,1,2],[0x90,3,127],[0x90,128,127],[0x90,60,255]]) assert.equal(midiTap(data,'lead'),null);
const { exportSong } = await module('src/studio/exports.ts');
const song = { title:'An export', chip:'dmg', bpm:300, order:[0], patterns:[{bass:'C2 . . .',lead:'E4 . G4 .',chord:'C3 . . .',perc:'K . H .',chordShape:[[0,4,7]]}] };
const original = JSON.stringify(song);
const dir = await mkdtemp(join(tmpdir(), 'chipvoice-exports-'));
try {
  const wav = exportSong(song,'wav');
  assert.deepEqual(wav.bytes,toWav(renderSong(arrange(song),{stereo:true})));
  for (const kind of ['stems','machines']) {
    const updates = [], archive = exportSong(song,kind,(done,total)=>updates.push([done,total]));
    const file = join(dir,`${kind}.zip`); await writeFile(file,archive.bytes);
    const names = JSON.parse(execFileSync('python3',['-c', 'import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))',file]));
    const roles = ['lead','chord','bass','perc'];
    const choices = kind === 'stems' ? roles : ['2a03','dmg','md','snes','c64'];
    assert.equal(names.length,choices.length+2); assert.deepEqual(updates.at(-1),[choices.length,choices.length]);
    for (const choice of choices) {
      const actual = execFileSync('python3',['-c','import zipfile,sys; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',file,`${choice}.wav`]);
      const score = kind === 'machines' ? {...song,chip:choice} : {...song,patterns:song.patterns.map(p=>({...p,...Object.fromEntries(roles.filter(r=>r!==choice).map(r=>[r,p[r].split(' ').map(()=>'.').join(' ')]))}))};
      assert.ok(actual.equals(Buffer.from(toWav(renderSong(arrange(score),{stereo:true})))));
    }
    assert.deepEqual(JSON.parse(execFileSync('python3',['-c','import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read("score.json").decode())',file])),song);
  }
  for (const chip of ['2a03','dmg','md']) {
    const result = exportSong({...song,chip},'vgm'); const capture = recordSong(arrange({...song,chip}));
    assert.deepEqual(result.bytes,toVgm(capture.events,capture.cycles,{chip,title:song.title}));
  }
  assert.throws(()=>exportSong({...song,chip:'snes'},'vgm'));
  assert.throws(()=>exportSong({...song,bpm:144,order:Array(64).fill(0)},'machines'));
  assert.equal(JSON.stringify(song),original);
} finally { await rm(dir,{recursive:true,force:true}); }
console.log('PASS MIDI tap decoding, independent ZIP reader, aligned stems/five-machine audio and VGM bytes');
