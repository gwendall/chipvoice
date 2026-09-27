import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {calibrationEngineHash,calibrationEngineModules} from './provenance.mjs';
import {MIX_FACTORY_PROFILES} from '../../packages/chipvoice/dist/mix-profiles.js';
import {MixProfileBank} from '../../packages/chipvoice/dist/mix-calibration.js';
const manifest=JSON.parse(await readFile(new URL('calibration-manifest.json',import.meta.url)));
assert.equal(await calibrationEngineHash(),manifest.engineSha256,'instrument calibration matches the current engine and measurement method');
assert.equal(createHash('sha256').update(JSON.stringify(MIX_FACTORY_PROFILES)).digest('hex'),manifest.profileSha256,'calibration profiles match the generated measurement snapshot');
for(const p of MIX_FACTORY_PROFILES)new MixProfileBank([p]);
assert.equal(MIX_FACTORY_PROFILES.length,manifest.profiles);
console.log('PASS calibrated instrument response provenance',manifest.profiles);

// The hash only earns "recalibrate when it matters" if it actually reaches
// every chip calibrate.mjs renders and stays put when an unrelated file
// merely exists under chips/**. Prove both, not just assert a manifest match.
const modules=await calibrationEngineModules();
for(const expected of [
 // 2A03: core and driver.
 'chips/nes/dsp.js','chips/nes/driver.js',
 // Game Boy: core and driver.
 'chips/gb/dsp.js','chips/gb/driver.js',
 // Mega Drive: driver plus both sound generators calibrate.mjs measures.
 'chips/md/driver.js','chips/md/ym2612.js','chips/md/sn76489.js',
 // SNES: driver and the S-DSP core.
 'chips/snes/driver.js','chips/snes/sdsp.js',
 // C64: driver and the SID core.
 'chips/c64/driver.js','chips/c64/sid.js',
 // The probe instruments and the measurement itself.
 'performance-palette.js','mix-calibration.js',
]) assert.ok(modules.includes(expected),`calibration hash must reach ${expected}`);
assert.ok(!modules.includes('mix-profiles.js'),'calibration hash must not reach its own generated output');
console.log('PASS calibration hash reaches every chip calibrate.mjs renders',modules.length,'modules');

// A file under chips/** that nothing imports (a new chip's file-format player,
// dropped in by a sibling PR before anything wires it up) must not move the
// hash. Prove it by actually adding one to the built dist, not by reasoning
// about esbuild's tree-shaking from the outside.
const unusedFile=new URL('../../packages/chipvoice/dist/chips/snes/_calibration-hash-proof-unused.js',import.meta.url);
try{
 await writeFile(unusedFile,'// Nothing imports this file; it exists only to prove the calibration hash ignores unreached modules.\nexport const unused=1;\n');
 assert.equal(await calibrationEngineHash(),manifest.engineSha256,'an unreached file under chips/** must not move the calibration hash');
}finally{
 await unlink(unusedFile).catch(()=>{});
}
console.log('PASS an unreached file under chips/** leaves the calibration hash unchanged');
