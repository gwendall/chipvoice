import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Compare execution traces directly. No time shifting, warping or resynthesis. */
export function compareNativeTrace(native,trace){
 const first=native.events.findIndex(e=>e.addr===0x4017&&e.value===255);
 assert.ok(first>=0,'first musical PLAY boundary');
 const expected=native.events.slice(first),last=expected.at(-1).at;
 const events=trace.trim().split('\n').map(line=>{const [at,addr,value]=line.trim().split(/\s+/).map(Number);assert.ok(Number.isSafeInteger(at)&&Number.isInteger(addr)&&Number.isInteger(value));return {at,addr,value};});
 const begin=events.findIndex(e=>e.at===expected[0].at&&e.addr===expected[0].addr&&e.value===expected[0].value);
 assert.ok(begin>=0,'independent trace reaches the same first PLAY');
 const actual=events.slice(begin).filter(e=>e.at<=last);
 assert.deepEqual(actual,expected,'every command and absolute cycle');
 return {musicCommands:actual.length,commandsSha256:hash(JSON.stringify(actual)),exactCycles:true};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const directory=process.argv[2]??'.artifacts/arrangements',candidate=process.argv[3]??'scores/arrangements/mario-native.json';
 const trace=await readFile(`${directory}/gme-writes.txt`),manifest=JSON.parse(await readFile(`${directory}/native-reference.json`)),reference=JSON.parse(await readFile(new URL('./references/mario.json',import.meta.url)));
 assert.equal(hash(trace),manifest.traceSha256);assert.equal(manifest.traceSha256,reference.traceSha256);assert.equal(manifest.pcmSha256,reference.pcmSha256);assert.equal(manifest.oracleRevision,reference.oracleRevision);assert.equal(manifest.sourceSha256,reference.sourceSha256);
 const result=compareNativeTrace(JSON.parse(await readFile(candidate)),trace.toString());
 assert.equal(result.commandsSha256,reference.commandsSha256);assert.equal(result.musicCommands,reference.musicCommands);
 console.log(JSON.stringify(result,null,2));
}
