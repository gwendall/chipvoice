import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {nativeSources,loadNative,vgmCommands} from './native-sources.mjs';
import {compareNativeTrace} from './compare-native.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const [id,spec] of Object.entries(nativeSources)){
 const native=await loadNative(id),reference=JSON.parse(await readFile(new URL(`./references/${id}.json`,import.meta.url))),manifest=JSON.parse(await readFile(`${spec.artifacts}/native-reference.json`)),trace=await readFile(`${spec.artifacts}/gme-writes.txt`);
 for(const key of ['sourceSha256','oracleRevision','pcmSha256','traceSha256'])assert.equal(manifest[key],reference[key],`${id}: ${key}`);
 assert.equal(hash(trace),manifest.traceSha256);assert.equal(hash(await readFile(`${spec.artifacts}/${spec.pcm}`)),manifest.pcmSha256);
 let result;
 if(spec.format==='vgm'){
  const commands=vgmCommands(native),lines=trace.toString().trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number));
  assert.deepEqual(commands,lines.slice(0,commands.length),'independent VGM decoder: command, register, value, sample timestamp');
  assert.ok(lines[commands.length][0]>=Math.round(native.seconds*44100),'no unaccounted command before end');
  result={musicCommands:commands.length,commandsSha256:hash(JSON.stringify(commands))};
 }else result=compareNativeTrace(native,trace.toString());
 assert.equal(result.musicCommands,reference.musicCommands);assert.equal(result.commandsSha256,reference.commandsSha256);
 console.log(`PASS ${id}: ${result.musicCommands} independent native commands, complete reference PCM and provenance`);
}
