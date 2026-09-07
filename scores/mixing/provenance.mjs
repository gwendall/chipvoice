import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {calibrateMixInstrument,mixInstrumentSignature,MIX_PROFILE_VERSION} from '../../packages/chipvoice/dist/mix-calibration.js';
const root=new URL('../../packages/chipvoice/dist/',import.meta.url);
export async function calibrationEngineHash(){
 const files=(await readdir(new URL('chips/',root),{recursive:true})).filter(n=>n.endsWith('.js')).map(n=>'chips/'+n);
 files.push('register-transactions.js','event-queue.js','fifo.js');
 const hash=createHash('sha256').update(String(MIX_PROFILE_VERSION)).update(calibrateMixInstrument.toString()).update(mixInstrumentSignature.toString());for(const file of files.sort())hash.update(file).update(await readFile(new URL(file,root)));return hash.digest('hex');
}
